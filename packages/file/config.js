import path from 'node:path';

/**
 * Lazy env config: values are resolved at access time so that services which
 * call dotenv.config() after imports still pick up the right storage mode.
 */
export const getFileConfig = () => ({
    storage: process.env.FILE_STORAGE || 'local', // local | s3

    local: {
        // Resolve to an absolute path so all services agree on the uploads dir
        uploadPath: path.resolve(
            process.env.LOCAL_STORAGE_PATH || path.join(process.cwd(), 'uploads')
        ),
    },

    s3: {
        bucket: process.env.AWS_S3_BUCKET || process.env.S3_BUCKET,
        region: process.env.AWS_REGION || process.env.S3_REGION,
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_KEY,
    },
});

export const fileConfig = new Proxy(
    {},
    {
        get: (_, prop) => getFileConfig()[prop],
    }
);

export const isS3Configured = () => {
    const cfg = getFileConfig().s3;
    return Boolean(cfg.bucket && cfg.region);
};