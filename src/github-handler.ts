import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import { Octokit } from "@octokit/rest";
import { fetchUpstreamAuthToken, getUpstreamAuthorizeUrl, type Props } from "./utils.js";
import {
	addApprovedClient,
	bindStateToSession,
	createOAuthState,
	generateCSRFProtection,
	isClientApproved,
	OAuthError,
	renderApprovalDialog,
	validateCSRFToken,
	validateOAuthState,
} from "./workers-oauth-utils.js";

/**
 * Environment interface
 */
export interface Env {
	CRAFT_DOCUMENTS: string;
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	ALLOWED_USERNAMES?: string;
	OAUTH_KV: KVNamespace;
	COOKIE_ENCRYPTION_KEY?: string;
}

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

/**
 * Authorization endpoint (GET)
 * Displays approval dialog or skips if client is already approved
 */
app.get("/authorize", async (c) => {
	const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
	const { clientId } = oauthReqInfo;
	if (!clientId) {
		return c.text("Invalid request", 400);
	}

	// Check if client is already approved
	const encryptionKey = c.env.COOKIE_ENCRYPTION_KEY || c.env.GITHUB_CLIENT_SECRET;
	if (await isClientApproved(c.req.raw, clientId, encryptionKey)) {
		// Skip approval dialog but still create secure state and bind to session
		const { stateToken } = await createOAuthState(oauthReqInfo, c.env.OAUTH_KV);
		const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);
		return redirectToGithub(c.req.raw, c.env.GITHUB_CLIENT_ID, stateToken, { "Set-Cookie": sessionBindingCookie });
	}

	// Generate CSRF protection for the approval form
	const { token: csrfToken, setCookie } = generateCSRFProtection();

	return renderApprovalDialog(c.req.raw, {
		client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
		csrfToken,
		server: {
			description: "Remote MCP server for Craft document management, authenticated via GitHub.",
			logo: "https://avatars.githubusercontent.com/u/314135?s=200&v=4",
			name: "Craft MCP Server",
		},
		setCookie,
		state: { oauthReqInfo },
	});
});

/**
 * Authorization endpoint (POST)
 * Handles approval form submission
 */
app.post("/authorize", async (c) => {
	try {
		// Read form data once
		const formData = await c.req.raw.formData();

		// Validate CSRF token
		validateCSRFToken(formData, c.req.raw);

		// Extract state from form data
		const encodedState = formData.get("state");
		if (!encodedState || typeof encodedState !== "string") {
			return c.text("Missing state in form data", 400);
		}

		let state: { oauthReqInfo?: AuthRequest };
		try {
			state = JSON.parse(atob(encodedState));
		} catch (_e) {
			return c.text("Invalid state data", 400);
		}

		if (!state.oauthReqInfo || !state.oauthReqInfo.clientId) {
			return c.text("Invalid request", 400);
		}

		// Add client to approved list
		const encryptionKey = c.env.COOKIE_ENCRYPTION_KEY || c.env.GITHUB_CLIENT_SECRET;
		const approvedClientCookie = await addApprovedClient(
			c.req.raw,
			state.oauthReqInfo.clientId,
			encryptionKey,
		);

		// Create OAuth state and bind it to this user's session
		const { stateToken } = await createOAuthState(state.oauthReqInfo, c.env.OAUTH_KV);
		const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);

		// Set both cookies: approved client list + session binding
		const headers = new Headers();
		headers.append("Set-Cookie", approvedClientCookie);
		headers.append("Set-Cookie", sessionBindingCookie);

		return redirectToGithub(c.req.raw, c.env.GITHUB_CLIENT_ID, stateToken, Object.fromEntries(headers));
	} catch (error: any) {
		console.error("POST /authorize error:", error);
		if (error instanceof OAuthError) {
			return error.toResponse();
		}
		// Unexpected non-OAuth error
		return c.text(`Internal server error: ${error.message}`, 500);
	}
});

/**
 * Redirect to GitHub OAuth
 */
async function redirectToGithub(
	request: Request,
	githubClientId: string,
	stateToken: string,
	headers: Record<string, string> = {},
) {
	return new Response(null, {
		headers: {
			...headers,
			location: getUpstreamAuthorizeUrl({
				client_id: githubClientId,
				redirect_uri: new URL("/callback", request.url).href,
				scope: "read:user user:email",
				state: stateToken,
				upstream_url: "https://github.com/login/oauth/authorize",
			}),
		},
		status: 302,
	});
}

/**
 * OAuth Callback Endpoint
 * Handles the callback from GitHub after user authentication
 */
app.get("/callback", async (c) => {
	// Validate OAuth state with session binding
	let oauthReqInfo: AuthRequest;
	let clearSessionCookie: string;

	try {
		const result = await validateOAuthState(c.req.raw, c.env.OAUTH_KV);
		oauthReqInfo = result.oauthReqInfo;
		clearSessionCookie = result.clearCookie;
	} catch (error: any) {
		if (error instanceof OAuthError) {
			return error.toResponse();
		}
		console.error("State validation failed:", error);
		return c.text("Invalid state", 400);
	}

	// Get code from query params
	const code = c.req.query("code");
	const [accessToken, tokenError] = await fetchUpstreamAuthToken({
		client_id: c.env.GITHUB_CLIENT_ID,
		client_secret: c.env.GITHUB_CLIENT_SECRET,
		code,
		redirect_uri: new URL("/callback", c.req.raw.url).href,
		upstream_url: "https://github.com/login/oauth/access_token",
	});

	if (tokenError) {
		return tokenError;
	}

	// Get user info from GitHub
	const octokit = new Octokit({ auth: accessToken });
	const { data: user } = await octokit.users.getAuthenticated();

	// Check if user is in allowed list
	if (c.env.ALLOWED_USERNAMES) {
		const allowedUsernames = c.env.ALLOWED_USERNAMES.split(",").map((u: string) => u.trim().toLowerCase());
		if (!allowedUsernames.includes(user.login.toLowerCase())) {
			return new Response(
				`<!DOCTYPE html>
<html>
<head>
	<title>Access Denied</title>
	<style>
		body {
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
			display: flex;
			justify-content: center;
			align-items: center;
			min-height: 100vh;
			margin: 0;
			background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		}
		.container {
			background: white;
			padding: 3rem;
			border-radius: 1rem;
			box-shadow: 0 20px 60px rgba(0,0,0,0.3);
			text-align: center;
			max-width: 500px;
		}
		h1 { color: #dc3545; margin-bottom: 1rem; }
		p { color: #666; line-height: 1.6; }
	</style>
</head>
<body>
	<div class="container">
		<h1>⛔ Access Denied</h1>
		<p>User <strong>${user.login}</strong> is not authorized to access this MCP server.</p>
		<p style="font-size: 0.9em; margin-top: 1.5rem;">Contact the server administrator if you believe this is an error.</p>
	</div>
</body>
</html>`,
				{
					status: 403,
					headers: {
						"Content-Type": "text/html",
						"Set-Cookie": clearSessionCookie,
					},
				}
			);
		}
	}

	// Store user props for the OAuth token
	const props: Props = {
		login: user.login,
		name: user.name || "",
		email: user.email || "",
		accessToken: accessToken,
	};

	// Complete the OAuth flow by creating a grant and getting the redirect URL
	const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
		request: oauthReqInfo,
		userId: user.login,
		metadata: {}, // Optional metadata about the grant itself
		props, // User props that will be available to MCP tools via this.props
		scope: oauthReqInfo.scope || [],
	});

	return new Response(null, {
		headers: {
			location: redirectTo,
			"Set-Cookie": clearSessionCookie,
		},
		status: 302,
	});
});

/**
 * Landing page
 */
app.get("/", async (c) => {
	return c.html(
		`<!DOCTYPE html>
<html>
<head>
	<title>Craft MCP Server</title>
	<style>
		body {
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
			display: flex;
			justify-content: center;
			align-items: center;
			min-height: 100vh;
			margin: 0;
			background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		}
		.container {
			background: white;
			padding: 3rem;
			border-radius: 1rem;
			box-shadow: 0 20px 60px rgba(0,0,0,0.3);
			text-align: center;
			max-width: 500px;
		}
		h1 { color: #333; margin-bottom: 0.5rem; }
		.subtitle { color: #666; margin-bottom: 2rem; font-size: 0.95em; }
		.info { background: #d1ecf1; color: #0c5460; padding: 1rem; border-radius: 0.5rem; margin: 1.5rem 0; text-align: left; }
		.info h3 { margin: 0 0 0.5rem 0; font-size: 1em; }
		.info p { margin: 0; font-size: 0.9em; line-height: 1.5; }
		code { background: #f4f4f4; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; }
	</style>
</head>
<body>
	<div class="container">
		<h1>🚀 Craft MCP Server</h1>
		<p class="subtitle">Remote Model Context Protocol server for Craft documents</p>

		<div class="info">
			<h3>🔒 OAuth 2.1 Authentication</h3>
			<p>This server uses GitHub for authentication. Configure your MCP client to connect to this server, and you'll be prompted to authenticate via GitHub.</p>
		</div>

		<p style="margin-top: 2rem; font-size: 0.9em; color: #888;">
			Connect via MCP endpoint: <code>${c.req.raw.url.replace(/\/$/, "")}/sse</code>
		</p>
	</div>
</body>
</html>`
	);
});

// Export as ExportedHandler for OAuthProvider compatibility
export default {
	async fetch(request: Request, env: Env & { OAUTH_PROVIDER: OAuthHelpers }, ctx: ExecutionContext): Promise<Response> {
		return app.fetch(request, env, ctx);
	},
};
