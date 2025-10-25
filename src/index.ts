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
	// Currently selected document for operations
	private currentDocument: string | null = null;

	async init() {
		// Parse document mappings from environment variable
		try {
			const env = this.env as Env;
			this.documents = JSON.parse(env.CRAFT_DOCUMENTS || "{}");
		} catch (error) {
			console.error("Failed to parse CRAFT_DOCUMENTS:", error);
			this.documents = {};
		}

		// Load current document from storage
		this.currentDocument = await this.ctx.storage.get<string>("currentDocument") || null;

		// 0. listDocuments - Show available documents and current selection
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
						const indicator = name === this.currentDocument ? "→ " : "  ";
						text += `${indicator}${name}\n`;
					}

					if (this.currentDocument) {
						text += `\nCurrent document: ${this.currentDocument}`;
					} else {
						text += `\nNo document selected. Use fetchBlocks with a document name to set the working document.`;
					}

					return {
						content: [
							{
								type: "text",
								text: text,
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
		// Operates on the current document set by fetchBlocks
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
					.describe("If true, wraps content in a new page block (first heading becomes page title). Operates on the current document (set via fetchBlocks)."),
			},
			async ({ markdown, parent, position, subpage }) => {
				try {
					// Get current document URL
					const documentUrl = this.getCurrentDocumentUrl();
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
		// Operates on the current document set by fetchBlocks
		this.server.tool(
			"deleteText",
			{
				id: z
					.string()
					.describe("ID of the page or heading to delete. WARNING: Deletes entire section including nested content. Operates on the current document (set via fetchBlocks)."),
			},
			async ({ id }) => {
				try {
					// Get current document URL
					const documentUrl = this.getCurrentDocumentUrl();

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
		// IMPORTANT: This tool also sets the working document for subsequent operations
		this.server.tool(
			"fetchBlocks",
			{
				document: z
					.string()
					.optional()
					.describe("Name of the document to fetch (e.g., 'MCP test'). If specified, also sets this as the working document for subsequent insertText, deleteText, and search operations. If omitted, uses the current working document."),
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
					// Determine which document to use
					let targetDocument = document || this.currentDocument;

					if (!targetDocument) {
						return {
							content: [
								{
									type: "text",
									text: "No document specified and no current document set. Please specify a document name or use listDocuments to see available documents.",
								},
							],
							isError: true,
						};
					}

					// Check if document exists
					const documentUrl = this.documents[targetDocument];
					if (!documentUrl) {
						const available = Object.keys(this.documents).join(", ");
						return {
							content: [
								{
									type: "text",
									text: `Document '${targetDocument}' not found. Available documents: ${available}. Use listDocuments to see all options.`,
								},
							],
							isError: true,
						};
					}

					// If document was explicitly specified, set it as current
					if (document) {
						this.currentDocument = targetDocument;
						await this.ctx.storage.put("currentDocument", targetDocument);
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

					let statusNote = "";
					if (document) {
						statusNote = `\n\n[Working document set to: ${targetDocument}]`;
					}

					return {
						content: [
							{
								type: "text",
								text: markdown + statusNote,
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
		// Operates on the current document set by fetchBlocks
		this.server.tool(
			"search",
			{
				pattern: z
					.string()
					.describe("Search pattern (supports regex). Operates on the current document (set via fetchBlocks)."),
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
					// Get current document URL
					const documentUrl = this.getCurrentDocumentUrl();

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
	}

	/**
	 * Get the base URL for the current document
	 * @throws Error if no document is selected or document not found
	 */
	private getCurrentDocumentUrl(): string {
		if (!this.currentDocument) {
			throw new Error(
				"No document selected. Use fetchBlocks with a document name to set the working document, or use listDocuments to see available documents.",
			);
		}

		const documentUrl = this.documents[this.currentDocument];
		if (!documentUrl) {
			const available = Object.keys(this.documents).join(", ");
			throw new Error(
				`Current document '${this.currentDocument}' not found in configuration. Available documents: ${available}`,
			);
		}

		return documentUrl;
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
