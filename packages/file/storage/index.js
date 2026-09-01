import { LocalStorageProvider } from './local.provider.js';
import { S3StorageProvider } from './s3.provider.js';
import { getFileConfig } from '../config.js';

/**
 * StorageService
 * Common abstraction over LocalStorageProvider / S3StorageProvider.
 * Controllers never need to know which backend is configured.
 *
 * The provider (and therefore the storage mode) is resolved lazily on first
 * use. Services load their env (dotenv) after imports, so we must not read
 * process.env at module-evaluation time.
 */
class StorageService {
    constructor() {
        this._provider = null;
        this._mode = null;
    }

    get provider() {
        if (!this._provider) {
            const config = getFileConfig();
            const mode = (config.storage || 'local').toLowerCase();
            if (mode === 's3') {
                this._provider = new S3StorageProvider();
            } else if (mode === 'local') {
                this._provider = new LocalStorageProvider();
            } else {
                throw new Error(`Unknown FILE_STORAGE mode: ${mode}`);
            }
            this._mode = mode;
        }
        return this._provider;
    }

    get mode() {
        this.provider; // force init
        return this._mode;
    }

    /**
     * Upload a file buffer under a relative storage key.
     * @returns {Promise<{storageKey: string}>}
     */
    async upload(buffer, { storageKey, contentType }) {
        return this.provider.upload(buffer, { storageKey, contentType });
    }

    /**
     * Read a file. Returns { body, buffer, contentType }.
     */
    async download(storageKey) {
        return this.provider.download(storageKey);
    }

    /**
     * Delete the physical file.
     */
    async delete(storageKey) {
        return this.provider.delete(storageKey);
    }

    /**
     * Check whether a file exists.
     */
    async exists(storageKey) {
        return this.provider.exists(storageKey);
    }

    /**
     * Public URL for a file record. For local this is the API route;
     * for S3 we return a (short-lived) presigned URL when requested.
     */
    async getUrl(file, { expiresIn } = {}) {
        if (this.mode === 's3' && expiresIn) {
            return this.provider.getSignedDownloadUrl(file.storageKey, expiresIn);
        }
        return `/file/${file.id}`;
    }
}

export const storageService = new StorageService();
export { LocalStorageProvider, S3StorageProvider };
export { fileConfig, getFileConfig } from '../config.js';