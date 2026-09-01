import { z } from 'zod';
import { storageClient } from '../grpc/storage.client.js';

/**
 * Centralized file API.
 * Frontend only ever talks to these endpoints; it never touches storage keys
 * or S3/local paths. Storage backend is chosen via FILE_STORAGE env.
 */
export default function registerFileRoutes({ openapi }) {
    const callRpc = (client, method, payload) =>
        new Promise((resolve, reject) => {
            client[method](payload, (err, resp) => (err ? reject(err) : resolve(resp)));
        });

    const cleanErrMsg = (err) =>
        String(err?.details || err?.message || '')
            .replace(/^\d+ [A-Z_]+: /, '')
            .trim();

    /* ----------------------------------------------------
       📤 Upload File
       POST /file/upload  (multipart: file, storePath)
    ---------------------------------------------------- */
    openapi(
        {
            method: 'post',
            path: '/file/upload',
            tags: ['File Storage'],
            summary: 'Upload a file to the centralized storage (local or S3)',
            request: {
                body: {
                    content: {
                        'multipart/form-data': {
                            schema: z.object({
                                file: z.any().openapi({ type: 'string', format: 'binary', description: 'File to upload' }),
                                storePath: z.string().openapi({
                                    description: 'Storage path, e.g. organizations/{organizationId}/legal-entities',
                                }),
                            }),
                        },
                    },
                },
            },
            responses: {
                201: {
                    description: 'File uploaded successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                code: z.number(),
                                message: z.string(),
                                data: z.object({
                                    id: z.string(),
                                    file_name: z.string(),
                                    file_type: z.string(),
                                    file_size: z.number(),
                                    storage_key: z.string(),
                                }),
                            }),
                        },
                    },
                },
                400: { description: 'Bad request' },
                401: { description: 'Unauthorized' },
            },
        },
        async (c) => {
            try {
                const adminId = c.get('adminId');
                const body = await c.req.parseBody();

                const file = body.file;
                if (!file || !file.arrayBuffer) {
                    return c.json({ error: 'file is required' }, 400);
                }

                const storePath = String(body.storePath || '').trim();
                if (!storePath) {
                    return c.json({ error: 'storePath is required (e.g. organizations/{organizationId}/legal-entities)' }, 400);
                }

                const fileBuffer = Buffer.from(await file.arrayBuffer());

                const response = await callRpc(storageClient, 'UploadFile', {
                    organization_id: c.req.header('x-org-id') || '',
                    added_by_id: adminId,
                    store_path: storePath,
                    file_buffer: fileBuffer,
                    file_name: file.name || 'uploaded-file',
                    mime_type: file.type || '',
                });

                const f = response.file;
                return c.json(
                    {
                        code: 201,
                        message: 'File uploaded successfully',
                        data: {
                            id: f.id,
                            file_name: f.file_name,
                            file_type: f.file_type,
                            file_size: f.file_size,
                            storage_key: f.storage_key,
                        },
                    },
                    201
                );
            } catch (err) {
                console.error('❌ File upload error:', err);
                const status = err.code === 3 ? 400 : err.code === 7 ? 403 : err.code === 5 ? 404 : 500;
                return c.json({ error: cleanErrMsg(err), message: err.message }, status);
            }
        }
    );

    /* ----------------------------------------------------
       📥 Get File
       GET /file/{id}  → streams the file bytes
    ---------------------------------------------------- */
    openapi(
        {
            method: 'get',
            path: '/file/{id}',
            tags: ['File Storage'],
            summary: 'Fetch a file by its Files.id (local or S3 transparently)',
            request: {
                params: z.object({ id: z.string().openapi({ description: 'Files.id' }) }),
            },
            responses: {
                200: { description: 'File streamed successfully' },
                401: { description: 'Unauthorized' },
                403: { description: 'Forbidden (file belongs to another organization)' },
                404: { description: 'File not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const adminId = c.get('adminId');

                const response = await callRpc(storageClient, 'GetFile', {
                    id,
                    organization_id: c.req.header('x-org-id') || '',
                    admin_id: adminId,
                });

                const f = response.file;
                const contentType = f.file_type || 'application/octet-stream';
                const content = Buffer.from(response.content);

                c.header('Content-Type', contentType);
                c.header('Content-Length', String(content.length));
                c.header('Cache-Control', 'public, max-age=86400');
                c.header('X-Content-Type-Options', 'nosniff');

                return c.body(content, 200);
            } catch (err) {
                console.error('❌ File fetch error:', err);
                const status = err.code === 7 ? 403 : err.code === 5 ? 404 : 500;
                return c.json({ error: cleanErrMsg(err), message: err.message }, status);
            }
        }
    );

    /* ----------------------------------------------------
       🗑️ Delete File
       DELETE /file/{id}  → delete storage object + soft-delete record
    ---------------------------------------------------- */
    openapi(
        {
            method: 'delete',
            path: '/file/{id}',
            tags: ['File Storage'],
            summary: 'Delete a file (removes from storage and soft-deletes the record)',
            request: {
                params: z.object({ id: z.string().openapi({ description: 'Files.id' }) }),
            },
            responses: {
                200: { description: 'File deleted successfully' },
                401: { description: 'Unauthorized' },
                403: { description: 'Forbidden (file belongs to another organization)' },
                404: { description: 'File not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const adminId = c.get('adminId');

                await callRpc(storageClient, 'DeleteFile', {
                    id,
                    organization_id: c.req.header('x-org-id') || '',
                    admin_id: adminId,
                });

                return c.json({ success: true, message: 'File deleted successfully' });
            } catch (err) {
                console.error('❌ File delete error:', err);
                const status = err.code === 7 ? 403 : err.code === 5 ? 404 : 500;
                return c.json({ error: cleanErrMsg(err), message: err.message }, status);
            }
        }
    );
}