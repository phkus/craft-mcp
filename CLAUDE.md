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
│   ├── mcp-creation-guide.md       # MCP best practices guide
│   └── Cloudflare Developer Documentation.md
├── wrangler.toml         # Cloudflare Workers configuration
├── package.json          # Dependencies and scripts
└── tsconfig.json         # TypeScript configuration
```

## Current Features

### Tools

1. **append_text** - Appends markdown-formatted text to a Craft document
   - `pageId` (optional, default: "0"): Target page block ID
   - `text` (required): Markdown content to append
   - Calls: `POST /blocks` on Craft API

## Craft API Configuration

- **Base URL**: `https://connect.craft.do/links/AcHPMgNXYdR/api/v1`
- **Authentication**: Not yet implemented (planned for future)
- **Endpoints Used**:
  - `POST /blocks` - Insert content blocks

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

The server uses Durable Objects for stateful MCP sessions:
- **Binding Name**: `MCP`
- **Class Name**: `MyMCP`
- **Compatibility Flags**: `nodejs_compat`

Each MCP client session gets its own Durable Object instance with persistent state.

## Key Dependencies

- `@modelcontextprotocol/sdk@1.19.1` - MCP protocol implementation
- `agents@^0.2.8` - Cloudflare Agents SDK with McpAgent class
- `zod@^3.25.76` - Schema validation

## Future Enhancements

Potential features to add:
- Authentication (OAuth or API token)
- More tools:
  - `fetch_blocks` - Read document content
  - `search_blocks` - Search within documents
  - `update_blocks` - Modify existing content
  - `delete_blocks` - Remove content
  - `move_blocks` - Reorganize document structure
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
