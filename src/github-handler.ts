import { Octokit } from "@octokit/rest";

/**
 * Props type containing authenticated user information
 * This gets passed to the MCP agent after successful authentication
 */
export type Props = {
	login: string;
	name: string;
	email: string;
	accessToken: string;
};

/**
 * Environment interface
 */
interface Env {
	CRAFT_DOCUMENTS: string;
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	ALLOWED_USERNAMES?: string;
	OAUTH_KV: KVNamespace;
}

/**
 * GitHub OAuth handler
 * Acts as an OAuth server to MCP clients while being an OAuth client to GitHub
 */
const GitHubHandler: ExportedHandler<Env> = {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// Handle GitHub OAuth callback
		if (url.pathname === "/callback") {
			const code = url.searchParams.get("code");
			const state = url.searchParams.get("state");

			if (!code) {
				return new Response("Missing authorization code", { status: 400 });
			}

			// Exchange code for access token with GitHub
			const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify({
					client_id: env.GITHUB_CLIENT_ID,
					client_secret: env.GITHUB_CLIENT_SECRET,
					code,
				}),
			});

			const tokenData = (await tokenResponse.json()) as any;
			if (!tokenData.access_token) {
				return new Response("Failed to get access token from GitHub", { status: 500 });
			}

			// Get user info from GitHub using Octokit
			const octokit = new Octokit({ auth: tokenData.access_token });
			const { data: user } = await octokit.users.getAuthenticated();

			// Check if user is in allowed list
			if (env.ALLOWED_USERNAMES) {
				const allowedUsernames = env.ALLOWED_USERNAMES.split(",").map((u) => u.trim().toLowerCase());
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
						{ status: 403, headers: { "Content-Type": "text/html" } }
					);
				}
			}

			// Store the OAuth state with user props
			// This will be used by OAuthProvider when issuing tokens
			if (state) {
				const props: Props = {
					login: user.login,
					name: user.name || "",
					email: user.email || "",
					accessToken: tokenData.access_token,
				};

				await env.OAUTH_KV.put(`oauth:state:${state}`, JSON.stringify(props), {
					expirationTtl: 300, // 5 minutes
				});
			}

			// Redirect back to the OAuth flow
			// OAuthProvider will handle the rest
			return Response.redirect(url.origin + (state ? `?state=${state}` : ""), 302);
		}

		// Landing page
		return new Response(
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
			Connect via MCP endpoint: <code>${url.origin}/sse</code>
		</p>
	</div>
</body>
</html>`,
			{ headers: { "Content-Type": "text/html" } }
		);
	},
};

export default GitHubHandler;
