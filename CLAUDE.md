# Craft MCP Server - Project Context

## Overview

This is a remote Model Context Protocol (MCP) server for the [Craft](https://www.craft.do/) document management app, deployed on Cloudflare Workers. The server enables AI assistants (like Claude) to interact with Craft documents through standardized MCP tools.

## Architecture

- **Platform**: Cloudflare Workers with Durable Objects
- **Framework**: Cloudflare Agents SDK (`agents` package)
- **MCP SDK**: `@modelcontextprotocol/sdk` (TypeScript)
- **Language**: TypeScript
- **Deployment**: Automated via GitHub → Cloudflare integration

## Important: Deployment Workflow

**⚠️ DO NOT deploy directly using `npm run deploy`**

Instead, follow this workflow:
1. Make changes to the code
2. Commit changes to the GitHub repository
3. Push to the `main` branch
4. Cloudflare will automatically deploy the updated worker

This ensures the GitHub repository remains the source of truth and maintains deployment history.

## Project Structure

```
craft-mcp/
├── src/
│   └── index.ts          # Main MCP server implementation (MyMCP class)
├── docs/
│   ├── craft-api-docs.md           # Craft API documentation
│   ├── craft-mcp-spec.md           # MCP tool specifications
│   ├── mcp-creation-guide.md       # MCP best practices guide
│   └── Cloudflare Developer Documentation.md
├── wrangler.toml         # Cloudflare Workers configuration
├── package.json          # Dependencies and scripts
└── tsconfig.json         # TypeScript configuration
```

## Current Features

### Multi-Document Support

The server supports multiple Craft documents configured via environment variables. All tools require an explicit `document` parameter to specify which document to operate on.

### Three-Level Abstraction for Working with Documents

The MCP server provides three levels of abstraction for accessing document content:

**Level 1: Document Structure** - `readDocument`
- Discover what's in a document (prose, headings, pages, collections)
- See collection metadata (name, schema, item count) without loading items
- Understand document organization before diving deeper

**Level 2: Collection Browsing** - `getCollectionItems`
- Query specific collections for their items
- Browse items with properties only (`maxDepth=0`) for efficiency
- Read full item content when needed (`maxDepth=-1` or `useMarkdown=true`)

**Level 3: Item Reading** - Included in `getCollectionItems`
- Get full content of collection items
- Use `useMarkdown=true` for collections with short text (notes, tasks)
- Use nested blocks (default) for complex structured content

**Typical Workflow:**
1. `listDocuments` → Find available documents
2. `readDocument` → Discover "Sources collection (from_year, author) - 25 items"
3. `getCollectionItems(Sources)` → Browse all items with properties + word counts (default maxDepth=0)
4. `getCollectionItems(Sources, filter={from_year: "1971"})` → Filter items, see which have content via word count
5. `getCollectionItems(Sources, filter={from_year: "1971"}, maxDepth=-1, useMarkdown=true)` → Read full content of filtered items

### Tools

#### Document & Block Tools

0. **listDocuments** - Show available documents
   - No parameters
   - Returns: List of configured document names
   - Used to discover available documents

1. **readDocument** - Read document structure and content
   - `document` (required): Document name (e.g., "MCP test")
   - `id` (optional): ID of page or heading to fetch (omit for root page)
   - `maxDepth` (optional, default: -1): Maximum nesting depth (-1 for all, 0 for block only, 1 for immediate children)
   - Returns: Markdown with embedded IDs, prose content, and collection metadata
   - Collections shown as: `<collection id="..." name="..."><schema>...</schema><items count="N"></items></collection>`
   - Calls: `GET /blocks` on Craft API

2. **insertText** - Insert markdown content into the document
   - `document` (required): Document name (e.g., "MCP test")
   - `markdown` (required): Markdown content to insert (supports headings, lists, formatting, blockquotes)
   - `parent` (optional): ID of page or heading to insert into (omit for root page)
   - `position` (required): "start" or "end" - where to insert within the parent
   - `subpage` (optional, default: false): If true, wraps content in a new page block
   - Calls: `POST /blocks` on Craft API

3. **deleteText** - Delete a page or heading and all its content
   - `document` (required): Document name (e.g., "MCP test")
   - `id` (required): ID of the page or heading to delete
   - WARNING: Destructive operation that deletes entire section including nested content
   - Calls: `DELETE /blocks` on Craft API

4. **search** - Search for text within the document using pattern matching
   - `document` (required): Document name (e.g., "MCP test")
   - `pattern` (required): Search pattern (supports regex)
   - `caseSensitive` (optional, default: false): Case-sensitive search
   - `beforeBlockCount` (optional, default: 2): Context blocks before match
   - `afterBlockCount` (optional, default: 2): Context blocks after match
   - Returns: Formatted results with hierarchical path and context
   - Calls: `GET /blocks/search` on Craft API

#### Collection Tools

Collections in Craft are similar to Notion databases - structured tables with custom schemas. These tools work generically with any collection schema.

**Important:** Use `readDocument` first to discover collections and their schemas. Collection names are case-insensitive.

5. **getCollectionItems** - Browse and read collection items
   - `document` (required): Document name (e.g., "MCP test")
   - `collectionName` (required): Collection name (case-insensitive, e.g., "Sources", "drafts")
   - `filter` (optional): Filter items by property values (e.g., `{from_year: "1971", box_nr: 45}`)
     - Multiple criteria use AND logic (all must match)
     - String comparison for all value types
   - `maxDepth` (optional, default: 0): Content depth for each item
     - `0` = Properties + word count (fast browsing) - **default for efficient browsing**
     - `-1` = Full nested content (for reading items)
   - `useMarkdown` (optional, default: false): If true, returns flat `contentMarkdown` instead of nested blocks (useful for short text collections like notes)
   - Returns: JSON array of items with `id`, `title`, `properties`, and:
     - When `maxDepth=0`: `wordCount` field (0 if no content)
     - When `maxDepth=-1`: `content` or `contentMarkdown` fields
   - Calls: `GET /collections/{collectionName}/items` on Craft API (filtering and word count done client-side)

6. **createCollectionItems** - Add new items to a collection
   - `document` (required): Document name (e.g., "MCP test")
   - `collectionName` (required): Name of the collection
   - `items` (required): Array of items with `title` and `properties` (schema-specific)
   - `allowNewSelectOptions` (optional, default: false): Allow creating new select field options
   - Returns: JSON array of created items
   - Calls: `POST /collections/{collectionName}/items` on Craft API

7. **updateCollectionItems** - Update existing items in a collection
   - `document` (required): Document name (e.g., "MCP test")
   - `collectionName` (required): Name of the collection
   - `itemsToUpdate` (required): Array of items with `id`, optional `title`, and optional `properties`
   - `allowNewSelectOptions` (optional, default: false): Allow creating new select field options
   - Returns: JSON array of updated items
   - Calls: `PUT /collections/{collectionName}/items` on Craft API

## Important: Craft API Breaking Changes (November 2025)

The Craft API has changed its response format. The MCP server code has been updated to handle both old and new formats for backward compatibility:

- **GET /blocks**: Now returns a single object instead of an array (`response` instead of `response[0]`)
- **POST /blocks**: Now returns a single object instead of an array
- **DELETE /blocks**: Now returns `response.items` instead of `response` array
- **GET /blocks/search**: Now returns `response.items` instead of `response` array
- **GET /collections/{name}/items**: No change (was already returning objects)

The server code uses fallback logic (`responseData.items || responseData`) to support both formats during the transition period.

## Craft API Configuration

### Document Setup

Documents are configured via the `CRAFT_DOCUMENTS` environment variable. The configuration differs between local development and production:

**Local Development (.dev.vars):**
```bash
CRAFT_DOCUMENTS={"MCP test": "https://connect.craft.do/links/AcHPMgNXYdR/api/v1", "Possible Futures": "https://connect.craft.do/links/HmHPcIx86Sp/api/v1"}
```

**Production (wrangler.toml - placeholder only):**
```toml
[vars]
CRAFT_DOCUMENTS = '{"Example Document": "https://connect.craft.do/links/YOUR_LINK_ID_HERE/api/v1"}'
```

**Setup Instructions:**

1. **Get Craft Document Link IDs:**
   - In Craft app, open your document
   - Go to Share → Enable API
   - Copy the link ID from the generated URL (e.g., `AcHPMgNXYdR` from `https://connect.craft.do/links/AcHPMgNXYdR`)

2. **For Local Development:**
   - Create a `.dev.vars` file in the project root (already gitignored)
   - Add your actual document links in the format shown above
   - Run `npm run dev` to test locally

3. **For Production Deployment:**
   - Go to Cloudflare Dashboard → Workers & Pages → Your Worker → Settings → Variables
   - Add environment variable `CRAFT_DOCUMENTS` with your actual JSON
   - OR use CLI: `wrangler secret put CRAFT_DOCUMENTS` (then paste your JSON)
   - The `keep_vars = true` setting in wrangler.toml ensures deployments won't override your dashboard settings

4. **To Add a New Document:**
   - Get the link ID as described in step 1
   - Update your `.dev.vars` file for local testing
   - Update the environment variable in Cloudflare Dashboard for production
   - Format: `"Document Name": "https://connect.craft.do/links/{LINK_ID}/api/v1"`

### API Endpoints Used

- `POST /blocks` - Insert content blocks
- `DELETE /blocks` - Delete blocks by ID
- `GET /blocks` - Fetch blocks with optional depth control
- `GET /blocks/search` - Search for patterns in content

**Authentication**: Not yet implemented (planned for future)

## MCP Server Details

- **Class**: `MyMCP` (extends `McpAgent`)
- **Server Name**: "craft-mcp-server"
- **Version**: "1.0.0"
- **Endpoints**:
  - `/mcp` - Streamable HTTP transport (recommended)
  - `/sse` - Server-Sent Events transport (legacy)

## Development Commands

```bash
# Install dependencies
npm install

# Type check
npm run type-check

# Local development server
npm run dev

# Deploy (use GitHub instead!)
npm run deploy

# Lint and format
npm run lint:fix
npm run format
```

## Cloudflare Configuration

The server uses Durable Objects for MCP sessions:
- **Binding Name**: `MCP`
- **Class Name**: `MyMCP`
- **Compatibility Flags**: `nodejs_compat`

Each MCP client session gets its own Durable Object instance that loads:
- Document mappings from `CRAFT_DOCUMENTS` environment variable

**Environment Variables:**
- `CRAFT_DOCUMENTS` - JSON mapping of document names to base URLs (configured in wrangler.toml)

## Key Dependencies

- `@modelcontextprotocol/sdk@1.19.1` - MCP protocol implementation
- `agents@^0.2.8` - Cloudflare Agents SDK with McpAgent class
- `zod@^3.25.76` - Schema validation

## Future Enhancements

Potential features to add:
- Authentication (OAuth or API token)
- Additional tools:
  - `updateBlocks` - Modify existing content in place
  - `moveBlocks` - Reorganize document structure
  - `uploadFile` - Upload and insert files (images, videos, documents)
- Error handling improvements
- Rate limiting
- Logging and monitoring

## Testing

To test the MCP server locally:
1. Run `npm run dev`
2. Server will be available at `http://localhost:8787/mcp`
3. Use MCP Inspector or configure Claude Desktop to connect

## Documentation References

- [MCP Specification](https://modelcontextprotocol.io/llms-full.txt)
- [Cloudflare Agents Docs](https://developers.cloudflare.com/agents/)
- [Craft API Docs](./docs/craft-api-docs.md)
- [MCP Creation Guide](./docs/mcp-creation-guide.md)
