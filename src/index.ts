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
		// 1. insertText - Insert markdown content into the document
		this.server.tool(
			"insertText",
			{
				markdown: z
					.string()
					.describe("Markdown content to insert. Supports headings, lists, text formatting, blockquotes, etc."),
				parent: z
					.string()
					.optional()
					.describe("ID of page or heading to insert into. Omit for root page."),
				position: z
					.enum(["start", "end"])
					.describe("Where to insert within the parent: 'start' or 'end'."),
				subpage: z
					.boolean()
					.optional()
					.default(false)
					.describe("If true, wraps content in a new page block (first heading becomes page title)."),
			},
			async ({ markdown, parent, position, subpage }) => {
				try {
					let requestBody: any;

					if (subpage) {
						// Create a page block with the markdown as content
						requestBody = {
							blocks: [
								{
									type: "page",
									textStyle: "page",
									markdown: `<page>${markdown}</page>`,
								},
							],
							position: parent
								? { position, pageId: parent }
								: { position, pageId: "0" },
						};
					} else {
						// Insert as regular text block
						requestBody = {
							blocks: [
								{
									type: "text",
									markdown: markdown,
								},
							],
							position: parent
								? { position, pageId: parent }
								: { position, pageId: "0" },
						};
					}

					const response = await fetch(`${CRAFT_API_BASE_URL}/blocks`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(requestBody),
					});

					if (!response.ok) {
						const errorText = await response.text();
						return {
							content: [
								{
									type: "text",
									text: `Failed to insert text: Craft API error (${response.status}): ${errorText}`,
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
								text: `Successfully inserted ${subpage ? "subpage" : "text"} at ${position} of ${parent || "root"}. Created ${insertedBlocks.length} block(s) with ID(s): ${insertedBlocks.map((b) => b.id).join(", ")}`,
							},
						],
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: `Failed to insert text: ${error instanceof Error ? error.message : String(error)}`,
							},
						],
						isError: true,
					};
				}
			},
		);

		// 2. deleteText - Delete a page or heading and all its content
		this.server.tool(
			"deleteText",
			{
				id: z
					.string()
					.describe("ID of the page or heading to delete. WARNING: Deletes entire section including nested content."),
			},
			async ({ id }) => {
				try {
					const response = await fetch(`${CRAFT_API_BASE_URL}/blocks`, {
						method: "DELETE",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ blockIds: [id] }),
					});

					if (!response.ok) {
						const errorText = await response.text();
						return {
							content: [
								{
									type: "text",
									text: `Failed to delete block: Craft API error (${response.status}): ${errorText}`,
								},
							],
							isError: true,
						};
					}

					const deletedIds = (await response.json()) as string[];
					return {
						content: [
							{
								type: "text",
								text: `Successfully deleted block ${id}. Deleted ${deletedIds.length} block(s).`,
							},
						],
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: `Failed to delete block: ${error instanceof Error ? error.message : String(error)}`,
							},
						],
						isError: true,
					};
				}
			},
		);

		// 3. fetchBlocks - Read document content with IDs embedded
		this.server.tool(
			"fetchBlocks",
			{
				id: z
					.string()
					.optional()
					.describe("ID of page or heading to fetch. Omit for root page."),
				maxDepth: z
					.number()
					.optional()
					.default(-1)
					.describe("Maximum nesting depth to fetch. Default -1 (all), 0 (only block), 1 (immediate children)."),
			},
			async ({ id, maxDepth }) => {
				try {
					const params = new URLSearchParams();
					if (id) params.set("id", id);
					if (maxDepth !== undefined) params.set("maxDepth", maxDepth.toString());

					const response = await fetch(
						`${CRAFT_API_BASE_URL}/blocks?${params.toString()}`,
						{
							method: "GET",
							headers: { Accept: "application/json" },
						},
					);

					if (!response.ok) {
						const errorText = await response.text();
						return {
							content: [
								{
									type: "text",
									text: `Failed to fetch blocks: Craft API error (${response.status}): ${errorText}`,
								},
							],
							isError: true,
						};
					}

					const blocks = (await response.json()) as any[];
					const markdown = this.convertBlocksToMarkdown(blocks);

					return {
						content: [
							{
								type: "text",
								text: markdown,
							},
						],
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: `Failed to fetch blocks: ${error instanceof Error ? error.message : String(error)}`,
							},
						],
						isError: true,
					};
				}
			},
		);

		// 4. search - Search within the document
		this.server.tool(
			"search",
			{
				pattern: z
					.string()
					.describe("Search pattern (supports regex)."),
				caseSensitive: z
					.boolean()
					.optional()
					.default(false)
					.describe("Case-sensitive search (default: false)."),
				beforeBlockCount: z
					.number()
					.optional()
					.default(2)
					.describe("Number of context blocks before match (default: 2)."),
				afterBlockCount: z
					.number()
					.optional()
					.default(2)
					.describe("Number of context blocks after match (default: 2)."),
			},
			async ({ pattern, caseSensitive, beforeBlockCount, afterBlockCount }) => {
				try {
					const params = new URLSearchParams();
					params.set("pattern", pattern);
					if (caseSensitive) params.set("caseSensitive", "true");
					if (beforeBlockCount !== undefined)
						params.set("beforeBlockCount", beforeBlockCount.toString());
					if (afterBlockCount !== undefined)
						params.set("afterBlockCount", afterBlockCount.toString());

					const response = await fetch(
						`${CRAFT_API_BASE_URL}/blocks/search?${params.toString()}`,
						{
							method: "GET",
							headers: { Accept: "application/json" },
						},
					);

					if (!response.ok) {
						const errorText = await response.text();
						return {
							content: [
								{
									type: "text",
									text: `Failed to search: Craft API error (${response.status}): ${errorText}`,
								},
							],
							isError: true,
						};
					}

					const results = (await response.json()) as any[];
					const formatted = this.formatSearchResults(results);

					return {
						content: [
							{
								type: "text",
								text: formatted,
							},
						],
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: `Failed to search: ${error instanceof Error ? error.message : String(error)}`,
							},
						],
						isError: true,
					};
				}
			},
		);
	}

	/**
	 * Convert Craft API blocks JSON to markdown with embedded IDs
	 */
	private convertBlocksToMarkdown(blocks: any[]): string {
		if (!blocks || blocks.length === 0) return "";

		const processBlock = (block: any, depth: number = 0): string => {
			if (block.type === "page") {
				// Extract page title from markdown
				const titleMatch = block.markdown?.match(/<page>(.*?)<\/page>/s);
				const pageTitle = titleMatch ? titleMatch[1] : "";

				let result = `<page id="${block.id}">\n`;
				result += `  <pageTitle>${pageTitle}</pageTitle>\n`;
				result += `  <content>\n`;

				if (block.content && Array.isArray(block.content)) {
					for (const child of block.content) {
						result += processBlock(child, depth + 1)
							.split("\n")
							.map((line) => (line ? "    " + line : ""))
							.join("\n");
					}
				}

				result += `  </content>\n`;
				result += `</page>\n`;
				return result;
			}

			if (block.type === "text") {
				let markdown = block.markdown || "";

				// Add ID comment for headings
				if (block.textStyle && block.textStyle.startsWith("h")) {
					markdown = `${markdown} <!-- id:${block.id} -->`;
				}

				return markdown + "\n\n";
			}

			// Other block types (images, files, etc.)
			return (block.markdown || "") + "\n\n";
		};

		let result = "";
		for (const block of blocks) {
			result += processBlock(block);
		}

		return result.trim();
	}

	/**
	 * Format search results from Craft API into readable text
	 */
	private formatSearchResults(results: any[]): string {
		if (!results || results.length === 0) {
			return "No results found.";
		}

		let output = `Found ${results.length} match(es):\n\n`;

		for (const result of results) {
			// Show path
			if (result.pageBlockPath && result.pageBlockPath.length > 0) {
				const path = result.pageBlockPath
					.map((p: any) => p.content)
					.join(" > ");
				output += `Path: ${path}\n`;
			}

			// Show before blocks
			if (result.beforeBlocks && result.beforeBlocks.length > 0) {
				for (const block of result.beforeBlocks) {
					output += `${block.blockId}- ${block.markdown}\n`;
				}
			}

			// Show matched block
			output += `${result.blockId}: ${result.markdown}\n`;

			// Show after blocks
			if (result.afterBlocks && result.afterBlocks.length > 0) {
				for (const block of result.afterBlocks) {
					output += `${block.blockId}- ${block.markdown}\n`;
				}
			}

			output += "\n---\n\n";
		}

		return output.trim();
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
