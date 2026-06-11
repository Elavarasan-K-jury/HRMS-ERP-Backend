# `file.service.js` — Unified File Service (Local / S3)

Abstraction layer over local filesystem and S3 storage. All methods are static on the `FileService` class and delegate to the backend configured in `fileConfig.storage`.

## Exports

### `FileService.upload(fileBuffer, originalName, storePath)`
Generates a unique filename using UUID + timestamp + original name, detects MIME type via `mime-types`, then delegates to local or S3 storage.

```js
const result = await FileService.upload(buffer, 'photo.jpg', 'profile-pics');
// Local:  { url: '/uploads/profile-pics/uuid...jpg', path: '...' }
// S3:     { url: 'https://...', key: 'profile-pics/uuid...jpg' }
```

### `FileService.get(fileKey)`
Reads a file and returns a `Buffer`. Accepts a file key (relative path for local, S3 key for S3).

```js
const buf = await FileService.get('profile-pics/uuid...jpg');
```

### `FileService.delete(filePathOrKey)`
Deletes a file by its path or S3 key.

```js
await FileService.delete('profile-pics/uuid...jpg');
```

## Dependencies

- `uuid` — unique filename generation
- `mime-types` — MIME type detection from file extension
- `./config.js` — `fileConfig`
- `./local.storage.js` — `saveLocal`, `readLocal`, `deleteLocal`
- `./s3.storage.js` — `uploadToS3`, `readFromS3`, `deleteFromS3`
