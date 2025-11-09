# Craft MCP Server

A remote [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for [Craft](https://www.craft.do/) document management, deployed on Cloudflare Workers. This server enables AI assistants like Claude to read, write, search, and manage Craft documents and collections.

## Features

- **Document Management**: Read, write, search, and delete content in Craft documents
- **Collection Support**: Work with Craft collections (similar to Notion databases)
- **Multi-Document**: Support for multiple Craft documents via configuration
- **GitHub OAuth Authentication**: Secure access control using GitHub accounts
- **Serverless**: Deployed on Cloudflare Workers with Durable Objects

## Setup

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd craft-mcp
npm install
```

### 2. Create GitHub OAuth App

1. Go to [GitHub Settings → Developer settings → OAuth Apps](https://github.com/settings/developers)
2. Click **New OAuth App**
3. Fill in:
   - **Application name**: Craft MCP Server
   - **Homepage URL**: `https://craft-mcp.YOUR_SUBDOMAIN.workers.dev`
   - **Authorization callback URL**: `https://craft-mcp.YOUR_SUBDOMAIN.workers.dev/callback`
4. Click **Register application**
5. Copy the **Client ID** and generate a **Client Secret**

### 3. Create KV Namespace

```bash
# Create the KV namespace for OAuth tokens
wrangler kv namespace create OAUTH_KV

# Note the namespace ID from the output
# Update wrangler.toml with this ID
```

### 4. Configure Environment Variables

#### For Local Development

Create a `.dev.vars` file in the project root:

```bash
# Craft documents
CRAFT_DOCUMENTS={"My Document": "https://connect.craft.do/links/YOUR_LINK_ID/api/v1"}

# GitHub OAuth credentials
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret

# Optional: Restrict access to specific GitHub users
ALLOWED_USERNAMES=username1,username2
```

**Get Craft Document Link IDs:**
1. Open your Craft document
2. Click **Share** → **Enable API**
3. Copy the link ID from the URL (e.g., `AcHPMgNXYdR`)

#### For Production

Set via Cloudflare Dashboard (Workers & Pages → Your Worker → Settings → Variables):

- `CRAFT_DOCUMENTS` - JSON mapping of document names to API URLs
- `GITHUB_CLIENT_ID` - Your GitHub OAuth Client ID
- `GITHUB_CLIENT_SECRET` - Your GitHub OAuth Client Secret (mark as encrypted)
- `ALLOWED_USERNAMES` - (Optional) Comma-separated list of allowed GitHub usernames

**OR** use Wrangler CLI:

```bash
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put CRAFT_DOCUMENTS
```

### 5. Update wrangler.toml

Replace `YOUR_KV_NAMESPACE_ID_HERE` with your actual KV namespace ID:

```toml
[[kv_namespaces]]
binding = "OAUTH_KV"
id = "your_actual_namespace_id"
```

### 6. Run Locally

```bash
npm run dev
```

Your MCP server will be available at `http://localhost:8787/sse`

### 7. Deploy to Cloudflare

#### Via GitHub (Recommended)

1. Connect your GitHub repo to Cloudflare (Workers & Pages → Create → Connect to Git)
2. Configure environment variables in the dashboard
3. Push changes to `main` branch - Cloudflare automatically deploys

#### Direct Deployment

```bash
npm run deploy
```

**Note**: Set environment variables in the dashboard first. The `keep_vars = true` setting ensures they won't be overwritten.

## Connect to Claude Desktop

Edit your Claude Desktop config (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "craft": {
      "url": "https://craft-mcp.YOUR_SUBDOMAIN.workers.dev/sse"
    }
  }
}
```

For local development, use `http://localhost:8787/sse`

**Authentication Flow:**
1. Restart Claude Desktop
2. When you try to use Craft tools, you'll be redirected to GitHub
3. Authorize the application
4. You'll be redirected back and authentication will complete
5. Craft tools will become available

The OAuth flow is handled automatically by the MCP client.

## Available Tools

- `listDocuments` - Show configured documents
- `readDocument` - Read document content with embedded IDs
- `insertText` - Insert markdown content into documents
- `deleteText` - Delete pages or headings
- `search` - Search within documents with regex support
- `getCollectionItems` - Retrieve items from Craft collections
- `createCollectionItems` - Add items to collections
- `updateCollectionItems` - Update existing collection items

See [CLAUDE.md](./CLAUDE.md) for detailed tool documentation and architecture information.

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

- **OAuth Authentication**: All access requires GitHub authentication
- **User Whitelist**: Use `ALLOWED_USERNAMES` to restrict access to specific GitHub users
- **Document Link IDs**: Provide full API access to your Craft documents - keep them private
- **Environment Variables**: Never commit real credentials or link IDs to version control
- **KV Namespace**: The `OAUTH_KV` namespace stores OAuth tokens and session state
- Keep `.dev.vars` and production environment variables secure

## License

MIT 
