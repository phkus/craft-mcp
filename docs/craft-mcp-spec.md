# Craft MCP Server - Tool Specifications

## Tool List

0. **`listDocuments`** - Show available documents
1. **`readDocument`** - Read document content with IDs
2. **`search`** - Search within the document
3. **`insertText`** - Insert markdown content into the document (with color variants)

---

## Tool Descriptions

### 0. listDocuments

Show available documents configured in the server.

**Parameters:**
```typescript
{
  // No parameters
}
```

**Returns:**
List of configured document names that can be used with other tools.

**Example:**
```javascript
listDocuments()
// Returns: "Available documents: MCP test, Possible Futures"
```

---

### 1. readDocument

Read document content in a markdown format with IDs embedded for pages and headings.

**Parameters:**
```typescript
{
  document: string;    // Name of the document to read (e.g., "MCP test")
  id?: string;         // ID of page or heading to fetch (omit for root page)
  maxDepth?: number;   // Maximum nesting depth to fetch (default: -1 for all)
}
```

**Returns:**
Markdown text with XML tags for structure and IDs embedded in page and heading elements.

**Format:**
- Pages: `<page id="..."><pageTitle>...</pageTitle><content>...</content></page>`
- Headings: `# Heading Text <!-- id:... -->`
- Collections: `<collection id="..." name="..."><schema>...</schema><items count="N"></items></collection>`

**Example:**
```javascript
// Fetch entire document
readDocument({ document: "MCP test" })

// Fetch specific page with limited depth
readDocument({
  document: "MCP test",
  id: "page-id-123",
  maxDepth: 2
})
```

---

### 2. search

Search for text within the document using pattern matching.

**Parameters:**
```typescript
{
  document: string;            // Name of the document to search (e.g., "MCP test")
  pattern: string;             // Search pattern (supports regex)
  caseSensitive?: boolean;     // Case-sensitive search (default: false)
  beforeBlockCount?: number;   // Context blocks before match (default: 2)
  afterBlockCount?: number;    // Context blocks after match (default: 2)
}
```

**Returns:**
Search results showing matched blocks with their parent context and hierarchical path.

**Example:**
```javascript
// Simple text search
search({
  document: "MCP test",
  pattern: "climate change"
})

// Case-sensitive regex search
search({
  document: "MCP test",
  pattern: "Project [0-9]+",
  caseSensitive: true
})
```

---

### 3. insertText

Insert markdown content into the document, optionally as a new subpage, with automatic color coding.

**Parameters:**
```typescript
{
  document: string;          // Name of the document to insert into (e.g., "MCP test")
  markdown: string;          // Markdown content to insert
  parent?: string;           // ID of page or heading to insert into (omit for root page)
  position: "start" | "end"; // Where to insert within the parent
  subpage?: boolean;         // If true, wraps content in a new page block (default: false)
  variant?: "1" | "2" | "3"; // Color variant (default: "1")
                             // "1" = purple (#9b59b6) - standard additions
                             // "2" = red (#e74c3c) - alternative interpretations
                             // "3" = blue (#3498db) - additional alternatives
}
```

**Behavior:**
- When `parent` is omitted, inserts at the root page level
- When `parent` is a page or heading ID, inserts as children of that element
- When `subpage: true`, creates a new page block and inserts the markdown as its content
  - The first heading (if present) becomes the page title
  - If no heading is present, the page will have an empty title
- All inserted blocks are automatically colored based on the `variant` parameter:
  - Variant 1 (purple): Default for standard AI-generated content
  - Variant 2 (red): Use for alternative interpretations or formulations
  - Variant 3 (blue): Use for additional alternatives
- Standard markdown is supported: headings (#, ##, etc.), lists (-, 1.), blockquotes (>), inline formatting (**bold**, *italic*, `code`)

**Examples:**
```javascript
// Insert at root, end of document (purple by default)
insertText({
  document: "MCP test",
  markdown: "# New Section\n\nSome content",
  position: "end"
})

// Insert alternative interpretation in red
insertText({
  document: "MCP test",
  markdown: "Alternative interpretation of the data...",
  parent: "heading-id-123",
  position: "end",
  variant: "2"
})

// Create three different formulations
insertText({
  document: "MCP test",
  markdown: "First formulation...",
  parent: "page-id-456",
  position: "end",
  variant: "1"
})
insertText({
  document: "MCP test",
  markdown: "Alternative formulation...",
  parent: "page-id-456",
  position: "end",
  variant: "2"
})
insertText({
  document: "MCP test",
  markdown: "Third option...",
  parent: "page-id-456",
  position: "end",
  variant: "3"
})
```

---

## Implementation Notes

### Underlying Craft API Mapping

This server uses the official Craft API endpoints:

- `listDocuments` → returns document list from environment configuration
- `readDocument` → calls `GET /blocks` with custom post-processing to add IDs
- `search` → calls `GET /blocks/search`
- `insertText` → calls `POST /blocks` with color parameter based on variant

### Color Coding for Authorship Tracking

All AI-generated content is automatically colored to distinguish it from human-written content:
- **Purple** (`#9b59b6`) - Variant 1, standard AI additions
- **Red** (`#e74c3c`) - Variant 2, alternative interpretations
- **Blue** (`#3498db`) - Variant 3, additional alternatives

This enables:
- Clear visual separation between AI and human content
- Divergent thinking by presenting multiple colored alternatives
- Intentional editing when users remove colors to take ownership

### ID Format

The server extracts IDs from Craft API JSON responses and embeds them in markdown:
- Pages: `<page id="12345">...</page>`
- Headings: `<!-- id:12345 -->`
- Collections: `<collection id="12345" name="...">...</collection>`

### Error Handling

- Unknown document name → return error with list of available documents
- Invalid parent ID → return error message indicating ID not found
- Invalid position value → return error with valid options
- Empty markdown with subpage=true → create empty page
