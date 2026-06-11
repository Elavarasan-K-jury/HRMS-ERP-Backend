# storage-service/server.js

## Purpose
gRPC microservice for file/folder management — CRUD for folders and files, upload/download integration with `FileService`, folder sharing among employees, and storage usage tracking.

## Key gRPC Handlers

| Method | Description |
|---|---|
| `CreateFolder` | Creates a folder with optional folder image upload via transaction |
| `GetFolder` | Fetches a single folder by ID |
| `ListFolders` | Paginated, searchable folders with storage usage aggregation |
| `UpdateFolder` | Updates folder metadata, optionally replaces folder image |
| `DeleteFolder` | Soft-deletes folder + all files/shares + underlying storage keys (transactional) |
| `UploadFileToFolder` | Uploads a file to a folder with `FileService`, creates Files row, updates folder counters |
| `ListFiles` | Paginated file listing within a folder (or all files) |
| `DeleteFile` | Soft-deletes a file, removes from storage, decrements folder counters |
| `ShareFolder` | Shares a folder with employees (idempotent — restores soft-deleted shares) |
| `UnshareFolder` | Removes an employee's access to a folder |
| `ListFolderShares` | Lists employees a folder is shared with |

## Important Logic

### Folder Creation with Image Upload (Transactional)
If a `folder_image_buffer` is provided, the image is uploaded via `FileService`, a `Files` row is created, and the folder's `folderImageId` is set — all within a single Prisma transaction:

```js
const folder = await prisma.$transaction(async (tx) => {
    const created = await tx.folders.create({ data: { name: data.name, ... } });

    if (data.folder_image_buffer?.length && data.folder_image_name) {
        const buf = Buffer.from(data.folder_image_buffer);
        const { fileRow } = await uploadFolderImageAndCreateFileRow({
            tx, organizationId, addedById, buffer: buf, originalName: data.folder_image_name,
        });

        const updated = await tx.folders.update({
            where: { id: created.id },
            data: { folderImageId: fileRow.id, folderStorageUsedInBytes: buf.length },
        });
        return updated;
    }
    return created;
});
```

### File Upload with Counter Increment
Uploading a file to a folder atomically increments the `filesCount` and `folderStorageUsedInBytes`:

```js
const created = await prisma.$transaction(async (tx) => {
    const fileRow = await tx.files.create({ data: { folderId: folder_id, fileUrl, fileKey, ... } });
    if (folder_id) {
        await tx.folders.update({
            where: { id: folder_id },
            data: { filesCount: { increment: 1 }, folderStorageUsedInBytes: { increment: buf.length } },
        });
    }
    return fileRow;
});
```

### Folder Delete Cascade (Transactional)
Soft-deleting a folder cascades to shares and files, and removes underlying storage keys:

```js
await prisma.$transaction(async (tx) => {
    await tx.folders.update({ where: { id }, data: { deletedAt: new Date() } });
    await tx.folderSharedWithEmployees.updateMany({ where: { folderId: id, deletedAt: null }, data: { deletedAt: new Date() } });

    const files = await tx.files.findMany({ where: { folderId: id, deletedAt: null } });
    for (const f of files) {
        try { await FileService.delete(f.fileKey); } catch (err) { console.warn(err); }
    }
    await tx.files.updateMany({ where: { folderId: id, deletedAt: null }, data: { deletedAt: new Date() } });
    // Also deletes folder image file row if present
});
```

### Idempotent Folder Sharing
If a share record was previously soft-deleted, it is restored instead of creating a duplicate:

```js
if (existing && existing.deletedAt) {
    const restored = await tx.folderSharedWithEmployees.update({
        where: { id: existing.id },
        data: { deletedAt: null, updatedAt: new Date(), addedById: added_by_id },
    });
    out.push(restored);
    continue;
}
```

### Storage Size Calculation
Converts human-readable storage units (GB, MB, etc.) to bytes:

```js
function sizeToBytes(value, unit) {
    const units = { B: 0, KB: 1, MB: 2, GB: 3, TB: 4, PB: 5, EB: 6 };
    const u = unit.toUpperCase();
    if (!(u in units)) return 0;
    return Math.round(Number(value) * Math.pow(1024, units[u]));
}
```

## Helper Functions

| Function | Purpose |
|---|---|
| `isObjectId(id)` | Validates 24-character hex MongoDB ObjectId |
| `toISO(d)` | Converts Date to ISO string (or empty string) |
| `mapFolder(folder)` | Maps Prisma folder to gRPC response |
| `mapFile(file)` | Maps Prisma file + folder name to gRPC response |
| `mapShareRow(row)` | Maps share record to gRPC response |
| `uploadFolderImageAndCreateFileRow(...)` | Uploads image to storage service and creates a Files row via transaction |
| `sizeToBytes(value, unit)` | Converts size with unit to bytes |
