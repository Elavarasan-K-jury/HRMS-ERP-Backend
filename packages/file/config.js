export const fileConfig = {
    storage: process.env.FILE_STORAGE || "local",  // local | s3

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
