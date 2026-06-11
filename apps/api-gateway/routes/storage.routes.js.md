# Storage Routes

**Service:** Storage gRPC (`storageClient`)

## Routes

| Method | Path | Summary |
|--------|------|---------|
| POST | `/folders` | Create a folder (with optional image) |
| GET | `/folders/{id}` | Get folder by ID |
| GET | `/folders` | List folders |
| PUT | `/folders/{id}` | Update folder |
| DELETE | `/folders/{id}` | Delete folder |
| POST | `/files` | Upload file to folder |
| GET | `/files` | List files (by organization or folder) |
| DELETE | `/files/{id}` | Delete a file |
| POST | `/folders/{id}/share` | Share folder with employees |

## Code Snippet

```js
async (c) => {
    try {
        const body = await c.req.parseBody();
        const parsed = z.object({ name: z.string(), organization_id: z.string(), ... }).parse(body);
        const file = body.folder_image;
        const payload = { ...parsed, visibility: parsed.visibility ?? 'PRIVATE' };
        if (file?.arrayBuffer) {
            payload.folder_image_buffer = Buffer.from(await file.arrayBuffer());
            payload.folder_image_name = file.name;
        }
        const response = await new Promise((resolve, reject) => {
            storageClient.CreateFolder(payload, (err, resp) => { ... });
        });
        return c.json(response, 201);
    } catch (e) { ... }
}
```

## Request/Response Schemas

- **CreateFolder**: `multipart/form-data` with `{ name, organization_id, created_by_id, color?, visibility? (PRIVATE|SHARED|PUBLIC), folder_image? (binary) }`
- **UploadFile**: `multipart/form-data` with `{ organization_id, folder_id?, added_by_id, file (binary) }`
- **ShareFolder**: `{ employee_ids (min 1), added_by_id }`
- **FolderResponse**: `{ id, name, color?, folder_image_id?, files_count, folder_storage_used_in_bytes, organization_id, created_by_id, visibility, ... }`
- **FileResponse**: `{ id, folder_id?, file_url, file_key, added_by_id, organization_id, ... }`

## Unique Logic

- Only route file using `multipart/form-data` (via `c.req.parseBody()`).
- File uploads convert `File` to `Buffer` via `file.arrayBuffer()` for gRPC transmission.
- Folder visibility enum: `PRIVATE`, `SHARED`, `PUBLIC`.
- Folder share endpoint shares with multiple employees at once.
- Swagger docs describe multipart schemas with `openapi({ type: 'string', format: 'binary' })`.
