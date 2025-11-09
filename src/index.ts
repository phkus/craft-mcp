import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Environment variables interface
interface Env {
	CRAFT_DOCUMENTS: string;
	// GitHub OAuth credentials
	GITHUB_CLIENT_ID?: string;
	GITHUB_CLIENT_SECRET?: string;
	// Optional: Allowed GitHub usernames for access control
	ALLOWED_USERNAMES?: string;
	// KV namespace for session storage
	SESSIONS?: KVNamespace;
}

// GitHub user info interface
interface GitHubUser {
	login: string;
	id: number;
	name: string | null;
	email: string | null;
}

// Session data interface
interface SessionData {
	username: string;
	githubId: number;
	expiresAt: number;
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

					const insertedBlocksData = (await response.json()) as any;
					// Handle new API format: response is now an object, not an array
					const insertedBlocks = Array.isArray(insertedBlocksData) ? insertedBlocksData : [insertedBlocksData];
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

					const responseData = (await response.json()) as any;
					// Handle new API format: other endpoints return response.items instead of response
					const deletedIds = responseData.items || responseData;
					const deletedCount = Array.isArray(deletedIds) ? deletedIds.length : 1;
					return {
						content: [
							{
								type: "text",
								text: `Successfully deleted block ${id}. Deleted ${deletedCount} block(s).`,
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

		// 3. readDocument - Read document structure and content
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

		// 5. getCollectionItems - Browse and read collection items
		this.server.tool(
			"getCollectionItems",
			{
				document: z
					.string()
					.describe("Name of the document containing the collection (e.g., 'MCP test')."),
				collectionName: z
					.string()
					.describe("Name of the collection (case-insensitive, e.g., 'Sources', 'drafts', 'notes'). Use readDocument first to discover available collections."),
				filter: z
					.record(z.any())
					.optional()
					.describe("Filter items by property values (e.g., {from_year: '1971', box_nr: 45}). Only items matching all filter criteria are returned."),
				maxDepth: z
					.number()
					.optional()
					.default(0)
					.describe("Content depth: 0 = properties + word count (fast browsing), -1 = full nested content (for reading items). Default 0."),
				useMarkdown: z
					.boolean()
					.optional()
					.default(false)
					.describe("If true, returns flat contentMarkdown field instead of nested blocks. Useful for collections with short text content."),
			},
			async ({ document, collectionName, filter, maxDepth, useMarkdown }) => {
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

					// Normalize collection name to lowercase (Craft API requires lowercase)
					const normalizedCollectionName = collectionName.toLowerCase();

					// When maxDepth=0 (browsing), fetch content for word count but will hide it
					const shouldShowWordCount = maxDepth === 0;
					const apiMaxDepth = shouldShowWordCount ? -1 : maxDepth;
					const apiUseMarkdown = shouldShowWordCount ? true : useMarkdown;

					const params = new URLSearchParams();
					if (apiMaxDepth !== undefined) params.set("maxDepth", apiMaxDepth.toString());

					const headers: Record<string, string> = {
						Accept: apiUseMarkdown
							? "application/json; content=markdown"
							: "application/json",
					};

					const response = await fetch(
						`${documentUrl}/collections/${normalizedCollectionName}/items?${params.toString()}`,
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

					const responseData = (await response.json()) as any;
					let items = responseData.items || responseData;

					// Apply filtering if filter parameter is provided
					if (filter && Object.keys(filter).length > 0) {
						items = items.filter((item: any) => {
							// Check if all filter criteria match
							return Object.entries(filter).every(([key, value]) => {
								const itemValue = item.properties?.[key];
								// Convert both to strings for comparison to handle different types
								return String(itemValue) === String(value);
							});
						});
					}

					// If maxDepth=0 (browsing mode), show word count instead of content
					if (shouldShowWordCount) {
						items = items.map((item: any) => {
							const content = item.contentMarkdown || "";
							const wordCount = content.trim().length > 0
								? content.trim().split(/\s+/).length
								: 0;

							// Remove content fields and add word count
							const { content: _, contentMarkdown: __, ...itemWithoutContent } = item;
							return {
								...itemWithoutContent,
								wordCount
							};
						});
					}

					const formatted = JSON.stringify(items, null, 2);
					const filterNote = filter && Object.keys(filter).length > 0
						? ` (filtered by ${Object.entries(filter).map(([k, v]) => `${k}=${v}`).join(', ')})`
						: '';

					return {
						content: [
							{
								type: "text",
								text: `Found ${items.length} item(s) in collection '${collectionName}'${filterNote}:\n\n${formatted}`,
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

					// Normalize collection name to lowercase (Craft API requires lowercase)
					const normalizedCollectionName = collectionName.toLowerCase();

					const requestBody: any = { items };
					if (allowNewSelectOptions) {
						requestBody.allowNewSelectOptions = true;
					}

					const response = await fetch(
						`${documentUrl}/collections/${normalizedCollectionName}/items`,
						{
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify(requestBody),
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

					const responseData = (await response.json()) as any;
					const createdItems = responseData.successful || responseData.items || responseData;
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

					// Normalize collection name to lowercase (Craft API requires lowercase)
					const normalizedCollectionName = collectionName.toLowerCase();

					const requestBody: any = { itemsToUpdate };
					if (allowNewSelectOptions) {
						requestBody.allowNewSelectOptions = true;
					}

					const response = await fetch(
						`${documentUrl}/collections/${normalizedCollectionName}/items`,
						{
							method: "PUT",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify(requestBody),
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

					const responseData = (await response.json()) as any;
					const updatedItems = responseData.successful || responseData.items || responseData;
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

			if (block.type === "collection") {
				const collectionName = block.markdown || "Unnamed Collection";
				let result = `<collection id="${block.id}" name="${collectionName}">\n`;

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

/**
 * Check if request has valid session
 */
async function getSessionUser(request: Request, env: Env): Promise<string | null> {
	if (!env.SESSIONS) return null;

	const cookies = request.headers.get("Cookie");
	if (!cookies) return null;

	const sessionMatch = cookies.match(/session=([^;]+)/);
	if (!sessionMatch) return null;

	const sessionId = sessionMatch[1];
	const sessionDataStr = await env.SESSIONS.get(`session:${sessionId}`);
	if (!sessionDataStr) return null;

	const sessionData: SessionData = JSON.parse(sessionDataStr);

	// Check if session is expired
	if (Date.now() > sessionData.expiresAt) {
		await env.SESSIONS.delete(`session:${sessionId}`);
		return null;
	}

	return sessionData.username;
}

/**
 * Create a new session for authenticated user
 */
async function createSession(env: Env, username: string, githubId: number): Promise<string> {
	const sessionId = crypto.randomUUID();
	const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days

	const sessionData: SessionData = {
		username,
		githubId,
		expiresAt,
	};

	await env.SESSIONS!.put(
		`session:${sessionId}`,
		JSON.stringify(sessionData),
		{ expirationTtl: 7 * 24 * 60 * 60 } // 7 days
	);

	return sessionId;
}

/**
 * Main fetch handler with GitHub OAuth authentication
 */
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// Check if OAuth is configured
		const isOAuthConfigured = !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.SESSIONS);

		// Handle GitHub OAuth callback
		if (url.pathname === "/callback" && isOAuthConfigured) {
			const code = url.searchParams.get("code");

			if (!code) {
				return new Response("Missing authorization code", { status: 400 });
			}

			// Exchange code for access token
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

			// Get user info from GitHub
			const userResponse = await fetch("https://api.github.com/user", {
				headers: {
					Authorization: `Bearer ${tokenData.access_token}`,
					Accept: "application/json",
				},
			});

			const githubUser = (await userResponse.json()) as GitHubUser;

			// Check if user is allowed
			if (env.ALLOWED_USERNAMES) {
				const allowedUsernames = env.ALLOWED_USERNAMES.split(",").map(u => u.trim().toLowerCase());
				if (!allowedUsernames.includes(githubUser.login.toLowerCase())) {
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
		<p>User <strong>${githubUser.login}</strong> is not authorized to access this MCP server.</p>
		<p style="font-size: 0.9em; margin-top: 1.5rem;">Contact the server administrator if you believe this is an error.</p>
	</div>
</body>
</html>`,
						{ status: 403, headers: { "Content-Type": "text/html" } }
					);
				}
			}

			// Create session
			const sessionId = await createSession(env, githubUser.login, githubUser.id);

			// Redirect to home with session cookie
			return new Response(null, {
				status: 302,
				headers: {
					"Location": "/",
					"Set-Cookie": `session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`,
				},
			});
		}

		// Handle login redirect to GitHub
		if (url.pathname === "/login" && isOAuthConfigured) {
			const githubAuthUrl = new URL("https://github.com/login/oauth/authorize");
			githubAuthUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID!);
			githubAuthUrl.searchParams.set("redirect_uri", `${url.origin}/callback`);
			githubAuthUrl.searchParams.set("scope", "read:user user:email");

			return Response.redirect(githubAuthUrl.toString(), 302);
		}

		// Handle logout
		if (url.pathname === "/logout" && isOAuthConfigured) {
			const cookies = request.headers.get("Cookie");
			if (cookies) {
				const sessionMatch = cookies.match(/session=([^;]+)/);
				if (sessionMatch && env.SESSIONS) {
					await env.SESSIONS.delete(`session:${sessionMatch[1]}`);
				}
			}

			return new Response(null, {
				status: 302,
				headers: {
					"Location": "/",
					"Set-Cookie": "session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
				},
			});
		}

		// Check authentication for MCP endpoints
		if (url.pathname === "/mcp" || url.pathname.startsWith("/sse")) {
			if (isOAuthConfigured) {
				const username = await getSessionUser(request, env);

				if (!username) {
					return new Response(
						JSON.stringify({ error: "Authentication required" }),
						{
							status: 401,
							headers: { "Content-Type": "application/json" }
						}
					);
				}
			}

			// Serve MCP endpoints
			if (url.pathname === "/sse" || url.pathname === "/sse/message") {
				return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
			}

			if (url.pathname === "/mcp") {
				return MyMCP.serve("/mcp").fetch(request, env, ctx);
			}
		}

		// Landing page
		if (url.pathname === "/" || url.pathname === "/login") {
			const username = isOAuthConfigured ? await getSessionUser(request, env) : null;
			const isAuthenticated = !!username;

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
		.success { background: #d4edda; color: #155724; padding: 1rem; border-radius: 0.5rem; margin: 1.5rem 0; text-align: left; }
		.warning { background: #fff3cd; color: #856404; padding: 1rem; border-radius: 0.5rem; margin: 1.5rem 0; text-align: left; }
		.info h3, .success h3, .warning h3 { margin: 0 0 0.5rem 0; font-size: 1em; }
		.info p, .success p, .warning p { margin: 0; font-size: 0.9em; line-height: 1.5; }
		a.button {
			display: inline-flex;
			align-items: center;
			gap: 0.5rem;
			background: #24292e;
			color: white;
			padding: 0.875rem 2rem;
			border-radius: 0.5rem;
			text-decoration: none;
			font-weight: 600;
			transition: background 0.2s;
			margin-top: 1rem;
		}
		a.button:hover { background: #1a1f23; }
		a.button.secondary {
			background: #6c757d;
		}
		a.button.secondary:hover {
			background: #5a6268;
		}
		code { background: #f4f4f4; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; }
	</style>
</head>
<body>
	<div class="container">
		<h1>🚀 Craft MCP Server</h1>
		<p class="subtitle">Remote Model Context Protocol server for Craft documents</p>

		${
			isOAuthConfigured
				? isAuthenticated
					? `
		<div class="success">
			<h3>✅ Authenticated</h3>
			<p>Signed in as <strong>${username}</strong></p>
		</div>
		<p style="margin-top: 2rem; font-size: 0.9em; color: #888;">
			Connect via MCP endpoint: <code>${url.origin}/mcp</code>
		</p>
		<a href="/logout" class="button secondary">Sign Out</a>
		`
					: `
		<div class="info">
			<h3>🔒 Authentication Required</h3>
			<p>This server requires GitHub authentication to access MCP tools.</p>
		</div>
		<a href="/login" class="button">
			Sign in with GitHub
		</a>
		`
				: `
		<div class="warning">
			<h3>⚠️ Running in Non-Authenticated Mode</h3>
			<p>To enable GitHub authentication, configure:<br>
			<code>GITHUB_CLIENT_ID</code>, <code>GITHUB_CLIENT_SECRET</code>, and <code>SESSIONS</code> KV namespace</p>
		</div>
		<p style="margin-top: 2rem; font-size: 0.9em; color: #888;">
			Connect via MCP endpoint: <code>${url.origin}/mcp</code>
		</p>
		`
		}
	</div>
</body>
</html>`,
				{ headers: { "Content-Type": "text/html" } }
			);
		}

		return new Response("Not found", { status: 404 });
	},
};
