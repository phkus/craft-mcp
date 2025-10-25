import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Craft API configuration
const CRAFT_API_BASE_URL = "https://connect.craft.do/links/AcHPMgNXYdR/api/v1";

// Type definition for inserted blocks
interface InsertedBlock {
	id: string;
	type: string;
	markdown?: string;
}

/**
 * MCP Server for Craft document management
 */
export class MyMCP extends McpAgent {
	server = new McpServer({
		name: "craft-mcp-server",
		version: "1.0.0",
	});

	async init() {
		// Register the append_text tool
		this.server.tool(
			"append_text",
			{
				pageId: z
					.string()
					.optional()
					.default("0")
					.describe(
						"The ID of the page block to append text to. Use '0' for the root page if unsure.",
					),
				text: z
					.string()
					.describe(
						"The markdown text content to append to the page. Supports headings, lists, text formatting, etc.",
					),
			},
			async ({ pageId, text }) => {
				// Prepare the request body for Craft API
				const requestBody = {
					blocks: [
						{
							type: "text",
							markdown: text,
						},
					],
					position: {
						position: "end",
						pageId: pageId,
					},
				};

				try {
					// Call Craft API to insert the block
					const response = await fetch(`${CRAFT_API_BASE_URL}/blocks`, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
						},
						body: JSON.stringify(requestBody),
					});

					if (!response.ok) {
						const errorText = await response.text();
						return {
							content: [
								{
									type: "text",
									text: `Failed to append text: Craft API error (${response.status}): ${errorText}`,
								},
							],
							isError: true,
						};
					}

					const insertedBlocks = (await response.json()) as InsertedBlock[];

					return {
						content: [
							{
								type: "text",
								text: `Successfully appended text to page ${pageId}. Inserted ${insertedBlocks.length} block(s) with ID(s): ${insertedBlocks.map((b) => b.id).join(", ")}`,
							},
						],
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: `Failed to append text: ${error instanceof Error ? error.message : String(error)}`,
							},
						],
						isError: true,
					};
				}
			},
		);
	}
}

// Export the fetch handler with routing
export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
		}

		if (url.pathname === "/mcp") {
			return MyMCP.serve("/mcp").fetch(request, env, ctx);
		}

		return new Response("Not found", { status: 404 });
	},
};
