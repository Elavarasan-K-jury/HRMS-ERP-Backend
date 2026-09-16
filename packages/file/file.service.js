import { v4 as uuid } from 'uuid';
import mime from 'mime-types';
import { storageService } from './storage/index.js';

/**
 * Backward-compatible wrapper used by existing services.
 * New code should use the `storageService` from "./storage/index.js".
 */
export class FileService {
    static async upload(fileBuffer, originalName, storePath = '') {
        const lookupMime = mime.lookup(originalName) || 'application/octet-stream';
        const ext = mime.extension(lookupMime) || 'bin';

        const timestamp = Date.now();
        const base = originalName.split('.')[0].replace(/[^a-zA-Z0-9_-]/g, '_') || 'file';
        const storeDir = storePath.replace(/\/+$/, '');
        const storageKey = `${storeDir ? storeDir + '/' : ''}${timestamp}_${uuid()}_${base}.${ext}`;

        await storageService.upload(fileBuffer, { storageKey, contentType: lookupMime });

        return {
            storageKey,
            key: storageKey,
            url: `/uploads/${storageKey}`,
            fileName: `${base}.${ext}`,
            fileType: lookupMime,
            fileSize: fileBuffer.length,
        };
    }

    static async get(fileKey) {
        const { buffer } = await storageService.download(fileKey);
        return buffer;
    }

    static async delete(filePathOrKey) {
        return storageService.delete(filePathOrKey);
    }

    static async exists(fileKey) {
        return storageService.exists(fileKey);
    }
}