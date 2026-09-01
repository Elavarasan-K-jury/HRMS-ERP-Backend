import fs from 'node:fs';
import path from 'node:path';
import { fileConfig } from '../config.js';

/**
 * LocalStorageProvider
 * Stores files on the server filesystem under the configured uploads dir.
 * The DB stores a RELATIVE storage key (never the absolute path).
 */
export class LocalStorageProvider {
    constructor() {
        this.baseDir = fileConfig.local.uploadPath;
    }

    _resolve(storageKey) {
        const clean = String(storageKey || '').replace(/^[/\\]+/, '').split('/').filter(Boolean).join('/');
        const fullPath = path.join(this.baseDir, clean);
        const resolvedBase = path.resolve(this.baseDir);
        const resolvedPath = path.resolve(fullPath);
        if (resolvedPath !== resolvedBase && !resolvedPath.startsWith(resolvedBase + path.sep)) {
            throw new Error('Invalid storage key: path traversal detected');
        }
        return resolvedPath;
    }

    async upload(buffer, { storageKey }) {
        const fullPath = this._resolve(storageKey);
        await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.promises.writeFile(fullPath, buffer);
        return { storageKey };
    }

    async download(storageKey) {
        const fullPath = this._resolve(storageKey);
        if (!fs.existsSync(fullPath)) throw new Error('File not found');
        return {
            body: fs.createReadStream(fullPath),
            buffer: await fs.promises.readFile(fullPath),
        };
    }

    async delete(storageKey) {
        const fullPath = this._resolve(storageKey);
        if (fs.existsSync(fullPath)) {
            await fs.promises.unlink(fullPath);
        }
    }

    async exists(storageKey) {
        return fs.existsSync(this._resolve(storageKey));
    }
}