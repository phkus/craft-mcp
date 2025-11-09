/**
 * ARCHIVED TOOLS - Removed from main MCP server
 *
 * These tools were removed as part of the November 2025 reorganization to simplify
 * the server for a clear authorship workflow where AI can only add content (not modify/delete).
 *
 * This file is kept for future reference in case these features are needed again.
 *
 * Removed tools:
 * - deleteText: Delete blocks by ID
 * - getCollectionItems: Browse and read collection items with filtering
 * - createCollectionItems: Add new items to collections
 * - updateCollectionItems: Update existing collection items
 */

import { z } from "zod";

/**
 * TOOL: deleteText
 * Delete a page or heading and all its content
 *
 * Original location: lines 297-368 in src/index.ts
 */
export const deleteTextToolDefinition = {
	name: "deleteText",
	schema: {
		document: z
			.string()
			.describe("Name of the document to delete from (e.g., 'MCP test')."),
		id: z
			.string()
			.describe("ID of the page or heading to delete. WARNING: Deletes entire section including nested content."),
	},
	async handler({ document, id }: { document: string; id: string }, context: { documents: Record<string, string> }) {
		try {
			// Get document URL
			const documentUrl = context.documents[document];
			if (!documentUrl) {
				const available = Object.keys(context.documents).join(", ");
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
};

/**
 * TOOL: getCollectionItems
 * Browse and read collection items with filtering
 *
 * Original location: lines 555-692 in src/index.ts
 */
export const getCollectionItemsToolDefinition = {
	name: "getCollectionItems",
	schema: {
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
	async handler(
		{ document, collectionName, filter, maxDepth, useMarkdown }:
		{ document: string; collectionName: string; filter?: Record<string, any>; maxDepth?: number; useMarkdown?: boolean },
		context: { documents: Record<string, string> }
	) {
		try {
			// Get document URL
			const documentUrl = context.documents[document];
			if (!documentUrl) {
				const available = Object.keys(context.documents).join(", ");
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
};

/**
 * TOOL: createCollectionItems
 * Add new items to a collection
 *
 * Original location: lines 694-794 in src/index.ts
 */
export const createCollectionItemsToolDefinition = {
	name: "createCollectionItems",
	schema: {
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
	async handler(
		{ document, collectionName, items, allowNewSelectOptions }:
		{ document: string; collectionName: string; items: Array<{title: string; properties?: Record<string, any>}>; allowNewSelectOptions?: boolean },
		context: { documents: Record<string, string> }
	) {
		try {
			// Get document URL
			const documentUrl = context.documents[document];
			if (!documentUrl) {
				const available = Object.keys(context.documents).join(", ");
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
};

/**
 * TOOL: updateCollectionItems
 * Update existing items in a collection
 *
 * Original location: lines 796-897 in src/index.ts
 */
export const updateCollectionItemsToolDefinition = {
	name: "updateCollectionItems",
	schema: {
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
	async handler(
		{ document, collectionName, itemsToUpdate, allowNewSelectOptions }:
		{ document: string; collectionName: string; itemsToUpdate: Array<{id: string; title?: string; properties?: Record<string, any>}>; allowNewSelectOptions?: boolean },
		context: { documents: Record<string, string> }
	) {
		try {
			// Get document URL
			const documentUrl = context.documents[document];
			if (!documentUrl) {
				const available = Object.keys(context.documents).join(", ");
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
};

/**
 * USAGE NOTES
 *
 * To restore any of these tools to the main server:
 * 1. Copy the tool definition from this file
 * 2. Convert it back to this.server.tool() format in src/index.ts init() method
 * 3. Update CLAUDE.md documentation to reflect the restored tool
 *
 * Example for restoring deleteText:
 *
 * this.server.tool(
 *   "deleteText",
 *   deleteTextToolDefinition.schema,
 *   async (params) => deleteTextToolDefinition.handler(params, { documents: this.documents })
 * );
 */
