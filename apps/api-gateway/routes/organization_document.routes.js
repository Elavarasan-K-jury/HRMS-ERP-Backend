import { z, ZodError } from 'zod';
import { grpc } from '@jury-hrms/proto';
import { organizationDocumentClient } from '../grpc/organization_document.client.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

function grpcToHttpStatus(code) {
    switch (code) {
        case grpc.status.INVALID_ARGUMENT: return 400;
        case grpc.status.NOT_FOUND: return 404;
        case grpc.status.ALREADY_EXISTS: return 409;
        case grpc.status.PERMISSION_DENIED: return 403;
        case grpc.status.FAILED_PRECONDITION: return 412;
        case grpc.status.UNAVAILABLE: return 503;
        default: return 500;
    }
}
function grpcCall(client, method, payload) {
    return new Promise((resolve, reject) => {
        client[method](payload, (err, resp) => {
            if (err) return reject(err);
            resolve(resp);
        });
    });
}

function safeJsonParse(val, fallback) {
    if (!val || val === '') return fallback;
    try { return JSON.parse(val); } catch { return fallback; }
}
function parseFolder(f = {}) {
    if (!f) return f;
    return {
        ...f,
        permissions: safeJsonParse(f.permissions, []),
        legal_entity_ids: safeJsonParse(f.legal_entity_ids, []),
        branch_ids: safeJsonParse(f.branch_ids, []),
        location_ids: safeJsonParse(f.location_ids, []),
        department_ids: safeJsonParse(f.department_ids, []),
        sub_department_ids: safeJsonParse(f.sub_department_ids, []),
        worker_types: safeJsonParse(f.worker_types, []),
    };
}
function parseFolderResp(res) {
    if (!res) return res;
    if (res.folder) res.folder = parseFolder(res.folder);
    if (res.folders) res.folders = res.folders.map(parseFolder);
    return res;
}

// Folder schemas
const permissionRole = z.object({
    role: z.string().min(1),
    canViewDocuments: z.boolean().optional().default(false),
    canAddUpdateDocuments: z.boolean().optional().default(false),
});

const folderCreateSchema = z.object({
    organization_id: objectId,
    name: z.string().min(1, 'Folder name is required').transform(s => s.trim()),
    description: z.string().optional().nullable(),
    is_confidential: z.boolean().optional(),
    is_active: z.boolean().optional(),
    legal_entity_ids: z.array(objectId).optional(),
    branch_ids: z.array(objectId).optional(),
    location_ids: z.array(objectId).optional(),
    department_ids: z.array(objectId).optional(),
    sub_department_ids: z.array(objectId).optional(),
    worker_types: z.array(z.string()).optional(),
    permissions: z.array(permissionRole).optional(),
    admin_id: objectId.optional(),
}).strict();

const folderUpdateSchema = z.object({
    organization_id: objectId.optional(),
    name: z.string().min(1, 'Folder name is required').transform(s => s.trim()).optional(),
    description: z.string().optional().nullable(),
    is_confidential: z.boolean().optional(),
    is_active: z.boolean().optional(),
    legal_entity_ids: z.array(objectId).optional().nullable(),
    branch_ids: z.array(objectId).optional().nullable(),
    location_ids: z.array(objectId).optional().nullable(),
    department_ids: z.array(objectId).optional().nullable(),
    sub_department_ids: z.array(objectId).optional().nullable(),
    worker_types: z.array(z.string()).optional().nullable(),
    permissions: z.array(permissionRole).optional().nullable(),
}).strict();

// Document schemas
const documentCreateSchema = z.object({
    organization_id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
    name: z.string().min(1, 'Document name is required'),
    description: z.string().optional(),
    allow_download: z.string().optional(),
    acknowledgement_required: z.string().optional(),
    block_until_acknowledged: z.string().optional(),
    ask_expiry_date: z.string().optional(),
    expiry_date: z.string().optional(),
    file: z.any().optional(),
});

const documentUpdateSchema = z.object({
    organization_id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
    name: z.string().min(1, 'Document name is required').optional(),
    description: z.string().optional(),
    allow_download: z.string().optional(),
    acknowledgement_required: z.string().optional(),
    block_until_acknowledged: z.string().optional(),
    ask_expiry_date: z.string().optional(),
    expiry_date: z.string().optional(),
    file: z.any().optional(),
});

export default function registerOrganizationDocumentRoutes({ openapi }) {
    /* ============================ FOLDERS ============================ */
    openapi({ method: 'post', path: '/organization-documents/folders', tags: ['Organization-Documents'], summary: 'Create document folder', request: { body: { content: { 'application/json': { schema: folderCreateSchema } } } }, responses: { 201: {}, 400: {}, 409: {} } },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = folderCreateSchema.parse(body);
                const res = await grpcCall(organizationDocumentClient, 'CreateOrgDocFolder', {
                    organization_id: parsed.organization_id,
                    name: parsed.name,
                    description: parsed.description ?? '',
                    is_confidential: parsed.is_confidential ?? false,
                    is_active: parsed.is_active ?? true,
                    legal_entity_ids: parsed.legal_entity_ids || [],
                    branch_ids: parsed.branch_ids || [],
                    location_ids: parsed.location_ids || [],
                    department_ids: parsed.department_ids || [],
                    sub_department_ids: parsed.sub_department_ids || [],
                    worker_types: parsed.worker_types || [],
                    permissions: parsed.permissions ? JSON.stringify(parsed.permissions) : '',
                    admin_id: c.get('adminId') || '',
                });
                return c.json(parseFolderResp(res), 201);
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: e.errors.map(x => ({ field: x.path.join('.'), message: x.message })) }, 400);
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    openapi({ method: 'get', path: '/organization-documents/folders', tags: ['Organization-Documents'], summary: 'List document folders', request: { query: z.object({
        organization_id: objectId.optional(),
        page: z.coerce.number().int().min(1).optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(10),
        search: z.string().optional().default(''),
        sort_by: z.enum(['name', 'created_at', 'updated_at']).optional().default('created_at'),
        sort_order: z.enum(['asc', 'desc']).optional().default('desc'),
    }) }, responses: { 200: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(organizationDocumentClient, 'ListOrgDocFolders', {
                    organization_id: q.organization_id ?? '',
                    page: q.page, limit: q.limit, search: q.search, sort_by: q.sort_by, sort_order: q.sort_order,
                });
                return c.json(parseFolderResp(res));
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    openapi({ method: 'get', path: '/organization-documents/folders/{folderId}', tags: ['Organization-Documents'], summary: 'Get document folder', request: { params: z.object({ folderId: objectId }), query: z.object({ organization_id: objectId.optional() }) }, responses: { 200: {}, 404: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const p = c.req.valid('param');
                const res = await grpcCall(organizationDocumentClient, 'GetOrgDocFolder', { folder_id: p.folderId, organization_id: q.organization_id ?? '' });
                return c.json(parseFolderResp(res));
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    openapi({ method: 'patch', path: '/organization-documents/folders/{folderId}', tags: ['Organization-Documents'], summary: 'Update document folder', request: { params: z.object({ folderId: objectId }), body: { content: { 'application/json': { schema: folderUpdateSchema } } } }, responses: { 200: {}, 400: {}, 404: {}, 409: {} } },
        async (c) => {
            try {
                const body = await c.req.json();
                const p = c.req.valid('param');
                const parsed = folderUpdateSchema.parse(body);
                const payload = { folder_id: p.folderId };
                if (parsed.name !== undefined) payload.name = parsed.name;
                if (parsed.description !== undefined) payload.description = parsed.description ?? '';
                if (parsed.is_confidential !== undefined) payload.is_confidential = parsed.is_confidential;
                if (parsed.is_active !== undefined) payload.is_active = parsed.is_active;
                if (parsed.legal_entity_ids !== undefined) payload.legal_entity_ids = parsed.legal_entity_ids || [];
                if (parsed.branch_ids !== undefined) payload.branch_ids = parsed.branch_ids || [];
                if (parsed.location_ids !== undefined) payload.location_ids = parsed.location_ids || [];
                if (parsed.department_ids !== undefined) payload.department_ids = parsed.department_ids || [];
                if (parsed.sub_department_ids !== undefined) payload.sub_department_ids = parsed.sub_department_ids || [];
                if (parsed.worker_types !== undefined) payload.worker_types = parsed.worker_types || [];
                if (parsed.permissions !== undefined) payload.permissions = parsed.permissions ? JSON.stringify(parsed.permissions) : '';
                if (parsed.organization_id) payload.organization_id = parsed.organization_id;
                payload.admin_id = c.get('adminId') || '';
                const res = await grpcCall(organizationDocumentClient, 'UpdateOrgDocFolder', payload);
                return c.json(parseFolderResp(res));
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: e.errors.map(x => ({ field: x.path.join('.'), message: x.message })) }, 400);
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    openapi({ method: 'delete', path: '/organization-documents/folders/{folderId}', tags: ['Organization-Documents'], summary: 'Delete document folder', request: { params: z.object({ folderId: objectId }), query: z.object({ organization_id: objectId.optional() }) }, responses: { 200: {}, 404: {}, 403: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const p = c.req.valid('param');
                const res = await grpcCall(organizationDocumentClient, 'DeleteOrgDocFolder', { folder_id: p.folderId, organization_id: q.organization_id ?? '', admin_id: c.get('adminId') || '' });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    /* ============================ DOCUMENTS ============================ */
    openapi({ method: 'post', path: '/organization-documents/folders/{folderId}/documents', tags: ['Organization-Documents'], summary: 'Create document (multipart)', request: {
        params: z.object({ folderId: objectId }),
        body: { content: { 'multipart/form-data': { schema: z.object({
            organization_id: objectId,
            name: z.string().min(1, 'Document name is required'),
            description: z.string().optional(),
            allow_download: z.enum(['true', 'false']).optional(),
            acknowledgement_required: z.enum(['true', 'false']).optional(),
            block_until_acknowledged: z.enum(['true', 'false']).optional(),
            ask_expiry_date: z.enum(['true', 'false']).optional(),
            expiry_date: z.string().optional(),
            file: z.any().optional(),
        }) } } },
    }, responses: { 201: {}, 400: {}, 404: {} } },
        async (c) => {
            try {
                const body = await c.req.parseBody();
                const parsed = z.object({
                    organization_id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
                    name: z.string().min(1, 'Document name is required'),
                }).parse(body);
                const p = c.req.valid('param');
                const file = body?.file;
                let fileBuffer = Buffer.alloc(0);
                let fileName = '';
                let fileType = '';
                if (file && file.arrayBuffer) {
                    fileBuffer = Buffer.from(await file.arrayBuffer());
                    fileName = file.name || 'document';
                    fileType = file.type || '';
                }
                const res = await grpcCall(organizationDocumentClient, 'CreateOrgDocument', {
                    organization_id: parsed.organization_id,
                    folder_id: p.folderId,
                    name: parsed.name,
                    description: body.description || '',
                    allow_download: body.allow_download === 'true',
                    acknowledgement_required: body.acknowledgement_required === 'true',
                    block_until_acknowledged: body.block_until_acknowledged === 'true',
                    ask_expiry_date: body.ask_expiry_date === 'true',
                    expiry_date: body.expiry_date || '',
                    file_buffer: fileBuffer,
                    file_name: fileName,
                    file_type: fileType,
                    admin_id: c.get('adminId') || '',
                });
                return c.json(res, 201);
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: e.errors.map(x => ({ field: x.path.join('.'), message: x.message })) }, 400);
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    openapi({ method: 'get', path: '/organization-documents/folders/{folderId}/documents', tags: ['Organization-Documents'], summary: 'List documents', request: { params: z.object({ folderId: objectId }), query: z.object({
        organization_id: objectId.optional(),
        page: z.coerce.number().int().min(1).optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(10),
        search: z.string().optional().default(''),
        sort_by: z.enum(['name', 'created_at', 'updated_at', 'expiry_date']).optional().default('created_at'),
        sort_order: z.enum(['asc', 'desc']).optional().default('desc'),
        expiry_status: z.enum(['NO_EXPIRY', 'ACTIVE', 'EXPIRING_SOON', 'EXPIRED']).optional().default(''),
    }) }, responses: { 200: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const p = c.req.valid('param');
                const res = await grpcCall(organizationDocumentClient, 'ListOrgDocuments', {
                    organization_id: q.organization_id ?? '',
                    folder_id: p.folderId,
                    page: q.page, limit: q.limit, search: q.search, sort_by: q.sort_by, sort_order: q.sort_order,
                    expiry_status: q.expiry_status ?? '',
                });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    openapi({ method: 'get', path: '/organization-documents/documents/{documentId}', tags: ['Organization-Documents'], summary: 'Get document', request: { params: z.object({ documentId: objectId }), query: z.object({ organization_id: objectId.optional() }) }, responses: { 200: {}, 404: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const p = c.req.valid('param');
                const res = await grpcCall(organizationDocumentClient, 'GetOrgDocument', { document_id: p.documentId, organization_id: q.organization_id ?? '' });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    openapi({ method: 'patch', path: '/organization-documents/documents/{documentId}', tags: ['Organization-Documents'], summary: 'Update document (multipart)', request: {
        params: z.object({ documentId: objectId }),
        body: { content: { 'multipart/form-data': { schema: z.object({
            organization_id: objectId,
            name: z.string().min(1, 'Document name is required').optional(),
            description: z.string().optional(),
            allow_download: z.enum(['true', 'false']).optional(),
            acknowledgement_required: z.enum(['true', 'false']).optional(),
            block_until_acknowledged: z.enum(['true', 'false']).optional(),
            ask_expiry_date: z.enum(['true', 'false']).optional(),
            expiry_date: z.string().optional(),
            file: z.any().optional(),
        }) } } },
    }, responses: { 200: {}, 400: {}, 404: {} } },
        async (c) => {
            try {
                const body = await c.req.parseBody();
                const p = c.req.valid('param');
                const payload = { document_id: p.documentId };
                if (body.organization_id) payload.organization_id = body.organization_id;
                if (body.name !== undefined) payload.name = body.name;
                if (body.description !== undefined) payload.description = body.description ?? '';
                if (body.allow_download !== undefined) payload.allow_download = body.allow_download === 'true';
                if (body.acknowledgement_required !== undefined) payload.acknowledgement_required = body.acknowledgement_required === 'true';
                if (body.block_until_acknowledged !== undefined) payload.block_until_acknowledged = body.block_until_acknowledged === 'true';
                if (body.ask_expiry_date !== undefined) payload.ask_expiry_date = body.ask_expiry_date === 'true';
                if (body.expiry_date !== undefined) payload.expiry_date = body.expiry_date ?? '';
                payload.admin_id = c.get('adminId') || '';
                const file = body?.file;
                if (file && file.arrayBuffer) {
                    payload.file_buffer = Buffer.from(await file.arrayBuffer());
                    payload.file_name = file.name || 'document';
                    payload.file_type = file.type || '';
                }
                const res = await grpcCall(organizationDocumentClient, 'UpdateOrgDocument', payload);
                return c.json(res);
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: e.errors.map(x => ({ field: x.path.join('.'), message: x.message })) }, 400);
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    openapi({ method: 'delete', path: '/organization-documents/documents/{documentId}', tags: ['Organization-Documents'], summary: 'Delete document', request: { params: z.object({ documentId: objectId }), query: z.object({ organization_id: objectId.optional() }) }, responses: { 200: {}, 404: {}, 403: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const p = c.req.valid('param');
                const res = await grpcCall(organizationDocumentClient, 'DeleteOrgDocument', { document_id: p.documentId, organization_id: q.organization_id ?? '', admin_id: c.get('adminId') || '' });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    /* ============================ STATS ============================ */
    openapi({ method: 'get', path: '/organization-documents/documents/{documentId}/stats', tags: ['Organization-Documents'], summary: 'Get document stats', request: { params: z.object({ documentId: objectId }), query: z.object({ organization_id: objectId.optional() }) }, responses: { 200: {}, 404: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const p = c.req.valid('param');
                const res = await grpcCall(organizationDocumentClient, 'GetOrgDocumentStats', { document_id: p.documentId, organization_id: q.organization_id ?? '' });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    /* ============================ TARGETING ============================ */
    openapi({ method: 'get', path: '/organization-documents/targeting/options', tags: ['Organization-Documents'], summary: 'Get targeting options', request: { query: z.object({ organization_id: objectId.optional() }) }, responses: { 200: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(organizationDocumentClient, 'GetTargetingOptions', { organization_id: q.organization_id ?? '' });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    /* ============================ APPLICABLE EMPLOYEES ============================ */
    openapi({ method: 'get', path: '/organization-documents/folders/{folderId}/applicable-employees', tags: ['Organization-Documents'], summary: 'List applicable employees', request: { params: z.object({ folderId: objectId }), query: z.object({ organization_id: objectId.optional() }) }, responses: { 200: {}, 404: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const p = c.req.valid('param');
                const res = await grpcCall(organizationDocumentClient, 'ListApplicableEmployees', { folder_id: p.folderId, organization_id: q.organization_id ?? '' });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });
}
