import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import GitHubHandler, { type Env } from "./github-handler.js";
import type { Props } from "./utils.js";

// Type definition for inserted blocks
interface InsertedBlock {
	id: string;
	type: string;
	markdown?: string;
}

/**
 * MCP Server for Craft document management
 * Props contain authenticated user information from GitHub OAuth
 */
export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "craft-mcp-server",
		version: "1.0.0",
	});

	// Document configuration from environment variables
	private documents: Record<string, string> = {};

	async init() {
		// Parse document mappings from environment variable
		try {
			const env = this.env as Env;
			this.documents = JSON.parse(env.CRAFT_DOCUMENTS || "{}");
		} catch (error) {
			console.error("Failed to parse CRAFT_DOCUMENTS:", error);
			this.documents = {};
		}

		// 0. listDocuments - Show available documents
		this.server.tool(
			"listDocuments",
			{},
			async () => {
				try {
					const documentNames = Object.keys(this.documents);

					if (documentNames.length === 0) {
						return {
							content: [
								{
									type: "text",
									text: "No documents configured. Please add document URLs to the CRAFT_DOCUMENTS environment variable in wrangler.toml.",
								},
							],
						};
					}

					let text = `Available documents (${documentNames.length}):\n\n`;
					for (const name of documentNames) {
						text += `- ${name}\n`;
					}

					return {
						content: [
							{
								type: "text",
								text: text.trim(),
							},
						],
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: `Failed to list documents: ${error instanceof Error ? error.message : String(error)}`,
							},
						],
						isError: true,
					};
				}
			},
		);

		// 1. insertText - Insert markdown content into the document
		this.server.tool(
			"insertText",
			{
				document: z
					.string()
					.describe("Name of the document to insert into (e.g., 'MCP test')."),
				markdown: z
					.string()
					.describe("Markdown content to insert. Supports headings, lists, text formatting, blockquotes, etc."),
				afterBlock: z
					.string()
					.optional()
					.describe("ID of block to insert after. Mutually exclusive with beforeBlock."),
				beforeBlock: z
					.string()
					.optional()
					.describe("ID of block to insert before. Mutually exclusive with afterBlock."),
				subpage: z
					.boolean()
					.optional()
					.default(false)
					.describe("If true, wraps content in a new page block (first heading becomes page title)."),
				variant: z
					.enum(["1", "2", "3"])
					.optional()
					.default("1")
					.describe("Color variant: '1' = purple (default), '2' = red, '3' = blue. Only use variants 2 and 3 for alternative AI formulations (not for revising user's text). Insert alternative variants sequentially (after each other, not after the same block)."),
			},
			async ({ document, markdown, afterBlock, beforeBlock, subpage, variant }) => {
				// Map variant to color
				const variantColors: Record<string, string> = {
					"1": "#9b59b6", // Purple (default)
					"2": "#e74c3c", // Red
					"3": "#3498db", // Blue
				};
				const color = variantColors[variant || "1"];

				try {
					// Validate parameters
					if (!afterBlock && !beforeBlock) {
						return {
							content: [
								{
									type: "text",
									text: "Either afterBlock or beforeBlock must be specified.",
								},
							],
							isError: true,
						};
					}

					if (afterBlock && beforeBlock) {
						return {
							content: [
								{
									type: "text",
									text: "Cannot specify both afterBlock and beforeBlock. Choose one.",
								},
							],
							isError: true,
						};
					}

					// Get document URL
					const documentUrl = this.documents[document];
					if (!documentUrl) {
						const available = Object.keys(this.documents).join(", ");
						return {
							content: [
								{
									type: "text",
									text: `Document '${document}' not found. Available documents: ${available}`,
								},
							],
							isError: true,
						};
					}
					if (subpage) {
						// Two-step process for creating subpages with content:
						// Step 1: Create the page with just the title
						// Step 2: Insert content into that page (Craft auto-parses multiline markdown)

						// Parse markdown to extract title and content
						const lines = markdown.split('\n');
						let pageTitle = '';
						let contentMarkdown = '';
						let foundTitle = false;

						for (let i = 0; i < lines.length; i++) {
							const line = lines[i];
							// Check if this is a heading (starts with #)
							if (!foundTitle && line.trim().startsWith('#')) {
								// Extract title without the # symbols
								pageTitle = line.replace(/^#+\s*/, '').trim();
								foundTitle = true;
							} else if (foundTitle) {
								// Everything after the first heading goes into content
								contentMarkdown += (contentMarkdown ? '\n' : '') + line;
							}
						}

						// Build position object for new API
						const position = afterBlock
							? { position: "after" as const, siblingId: afterBlock }
							: { position: "before" as const, siblingId: beforeBlock! };

						// Step 1: Create the page with title only (no <page> tags)
						const pageResponse = await fetch(`${documentUrl}/blocks`, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								blocks: [
									{
										type: "page",
										markdown: pageTitle || "Untitled Page",
									},
								],
								position,
							}),
						});

						if (!pageResponse.ok) {
							const errorText = await pageResponse.text();
							return {
								content: [
									{
										type: "text",
										text: `Failed to create subpage: Craft API error (${pageResponse.status}): ${errorText}`,
									},
								],
								isError: true,
							};
						}

						const createdPageData = (await pageResponse.json()) as any;
						// Handle new API format: response is now an object, not an array
						const createdPage = Array.isArray(createdPageData) ? createdPageData[0] : createdPageData;
						const pageId = createdPage.id;

						// Step 2: If there's content, insert it into the page
						if (contentMarkdown.trim()) {
							const contentResponse = await fetch(
								`${documentUrl}/blocks`,
								{
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: JSON.stringify({
										blocks: [
											{
												type: "text",
												markdown: contentMarkdown.trim(),
												color, // Color based on variant parameter
												decorations: ["callout"]
											},
										],
										position: {
											position: "end",
											pageId: pageId,
										},
									}),
								},
							);

							if (!contentResponse.ok) {
								const errorText = await contentResponse.text();
								return {
									content: [
										{
											type: "text",
											text: `Created subpage ${pageId} but failed to add content: Craft API error (${contentResponse.status}): ${errorText}`,
										},
									],
									isError: true,
								};
							}

							const contentBlocksData = (await contentResponse.json()) as any;
							// Handle new API format: response is now an object, not an array
							const contentBlocks = Array.isArray(contentBlocksData) ? contentBlocksData : [contentBlocksData];
							return {
								content: [
									{
										type: "text",
										text: `Successfully created subpage ${pageId} with ${contentBlocks.length} content block(s).`,
									},
								],
							};
						}

						return {
							content: [
								{
									type: "text",
									text: `Successfully created empty subpage ${pageId}.`,
								},
							],
						};
					}

					// Regular text insertion (not a subpage)
					// Build position object for new API
					const position = afterBlock
						? { position: "after" as const, siblingId: afterBlock }
						: { position: "before" as const, siblingId: beforeBlock! };

					const requestBody = {
						blocks: [
							{
								type: "text",
								markdown: markdown,
								color, // Color based on variant parameter
								decorations: ["callout"]
							},
						],
						position,
					};

					const response = await fetch(`${documentUrl}/blocks`, {
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

					const insertedBlocksData = (await response.json()) as any;
					// Handle new API format: response is now an object, not an array
					const insertedBlocks = Array.isArray(insertedBlocksData) ? insertedBlocksData : [insertedBlocksData];

					const positionDesc = afterBlock
						? `after block [${afterBlock}]`
						: `before block [${beforeBlock}]`;

					return {
						content: [
							{
								type: "text",
								text: `Successfully inserted ${positionDesc}. Created ${insertedBlocks.length} block(s) with ID(s): ${insertedBlocks.map((b) => b.id).join(", ")}`,
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

		// 2. readDocument - Read document structure and content
		this.server.tool(
			"readDocument",
			{
				document: z
					.string()
					.describe("Name of the document to read (e.g., 'MCP test')."),
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
			async ({ document, id, maxDepth }) => {
				try {
					// Check if document exists
					const documentUrl = this.documents[document];
					if (!documentUrl) {
						const available = Object.keys(this.documents).join(", ");
						return {
							content: [
								{
									type: "text",
									text: `Document '${document}' not found. Available documents: ${available}`,
								},
							],
							isError: true,
						};
					}

					const params = new URLSearchParams();
					if (id) params.set("id", id);
					if (maxDepth !== undefined) params.set("maxDepth", maxDepth.toString());

					const response = await fetch(
						`${documentUrl}/blocks?${params.toString()}`,
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
									text: `Failed to read document: Craft API error (${response.status}): ${errorText}`,
								},
							],
							isError: true,
						};
					}

					const responseData = (await response.json()) as any;
					// Handle new API format: response is now an object, not an array
					const blocks = Array.isArray(responseData) ? responseData : [responseData];
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
								text: `Failed to read document: ${error instanceof Error ? error.message : String(error)}`,
							},
						],
						isError: true,
					};
				}
			},
		);

		// 3. search - Search within the document
		this.server.tool(
			"search",
			{
				document: z
					.string()
					.describe("Name of the document to search in (e.g., 'MCP test')."),
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
			async ({ document, pattern, caseSensitive, beforeBlockCount, afterBlockCount }) => {
				try {
					// Get document URL
					const documentUrl = this.documents[document];
					if (!documentUrl) {
						const available = Object.keys(this.documents).join(", ");
						return {
							content: [
								{
									type: "text",
									text: `Document '${document}' not found. Available documents: ${available}`,
								},
							],
							isError: true,
						};
					}

					const params = new URLSearchParams();
					params.set("pattern", pattern);
					if (caseSensitive) params.set("caseSensitive", "true");
					if (beforeBlockCount !== undefined)
						params.set("beforeBlockCount", beforeBlockCount.toString());
					if (afterBlockCount !== undefined)
						params.set("afterBlockCount", afterBlockCount.toString());

					const response = await fetch(
						`${documentUrl}/blocks/search?${params.toString()}`,
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

					const responseData = (await response.json()) as any;
					// Handle new API format: other endpoints return response.items instead of response
					const results = responseData.items || responseData;
					const formatted = this.formatSearchResults(Array.isArray(results) ? results : [results]);

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
	 * All blocks are prefixed with [id] for precise positioning
	 */
	private convertBlocksToMarkdown(blocks: any[]): string {
		if (!blocks || blocks.length === 0) return "";

		const processBlock = (block: any, depth: number = 0): string => {
			if (block.type === "page") {
				// Extract page title from markdown
				const titleMatch = block.markdown?.match(/<page>(.*?)<\/page>/s);
				const pageTitle = titleMatch ? titleMatch[1] : "";

				let result = `[${block.id}] <page>\n`;
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
				// Add ID prefix to all text blocks
				return `[${block.id}] ${markdown}\n\n`;
			}

			if (block.type === "collection") {
				const collectionName = block.markdown || "Unnamed Collection";
				let result = `[${block.id}] <collection name="${collectionName}">\n`;

				// Extract schema from items
				const items = block.items || [];
				const schemaKeys = new Set<string>();
				items.forEach((item: any) => {
					if (item.properties) {
						Object.keys(item.properties).forEach(key => schemaKeys.add(key));
					}
				});

				const schemaStr = Array.from(schemaKeys).join(", ");
				result += `  <schema>${schemaStr || "no properties"}</schema>\n`;
				result += `  <items count="${items.length}"></items>\n`;
				result += `</collection>\n\n`;
				return result;
			}

			// Other block types (images, videos, files, etc.)
			// Add ID prefix for all block types
			const markdown = block.markdown || "";
			const blockTypeTag = block.type ? `<${block.type}>` : "";
			return `[${block.id}] ${markdown || blockTypeTag}\n\n`;
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

/**
 * Export OAuthProvider as default
 * This acts as the OAuth server for MCP clients
 */
export default new OAuthProvider({
	apiHandlers: {
		"/sse": MyMCP.serveSSE("/sse"),
		"/mcp": MyMCP.serve("/mcp"),
	},
	authorizeEndpoint: "/authorize",
	tokenEndpoint: "/token",
	clientRegistrationEndpoint: "/register",
	// Type assertion needed because OAuthProvider uses generic types
	defaultHandler: GitHubHandler as any,
});
