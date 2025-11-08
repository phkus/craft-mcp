# Craft – API for MCP test

**Version:** 1.0.0

## Overview
The Craft Blocks API provides a flexible, hierarchical data structure that serves as a powerful general-purpose hybrid data store. It combines structured data collections with unstructured textual or file block content in a tree-based hierarchy.

## Recommended Usage
This API is best utilized when a custom abstraction layer is built on top to hide Craft-specific concepts (ids, blocks, pages, text styles) and expose domain-specific operations for your use case.

## Development Tip
- When working with existing content, try to preserve the original hierarchical structure where possible to maintain data organization and relationships.
- When working with collections, favor `/collections/{collectionName}/items` endpoints instead of accessing collections as blocks.

## Note for AI
When implementing functionality using this API, always make actual calls to these endpoints and verify the responses. Do not simulate or mock the API interactions or use hard-coded values on the client-side - use the real endpoints to ensure proper functionality and data handling.

**IMPORTANT: This is a production server connected to real user data.** Only perform testing operations that can be safely rolled back:

- Safe: Reading data (`GET` requests), creating test content that you delete immediately after
- Safe: Modifying content if you can restore it to its original state
- Safe: Moving blocks if you can move them back to their original position
- Unsafe: Permanent deletions, modifications without backup, or any changes you cannot reverse

Always verify rollback operations work before considering a test complete.

## Servers

- https://connect.craft.do/links/AcHPMgNXYdR/api/v1
  API Server for MCP test

---

# Endpoints

# Fetch Blocks

`GET /blocks`

Fetches content from the document. The system uses a block-based hierarchical structure with rich content support. Page blocks define the hierarchy, where each page contains child blocks. The root level is itself a page block.

Use `Accept` header `application/json` for structured data, `text/markdown` for rendered content.

**Content Rendering:** Text blocks contain markdown formatting and may include structural tags like `<page></page>`, `<card></card>`, etc. When displaying content, consider rendering markdown as formatted text or cleaning up the syntax and structural tags for plain text display.

**Document Scope Filtering:** Block links in text runs are filtered to document scope. In-scope links include a `relation` field with the target blockId. Out-of-scope links include a `warning` string field instead.

**Tip:** Start by calling this endpoint without parameters to explore and understand the data structure before making modifications.

## Parameters

- **id** (query): string
  The ID of the page block to fetch. If not provided, the root page will be fetched.
- **maxDepth** (query): number
  The maximum depth of blocks to fetch. Default is -1 (all descendants). With a depth of 0, only the specified block is fetched. With a depth of 1, only direct children are returned.
- **fetchMetadata** (query): boolean
  Whether to fetch metadata (comments, createdBy, lastModifiedBy, lastModifiedAt, createdAt) for the blocks. Default is false.

## Responses

### 200
Array of fetched blocks

**Content-Type:** `application/json`

```json
{
  "id": "0",
  "type": "page",
  "textStyle": "page",
  "markdown": "<page>Document Title</page>",
  "content": [
    {
      "id": "1",
      "type": "text",
      "textStyle": "h1",
      "markdown": "# Main Section"
    },
    {
      "id": "2",
      "type": "text",
      "markdown": "This document contains hierarchical content with multiple nesting levels."
    },
    {
      "id": "3",
      "type": "page",
      "textStyle": "card",
      "markdown": "<card>Subsection A</card>",
      "content": [
        {
          "id": "4",
          "type": "text",
          "textStyle": "h2",
          "markdown": "## Category Header"
        },
        {
          "id": "5",
          "type": "text",
          "markdown": "- List item alpha",
          "indentationLevel": 3
        },
        {
          "id": "6",
          "type": "page",
          "textStyle": "card",
          "markdown": "<card>Sub-subsection</card>",
          "content": [
            {
              "id": "7",
              "type": "text",
              "textStyle": "h3",
              "markdown": "### Nested Header"
            },
            {
              "id": "8",
              "type": "text",
              "markdown": "Content at depth level 3 with **formatting**.",
              "indentationLevel": 1
            }
          ]
        }
      ]
    },
    {
      "id": "9",
      "type": "image",
      "url": "https://example.com/diagram.jpg",
      "altText": "Structural diagram",
      "width": 600,
      "height": 400
    }
  ]
}
```

**Content-Type:** `text/markdown`

```markdown
<page>
<pageTitle>Document Title</pageTitle>
<content>
    # Main Section

    This document contains hierarchical content with multiple nesting levels.

    <page>
    <pageTitle>Subsection A</pageTitle>
    <content>
        ## Category Header

        - List item alpha
        - List item beta
        - List item gamma

        <page>
        <pageTitle>Sub-subsection</pageTitle>
        <content>
            ### Nested Header

            Content at depth level 3 with **formatting**.
        </content>
        </page>
    </content>
    </page>

</content>
</page>
```

---

# Insert Blocks

`POST /blocks`

Insert content into the document. Content can be provided as structured JSON blocks. Returns the inserted blocks with their assigned block IDs for later reference. Block IDs never change once assigned.

**File Upload (3-Step Process)** – to upload files (images, videos, documents):
1. Call POST `/upload-link` with optional `fileName` or `mimeType` (e.g., `{"fileName": "photo.jpg"}`) to get `uploadUrl`
2. Upload file to S3 with matching Content-Type:
   ```bash
   curl -T /path/to/file "UPLOAD_URL" -H "Content-Type: image/jpeg"
   ```
3. Call POST `/blocks` with the uploaded file's URL as the block's `url` field
   - File metadata (`mimeType`, `fileSize`) will be automatically fetched from S3 and populated in the response
   - Do NOT provide `mimeType` or `fileSize` in the request - they are read-only fields

**S3 CLEANUP WARNING:**
Files uploaded to S3 that are NOT inserted into blocks within the timeout period will be automatically purged. Complete step 3 promptly.

**Content-Type Matching:**
The `Content-Type` header in step 2 must match the `mimeType` provided in step 1. If neither `mimeType` nor `fileName` is provided, defaults to `text/plain`.

**File Metadata:**
- `fileName`: Optional display name (e.g., `document.pdf`)
- `mimeType` and `fileSize`: Automatically retrieved from S3 and populated in the response

## Request Body

**Content-Type:** `application/json`


**Example: textBlock**

Insert text block as child inside block

```json
{
  "blocks": [
    {
      "type": "text",
      "markdown": "## Second Level Header\n\n- **List Item A**: Description text\n- **List Item B**: Description text\n- **List Item C**: Description text"
    }
  ],
  "position": {
    "position": "end",
    "pageId": "0"
  }
}
```


**Example: imageBlockWithUrl**

Insert image block with URL (after 3-step upload)

```json
{
  "blocks": [
    {
      "type": "image",
      "url": "https://res.luki.io/user/full/space-id/doc/doc-id/image-uuid.jpg",
      "altText": "Alt text for accessibility",
      "width": "auto"
    }
  ],
  "position": {
    "position": "before",
    "siblingId": "3"
  }
}
```


**Example: videoBlockWithUrl**

Insert video block with URL (after 3-step upload)

```json
{
  "blocks": [
    {
      "type": "video",
      "url": "https://res.luki.io/user/full/space-id/doc/doc-id/video-uuid.mp4",
      "altText": "Video description",
      "width": "auto"
    }
  ],
  "position": {
    "position": "end",
    "pageId": "0"
  }
}
```


**Example: fileBlockWithUrl**

Insert file block with URL (after 3-step upload)

```json
{
  "blocks": [
    {
      "type": "file",
      "url": "https://res.luki.io/user/full/space-id/doc/doc-id/file-uuid.pdf",
      "fileName": "document.pdf"
    }
  ],
  "position": {
    "position": "end",
    "pageId": "0"
  }
}
```

## Responses

### 200
Array of inserted blocks with assigned IDs

**Content-Type:** `application/json`

```json
{
  "items": [
    {
      "id": "15",
      "type": "text",
      "textStyle": "body",
      "markdown": "## Second Level Header\n\n- **List Item A**: Description text\n- **List Item B**: Description text"
    },
    {
      "id": "16",
      "type": "image",
      "url": "https://res.luki.io/user/full/space-id/doc/doc-id/uuid",
      "altText": "Alt text for accessibility",
      "markdown": "![Image](https://res.luki.io/user/full/space-id/doc/doc-id/uuid)"
    },
    {
      "id": "17",
      "type": "file",
      "url": "https://res.luki.io/user/full/space-id/doc/doc-id/file-uuid.pdf",
      "fileName": "document.pdf",
      "mimeType": "application/pdf",
      "fileSize": 1536000,
      "markdown": "[document.pdf](https://res.luki.io/user/full/space-id/doc/doc-id/file-uuid.pdf)"
    }
  ]
}
```

---

# Delete Blocks

`DELETE /blocks`

Delete content from the document. Removes specified blocks by their IDs. Partial success supported – operation continues even if some block IDs are not found.

## Request Body

**Content-Type:** `application/json`

```json
{
  "blockIds": [
    "7",
    "9",
    "12"
  ]
}
```

## Responses

### 200
Array of deleted block IDs (HTTP 207 for partial success)

**Content-Type:** `application/json`

```json
{
  "items": [
    {
      "id": "7"
    },
    {
      "id": "9"
    },
    {
      "id": "12"
    }
  ]
}
```

---

# Update Blocks

`PUT /blocks`

Update content in the document.


For text blocks, provide updated markdown content in the `markdown` field. Only paragraph level markdown is allowed: headings, text formatting, list style (single list item only). Markdown that yields non-text blocks or multiple blocks will be rejected.


Returns updated blocks to confirm changes.




## Request Body

**Content-Type:** `application/json`

```json
{
  "blocks": [
    {
      "id": "5",
      "markdown": "## Updated Section Title\n\nThis content has been updated with new information.",
      "font": "serif"
    },
    {
      "id": "8",
      "markdown": "# New Heading"
    }
  ]
}
```

## Responses

### 200
Array of updated blocks

**Content-Type:** `application/json`

```json
{
  "items": [
    {
      "id": "5",
      "type": "text",
      "textStyle": "body",
      "markdown": "## Updated Section Title\n\nThis content has been updated with new information.",
      "font": "serif"
    },
    {
      "id": "8",
      "type": "text",
      "textStyle": "h2",
      "markdown": "# New Heading"
    }
  ]
}
```

---

# Generate Upload URL

`POST /upload-link`

Generate a pre-signed S3 URL for direct file upload (Step 1 of 3-step upload process).

**3-Step Upload Flow:**
1. Call this endpoint with `fileName` (required) to get `uploadUrl`
2. Upload file to S3 with matching Content-Type:
   ```bash
   curl -T /path/to/file "UPLOAD_URL" -H "Content-Type: image/jpeg"
   ```
3. Call POST `/blocks` with the uploaded file's URL as the block's `url` field to insert the block

**IMPORTANT NOTES:**
- **`fileName` is REQUIRED** - Must provide the filename with extension (e.g., `photo.jpg`, `document.pdf`)
- Files uploaded to S3 must be inserted into blocks promptly or they will be purged
- The `uploadUrl` is valid for 1 hour
- MIME type is auto-detected from `fileName` extension (supports 40+ common file types)
- Optionally provide `mimeType` to override the auto-detected MIME type
- The `Content-Type` header in step 2 must match the `Content-Type` in the signed URL

## Request Body

**Content-Type:** `application/json`

```json
{
  "fileName": "photo.jpg",
  "mimeType": "image/jpeg"
}
```

## Responses

### 200
Upload URL generated successfully

**Content-Type:** `application/json`

```json
{
  "uploadUrl": "https://s3.amazonaws.com/bucket/path?AWSAccessKeyId=...&Signature=...",
  "rawUrl": "string"
}
```

---

# Move Blocks

`PUT /blocks/move`

Move blocks to reorder them or assign a new parent block for them. Returns the moved block IDs.

## Request Body

**Content-Type:** `application/json`

```json
{
  "blockIds": [
    "9",
    "10",
    "11"
  ],
  "position": {
    "position": "after",
    "siblingId": "8"
  }
}
```

## Responses

### 200
Array of moved block IDs (HTTP 207 for partial success)

**Content-Type:** `application/json`

```json
{
  "items": [
    {
      "id": "9"
    },
    {
      "id": "10"
    },
    {
      "id": "11"
    }
  ]
}
```

---

# Search in Document

`GET /blocks/search`

Search content in the document. Results are returned in hierarchical order. Each match includes the block ID, content, hierarchical path, and surrounding context blocks for better understanding of the data relationships.

## Parameters

- **pattern** (required) (query): string
  The search patterns to look for. Supports NodeJS regular expressions.
- **caseSensitive** (query): boolean
  Whether the search should be case sensitive. Default is false.
- **beforeBlockCount** (query): number
  The number of blocks to include before the matched block.
- **afterBlockCount** (query): number
  The number of blocks to include after the matched block.

## Responses

### 200
Array of search matches with structured context

**Content-Type:** `application/json`


**Example: searchWithContext**

Search for 'Description' with beforeBlockCount=3, afterBlockCount=2

```json
{
  "items": [
    {
      "blockId": "109",
      "markdown": "List Item A: Description text",
      "pageBlockPath": [
        {
          "id": "0",
          "content": "title"
        }
      ],
      "beforeBlocks": [
        {
          "blockId": "108",
          "markdown": "Second Level Header"
        }
      ],
      "afterBlocks": [
        {
          "blockId": "110",
          "markdown": "List Item B: Description text"
        },
        {
          "blockId": "111",
          "markdown": "List Item C: Description text"
        }
      ]
    },
    {
      "blockId": "110",
      "markdown": "List Item B: Description text",
      "pageBlockPath": [
        {
          "id": "0",
          "content": "title"
        }
      ],
      "beforeBlocks": [
        {
          "blockId": "108",
          "markdown": "Second Level Header"
        },
        {
          "blockId": "109",
          "markdown": "List Item A: Description text"
        }
      ],
      "afterBlocks": [
        {
          "blockId": "111",
          "markdown": "List Item C: Description text"
        }
      ]
    },
    {
      "blockId": "111",
      "markdown": "List Item C: Description text",
      "pageBlockPath": [
        {
          "id": "0",
          "content": "title"
        }
      ],
      "beforeBlocks": [
        {
          "blockId": "108",
          "markdown": "Second Level Header"
        },
        {
          "blockId": "109",
          "markdown": "List Item A: Description text"
        },
        {
          "blockId": "110",
          "markdown": "List Item B: Description text"
        }
      ],
      "afterBlocks": []
    }
  ]
}
```

**Example: deeplyNestedSearch**

Search in deeply nested structure with beforeBlockCount=2, afterBlockCount=1

```json
{
  "items": [
    {
      "blockId": "87",
      "markdown": "This important task needs attention",
      "pageBlockPath": [
        {
          "id": "0",
          "content": "Project Documentation"
        },
        {
          "id": "3",
          "content": "Development Phase"
        },
        {
          "id": "12",
          "content": "Backend Implementation"
        },
        {
          "id": "24",
          "content": "API Endpoints"
        },
        {
          "id": "56",
          "content": "Authentication Module"
        }
      ],
      "beforeBlocks": [
        {
          "blockId": "85",
          "markdown": "## Security Requirements"
        },
        {
          "blockId": "86",
          "markdown": "JWT tokens must be validated on every request"
        }
      ],
      "afterBlocks": [
        {
          "blockId": "88",
          "markdown": "Password hashing should use bcrypt with salt rounds >= 12"
        }
      ]
    }
  ]
}
```

---

# Get Test Collection

`GET /collections/test_collection/items`

Retrieve all test collection items. Backend document changes may cause 404 errors - handle gracefully.

**Content Format:** Use Accept header to control content format:
- `Accept: application/json` (default) - Returns items with nested content as block arrays
- `Accept: application/json; content=markdown` - Returns items with contentMarkdown field containing the item's markdown representation

**Document Scope Filtering:** Relations and block links in properties are filtered to document scope. Out-of-scope references show a `warning` string field and empty or reduced arrays.

## Parameters

- **maxDepth** (query): number
  The maximum depth of nested content to fetch for each collection item. Default is -1 (all descendants). With a depth of 0, only the item properties are fetched without nested content.

## Responses

### 200
Test Collection items retrieved successfully

**Content-Type:** `application/json`


**Example: defaultFormat**

Default format with nested blocks

```json
{
  "items": [
    {
      "id": "3",
      "title": "Q1 Project Planning",
      "properties": {
        "status": "In Progress",
        "dueDate": "2025-03-31",
        "owner": "Jane Smith"
      },
      "content": [
        {
          "id": "4",
          "type": "text",
          "markdown": "## Objectives\n\n- Define quarterly goals\n- Allocate resources\n- Set key milestones"
        }
      ]
    }
  ]
}
```

**Example: markdownFormat**

Markdown format (Accept: application/json; content=markdown)

```json
{
  "items": [
    {
      "id": "3",
      "title": "Q1 Project Planning",
      "properties": {
        "status": "In Progress",
        "dueDate": "2025-03-31",
        "owner": "Jane Smith"
      },
      "contentMarkdown": "## Objectives\n\n- Define quarterly goals\n- Allocate resources\n- Set key milestones"
    }
  ]
}
```

---

# Add Test Collection

`POST /collections/test_collection/items`

Add new test collection items. Schema changes may cause validation errors.

## Request Body

**Content-Type:** `application/json`

```json
{
  "items": [
    {
      "title": "string",
      "properties": {}
    }
  ]
}
```

## Responses

### 200
Test Collection items created successfully

**Content-Type:** `application/json`


**Example: success**

Successful creation

```json
{
  "items": [
    {
      "id": "3",
      "title": "New Collection Item",
      "properties": {
        "status": "Active",
        "priority": "High",
        "assignee": "John Doe"
      }
    }
  ]
}
```

**Example: partialFailure**

Partial failure with some items failing

```json
{
  "items": [
    {
      "id": "3",
      "title": "Successfully Created Item",
      "properties": {
        "status": "Active"
      }
    }
  ],
  "ignoredItems": [
    {
      "title": "Invalid Item Missing Required Field"
    }
  ]
}
```

---

# Delete Test Collection

`DELETE /collections/test_collection/items`

Delete test collection items. Items may already be deleted, causing partial success.

## Request Body

**Content-Type:** `application/json`

```json
{
  "idsToDelete": [
    "1",
    "2"
  ]
}
```

## Responses

### 200
Test Collection items deleted successfully

**Content-Type:** `application/json`

```json
{
  "items": [
    {
      "id": "3"
    },
    {
      "id": "4"
    }
  ]
}
```

---

# Update Test Collection

`PUT /collections/test_collection/items`

Update existing test collection items. Item deletion or schema changes may cause errors.

## Request Body

**Content-Type:** `application/json`

```json
{
  "itemsToUpdate": [
    {
      "id": "string",
      "title": "string",
      "properties": {}
    }
  ]
}
```

## Responses

### 200
Test Collection items updated successfully

**Content-Type:** `application/json`


**Example: success**

Successful update

```json
{
  "items": [
    {
      "id": "3",
      "title": "Updated Collection Item Title",
      "properties": {
        "status": "Completed",
        "priority": "Medium",
        "completedDate": "2025-01-15"
      }
    }
  ]
}
```

**Example: partialFailure**

Partial failure with some items failing

```json
{
  "items": [
    {
      "id": "3",
      "title": "Successfully Updated Item",
      "properties": {
        "status": "Completed"
      }
    }
  ],
  "ignoredItems": [
    {
      "id": "999"
    }
  ]
}
```

---

# Get Another collection

`GET /collections/another_collection/items`

Retrieve all another collection items. Backend document changes may cause 404 errors - handle gracefully.

**Content Format:** Use Accept header to control content format:
- `Accept: application/json` (default) - Returns items with nested content as block arrays
- `Accept: application/json; content=markdown` - Returns items with contentMarkdown field containing the item's markdown representation

**Document Scope Filtering:** Relations and block links in properties are filtered to document scope. Out-of-scope references show a `warning` string field and empty or reduced arrays.

## Parameters

- **maxDepth** (query): number
  The maximum depth of nested content to fetch for each collection item. Default is -1 (all descendants). With a depth of 0, only the item properties are fetched without nested content.

## Responses

### 200
Another collection items retrieved successfully

**Content-Type:** `application/json`


**Example: defaultFormat**

Default format with nested blocks

```json
{
  "items": [
    {
      "id": "3",
      "title": "Q1 Project Planning",
      "properties": {
        "status": "In Progress",
        "dueDate": "2025-03-31",
        "owner": "Jane Smith"
      },
      "content": [
        {
          "id": "4",
          "type": "text",
          "markdown": "## Objectives\n\n- Define quarterly goals\n- Allocate resources\n- Set key milestones"
        }
      ]
    }
  ]
}
```

**Example: markdownFormat**

Markdown format (Accept: application/json; content=markdown)

```json
{
  "items": [
    {
      "id": "3",
      "title": "Q1 Project Planning",
      "properties": {
        "status": "In Progress",
        "dueDate": "2025-03-31",
        "owner": "Jane Smith"
      },
      "contentMarkdown": "## Objectives\n\n- Define quarterly goals\n- Allocate resources\n- Set key milestones"
    }
  ]
}
```

---

# Add Another collection

`POST /collections/another_collection/items`

Add new another collection items. Schema changes may cause validation errors.

## Request Body

**Content-Type:** `application/json`

```json
{
  "items": [
    {
      "title": "string",
      "properties": {}
    }
  ]
}
```

## Responses

### 200
Another collection items created successfully

**Content-Type:** `application/json`


**Example: success**

Successful creation

```json
{
  "items": [
    {
      "id": "3",
      "title": "New Collection Item",
      "properties": {
        "status": "Active",
        "priority": "High",
        "assignee": "John Doe"
      }
    }
  ]
}
```

**Example: partialFailure**

Partial failure with some items failing

```json
{
  "items": [
    {
      "id": "3",
      "title": "Successfully Created Item",
      "properties": {
        "status": "Active"
      }
    }
  ],
  "ignoredItems": [
    {
      "title": "Invalid Item Missing Required Field"
    }
  ]
}
```

---

# Delete Another collection

`DELETE /collections/another_collection/items`

Delete another collection items. Items may already be deleted, causing partial success.

## Request Body

**Content-Type:** `application/json`

```json
{
  "idsToDelete": [
    "1",
    "2"
  ]
}
```

## Responses

### 200
Another collection items deleted successfully

**Content-Type:** `application/json`

```json
{
  "items": [
    {
      "id": "3"
    },
    {
      "id": "4"
    }
  ]
}
```

---

# Update Another collection

`PUT /collections/another_collection/items`

Update existing another collection items. Item deletion or schema changes may cause errors.

## Request Body

**Content-Type:** `application/json`

```json
{
  "itemsToUpdate": [
    {
      "id": "string",
      "title": "string",
      "properties": {}
    }
  ]
}
```

## Responses

### 200
Another collection items updated successfully

**Content-Type:** `application/json`


**Example: success**

Successful update

```json
{
  "items": [
    {
      "id": "3",
      "title": "Updated Collection Item Title",
      "properties": {
        "status": "Completed",
        "priority": "Medium",
        "completedDate": "2025-01-15"
      }
    }
  ]
}
```

**Example: partialFailure**

Partial failure with some items failing

```json
{
  "items": [
    {
      "id": "3",
      "title": "Successfully Updated Item",
      "properties": {
        "status": "Completed"
      }
    }
  ],
  "ignoredItems": [
    {
      "id": "999"
    }
  ]
}
```

---
