// One-time backfill for pre-centralized Files records.
// Old docs stored fileUrl/fileKey; new schema stores fileType/storageKey/fileName/fileSize.
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mime from 'mime-types';
import { prisma } from '@jury-hrms/db/client.js';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

const extFromUrl = (url) => {
    const seg = String(url || '').split('?')[0].split('/').pop() || '';
    return (seg.split('.').pop() || '').toLowerCase();
};

const main = async () => {
    const cursor = await prisma.$runCommandRaw({
        find: 'Files',
        filter: { fileType: { $exists: false } },
        limit: 500,
    });
    const docs = cursor?.cursor?.firstBatch || [];
    let updated = 0;

    for (const doc of docs) {
        const legacyUrl = doc.fileUrl || '';
        const legacyKey = doc.fileKey || '';

        // old local rows: fileUrl="/uploads/org-.../misc/x.png"; key may be empty
        const storageKey =
            legacyKey && !legacyKey.startsWith('/')
                ? legacyKey
                : String(legacyUrl).replace(/^\/uploads\//, '').replace(/^\//, '');

        const fileName = String(legacyUrl).split('/').pop() || 'legacy-file';
        const ext = extFromUrl(legacyUrl);
        const fileType = mime.lookup(ext) || 'application/octet-stream';
        const fileSize = doc.folderStorageUsedInBytes || 0;

        if (!storageKey) continue;

        await prisma.files.update({
            where: { id: doc._id?.$oid || doc._id?.toString() },
            data: { fileType, storageKey, fileName, fileSize },
        });
        updated += 1;
    }

    console.log(`[migrate-files] backfilled ${updated} legacy file record(s)`);
    await prisma.$disconnect();
};

main().catch((err) => {
    console.error('[migrate-files] error:', err);
    process.exit(1);
});