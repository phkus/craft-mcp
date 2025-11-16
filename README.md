# Craft MCP Server

A remote [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for [Craft](https://www.craft.do/), deployed on Cloudflare Workers. This server enables AI assistants like Claude to read, write, search, and manage Craft documents.

## Features

- **Document Management**: Read, write, and search in Craft documents
- **Multi-Document**: Support for multiple Craft documents via configuration
- **Authorship separation**: Blocks created via MCP have a unique appearance (purple blocks), keeping AI-formulated content clearly identifiable

## Available Tools

- `listDocuments` - Show configured documents
- `search` - find blocks in one of the documents
- `readDocument` - Read document content with embedded IDs
- `insertText` - Insert markdown content into documents, optionally as a subpage

## Setup

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd craft-mcp
npm install
```

### 2. Configure Craft Documents

#### Get Your Craft Document Link IDs

1. Open your Craft document
2. Click **Share** → **Enable API**
3. Copy the link ID from the generated URL
   - Example: `AcHPMgNXYdR` from `https://connect.craft.do/links/AcHPMgNXYdR`

#### For Local Development

Create a `.dev.vars` file in the project root:

```bash
CRAFT_DOCUMENTS={"My Document": "https://connect.craft.do/links/YOUR_LINK_ID_HERE/api/v1"}
```

You can add multiple documents:

```bash
CRAFT_DOCUMENTS={"Notes": "https://connect.craft.do/links/ABC123/api/v1", "Tasks": "https://connect.craft.do/links/XYZ789/api/v1"}
```

**Important**: `.dev.vars` is gitignored and contains your private document links.

### 3. Run Locally

```bash
npm run dev
```

Your MCP server will be available at:
- `http://localhost:8787/mcp` (recommended - streamable HTTP transport)
- `http://localhost:8787/sse` (legacy - Server-Sent Events)

### 4. Deploy to Cloudflare

#### Set Up Production Variables

Do **NOT** commit your real document links to `wrangler.toml`. Instead, set them via Cloudflare Dashboard:

1. Deploy your worker: `npm run deploy` (first time only)
2. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) → Workers & Pages → Your Worker → Settings → Variables
3. Add environment variable:
   - **Name**: `CRAFT_DOCUMENTS`
   - **Value**: `{"My Document": "https://connect.craft.do/links/YOUR_LINK_ID_HERE/api/v1"}`

**OR** use the Wrangler CLI:

```bash
wrangler secret put CRAFT_DOCUMENTS
# Then paste your JSON when prompted
```

#### Deploy via GitHub (Recommended)

For automatic deployments:

1. Connect your GitHub repo to Cloudflare (Workers & Pages → Create → Connect to Git)
2. Push changes to `main` branch
3. Cloudflare automatically deploys

**Note**: The `keep_vars = true` setting in `wrangler.toml` ensures your dashboard variables won't be overwritten during deployment.

## Connect to Claude Desktop

Use the [mcp-remote proxy](https://www.npmjs.com/package/mcp-remote) to connect Claude Desktop to your MCP server.

Edit your Claude Desktop config (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "craft": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:8787/mcp"
      ]
    }
  }
}
```

For production, replace `http://localhost:8787/mcp` with your deployed worker URL:
`https://craft-mcp.<your-account>.workers.dev/mcp`

Restart Claude Desktop and the Craft tools will become available.

## Development

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Type check
npm run type-check

# Lint and format
npm run lint:fix
npm run format

# Deploy to Cloudflare
npm run deploy
```

## Project Structure

```
craft-mcp/
├── src/
│   └── index.ts          # MCP server implementation
├── docs/                 # API documentation
├── wrangler.toml         # Cloudflare Workers config (placeholders only)
├── .dev.vars            # Local env vars (gitignored, create this)
└── package.json
```

## Security Notes

- Document link IDs provide full API access to your Craft documents
- Keep `.dev.vars` and production environment variables private
- Never commit real link IDs to version control
- The repository includeshh placeholders only in `wrangler.toml`

## License

MIT 
