import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Environment variables interface
interface Env {
	CRAFT_DOCUMENTS: string;
}

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
			async ({ document, markdown, parent, position, subpage }) => {
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
								position: parent
									? { position, pageId: parent }
									: { position, pageId: "0" },
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

						const createdPage = (await pageResponse.json()) as InsertedBlock[];
						const pageId = createdPage[0].id;

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

							const contentBlocks =
								(await contentResponse.json()) as InsertedBlock[];
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
					const requestBody = {
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

					const insertedBlocks = (await response.json()) as InsertedBlock[];
					return {
						content: [
							{
								type: "text",
								text: `Successfully inserted text at ${position} of ${parent || "root"}. Created ${insertedBlocks.length} block(s) with ID(s): ${insertedBlocks.map((b) => b.id).join(", ")}`,
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
				document: z
					.string()
					.describe("Name of the document to delete from (e.g., 'MCP test')."),
				id: z
					.string()
					.describe("ID of the page or heading to delete. WARNING: Deletes entire section including nested content."),
			},
			async ({ document, id }) => {
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

					const response = await fetch(`${documentUrl}/blocks`, {
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
				document: z
					.string()
					.describe("Name of the document to fetch (e.g., 'MCP test')."),
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

		// 5. getCollectionItems - Retrieve items from a collection
		this.server.tool(
			"getCollectionItems",
			{
				document: z
					.string()
					.describe("Name of the document containing the collection (e.g., 'MCP test')."),
				collectionName: z
					.string()
					.describe("Name of the collection to retrieve items from (e.g., 'drafts', 'notes', 'tasks')."),
				maxDepth: z
					.number()
					.optional()
					.default(-1)
					.describe("Maximum depth of nested content to fetch for each item. Default -1 (all), 0 (only properties)."),
				useMarkdown: z
					.boolean()
					.optional()
					.default(false)
					.describe("If true, returns contentMarkdown field instead of nested content blocks."),
			},
			async ({ document, collectionName, maxDepth, useMarkdown }) => {
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
					if (maxDepth !== undefined) params.set("maxDepth", maxDepth.toString());

					const headers: Record<string, string> = {
						Accept: useMarkdown
							? "application/json; content=markdown"
							: "application/json",
					};

					const response = await fetch(
						`${documentUrl}/collections/${collectionName}/items?${params.toString()}`,
						{
							method: "GET",
							headers: headers,
						},
					);

					if (!response.ok) {
						const errorText = await response.text();
						return {
							content: [
								{
									type: "text",
									text: `Failed to get collection items: Craft API error (${response.status}): ${errorText}. Make sure the collection '${collectionName}' exists in the current document.`,
								},
							],
							isError: true,
						};
					}

					const items = (await response.json()) as any[];
					const formatted = JSON.stringify(items, null, 2);

					return {
						content: [
							{
								type: "text",
								text: `Found ${items.length} item(s) in collection '${collectionName}':\n\n${formatted}`,
							},
						],
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: `Failed to get collection items: ${error instanceof Error ? error.message : String(error)}`,
							},
						],
						isError: true,
					};
				}
			},
		);

		// 6. createCollectionItems - Add new items to a collection
		this.server.tool(
			"createCollectionItems",
			{
				document: z
					.string()
					.describe("Name of the document containing the collection (e.g., 'MCP test')."),
				collectionName: z
					.string()
					.describe("Name of the collection to add items to (e.g., 'drafts', 'notes', 'tasks')."),
				items: z
					.array(
						z.object({
							title: z.string().describe("Title of the item"),
							properties: z
								.record(z.any())
								.optional()
								.describe(
									"Properties object matching the collection schema (e.g., {status: 'todo', priority: 'high'}). Schema depends on the collection.",
								),
						}),
					)
					.describe("Array of items to create in the collection."),
				allowNewSelectOptions: z
					.boolean()
					.optional()
					.default(false)
					.describe("If true, allows creating new select options if they don't exist in the schema."),
			},
			async ({ document, collectionName, items, allowNewSelectOptions }) => {
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

					const response = await fetch(
						`${documentUrl}/collections/${collectionName}/items`,
						{
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								items: items,
								allowNewSelectOptions: allowNewSelectOptions,
							}),
						},
					);

					if (!response.ok) {
						const errorText = await response.text();
						return {
							content: [
								{
									type: "text",
									text: `Failed to create collection items: Craft API error (${response.status}): ${errorText}. Check that properties match the collection schema and that the collection '${collectionName}' exists.`,
								},
							],
							isError: true,
						};
					}

					const createdItems = (await response.json()) as any[];
					const formatted = JSON.stringify(createdItems, null, 2);

					return {
						content: [
							{
								type: "text",
								text: `Successfully created ${createdItems.length} item(s) in collection '${collectionName}':\n\n${formatted}`,
							},
						],
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: `Failed to create collection items: ${error instanceof Error ? error.message : String(error)}`,
							},
						],
						isError: true,
					};
				}
			},
		);

		// 7. updateCollectionItems - Update existing items in a collection
		this.server.tool(
			"updateCollectionItems",
			{
				document: z
					.string()
					.describe("Name of the document containing the collection (e.g., 'MCP test')."),
				collectionName: z
					.string()
					.describe("Name of the collection to update items in (e.g., 'drafts', 'notes', 'tasks')."),
				itemsToUpdate: z
					.array(
						z.object({
							id: z.string().describe("ID of the item to update"),
							title: z.string().optional().describe("New title for the item"),
							properties: z
								.record(z.any())
								.optional()
								.describe(
									"Properties to update (e.g., {status: 'done'}). Only specified properties are updated.",
								),
						}),
					)
					.describe("Array of items to update in the collection."),
				allowNewSelectOptions: z
					.boolean()
					.optional()
					.default(false)
					.describe("If true, allows creating new select options if they don't exist in the schema."),
			},
			async ({ document, collectionName, itemsToUpdate, allowNewSelectOptions }) => {
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

					const response = await fetch(
						`${documentUrl}/collections/${collectionName}/items`,
						{
							method: "PUT",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								itemsToUpdate: itemsToUpdate,
								allowNewSelectOptions: allowNewSelectOptions,
							}),
						},
					);

					if (!response.ok) {
						const errorText = await response.text();
						return {
							content: [
								{
									type: "text",
									text: `Failed to update collection items: Craft API error (${response.status}): ${errorText}. Check that item IDs exist and properties match the collection schema.`,
								},
							],
							isError: true,
						};
					}

					const updatedItems = (await response.json()) as any[];
					const formatted = JSON.stringify(updatedItems, null, 2);

					return {
						content: [
							{
								type: "text",
								text: `Successfully updated ${updatedItems.length} item(s) in collection '${collectionName}':\n\n${formatted}`,
							},
						],
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: `Failed to update collection items: ${error instanceof Error ? error.message : String(error)}`,
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
