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
│   ├── index.ts          # Main MCP server implementation (MyMCP class)
│   └── archived-tools.ts # Archived collection/delete tools (removed Nov 2025)
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

### AI as Research Assistant: Clear Authorship Workflow

**Design Philosophy:**

This MCP server is designed around a clear principle: **AI can only add content, never modify or delete it**. This creates a clear visual and functional separation between human-written content and AI-generated contributions.

**Key Features:**
- **Visual Styling**: All AI-generated blocks use callout formatting with colored text
- **Color Coding**: Purple (default), red, or blue text based on variant parameter
- **Write-Only AI**: The AI can only create new blocks, not update or delete existing ones
- **Visual Authorship Tracking**: Callout blocks with color = AI-generated, regular text = Human-written
- **Intentional Workflow**: If the AI wants to suggest changes to existing text, it creates a new colored callout version below the original

**Benefits:**
1. **No confusion about authorship** - Callout styling makes AI contributions instantly recognizable
2. **Intentional editing** - When you manually remove the callout/color, you're consciously taking ownership of the content
3. **Research assistant role** - The AI adds findings and suggestions without taking over your notes
4. **Clean workspace** - Your notes remain yours, with AI contributions visually separated

**Typical Workflow:**
1. `listDocuments` → Find available documents
2. `readDocument` → Understand document structure and existing content
3. `search` → Find relevant sections for context
4. `insertText` → AI adds new color-coded blocks with research findings or suggestions
   - Use variant 1 (purple) for all standard additions and when revising/improving user's existing text
   - **IMPORTANT:** Use variants 2 (red) and 3 (blue) only to present multiple alternative AI formulations of the same idea
   - Insert alternatives sequentially (variant 2 after variant 1, variant 3 after variant 2)

### Block ID Format

All blocks in `readDocument` output are prefixed with `[id]` for precise positioning:

```markdown
[0] <page>
  <pageTitle>Research Notes</pageTitle>
  <content>

[1] # Introduction

[2] This is the first paragraph with some context.

[3] - Key point one
[4] - Key point two

[5] <image url="..." alt="Diagram" />

[6] <page>
  <pageTitle>Subsection</pageTitle>
  <content>

[7] ## Details

[8] More content here.

  </content>
</page>

[9] <collection name="Tasks">
  <schema>title, status, priority</schema>
  <items count="3"></items>
</collection>

  </content>
</page>
```

**Using IDs for insertion:**
- To insert after the first paragraph: `insertText(afterBlock="2", markdown="New paragraph")`
- To insert before the image: `insertText(beforeBlock="5", markdown="Caption text")`
- To insert after a list item: `insertText(afterBlock="4", markdown="Additional point")`

### Tools

The server provides **4 focused tools** that support the clear authorship workflow:

#### Read-Only Tools (3 tools)

These tools allow the AI to understand and search your documents without modifying them:

0. **listDocuments** - Show available documents
   - No parameters
   - Returns: List of configured document names
   - Used to discover available documents

1. **readDocument** - Read document structure and content
   - `document` (required): Document name (e.g., "MCP test")
   - `id` (optional): ID of page or heading to fetch (omit for root page)
   - `maxDepth` (optional, default: -1): Maximum nesting depth (-1 for all, 0 for block only, 1 for immediate children)
   - Returns: Markdown with `[id]` prefix for all blocks, enabling precise positioning
   - Format: `[123] # Heading`, `[124] Paragraph text`, `[125] <image>`, etc.
   - Collections shown as: `[id] <collection name="..."><schema>...</schema><items count="N"></items></collection>`
   - Calls: `GET /blocks` on Craft API

2. **search** - Search for text within the document using pattern matching
   - `document` (required): Document name (e.g., "MCP test")
   - `pattern` (required): Search pattern (supports regex)
   - `caseSensitive` (optional, default: false): Case-sensitive search
   - `beforeBlockCount` (optional, default: 2): Context blocks before match
   - `afterBlockCount` (optional, default: 2): Context blocks after match
   - Returns: Formatted results with hierarchical path and context
   - Calls: `GET /blocks/search` on Craft API

#### Write-Only Tool (1 tool)

This is the **only** tool that modifies your documents, and it can only **add** content, not modify or delete:

3. **insertText** - Insert markdown content into the document (with automatic color coding)
   - `document` (required): Document name (e.g., "MCP test")
   - `markdown` (required): Markdown content to insert (supports headings, lists, formatting, blockquotes)
   - `afterBlock` (optional): Block ID to insert after (mutually exclusive with beforeBlock)
   - `beforeBlock` (optional): Block ID to insert before (mutually exclusive with afterBlock)
   - Exactly one of `afterBlock` or `beforeBlock` must be specified
   - `subpage` (optional, default: false): If true, wraps content in a new page block
   - `variant` (optional, default: "1"): Color variant - "1" = purple, "2" = red, "3" = blue
   - **Automatic styling**: All inserted blocks use callout formatting with color based on variant
     - Variant 1: Purple callout (`#9b59b6`) - use for all standard additions and when revising/improving user text
     - Variant 2: Red callout (`#e74c3c`) - **IMPORTANT:** only for presenting alternative AI formulations of the same idea
     - Variant 3: Blue callout (`#3498db`) - **IMPORTANT:** only for additional AI alternatives
     - When creating alternatives: insert sequentially (variant 2 after variant 1, variant 3 after variant 2)
     - Callout decoration provides visual separation from human-written content
   - **Example**: `insertText(document="MCP test", afterBlock="123", markdown="New content", variant="1")`
   - Calls: `POST /blocks` on Craft API with `{ position: "after", siblingId: "123" }`

#### Archived Tools

The following tools were removed in November 2025 to support the clear authorship workflow. Their code is preserved in `src/archived-tools.ts` for future reference:

- **deleteText** - Deleted blocks (removed to prevent AI from removing content)
- **getCollectionItems** - Browsed collection items (removed to simplify toolset)
- **createCollectionItems** - Created collection items (removed to simplify toolset)
- **updateCollectionItems** - Updated collection items (removed to simplify toolset)

## Important: Craft API Breaking Changes (November 2025)

The Craft API has changed its response format. The MCP server code has been updated to handle both old and new formats for backward compatibility:

- **GET /blocks**: Now returns a single object instead of an array (`response` instead of `response[0]`)
- **POST /blocks**: Now returns a single object instead of an array
- **GET /blocks/search**: Now returns `response.items` instead of `response` array

The server code uses fallback logic (`responseData.items || responseData` or `Array.isArray(responseData) ? responseData : [responseData]`) to support both formats during the transition period.

## Text Styling Support in Craft API

The Craft API supports visual styling of text blocks:

**Color:**
- **Property**: `color` (string, hex code format)
- **Format**: `"#RRGGBB"` (case-insensitive)
- **Auto-adjustment**: Craft automatically adjusts colors for readability in dark mode
- **Example**: `{ type: "text", markdown: "...", color: "#9b59b6" }`

**Decorations:**
- **Property**: `decorations` (array of strings)
- **Supported values**: `["callout"]` - creates a visually highlighted block
- **Example**: `{ type: "text", markdown: "...", color: "#9b59b6", decorations: ["callout"] }`

This server uses callout decoration with color variants (purple/red/blue) for all AI-generated content to provide clear visual separation and authorship tracking.

## Authentication

The server uses **OAuth 2.1 with PKCE** for secure authentication via GitHub.

**Architecture:**
- OAuth Server to MCP clients (using `@cloudflare/workers-oauth-provider`)
- OAuth Client to GitHub (for user identity verification)
- Bearer token authentication with user props available to tools via `this.props`

**For setup instructions**, see [README.md](./README.md#2-create-github-oauth-app)

**User Props available to tools:**
```typescript
type Props = {
  login: string;        // GitHub username
  name: string;         // Full name
  email: string;        // Email address
  accessToken: string;  // GitHub access token
};
```

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

Currently active endpoints:
- `POST /blocks` - Insert content blocks (with color support)
- `GET /blocks` - Fetch blocks with optional depth control
- `GET /blocks/search` - Search for patterns in content

No longer used (but supported by API):
- `DELETE /blocks` - Delete blocks by ID (removed from toolset)
- `GET /collections/{name}/items` - Browse collection items (removed from toolset)
- `POST /collections/{name}/items` - Create collection items (removed from toolset)
- `PUT /collections/{name}/items` - Update collection items (removed from toolset)

**Authentication**: Optional GitHub OAuth (see Authentication section above)

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
- `GITHUB_CLIENT_ID` - GitHub OAuth application client ID (optional, for authentication)
- `GITHUB_CLIENT_SECRET` - GitHub OAuth application client secret (optional, for authentication)
- `ALLOWED_USERNAMES` - Comma-separated list of allowed GitHub usernames (optional)
- `OAUTH_KV` - KV namespace binding for OAuth token storage (required for authentication)

## Key Dependencies

- `@modelcontextprotocol/sdk@1.19.1` - MCP protocol implementation
- `agents@^0.2.8` - Cloudflare Agents SDK with McpAgent class
- `@cloudflare/workers-oauth-provider` - OAuth 2.1 provider for MCP client authentication
- `@octokit/rest` - GitHub API client for user authentication
- `zod@^3.25.76` - Schema validation

## Future Enhancements

Potential features that align with the authorship workflow:
- **Additional OAuth providers** - Support Google, Microsoft, etc. for authentication
- **Enhanced insertText capabilities**:
  - Support for inserting images, videos, and file attachments
  - Batch insertion of multiple blocks in one operation
  - Template-based content insertion
- **Better color customization**:
  - User-configurable color for AI-generated content
  - Different colors for different types of AI contributions (research vs. suggestions vs. summaries)
- **Advanced search features**:
  - Search within specific sections or pages
  - Boolean search operators
  - Search result ranking and relevance scoring
- **Infrastructure improvements**:
  - Error handling and retry logic
  - Rate limiting and quota management
  - Logging, monitoring, and usage analytics

Features intentionally NOT added (to preserve authorship clarity):
- Block update/modification tools - Would blur the line between AI and human authorship
- Block deletion tools - AI should only add, never remove
- Inline text editing - Would make authorship tracking difficult

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
