import { z, ZodError } from 'zod';
import { storageClient } from '../grpc/storage.client.js';

/**
 * NOTE:
 * - This assumes your gateway already supports multipart parsing
 *   (c.req.parseBody() or equivalent).
 * - Swagger WILL work because we explicitly describe multipart schemas.
 */

export default function registerStorageRoutes({ openapi }) {
    /* ----------------------------------------------------
       🧩 Shared Schemas
    ---------------------------------------------------- */

    const folderVisibilityEnum = z.enum(['PRIVATE', 'SHARED', 'PUBLIC']);

    // Proper file schema for OpenAPI/Swagger
    const fileSchema = z.object({
        type: z.string(),
        name: z.string(),
        size: z.number(),
    }).passthrough();

    const folderResponseSchema = z.object({
        id: z.string(),
        name: z.string(),
        color: z.string().optional(),
        folder_image_id: z.string().optional(),
        files_count: z.number(),
        folder_storage_used_in_bytes: z.number(),
        organization_id: z.string(),
        created_by_id: z.string(),
        visibility: folderVisibilityEnum,
        created_at: z.string().optional(),
        updated_at: z.string().optional(),
    });

    const paginationSchema = {
        page: z.coerce.number().default(1),
        limit: z.coerce.number().default(10),
    };

    const fileResponseSchema = z.object({
        id: z.string(),
        folder_id: z.string().optional(),
        file_url: z.string(),
        file_key: z.string(),
        added_by_id: z.string(),
        organization_id: z.string(),
        created_at: z.string().optional(),
        updated_at: z.string().optional(),
    });



    /* ----------------------------------------------------
       🟢 Create Folder (multipart)
    ---------------------------------------------------- */
    openapi(
        {
            method: 'post',
            path: '/folders',
            tags: ['Folders'],
            summary: 'Create a folder (with optional image)',
            request: {
                body: {
                    content: {
                        'multipart/form-data': {
                            schema: z.object({
                                name: z.string().min(1).openapi({ description: 'Folder name' }),
                                organization_id: z.string().openapi({ description: 'Organization ID' }),
                                created_by_id: z.string().openapi({ description: 'Creator user ID' }),
                                color: z.string().optional().openapi({ description: 'Hex color code' }),
                                visibility: folderVisibilityEnum.optional().openapi({ description: 'Folder visibility level' }),
                                folder_image: z.string().optional().openapi({
                                    type: 'string',
                                    format: 'binary',
                                    description: 'Folder image file'
                                }),
                            }),
                        },
                    },
                },
            },
            responses: {
                201: {
                    description: 'Folder created successfully',
                    content: {
                        'application/json': {
                            schema: folderResponseSchema,
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const body = await c.req.parseBody();

                const parsed = z.object({
                    name: z.string(),
                    organization_id: z.string(),
                    created_by_id: z.string(),
                    color: z.string().optional(),
                    visibility: folderVisibilityEnum.optional(),
                }).parse(body);

                const file = body.folder_image;

                const payload = {
                    ...parsed,
                    visibility: parsed.visibility ?? 'PRIVATE',
                };

                if (file?.arrayBuffer) {
                    payload.folder_image_buffer = Buffer.from(await file.arrayBuffer());
                    payload.folder_image_name = file.name;
                }

                const response = await new Promise((resolve, reject) => {
                    storageClient.CreateFolder(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.folder);
                    });
                });

                return c.json(response, 201);
            } catch (e) {
                if (e instanceof ZodError) {
                    return c.json({ error: 'Validation failed', details: e.errors }, 400);
                }
                return c.json({ error: e.message }, 500);
            }
        }
    );

    /* ----------------------------------------------------
       🟣 Get Folder
    ---------------------------------------------------- */
    openapi(
        {
            method: 'get',
            path: '/folders/{id}',
            tags: ['Folders'],
            summary: 'Get folder by ID',
            request: {
                params: z.object({ id: z.string() }),
            },
            responses: {
                200: { description: 'Folder fetched', content: { 'application/json': { schema: folderResponseSchema } } },
                404: { description: 'Folder not found' },
            },
        },
        async (c) => {
            const id = c.req.param('id');

            const folder = await new Promise((resolve, reject) => {
                storageClient.GetFolder({ id }, (err, resp) => {
                    if (err) return reject(err);
                    resolve(resp.folder);
                });
            });

            if (!folder) return c.json({ error: 'Folder not found' }, 404);
            return c.json(folder);
        }
    );

    /* ----------------------------------------------------
       🔵 List Folders
    ---------------------------------------------------- */
    openapi(
        {
            method: 'get',
            path: '/folders',
            tags: ['Folders'],
            summary: 'List folders',
            request: {
                query: z.object({
                    organization_id: z.string(),
                    search: z.string().optional(),
                    visibility: folderVisibilityEnum.optional(),
                    sort_by: z.string().optional(),
                    sort_order: z.enum(['asc', 'desc']).optional(),
                    ...paginationSchema,
                }),
            },
            responses: {
                200: {
                    description: 'Folders list',
                    content: {
                        'application/json': {
                            schema: z.object({
                                folders: z.array(folderResponseSchema),
                                total: z.number(),
                                page: z.number(),
                                limit: z.number(),
                                total_pages: z.number(),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            const q = c.req.valid('query');

            const response = await new Promise((resolve, reject) => {
                storageClient.ListFolders(q, (err, resp) => {
                    if (err) return reject(err);
                    resolve(resp);
                });
            });

            return c.json(response);
        }
    );

    /* ----------------------------------------------------
       🟠 Update Folder (multipart)
    ---------------------------------------------------- */
    openapi(
        {
            method: 'put',
            path: '/folders/{id}',
            tags: ['Folders'],
            summary: 'Update folder',
            request: {
                params: z.object({ id: z.string() }),
                body: {
                    content: {
                        'multipart/form-data': {
                            schema: z.object({
                                name: z.string().optional().openapi({ description: 'New folder name' }),
                                color: z.string().optional().openapi({ description: 'New hex color code' }),
                                visibility: folderVisibilityEnum.optional().openapi({ description: 'New visibility level' }),
                                folder_image: z.string().optional().openapi({
                                    type: 'string',
                                    format: 'binary',
                                    description: 'New folder image file'
                                }),
                            }),
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Folder updated',
                    content: {
                        'application/json': {
                            schema: folderResponseSchema,
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = await c.req.parseBody();

                const payload = { id };

                if (body.name) payload.name = body.name;
                if (body.color) payload.color = body.color;
                if (body.visibility) payload.visibility = body.visibility;

                if (body.folder_image?.arrayBuffer) {
                    payload.folder_image_buffer = Buffer.from(await body.folder_image.arrayBuffer());
                    payload.folder_image_name = body.folder_image.name;
                }

                const response = await new Promise((resolve, reject) => {
                    storageClient.UpdateFolder(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.folder);
                    });
                });

                return c.json(response);
            } catch (e) {
                if (e instanceof ZodError) {
                    return c.json({ error: 'Validation failed', details: e.errors }, 400);
                }
                return c.json({ error: e.message }, 500);
            }
        }
    );

    /* ----------------------------------------------------
       🔴 Delete Folder
    ---------------------------------------------------- */
    openapi(
        {
            method: 'delete',
            path: '/folders/{id}',
            tags: ['Folders'],
            summary: 'Delete folder',
            request: { params: z.object({ id: z.string() }) },
            responses: {
                200: {
                    description: 'Folder deleted successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            const id = c.req.param('id');

            const response = await new Promise((resolve, reject) => {
                storageClient.DeleteFolder({ id }, (err, resp) => {
                    if (err) return reject(err);
                    resolve(resp);
                });
            });

            return c.json(response);
        }
    );

    /* ----------------------------------------------------
       📄 Upload File to Folder
    ---------------------------------------------------- */
    openapi(
        {
            method: 'post',
            path: '/files',
            tags: ['Folder Files'],
            summary: 'Upload file to folder',
            request: {
                body: {
                    content: {
                        'multipart/form-data': {
                            schema: z.object({
                                organization_id: z.string().openapi({
                                    description: 'Organization ID',
                                }),
                                folder_id: z.string().optional().openapi({
                                    description: 'Folder ID',
                                }),
                                added_by_id: z.string().openapi({
                                    description: 'Uploader user ID',
                                }),
                                file: z.any().openapi({
                                    type: 'string',
                                    format: 'binary',
                                    description: 'File to upload',
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
                            schema: fileResponseSchema,
                        },
                    },
                },
                400: { description: 'Bad request' },
            },
        },
        async (c) => {
            try {
                const body = await c.req.parseBody();


                const file = body.file;
                if (!file || !file.arrayBuffer) {
                    return c.json({ error: 'No file provided' }, 400);
                }

                const fileBuffer = Buffer.from(await file.arrayBuffer());
                const fileName = file.name || 'uploaded-file';

                const payload = {
                    folder_id: body.folder_id,
                    organization_id: body.organization_id,
                    added_by_id: body.added_by_id,
                    file_buffer: fileBuffer,
                    file_name: fileName,
                };

                const response = await new Promise((resolve, reject) => {
                    storageClient.UploadFileToFolder(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.file);
                    });
                });

                return c.json(response, 201);
            } catch (err) {
                console.error('❌ File upload error:', err);
                return c.json(
                    { error: 'File upload failed', message: err.message },
                    500
                );
            }
        }
    );


    /* ----------------------------------------------------
       👥 Share Folder
    ---------------------------------------------------- */
    openapi(
        {
            method: 'post',
            path: '/folders/{id}/share',
            tags: ['Folder Sharing'],
            summary: 'Share folder with employees',
            request: {
                params: z.object({ id: z.string() }),
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                employee_ids: z.array(z.string()).min(1).openapi({ description: 'Array of employee IDs to share with' }),
                                added_by_id: z.string().openapi({ description: 'User ID performing the share action' }),
                            }),
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Folder shared successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            const folder_id = c.req.param('id');
            const body = await c.req.json();

            const response = await new Promise((resolve, reject) => {
                storageClient.ShareFolder(
                    { folder_id, ...body },
                    (err, resp) => (err ? reject(err) : resolve(resp))
                );
            });

            return c.json(response);
        }
    );

    /* ----------------------------------------------------
       👥 Get Files In A Folder Or Organization
    ---------------------------------------------------- */

    openapi(
        {
            method: 'get',
            path: '/files',
            tags: ['Files'],
            summary: 'List files (by organization or folder)',
            request: {
                query: z.object({
                    organization_id: z.string(),
                    folder_id: z.string().optional(),
                    page: z.coerce.number().default(1),
                    limit: z.coerce.number().default(20),
                }),
            },
            responses: {
                200: {
                    description: 'Files list',
                    content: {
                        'application/json': {
                            schema: z.object({
                                files: z.array(fileResponseSchema),
                                total: z.number(),
                                page: z.number(),
                                limit: z.number(),
                                total_pages: z.number(),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const query = c.req.valid('query');

                const response = await new Promise((resolve, reject) => {
                    storageClient.ListFiles(
                        {
                            organization_id: query.organization_id,
                            folder_id: query.folder_id,
                            page: query.page,
                            limit: query.limit,
                        },
                        (err, resp) => (err ? reject(err) : resolve(resp))
                    );
                });

                return c.json(response);
            } catch (e) {
                return c.json({ error: e.message }, 500);
            }
        }
    );


    /* ----------------------------------------------------
       🔴 Delete File
    ---------------------------------------------------- */
    openapi(
        {
            method: 'delete',
            path: '/files/{id}',
            tags: ['Files'],
            summary: 'Delete a file (soft delete + remove storage)',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'File ID is required' }),
                }),
            },
            responses: {
                200: {
                    description: 'File deleted successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
                404: { description: 'File not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');

                const response = await new Promise((resolve, reject) => {
                    storageClient.DeleteFile({ id }, (err, resp) =>
                        err ? reject(err) : resolve(resp)
                    );
                });

                return c.json(response);
            } catch (e) {
                return c.json({ error: e.message }, 500);
            }
        }
    );


}