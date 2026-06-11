# `config.js` — File Storage Configuration

Exports a configuration object that controls whether files are stored locally or on S3, along with provider-specific settings.

## Exports

### `fileConfig`

```js
export const fileConfig = {
    storage: process.env.FILE_STORAGE || "local",
    local: {
        uploadPath: process.env.LOCAL_STORAGE_PATH || "uploads"
    },
    s3: {
        bucket: process.env.S3_BUCKET,
        region: process.env.S3_REGION,
        accessKeyId: process.env.S3_ACCESS_KEY,
        secretAccessKey: process.env.S3_SECRET_KEY,
    }
};
```

The `storage` property (`"local"` or `"s3"`) determines which backend `FileService` uses at runtime.

## Dependencies

None (pure config object).
