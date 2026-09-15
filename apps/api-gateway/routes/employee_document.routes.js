import { z, ZodError } from 'zod';
import { grpc } from '@jury-hrms/proto';
import { employeeDocumentClient } from '../grpc/employee_document.client.js';
import { employeeClient } from '../grpc/employee.client.js';
import { PrismaClient } from '@jury-hrms/db';

const prisma = new PrismaClient();

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

// Parse JSON-string proto fields back to objects for the REST response
function parseFolder(f = {}) {
    if (!f) return f;
    return { ...f, permissions: f.permissions ? JSON.parse(f.permissions) : [] };
}
function parseField(fd = {}) {
    if (!fd) return fd;
    return { ...fd, options: fd.options ? JSON.parse(fd.options) : [] };
}
function parseType(t = {}) {
    if (!t) return t;
    if (Array.isArray(t.fields)) t.fields = t.fields.map(parseField);
    return t;
}
function parseFolderResp(res) {
    if (!res) return res;
    if (res.folder) res.folder = parseFolder(res.folder);
    if (res.folders) res.folders = res.folders.map(parseFolder);
    return res;
}
function parseTypeResp(res) {
    if (!res) return res;
    if (res.document_type) res.document_type = parseType(res.document_type);
    if (res.document_types) res.document_types = res.document_types.map(parseType);
    return res;
}
function parseFieldResp(res) {
    if (!res) return res;
    if (res.field) res.field = parseField(res.field);
    if (res.fields) res.fields = res.fields.map(parseField);
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
    permissions: z.array(permissionRole).optional(),
    created_by_id: objectId.optional(),
}).strict();

const folderUpdateSchema = z.object({
    organization_id: objectId.optional(),
    name: z.string().min(1, 'Folder name is required').transform(s => s.trim()).optional(),
    description: z.string().optional().nullable(),
    is_confidential: z.boolean().optional(),
    is_active: z.boolean().optional(),
    permissions: z.array(permissionRole).optional().nullable(),
    updated_by_id: objectId.optional(),
}).strict();

// Document type schemas
const documentTypeFields = {
    name: z.string().min(1, 'Document type name is required').transform(s => s.trim()),
    description: z.string().optional().nullable(),
    is_multiple: z.boolean().optional(),
    is_mandatory: z.boolean().optional(),
    is_appliable_na: z.boolean().optional(),
    is_file_upload_enabled: z.boolean().optional(),
    is_verification_required: z.boolean().optional(),
    ask_expiry_date: z.boolean().optional(),
    expiry_days: z.coerce.number().int().min(0).optional().nullable(),
    expiry_period: z.enum(['DAY', 'WEEK', 'MONTH', 'YEAR']).optional().nullable(),
    all_countries: z.boolean().optional(),
    allowed_countries: z.array(z.string()).optional(),
    display_order: z.coerce.number().int().min(0).optional(),
    is_active: z.boolean().optional(),
};

const documentTypeCreateSchema = z.object({
    organization_id: objectId,
    ...documentTypeFields,
    created_by_id: objectId.optional(),
}).strict();

const documentTypeUpdateSchema = z.object({
    organization_id: objectId.optional(),
    name: z.string().min(1, 'Document type name is required').transform(s => s.trim()).optional(),
    description: z.string().optional().nullable(),
    is_multiple: z.boolean().optional(),
    is_mandatory: z.boolean().optional(),
    is_appliable_na: z.boolean().optional(),
    is_file_upload_enabled: z.boolean().optional(),
    is_verification_required: z.boolean().optional(),
    ask_expiry_date: z.boolean().optional(),
    expiry_days: z.coerce.number().int().min(0).optional().nullable(),
    expiry_period: z.enum(['DAY', 'WEEK', 'MONTH', 'YEAR']).optional().nullable(),
    all_countries: z.boolean().optional(),
    allowed_countries: z.array(z.string()).optional(),
    display_order: z.coerce.number().int().min(0).optional(),
    is_active: z.boolean().optional(),
    updated_by_id: objectId.optional(),
}).strict();

// Document field schemas
const FIELD_TYPES = ['TEXTBOX', 'NUMBER', 'DATE', 'TEXTAREA', 'DROPDOWN', 'MULTI_SELECT', 'FILE'];
const fieldCreateSchema = z.object({
    organization_id: objectId,
    label: z.string().min(1, 'Field label is required').transform(s => s.trim()),
    key: z.string().min(1, 'Field key is required').transform(s => s.trim()),
    field_type: z.enum(FIELD_TYPES),
    options: z.array(z.string()).optional().nullable(),
    is_mandatory: z.boolean().optional(),
    display_order: z.coerce.number().int().min(0).optional(),
}).strict();

const fieldUpdateSchema = z.object({
    organization_id: objectId.optional(),
    label: z.string().min(1, 'Field label is required').transform(s => s.trim()).optional(),
    key: z.string().min(1, 'Field key is required').transform(s => s.trim()).optional(),
    field_type: z.enum(FIELD_TYPES).optional(),
    options: z.array(z.string()).optional().nullable(),
    is_mandatory: z.boolean().optional(),
    display_order: z.coerce.number().int().min(0).optional(),
}).strict();

export default function registerEmployeeDocumentRoutes({ openapi }) {
    /* ============================ FOLDERS ============================ */
    openapi({ method: 'post', path: '/employee-documents/folders', tags: ['Employee-Documents'], summary: 'Create document folder', request: { body: { content: { 'application/json': { schema: folderCreateSchema } } } }, responses: { 201: {}, 400: {}, 409: {} } },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = folderCreateSchema.parse(body);
                const res = await grpcCall(employeeDocumentClient, 'CreateFolder', {
                    organization_id: parsed.organization_id,
                    name: parsed.name,
                    description: parsed.description ?? '',
                    is_confidential: parsed.is_confidential ?? false,
                    is_active: parsed.is_active ?? true,
                    permissions: parsed.permissions ? JSON.stringify(parsed.permissions) : '',
                    created_by_id: parsed.created_by_id ?? '',
                });
                return c.json(parseFolderResp(res), 201);
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: e.errors.map(x => ({ field: x.path.join('.'), message: x.message })) }, 400);
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    openapi({ method: 'get', path: '/employee-documents/folders', tags: ['Employee-Documents'], summary: 'List document folders', request: { query: z.object({
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
                const res = await grpcCall(employeeDocumentClient, 'ListFolders', {
                    organization_id: q.organization_id ?? '',
                    page: q.page, limit: q.limit, search: q.search, sort_by: q.sort_by, sort_order: q.sort_order,
                });
                return c.json(parseFolderResp(res));
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    openapi({ method: 'get', path: '/employee-documents/folders/{folderId}', tags: ['Employee-Documents'], summary: 'Get document folder', request: { params: z.object({ folderId: objectId }), query: z.object({ organization_id: objectId.optional() }) }, responses: { 200: {}, 404: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const p = c.req.valid('param');
                const res = await grpcCall(employeeDocumentClient, 'GetFolder', { folder_id: p.folderId, organization_id: q.organization_id ?? '' });
                return c.json(parseFolderResp(res));
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    openapi({ method: 'patch', path: '/employee-documents/folders/{folderId}', tags: ['Employee-Documents'], summary: 'Update document folder', request: { params: z.object({ folderId: objectId }), body: { content: { 'application/json': { schema: folderUpdateSchema } } } }, responses: { 200: {}, 400: {}, 404: {}, 409: {} } },
        async (c) => {
            try {
                const body = await c.req.json();
                const p = c.req.valid('param');
                const parsed = folderUpdateSchema.parse(body);
                const payload = { id: p.folderId };
                if (parsed.name !== undefined) payload.name = parsed.name;
                if (parsed.description !== undefined) payload.description = parsed.description ?? '';
                if (parsed.is_confidential !== undefined) payload.is_confidential = parsed.is_confidential;
                if (parsed.is_active !== undefined) payload.is_active = parsed.is_active;
                if (parsed.permissions !== undefined) payload.permissions = parsed.permissions ? JSON.stringify(parsed.permissions) : '';
                if (parsed.organization_id) payload.organization_id = parsed.organization_id;
                if (parsed.updated_by_id) payload.updated_by_id = parsed.updated_by_id;
                const res = await grpcCall(employeeDocumentClient, 'UpdateFolder', payload);
                return c.json(parseFolderResp(res));
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: e.errors.map(x => ({ field: x.path.join('.'), message: x.message })) }, 400);
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    openapi({ method: 'delete', path: '/employee-documents/folders/{folderId}', tags: ['Employee-Documents'], summary: 'Delete document folder', request: { params: z.object({ folderId: objectId }), query: z.object({ organization_id: objectId.optional() }) }, responses: { 200: {}, 404: {}, 403: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const p = c.req.valid('param');
                const res = await grpcCall(employeeDocumentClient, 'DeleteFolder', { folder_id: p.folderId, organization_id: q.organization_id ?? '' });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    /* ============================ DOCUMENT TYPES ============================ */
    openapi({ method: 'post', path: '/employee-documents/folders/{folderId}/types', tags: ['Employee-Documents'], summary: 'Create document type', request: { params: z.object({ folderId: objectId }), body: { content: { 'application/json': { schema: documentTypeCreateSchema } } } }, responses: { 201: {}, 400: {}, 404: {}, 409: {}, 403: {} } },
        async (c) => {
            try {
                const body = await c.req.json();
                const p = c.req.valid('param');
                const parsed = documentTypeCreateSchema.parse(body);
                const res = await grpcCall(employeeDocumentClient, 'CreateDocumentType', {
                    organization_id: parsed.organization_id,
                    folder_id: p.folderId,
                    name: parsed.name,
                    description: parsed.description ?? '',
                    is_multiple: parsed.is_multiple ?? false,
                    is_mandatory: parsed.is_mandatory ?? false,
                    is_appliable_na: parsed.is_appliable_na ?? false,
                    is_file_upload_enabled: parsed.is_file_upload_enabled ?? false,
                    is_verification_required: parsed.is_verification_required ?? false,
                    ask_expiry_date: parsed.ask_expiry_date ?? false,
                    expiry_days: parsed.expiry_days ?? 0,
                    expiry_period: parsed.expiry_period ?? '',
                    all_countries: parsed.all_countries ?? true,
                    allowed_countries: parsed.allowed_countries || [],
                    display_order: parsed.display_order ?? 0,
                    is_active: parsed.is_active ?? true,
                    created_by_id: parsed.created_by_id ?? '',
                });
                return c.json(parseTypeResp(res), 201);
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: e.errors.map(x => ({ field: x.path.join('.'), message: x.message })) }, 400);
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    openapi({ method: 'get', path: '/employee-documents/folders/{folderId}/types', tags: ['Employee-Documents'], summary: 'List document types', request: { params: z.object({ folderId: objectId }), query: z.object({
        organization_id: objectId.optional(),
        page: z.coerce.number().int().min(1).optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(10),
        search: z.string().optional().default(''),
        sort_by: z.enum(['name', 'display_order', 'created_at', 'updated_at']).optional().default('created_at'),
        sort_order: z.enum(['asc', 'desc']).optional().default('desc'),
    }) }, responses: { 200: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const p = c.req.valid('param');
                const res = await grpcCall(employeeDocumentClient, 'ListDocumentTypes', {
                    organization_id: q.organization_id ?? '',
                    folder_id: p.folderId,
                    page: q.page, limit: q.limit, search: q.search, sort_by: q.sort_by, sort_order: q.sort_order,
                });
                return c.json(parseTypeResp(res));
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    openapi({ method: 'get', path: '/employee-documents/folders/{folderId}/types/{typeId}', tags: ['Employee-Documents'], summary: 'Get document type', request: { params: z.object({ folderId: objectId, typeId: objectId }), query: z.object({ organization_id: objectId.optional() }) }, responses: { 200: {}, 404: {}, 403: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const p = c.req.valid('param');
                const res = await grpcCall(employeeDocumentClient, 'GetDocumentType', { organization_id: q.organization_id ?? '', folder_id: p.folderId, document_type_id: p.typeId });
                return c.json(parseTypeResp(res));
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    openapi({ method: 'patch', path: '/employee-documents/folders/{folderId}/types/{typeId}', tags: ['Employee-Documents'], summary: 'Update document type', request: { params: z.object({ folderId: objectId, typeId: objectId }), body: { content: { 'application/json': { schema: documentTypeUpdateSchema } } } }, responses: { 200: {}, 400: {}, 404: {}, 409: {}, 403: {} } },
        async (c) => {
            try {
                const body = await c.req.json();
                const p = c.req.valid('param');
                const parsed = documentTypeUpdateSchema.parse(body);
                const payload = { id: p.typeId, folder_id: p.folderId };
                if (parsed.name !== undefined) payload.name = parsed.name;
                if (parsed.description !== undefined) payload.description = parsed.description ?? '';
                if (parsed.is_multiple !== undefined) payload.is_multiple = parsed.is_multiple;
                if (parsed.is_mandatory !== undefined) payload.is_mandatory = parsed.is_mandatory;
                if (parsed.is_appliable_na !== undefined) payload.is_appliable_na = parsed.is_appliable_na;
                if (parsed.is_file_upload_enabled !== undefined) payload.is_file_upload_enabled = parsed.is_file_upload_enabled;
                if (parsed.is_verification_required !== undefined) payload.is_verification_required = parsed.is_verification_required;
                if (parsed.ask_expiry_date !== undefined) payload.ask_expiry_date = parsed.ask_expiry_date;
                if (parsed.expiry_days !== undefined) payload.expiry_days = parsed.expiry_days ?? 0;
                if (parsed.expiry_period !== undefined) payload.expiry_period = parsed.expiry_period ?? '';
                if (parsed.all_countries !== undefined) payload.all_countries = parsed.all_countries;
                if (parsed.allowed_countries !== undefined) payload.allowed_countries = parsed.allowed_countries || [];
                if (parsed.display_order !== undefined) payload.display_order = parsed.display_order;
                if (parsed.is_active !== undefined) payload.is_active = parsed.is_active;
                if (parsed.organization_id) payload.organization_id = parsed.organization_id;
                if (parsed.updated_by_id) payload.updated_by_id = parsed.updated_by_id;
                const res = await grpcCall(employeeDocumentClient, 'UpdateDocumentType', payload);
                return c.json(parseTypeResp(res));
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: e.errors.map(x => ({ field: x.path.join('.'), message: x.message })) }, 400);
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    openapi({ method: 'delete', path: '/employee-documents/folders/{folderId}/types/{typeId}', tags: ['Employee-Documents'], summary: 'Delete document type', request: { params: z.object({ folderId: objectId, typeId: objectId }), query: z.object({ organization_id: objectId.optional() }) }, responses: { 200: {}, 404: {}, 403: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const p = c.req.valid('param');
                const res = await grpcCall(employeeDocumentClient, 'DeleteDocumentType', { organization_id: q.organization_id ?? '', folder_id: p.folderId, document_type_id: p.typeId });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    /* ============================ DOCUMENT FIELDS ============================ */
    openapi({ method: 'post', path: '/employee-documents/types/{typeId}/fields', tags: ['Employee-Documents'], summary: 'Create document field', request: { params: z.object({ typeId: objectId }), body: { content: { 'application/json': { schema: fieldCreateSchema } } } }, responses: { 201: {}, 400: {}, 404: {}, 403: {} } },
        async (c) => {
            try {
                const body = await c.req.json();
                const p = c.req.valid('param');
                const parsed = fieldCreateSchema.parse(body);
                const res = await grpcCall(employeeDocumentClient, 'CreateDocumentField', {
                    organization_id: parsed.organization_id,
                    document_type_id: p.typeId,
                    label: parsed.label,
                    key: parsed.key,
                    field_type: parsed.field_type,
                    options: parsed.options ? JSON.stringify(parsed.options) : '',
                    is_mandatory: parsed.is_mandatory ?? false,
                    display_order: parsed.display_order ?? 0,
                });
                return c.json(parseFieldResp(res), 201);
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: e.errors.map(x => ({ field: x.path.join('.'), message: x.message })) }, 400);
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    openapi({ method: 'get', path: '/employee-documents/types/{typeId}/fields', tags: ['Employee-Documents'], summary: 'List document fields', request: { params: z.object({ typeId: objectId }), query: z.object({ organization_id: objectId.optional() }) }, responses: { 200: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const p = c.req.valid('param');
                const res = await grpcCall(employeeDocumentClient, 'ListDocumentFields', { organization_id: q.organization_id ?? '', document_type_id: p.typeId });
                return c.json(parseFieldResp(res));
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    openapi({ method: 'get', path: '/employee-documents/types/{typeId}/fields/{fieldId}', tags: ['Employee-Documents'], summary: 'Get document field', request: { params: z.object({ typeId: objectId, fieldId: objectId }), query: z.object({ organization_id: objectId.optional() }) }, responses: { 200: {}, 404: {}, 403: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const p = c.req.valid('param');
                const res = await grpcCall(employeeDocumentClient, 'GetDocumentField', { organization_id: q.organization_id ?? '', document_type_id: p.typeId, field_id: p.fieldId });
                return c.json(parseFieldResp(res));
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    openapi({ method: 'patch', path: '/employee-documents/types/{typeId}/fields/{fieldId}', tags: ['Employee-Documents'], summary: 'Update document field', request: { params: z.object({ typeId: objectId, fieldId: objectId }), body: { content: { 'application/json': { schema: fieldUpdateSchema } } } }, responses: { 200: {}, 400: {}, 404: {}, 403: {} } },
        async (c) => {
            try {
                const body = await c.req.json();
                const p = c.req.valid('param');
                const parsed = fieldUpdateSchema.parse(body);
                const payload = { id: p.fieldId, document_type_id: p.typeId };
                if (parsed.label !== undefined) payload.label = parsed.label;
                if (parsed.key !== undefined) payload.key = parsed.key;
                if (parsed.field_type !== undefined) payload.field_type = parsed.field_type;
                if (parsed.options !== undefined) payload.options = parsed.options ? JSON.stringify(parsed.options) : '';
                if (parsed.is_mandatory !== undefined) payload.is_mandatory = parsed.is_mandatory;
                if (parsed.display_order !== undefined) payload.display_order = parsed.display_order;
                if (parsed.organization_id) payload.organization_id = parsed.organization_id;
                const res = await grpcCall(employeeDocumentClient, 'UpdateDocumentField', payload);
                return c.json(parseFieldResp(res));
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: e.errors.map(x => ({ field: x.path.join('.'), message: x.message })) }, 400);
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    openapi({ method: 'delete', path: '/employee-documents/types/{typeId}/fields/{fieldId}', tags: ['Employee-Documents'], summary: 'Delete document field', request: { params: z.object({ typeId: objectId, fieldId: objectId }), query: z.object({ organization_id: objectId.optional() }) }, responses: { 200: {}, 404: {}, 403: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const p = c.req.valid('param');
                const res = await grpcCall(employeeDocumentClient, 'DeleteDocumentField', { organization_id: q.organization_id ?? '', document_type_id: p.typeId, field_id: p.fieldId });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    /* ============================ ASSIGNMENTS ============================ */
    // POST /employee-documents/assignments - assign one document type to one employee
    openapi({ method: 'post', path: '/employee-documents/assignments', tags: ['Employee-Documents'], summary: 'Assign a document type to an employee', request: { body: { content: { 'application/json': { schema: z.object({ organization_id: objectId, employee_id: objectId, document_type_id: objectId, assigned_by_id: objectId.optional() }) } } } }, responses: { 201: {}, 400: {}, 404: {}, 403: {}, 409: {} } },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = z.object({ organization_id: objectId, employee_id: objectId, document_type_id: objectId, assigned_by_id: objectId.optional() }).parse(body);
                const res = await grpcCall(employeeDocumentClient, 'AssignDocument', {
                    organization_id: parsed.organization_id,
                    employee_id: parsed.employee_id,
                    document_type_id: parsed.document_type_id,
                    assigned_by_id: parsed.assigned_by_id ?? '',
                });
                return c.json(res, 201);
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: e.errors.map(x => ({ field: x.path.join('.'), message: x.message })) }, 400);
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    // POST /employee-documents/assignments/bulk - assign many document types to one employee
    openapi({ method: 'post', path: '/employee-documents/assignments/bulk', tags: ['Employee-Documents'], summary: 'Bulk assign document types to an employee', request: { body: { content: { 'application/json': { schema: z.object({ organization_id: objectId, employee_id: objectId, document_type_ids: z.array(objectId).min(1, 'Select at least one document type'), assigned_by_id: objectId.optional() }).strict() } } } }, responses: { 200: {}, 400: {}, 404: {}, 403: {} } },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = z.object({ organization_id: objectId, employee_id: objectId, document_type_ids: z.array(objectId).min(1), assigned_by_id: objectId.optional() }).parse(body);
                const res = await grpcCall(employeeDocumentClient, 'AssignDocuments', {
                    organization_id: parsed.organization_id,
                    employee_id: parsed.employee_id,
                    document_type_ids: parsed.document_type_ids,
                    assigned_by_id: parsed.assigned_by_id ?? '',
                });
                return c.json(res);
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: e.errors.map(x => ({ field: x.path.join('.'), message: x.message })) }, 400);
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    // POST /employee-documents/assignments/bulk-multi - assign many document types to many employees
    openapi({ method: 'post', path: '/employee-documents/assignments/bulk-multi', tags: ['Employee-Documents'], summary: 'Bulk assign document types to multiple employees', request: { body: { content: { 'application/json': { schema: z.object({ organization_id: objectId, employee_ids: z.array(objectId).min(1, 'Select at least one employee'), document_type_ids: z.array(objectId).min(1, 'Select at least one document type'), assigned_by_id: objectId.optional() }).strict() } } } }, responses: { 200: {}, 400: {}, 404: {}, 403: {} } },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = z.object({ organization_id: objectId, employee_ids: z.array(objectId).min(1), document_type_ids: z.array(objectId).min(1), assigned_by_id: objectId.optional() }).parse(body);
                const res = await grpcCall(employeeDocumentClient, 'BulkAssignDocuments', {
                    organization_id: parsed.organization_id,
                    employee_ids: parsed.employee_ids,
                    document_type_ids: parsed.document_type_ids,
                    assigned_by_id: parsed.assigned_by_id ?? '',
                });
                return c.json(res);
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: e.errors.map(x => ({ field: x.path.join('.'), message: x.message })) }, 400);
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    // GET /employee-documents/employees/{employeeId}/assignments
    openapi({ method: 'get', path: '/employee-documents/employees/{employeeId}/assignments', tags: ['Employee-Documents'], summary: 'List assignments by employee', request: { params: z.object({ employeeId: objectId }), query: z.object({ organization_id: objectId.optional() }) }, responses: { 200: {}, 404: {}, 403: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const p = c.req.valid('param');
                const res = await grpcCall(employeeDocumentClient, 'ListEmployeeAssignments', { organization_id: q.organization_id ?? '', employee_id: p.employeeId });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    // GET /employee-documents/types/{typeId}/assignments
    openapi({ method: 'get', path: '/employee-documents/types/{typeId}/assignments', tags: ['Employee-Documents'], summary: 'List assignments by document type', request: { params: z.object({ typeId: objectId }), query: z.object({
        organization_id: objectId.optional(),
        page: z.coerce.number().int().min(1).optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(10),
        search: z.string().optional().default(''),
        sort_by: z.string().optional().default('created_at'),
        sort_order: z.enum(['asc', 'desc']).optional().default('desc'),
    }) }, responses: { 200: {}, 404: {}, 403: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const p = c.req.valid('param');
                const res = await grpcCall(employeeDocumentClient, 'ListDocumentAssignments', {
                    organization_id: q.organization_id ?? '',
                    document_type_id: p.typeId,
                    page: q.page, limit: q.limit, search: q.search, sort_by: q.sort_by, sort_order: q.sort_order,
                });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    // GET /employee-documents/assignments/grouped
    openapi({ method: 'get', path: '/employee-documents/assignments/grouped', tags: ['Employee-Documents'], summary: 'List assignments grouped by employee', request: { query: z.object({
        organization_id: objectId.optional(),
        page: z.coerce.number().int().min(1).optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(10),
        search: z.string().optional().default(''),
        sort_by: z.string().optional().default('name'),
        sort_order: z.enum(['asc', 'desc']).optional().default('asc'),
    }) }, responses: { 200: {}, 403: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(employeeDocumentClient, 'ListGroupedAssignments', {
                    organization_id: q.organization_id ?? '',
                    page: q.page, limit: q.limit, search: q.search, sort_by: q.sort_by, sort_order: q.sort_order,
                });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    // GET /employee-documents/assignments/{assignmentId}
    openapi({ method: 'get', path: '/employee-documents/assignments/{assignmentId}', tags: ['Employee-Documents'], summary: 'Get assignment', request: { params: z.object({ assignmentId: objectId }), query: z.object({ organization_id: objectId.optional() }) }, responses: { 200: {}, 404: {}, 403: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const p = c.req.valid('param');
                const res = await grpcCall(employeeDocumentClient, 'GetAssignment', { organization_id: q.organization_id ?? '', assignment_id: p.assignmentId });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    // DELETE /employee-documents/assignments/{assignmentId}
    openapi({ method: 'delete', path: '/employee-documents/assignments/{assignmentId}', tags: ['Employee-Documents'], summary: 'Unassign a document type from an employee', request: { params: z.object({ assignmentId: objectId }), query: z.object({ organization_id: objectId.optional() }) }, responses: { 200: {}, 404: {}, 403: {}, 412: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const p = c.req.valid('param');
                const res = await grpcCall(employeeDocumentClient, 'UnassignDocument', { organization_id: q.organization_id ?? '', assignment_id: p.assignmentId });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    // GET /employee-documents/pending - list pending-on-employee documents
    openapi({ method: 'get', path: '/employee-documents/pending', tags: ['Employee-Documents'], summary: 'List pending-on-employee documents', request: { query: z.object({
        organization_id: objectId.optional(),
        page: z.coerce.number().int().min(1).optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(10),
        search: z.string().optional().default(''),
        sort_by: z.enum(['created_at', 'assigned_at', 'employee_name']).optional().default('created_at'),
        sort_order: z.enum(['asc', 'desc']).optional().default('desc'),
        employee_id: objectId.optional(),
        folder_id: objectId.optional(),
        document_type_id: objectId.optional(),
    }) }, responses: { 200: {}, 400: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(employeeDocumentClient, 'ListPendingEmployeeDocuments', {
                    organization_id: q.organization_id ?? '',
                    page: q.page,
                    limit: q.limit,
                    search: q.search,
                    sort_by: q.sort_by,
                    sort_order: q.sort_order,
                    employee_id: q.employee_id ?? '',
                    folder_id: q.folder_id ?? '',
                    document_type_id: q.document_type_id ?? '',
                });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    /* ============================ SUBMISSIONS ============================ */
    // POST /employee-documents/submissions - submit a document (multipart: file + fieldValues JSON)
    openapi({ method: 'post', path: '/employee-documents/submissions', tags: ['Employee-Documents'], summary: 'Submit a document (multipart)', request: {
        body: { content: { 'multipart/form-data': { schema: z.object({
            organization_id: objectId,
            assignment_id: objectId,
            employee_id: objectId,
            document_type_id: objectId,
            submitted_by_id: objectId.optional(),
            field_values: z.string().optional(),
            is_na: z.enum(['true', 'false']).optional(),
            expiry_date: z.string().optional(),
            file: z.any().optional(),
        }) } } },
    }, responses: { 201: {}, 400: {}, 404: {}, 403: {}, 409: {} } },
        async (c) => {
            try {
                const body = await c.req.parseBody();
                const parsed = z.object({
                    organization_id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
                    assignment_id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
                    employee_id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
                    document_type_id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
                }).parse(body);
                const file = body?.file;
                let fileBuffer = Buffer.alloc(0);
                let fileName = '';
                let fileType = '';
                if (file && file.arrayBuffer) {
                    fileBuffer = Buffer.from(await file.arrayBuffer());
                    fileName = file.name || 'document';
                    fileType = file.type || '';
                }
                const res = await grpcCall(employeeDocumentClient, 'SubmitDocument', {
                    organization_id: parsed.organization_id,
                    assignment_id: parsed.assignment_id,
                    employee_id: parsed.employee_id,
                    document_type_id: parsed.document_type_id,
                    submitted_by_id: '',
                    field_values: body.field_values || '',
                    is_na: body.is_na === 'true',
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

    // POST /employee-documents/submissions/json - submit without a file (JSON body)
    openapi({ method: 'post', path: '/employee-documents/submissions/json', tags: ['Employee-Documents'], summary: 'Submit a document (JSON)', request: { body: { content: { 'application/json': { schema: z.object({
        organization_id: objectId, assignment_id: objectId, employee_id: objectId, document_type_id: objectId,
        submitted_by_id: objectId.optional(), field_values: z.string().optional(), is_na: z.boolean().optional(), expiry_date: z.string().optional(),
    }).strict() } } } }, responses: { 201: {}, 400: {}, 404: {}, 403: {}, 409: {} } },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = z.object({
                    organization_id: objectId, assignment_id: objectId, employee_id: objectId, document_type_id: objectId,
                    submitted_by_id: objectId.optional(), field_values: z.string().optional(), is_na: z.boolean().optional(), expiry_date: z.string().optional(),
                }).parse(body);
                const res = await grpcCall(employeeDocumentClient, 'SubmitDocument', {
                    organization_id: parsed.organization_id, assignment_id: parsed.assignment_id, employee_id: parsed.employee_id,
                    document_type_id: parsed.document_type_id, submitted_by_id: '',
                    field_values: parsed.field_values ?? '', is_na: !!parsed.is_na, expiry_date: parsed.expiry_date ?? '',
                    file_buffer: Buffer.alloc(0), file_name: '', file_type: '',
                    admin_id: c.get('adminId') || '',
                });
                return c.json(res, 201);
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: e.errors.map(x => ({ field: x.path.join('.'), message: x.message })) }, 400);
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    // GET /employee-documents/submissions/{submissionId}
    openapi({ method: 'get', path: '/employee-documents/submissions/{submissionId}', tags: ['Employee-Documents'], summary: 'Get submission', request: { params: z.object({ submissionId: objectId }), query: z.object({ organization_id: objectId.optional() }) }, responses: { 200: {}, 404: {}, 403: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const p = c.req.valid('param');
                const res = await grpcCall(employeeDocumentClient, 'GetSubmission', { organization_id: q.organization_id ?? '', submission_id: p.submissionId });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    // GET /employee-documents/employees/{employeeId}/submissions
    openapi({ method: 'get', path: '/employee-documents/employees/{employeeId}/submissions', tags: ['Employee-Documents'], summary: 'List submissions by employee', request: { params: z.object({ employeeId: objectId }), query: z.object({ organization_id: objectId.optional(), page: z.coerce.number().int().min(1).optional().default(1), limit: z.coerce.number().int().min(1).max(100).optional().default(10) }) }, responses: { 200: {}, 404: {}, 403: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const p = c.req.valid('param');
                const res = await grpcCall(employeeDocumentClient, 'ListEmployeeSubmissions', { organization_id: q.organization_id ?? '', employee_id: p.employeeId, page: q.page, limit: q.limit });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    // GET /employee-documents/assignments/{assignmentId}/submissions
    openapi({ method: 'get', path: '/employee-documents/assignments/{assignmentId}/submissions', tags: ['Employee-Documents'], summary: 'List submissions by assignment', request: { params: z.object({ assignmentId: objectId }), query: z.object({ organization_id: objectId.optional() }) }, responses: { 200: {}, 404: {}, 403: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const p = c.req.valid('param');
                const res = await grpcCall(employeeDocumentClient, 'ListAssignmentSubmissions', { organization_id: q.organization_id ?? '', assignment_id: p.assignmentId });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    // DELETE /employee-documents/submissions/{submissionId}
    openapi({ method: 'delete', path: '/employee-documents/submissions/{submissionId}', tags: ['Employee-Documents'], summary: 'Soft-delete submission', request: { params: z.object({ submissionId: objectId }), query: z.object({ organization_id: objectId.optional() }) }, responses: { 200: {}, 404: {}, 403: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const p = c.req.valid('param');
                const res = await grpcCall(employeeDocumentClient, 'DeleteSubmission', { organization_id: q.organization_id ?? '', submission_id: p.submissionId });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    /* ============================ PENDING VERIFICATION / REVIEW ============================ */
    // GET /employee-documents/pending-verification
    openapi({ method: 'get', path: '/employee-documents/pending-verification', tags: ['Employee-Documents'], summary: 'List pending verification documents', request: { query: z.object({
        organization_id: objectId.optional(),
        page: z.coerce.number().int().min(1).optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(10),
        search: z.string().optional().default(''),
        sort_by: z.enum(['submitted_at', 'employee_name', 'document_type_name', 'created_at']).optional().default('submitted_at'),
        sort_order: z.enum(['asc', 'desc']).optional().default('desc'),
        employee_id: objectId.optional(),
        folder_id: objectId.optional(),
        document_type_id: objectId.optional(),
    }) }, responses: { 200: {}, 400: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(employeeDocumentClient, 'ListPendingVerificationDocuments', {
                    organization_id: q.organization_id ?? '',
                    page: q.page, limit: q.limit, search: q.search, sort_by: q.sort_by, sort_order: q.sort_order,
                    employee_id: q.employee_id ?? '', folder_id: q.folder_id ?? '', document_type_id: q.document_type_id ?? '',
                });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    // POST /employee-documents/submissions/{submissionId}/verify
    openapi({ method: 'post', path: '/employee-documents/submissions/{submissionId}/verify', tags: ['Employee-Documents'], summary: 'Verify a submission', request: { params: z.object({ submissionId: objectId }), body: { content: { 'application/json': { schema: z.object({ organization_id: objectId, verified_by_id: objectId.optional() }).strict() } } } }, responses: { 200: {}, 400: {}, 404: {}, 403: {}, 409: {}, 412: {} } },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = z.object({ organization_id: objectId, verified_by_id: objectId.optional() }).parse(body);
                const p = c.req.valid('param');
                const res = await grpcCall(employeeDocumentClient, 'VerifySubmission', { organization_id: parsed.organization_id, submission_id: p.submissionId, verified_by_id: '', admin_id: c.get('adminId') || '' });
                return c.json(res);
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: e.errors.map(x => ({ field: x.path.join('.'), message: x.message })) }, 400);
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    // POST /employee-documents/submissions/{submissionId}/reject
    openapi({ method: 'post', path: '/employee-documents/submissions/{submissionId}/reject', tags: ['Employee-Documents'], summary: 'Reject a submission', request: { params: z.object({ submissionId: objectId }), body: { content: { 'application/json': { schema: z.object({ organization_id: objectId, rejection_reason: z.string().min(1, 'Rejection reason is required').transform(s => s.trim()), rejected_by_id: objectId.optional() }).strict() } } } }, responses: { 200: {}, 400: {}, 404: {}, 403: {}, 409: {}, 412: {} } },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = z.object({ organization_id: objectId, rejection_reason: z.string().min(1, 'Rejection reason is required').transform(s => s.trim()), rejected_by_id: objectId.optional() }).parse(body);
                const p = c.req.valid('param');
                const res = await grpcCall(employeeDocumentClient, 'RejectSubmission', { organization_id: parsed.organization_id, submission_id: p.submissionId, rejection_reason: parsed.rejection_reason, rejected_by_id: '', admin_id: c.get('adminId') || '' });
                return c.json(res);
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: e.errors.map(x => ({ field: x.path.join('.'), message: x.message })) }, 400);
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    /* ============================ VERIFIED DOCUMENTS ============================ */
    // GET /employee-documents/verified
    openapi({ method: 'get', path: '/employee-documents/verified', tags: ['Employee-Documents'], summary: 'List verified documents', request: { query: z.object({
        organization_id: objectId.optional(),
        page: z.coerce.number().int().min(1).optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(10),
        search: z.string().optional().default(''),
        sort_by: z.enum(['created_at', 'submitted_at', 'verified_at', 'employee_name', 'document_type_name']).optional().default('verified_at'),
        sort_order: z.enum(['asc', 'desc']).optional().default('desc'),
        employee_id: objectId.optional(),
        folder_id: objectId.optional(),
        document_type_id: objectId.optional(),
    }) }, responses: { 200: {}, 400: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(employeeDocumentClient, 'ListVerifiedDocuments', {
                    organization_id: q.organization_id ?? '',
                    page: q.page, limit: q.limit, search: q.search, sort_by: q.sort_by, sort_order: q.sort_order,
                    employee_id: q.employee_id ?? '', folder_id: q.folder_id ?? '', document_type_id: q.document_type_id ?? '',
                });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    /* ============================ EXPIRING DOCUMENTS ============================ */
    // GET /employee-documents/expiring
    openapi({ method: 'get', path: '/employee-documents/expiring', tags: ['Employee-Documents'], summary: 'List expiring documents', request: { query: z.object({
        organization_id: objectId.optional(),
        page: z.coerce.number().int().min(1).optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(10),
        search: z.string().optional().default(''),
        sort_by: z.enum(['expiry_date', 'employee_name', 'document_type_name', 'submitted_at', 'verified_at']).optional().default('expiry_date'),
        sort_order: z.enum(['asc', 'desc']).optional().default('asc'),
        employee_id: objectId.optional(),
        folder_id: objectId.optional(),
        document_type_id: objectId.optional(),
        days: z.coerce.number().int().min(1).max(365).optional().default(30),
    }) }, responses: { 200: {}, 400: {} } },
        async (c) => {
            try {
                const q = c.req.valid('query');
                const res = await grpcCall(employeeDocumentClient, 'ListExpiringDocuments', {
                    organization_id: q.organization_id ?? '',
                    page: q.page, limit: q.limit, search: q.search, sort_by: q.sort_by, sort_order: q.sort_order,
                    employee_id: q.employee_id ?? '', folder_id: q.folder_id ?? '', document_type_id: q.document_type_id ?? '',
                    days: q.days,
                });
                return c.json(res);
            } catch (e) { return c.json({ error: e.message }, grpcToHttpStatus(e.code)); }
        });

    /* ============================ RENEWAL / REPLACEMENT ============================ */
    // POST /employee-documents/submissions/{submissionId}/renew (multipart: file + fieldValues + expiry)
    openapi({ method: 'post', path: '/employee-documents/submissions/{submissionId}/renew', tags: ['Employee-Documents'], summary: 'Renew a verified document (multipart)', request: {
        params: z.object({ submissionId: objectId }),
        body: { content: { 'multipart/form-data': { schema: z.object({
            organization_id: objectId,
            submitted_by_id: objectId.optional(),
            field_values: z.string().optional(),
            is_na: z.enum(['true', 'false']).optional(),
            expiry_date: z.string().optional(),
            file: z.any().optional(),
        }) } } },
    }, responses: { 201: {}, 400: {}, 404: {}, 403: {}, 409: {}, 412: {} } },
        async (c) => {
            try {
                const body = await c.req.parseBody();
                const parsed = z.object({
                    organization_id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id'),
                }).parse(body);
                const file = body?.file;
                let fileBuffer = Buffer.alloc(0);
                let fileName = '';
                let fileType = '';
                if (file && file.arrayBuffer) {
                    fileBuffer = Buffer.from(await file.arrayBuffer());
                    fileName = file.name || 'document';
                    fileType = file.type || '';
                }
                const res = await grpcCall(employeeDocumentClient, 'RenewDocument', {
                    organization_id: parsed.organization_id,
                    submission_id: c.req.param('submissionId'),
                    submitted_by_id: '',
                    field_values: body.field_values || '',
                    is_na: body.is_na === 'true',
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

    // POST /employee-documents/submissions/{submissionId}/renew/json (JSON, no file)
    openapi({ method: 'post', path: '/employee-documents/submissions/{submissionId}/renew/json', tags: ['Employee-Documents'], summary: 'Renew a verified document (JSON)', request: { params: z.object({ submissionId: objectId }), body: { content: { 'application/json': { schema: z.object({
        organization_id: objectId, submitted_by_id: objectId.optional(), field_values: z.string().optional(), is_na: z.boolean().optional(), expiry_date: z.string().optional(),
    }).strict() } } } }, responses: { 201: {}, 400: {}, 404: {}, 403: {}, 409: {}, 412: {} } },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = z.object({ organization_id: objectId, submitted_by_id: objectId.optional(), field_values: z.string().optional(), is_na: z.boolean().optional(), expiry_date: z.string().optional() }).parse(body);
                const res = await grpcCall(employeeDocumentClient, 'RenewDocument', {
                    organization_id: parsed.organization_id,
                    submission_id: c.req.param('submissionId'),
                    submitted_by_id: '',
                    field_values: parsed.field_values ?? '',
                    is_na: !!parsed.is_na,
                    expiry_date: parsed.expiry_date ?? '',
                    file_buffer: Buffer.alloc(0), file_name: '', file_type: '',
                    admin_id: c.get('adminId') || '',
                });
                return c.json(res, 201);
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: e.errors.map(x => ({ field: x.path.join('.'), message: x.message })) }, 400);
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    /* ============================ EMPLOYEE SELF-SERVICE (authEmployee) ============================ */
    // GET /employee-documents/my/verified
    // Returns VERIFIED, current documents for the authenticated employee only.
    // Uses authEmployee middleware (applied at gateway level for /employee-documents/my/*).
    openapi({ method: 'get', path: '/employee-documents/my/verified', tags: ['Employee-Documents'], summary: 'Employee self-service: list my verified documents', request: { query: z.object({
        page: z.coerce.number().int().min(1).optional().default(1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    }) }, responses: { 200: {}, 401: {}, 403: {} } },
        async (c) => {
            try {
                const employeeId = c.get('employeeId');
                if (!employeeId) return c.json({ error: 'Unauthorized' }, 401);

                const empRes = await grpcCall(employeeClient, 'GetEmployee', { id: employeeId });
                const employee = empRes?.employee;
                if (!employee || !employee.organization_id) {
                    return c.json({ error: 'Employee organization not found' }, 404);
                }

                const q = c.req.valid('query');
                const res = await grpcCall(employeeDocumentClient, 'ListVerifiedDocuments', {
                    organization_id: employee.organization_id,
                    employee_id: employeeId,
                    page: q.page, limit: q.limit,
                    search: '', sort_by: 'verified_at', sort_order: 'desc',
                    folder_id: '', document_type_id: '',
                });
                return c.json(res);
            } catch (e) {
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    // GET /employee-documents/my/assignments
    // Returns all assigned document types (folders + types) for the authenticated employee only.
    openapi({ method: 'get', path: '/employee-documents/my/assignments', tags: ['Employee-Documents'], summary: 'Employee self-service: list my assigned document types', responses: { 200: {}, 401: {}, 403: {} } },
        async (c) => {
            try {
                const employeeId = c.get('employeeId');
                if (!employeeId) return c.json({ error: 'Unauthorized' }, 401);

                const empRes = await grpcCall(employeeClient, 'GetEmployee', { id: employeeId });
                const employee = empRes?.employee;
                if (!employee || !employee.organization_id) {
                    return c.json({ error: 'Employee organization not found' }, 404);
                }

                const res = await grpcCall(employeeDocumentClient, 'ListEmployeeAssignments', {
                    organization_id: employee.organization_id,
                    employee_id: employeeId,
                });
                return c.json(res);
            } catch (e) {
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    // GET /employee-documents/my/submissions
    // Returns all submissions for the authenticated employee (any status) for state determination.
    openapi({ method: 'get', path: '/employee-documents/my/submissions', tags: ['Employee-Documents'], summary: 'Employee self-service: list my submissions', responses: { 200: {}, 401: {}, 403: {} } },
        async (c) => {
            try {
                const employeeId = c.get('employeeId');
                if (!employeeId) return c.json({ error: 'Unauthorized' }, 401);

                const empRes = await grpcCall(employeeClient, 'GetEmployee', { id: employeeId });
                const employee = empRes?.employee;
                if (!employee || !employee.organization_id) {
                    return c.json({ error: 'Employee organization not found' }, 404);
                }

                const submissions = await prisma.employeeDocumentSubmission.findMany({
                    where: { employeeId: employeeId, organizationId: employee.organization_id, deletedAt: null },
                    include: { documentType: { select: { id: true, name: true } } },
                    orderBy: { createdAt: 'desc' },
                });

                const result = submissions.map(s => ({
                    id: s.id,
                    assignment_id: s.assignmentId || '',
                    document_type_id: s.documentTypeId || '',
                    document_type_name: s.documentType?.name || '',
                    status: s.status || '',
                    submitted_at: s.submittedAt ? s.submittedAt.toISOString() : '',
                    file_name: s.fileName || '',
                    replaced_by_submission_id: s.replacedBySubmissionId || '',
                    is_current: s.status === 'VERIFIED' && !s.replacedBySubmissionId,
                }));

                return c.json({ submissions: result, total: result.length, success: true });
            } catch (e) {
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    // GET /employee-documents/my/document-type/{documentTypeId}/fields
    // Returns document type configuration including fields[] for the employee dynamic form.
    openapi({ method: 'get', path: '/employee-documents/my/document-type/{documentTypeId}/fields', tags: ['Employee-Documents'], summary: 'Employee self-service: get document type fields', request: { params: z.object({ documentTypeId: objectId }) }, responses: { 200: {}, 401: {}, 403: {}, 404: {} } },
        async (c) => {
            try {
                const employeeId = c.get('employeeId');
                if (!employeeId) return c.json({ error: 'Unauthorized' }, 401);

                const empRes = await grpcCall(employeeClient, 'GetEmployee', { id: employeeId });
                const employee = empRes?.employee;
                if (!employee || !employee.organization_id) {
                    return c.json({ error: 'Employee organization not found' }, 404);
                }

                const p = c.req.valid('param');

                const assignment = await prisma.employeeDocumentAssignment.findFirst({
                    where: { employeeId, documentTypeId: p.documentTypeId, deletedAt: { isSet: false } },
                });
                if (!assignment) return c.json({ error: 'Not assigned' }, 404);

                const type = await prisma.employeeDocumentType.findFirst({
                    where: { id: p.documentTypeId, deletedAt: null },
                    include: {
                        fields: { where: { deletedAt: null }, orderBy: { displayOrder: 'asc' } },
                        folder: { select: { id: true, name: true, organizationId: true } },
                    },
                });

                if (!type) return c.json({ error: 'Document type not found' }, 404);
                if (String(type.folder?.organizationId || '') !== String(employee.organization_id)) {
                    return c.json({ error: 'Document type not found' }, 404);
                }

                return c.json({
                    document_type: {
                        id: type.id,
                        name: type.name,
                        folder_id: type.folderId,
                        folder_name: type.folder?.name || '',
                        is_mandatory: !!type.isMandatory,
                        is_multiple: !!type.isMultiple,
                        is_verification_required: !!type.isVerificationRequired,
                        is_file_upload_enabled: !!type.isFileUploadEnabled,
                        is_appliable_na: !!type.isAppliableNa,
                        ask_expiry_date: !!type.askExpiryDate,
                    },
                    fields: type.fields.map(f => ({
                        id: f.id,
                        key: f.key,
                        label: f.label,
                        field_type: f.fieldType,
                        is_mandatory: !!f.isMandatory,
                        options: f.options || [],
                        display_order: f.displayOrder || 0,
                    })),
                });
            } catch (e) {
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    // POST /employee-documents/my/submissions
    // Employee self-service document submission. Creates PENDING_VERIFICATION submission.
    // For non-multiple types: if a VERIFIED submission exists, creates a renewal (PENDING_VERIFICATION).
    openapi({ method: 'post', path: '/employee-documents/my/submissions', tags: ['Employee-Documents'], summary: 'Employee self-service: submit a document', request: {
        body: { content: { 'multipart/form-data': { schema: z.object({
            assignment_id: objectId,
            document_type_id: objectId,
            field_values: z.string().optional(),
            is_na: z.enum(['true', 'false']).optional(),
            expiry_date: z.string().optional(),
            file: z.any().optional(),
        }) } } },
    }, responses: { 201: {}, 400: {}, 404: {}, 403: {}, 409: {} } },
        async (c) => {
            try {
                const employeeId = c.get('employeeId');
                if (!employeeId) return c.json({ error: 'Unauthorized' }, 401);

                const empRes = await grpcCall(employeeClient, 'GetEmployee', { id: employeeId });
                const employee = empRes?.employee;
                if (!employee || !employee.organization_id) {
                    return c.json({ error: 'Employee organization not found' }, 404);
                }

                const body = await c.req.parseBody();
                const parsed = z.object({
                    assignment_id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid assignment_id'),
                    document_type_id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid document_type_id'),
                }).parse(body);

                const file = body?.file;
                let fileBuffer = Buffer.alloc(0);
                let fileName = '';
                let fileType = '';
                if (file && file.arrayBuffer) {
                    fileBuffer = Buffer.from(await file.arrayBuffer());
                    fileName = file.name || 'document';
                    fileType = file.type || '';
                }

                // Check if this is a renewal (non-multiple type with existing VERIFIED submission)
                const assignment = await prisma.employeeDocumentAssignment.findFirst({
                    where: { id: parsed.assignment_id, deletedAt: { isSet: false } },
                });
                if (!assignment) return c.json({ error: 'Assignment not found' }, 404);
                if (String(assignment.employeeId) !== String(employeeId)) {
                    return c.json({ error: 'Unauthorized' }, 403);
                }

                const docType = await prisma.employeeDocumentType.findFirst({
                    where: { id: parsed.document_type_id, deletedAt: null },
                });
                if (!docType) return c.json({ error: 'Document type not found' }, 404);

                let renewSubmissionId = null;
                if (!docType.isMultiple) {
                    const existingVerified = await prisma.employeeDocumentSubmission.findFirst({
                        where: {
                            assignmentId: parsed.assignment_id,
                            status: 'VERIFIED',
                            deletedAt: null,
                            replacedBySubmissionId: null,
                        },
                    });
                    if (existingVerified) {
                        // Check no pending renewal already exists
                        const pendingRenewal = await prisma.employeeDocumentSubmission.findFirst({
                            where: {
                                assignmentId: parsed.assignment_id,
                                status: 'PENDING_VERIFICATION',
                                deletedAt: null,
                            },
                        });
                        if (pendingRenewal) {
                            return c.json({ error: 'A renewal is already awaiting verification for this document.' }, 409);
                        }
                        renewSubmissionId = existingVerified.id;
                    }
                }

                if (renewSubmissionId) {
                    // Use RenewDocument gRPC
                    const res = await grpcCall(employeeDocumentClient, 'RenewDocument', {
                        organization_id: employee.organization_id,
                        submission_id: renewSubmissionId,
                        admin_id: '',
                        field_values: body.field_values || '',
                        is_na: body.is_na === 'true',
                        expiry_date: body.expiry_date || '',
                        file_buffer: fileBuffer,
                        file_name: fileName,
                        file_type: fileType,
                    });
                    return c.json(res, 201);
                } else {
                    // Use SubmitDocument gRPC
                    const res = await grpcCall(employeeDocumentClient, 'SubmitDocument', {
                        organization_id: employee.organization_id,
                        assignment_id: parsed.assignment_id,
                        employee_id: employeeId,
                        document_type_id: parsed.document_type_id,
                        submitted_by_id: '',
                        field_values: body.field_values || '',
                        is_na: body.is_na === 'true',
                        expiry_date: body.expiry_date || '',
                        file_buffer: fileBuffer,
                        file_name: fileName,
                        file_type: fileType,
                        admin_id: '',
                    });
                    return c.json(res, 201);
                }
            } catch (e) {
                if (e instanceof ZodError) return c.json({ error: 'Validation failed', details: e.errors.map(x => ({ field: x.path.join('.'), message: x.message })) }, 400);
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });
}
