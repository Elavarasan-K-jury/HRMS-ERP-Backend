import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { fileConfig } from '../config.js';

/**
 * S3StorageProvider
 * Stores files in an AWS S3 bucket. The DB stores the object KEY (never the URL).
 */
export class S3StorageProvider {
    constructor() {
        const cfg = fileConfig.s3;
        if (!cfg.bucket || !cfg.region) {
            throw new Error(
                'S3 storage requires AWS_S3_BUCKET and AWS_REGION (FILE_STORAGE=s3)'
            );
        }
        this.bucket = cfg.bucket;
        this.client = new S3Client({
            region: cfg.region,
            ...(cfg.accessKeyId && cfg.secretAccessKey
                ? {
                      credentials: {
                          accessKeyId: cfg.accessKeyId,
                          secretAccessKey: cfg.secretAccessKey,
                      },
                  }
                : {}), // fall back to instance/IRSA credentials when keys are absent
        });
    }

    async upload(buffer, { storageKey, contentType = 'application/octet-stream' }) {
        await this.client.send(
            new PutObjectCommand({
                Bucket: this.bucket,
                Key: storageKey,
                Body: buffer,
                ContentType: contentType,
            })
        );
        return { storageKey };
    }

    async download(storageKey) {
        const res = await this.client.send(
            new GetObjectCommand({ Bucket: this.bucket, Key: storageKey })
        );
        return {
            body: res.Body,
            buffer: Buffer.from(await res.Body.transformToByteArray()),
            contentType: res.ContentType,
        };
    }

    async delete(storageKey) {
        await this.client.send(
            new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey })
        );
    }

    async exists(storageKey) {
        try {
            await this.client.send(
                new HeadObjectCommand({ Bucket: this.bucket, Key: storageKey })
            );
            return true;
        } catch {
            return false;
        }
    }

    async getSignedDownloadUrl(storageKey, expiresIn = 3600) {
        return getSignedUrl(
            this.client,
            new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }),
            { expiresIn }
        );
    }
}