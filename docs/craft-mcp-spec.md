# Simplified Craft MCP Server - Tool Specifications

## Tool List

1. **`insertText`** - Insert markdown content into the document
2. **`deleteText`** - Delete a page or heading section (destructive)
3. **`fetchBlocks`** - Read document content with IDs
4. **`search`** - Search within the document

---

## Tool Descriptions

### 1. insertText

Insert markdown content into the document, optionally as a new subpage.

**Parameters:**
```typescript
{
  markdown: string;          // Markdown content to insert
  parent?: string;           // ID of page or heading to insert into (omit for root page)
  position: "start" | "end"; // Where to insert within the parent
  subpage?: boolean;         // If true, wraps content in a new page block (default: false)
}
```

**Behavior:**
- When `parent` is omitted, inserts at the root page level
- When `parent` is a page or heading ID, inserts as children of that element
- When `subpage: true`, creates a new page block and inserts the markdown as its content
  - The first heading (if present) becomes the page title
  - If no heading is present, the page will have an empty title
- Standard markdown is supported: headings (#, ##, etc.), lists (-, 1.), blockquotes (>), inline formatting (**bold**, *italic*, `code`)
- Craft-specific HTML tags supported:
  - `<callout></callout>` for callout blocks
  - `<caption></caption>` for caption text style

**Examples:**
```javascript
// Insert at root, end of document
insertText({
  markdown: "# New Section\n\nSome content",
  position: "end"
})

// Insert into a specific heading
insertText({
  markdown: "- New bullet point\n- Another point",
  parent: "heading-id-123",
  position: "end"
})

// Create a new subpage
insertText({
  markdown: "# Subpage Title\n\nThis becomes a separate page",
  parent: "page-id-456",
  position: "start",
  subpage: true
})
```

---

### 2. deleteText

Delete a page or heading and all its content. **WARNING: This is destructive and irreversible. Deleting a heading or page removes the entire section including all nested content.**

**Parameters:**
```typescript
{
  id: string; // ID of the page or heading to delete
}
```

**Behavior:**
- Deletes the specified page or heading block
- Also deletes ALL content nested under that block
- This includes text, lists, images, subpages, and any other nested elements
- Cannot be undone

**Example:**
```javascript
// Delete a heading and everything under it
deleteText({
  id: "heading-id-123"
})
```

---

### 3. fetchBlocks

Read document content in a markdown format with IDs embedded for pages and headings.

**Parameters:**
```typescript
{
  id?: string;      // ID of page or heading to fetch (omit for root page)
  maxDepth?: number; // Maximum nesting depth to fetch (default: -1 for all)
}
```

**Returns:**
Markdown text with XML tags for structure and IDs embedded in page and heading elements.

**Format:**
- Pages: `<page id="..."><pageTitle>...</pageTitle><content>...</content></page>`
- Headings: `# Heading Text <!-- id:... -->`
  - Pattern for all heading levels: `#`, `##`, `###`, `####` followed by `<!-- id:... -->`
- Regular markdown content (paragraphs, lists, blockquotes) rendered normally
- Nested pages appear as `<page>` tags within parent `<content>` tags
- Collections rendered as: `<collection><title>...</title><content>...</content></collection>` (no IDs needed since collections won't be edited via this API)

**Example Output:**
```markdown
<page id="0">
  <pageTitle>Root Document</pageTitle>
  <content>
    # Introduction <!-- id:10 -->
    
    This is the introduction paragraph.
    
    - First point
    - Second point
    
    ## Subsection <!-- id:11 -->
    
    More content here.
    
    <page id="20">
      <pageTitle>Nested Subpage</pageTitle>
      <content>
        ### Subpage Heading <!-- id:21 -->
        
        Content within the subpage.
      </content>
    </page>
    
    ## Another Section <!-- id:12 -->
    
    Final content.
  </content>
</page>
```

**Depth Control:**
- `maxDepth: 0` - Only the specified block, no children
- `maxDepth: 1` - The block and its immediate children
- `maxDepth: -1` - All descendants (default)

**Example:**
```javascript
// Fetch entire document
const content = fetchBlocks();

// Fetch specific page with limited depth
const section = fetchBlocks({
  id: "page-id-123",
  maxDepth: 2
});
```

---

### 4. search

Search for text within the document using pattern matching.

**Parameters:**
```typescript
{
  pattern: string;         // Search pattern (supports regex)
  caseSensitive?: boolean; // Case-sensitive search (default: false)
  beforeBlockCount?: number; // Context blocks before match (default: 2)
  afterBlockCount?: number;  // Context blocks after match (default: 2)
}
```

**Returns:**
Search results showing matched blocks with their parent context. Format:
- Matched blocks prefixed with `<blockId>: <blockContent>`
- Adjacent context blocks prefixed with `<blockId>- <blockContent>`
- Skipped blocks indicated with `... N Blocks Skipped ...`
- Results grouped by parent page/heading with path shown

**Example:**
```javascript
// Simple text search
search({
  pattern: "climate change"
})

// Case-sensitive regex search
search({
  pattern: "Project [0-9]+",
  caseSensitive: true
})
```

---

## Implementation Notes

### Underlying Craft API Mapping

This simplified server wraps the official Craft API tools:

- `insertText` → calls `insertMarkdown` or `insertBlocks` (when subpage=true)
- `deleteText` → calls `deleteBlocks`
- `fetchBlocks` → calls `fetchBlocks` with custom post-processing to add IDs
- `search` → calls `search` (mostly pass-through)

### ID Format

The server should extract IDs from the Craft API JSON responses and inject them into the markdown output:
- Pages already have `id` field in JSON
- Text blocks with `textStyle: "h1"/"h2"/"h3"/"h4"` have `id` fields
- Use HTML comments for headings: `<!-- id:12345 -->`
- Use XML attributes for pages: `<page id="12345">`

### Error Handling

- Invalid parent ID → return error message indicating ID not found
- Invalid position value → return error with valid options
- Empty markdown with subpage=true → create empty page (title from first heading if it exists later)
