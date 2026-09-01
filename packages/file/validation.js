/**
 * Centralized file validation.
 * All uploads (regardless of module) go through these rules.
 */

import mime from 'mime-types';

export class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
    }
}

const ALLOWED_TYPES = {
    image: ['image/jpeg', 'image/png', 'image/webp'],
    document: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
};

const ALLOWED_EXTENSIONS = [
    'jpg', 'jpeg', 'png', 'webp',
    'pdf', 'doc', 'docx', 'xls', 'xlsx',
];

export const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE || 10) * 1024 * 1024; // 10 MB default

export const validateFile = ({ buffer, fileName, mimeType }) => {
    const size = buffer.length || 0;

    if (!fileName) throw new ValidationError('File name is required');

    const ext = (fileName.split('.').pop() || '').toLowerCase();
    // Auto-detect MIME from the extension when the client did not send one.
    const detectedMime = ((mimeType || '') || mime.lookup(fileName) || 'application/octet-stream')
        .toLowerCase();

    if (!ALLOWED_EXTENSIONS.includes(ext)) {
        throw new ValidationError(`File extension ".${ext}" is not allowed`);
    }

    const allowedMimes = Object.values(ALLOWED_TYPES).flat();
    if (!allowedMimes.includes(detectedMime)) {
        throw new ValidationError(`File type "${detectedMime}" is not allowed`);
    }

    if (size > MAX_FILE_SIZE) {
        throw new ValidationError(`File exceeds the maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    return { ext, mime: detectedMime, size };
};

const ALLOWED_STORE_PREFIXES = ['organizations'];

export const validateStorePath = (storePath) => {
    const raw = String(storePath || '').trim().replace(/^[/\\]+/, '').replace(/\/+$/, '');

    if (!raw) throw new ValidationError('storePath is required');

    // Reject traversal / absolute paths
    if (
        raw.includes('..') ||
        raw.includes('\0') ||
        raw.startsWith('/') ||
        raw.startsWith('\\') ||
        /^[a-zA-Z]:[\\/]/.test(raw)
    ) {
        throw new ValidationError('Invalid storePath');
    }

    const segments = raw.split('/').filter(Boolean);
    if (segments.length < 2 || segments[0] !== ALLOWED_STORE_PREFIXES[0]) {
        throw new Error(
            'storePath must start with "organizations/{organizationId}/..."'
        );
    }

    return raw;
};