# `local.storage.js` — Local Filesystem File Operations

Saves, reads, and deletes files from the local filesystem under the configured `uploadPath`.

## Exports

### `saveLocal(fileBuffer, filename)`
Writes a buffer to disk. Automatically creates any intermediate directories (for path separators in `filename`) and the base upload directory. Returns the public URL and absolute filesystem path.

```js
const result = await saveLocal(buffer, 'avatars/uuid.jpg');
// => { url: '/uploads/avatars/uuid.jpg', path: '/abs/path/uploads/avatars/uuid.jpg' }
```

### `readLocal(fileKey)`
Reads a file by its relative key and returns its contents as a `Buffer`. Throws if the file does not exist.

```js
const buf = await readLocal('avatars/uuid.jpg');
```

### `deleteLocal(filepath)`
Removes a file from disk if it exists. No-op if the file is missing.

```js
await deleteLocal('/abs/path/uploads/avatars/uuid.jpg');
```

## Dependencies

- `fs` (Node.js)
- `path` (Node.js)
- `./config.js` — `fileConfig.local.uploadPath`
