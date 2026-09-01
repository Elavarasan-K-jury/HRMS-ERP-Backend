import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import { storageService, validateFile, ValidationError } from '@jury-hrms/files';
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.EMPLOYEE_DOCUMENT_SERVICE_PORT || 5068);
const employeeDocumentProto = loadProto('employee_document');

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

function isObjectId(id) {
    return typeof id === 'string' && OBJECT_ID.test(id);
}

function safeParseJson(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch (e) {
        return fallback;
    }
}

function mapDocumentField(f = {}) {
    return {
        id: f.id ?? '',
        document_type_id: f.documentTypeId ?? '',
        label: f.label ?? '',
        key: f.key ?? '',
        field_type: f.fieldType ?? '',
        options: f.options ? JSON.stringify(f.options) : '',
        is_mandatory: !!f.isMandatory,
        display_order: f.displayOrder ?? 0,
        created_at: f.createdAt ? f.createdAt.toISOString() : '',
        updated_at: f.updatedAt ? f.updatedAt.toISOString() : '',
    };
}

function mapDocumentType(t = {}) {
    return {
        id: t.id ?? '',
        folder_id: t.folderId ?? '',
        name: t.name ?? '',
        description: t.description ?? '',
        is_multiple: !!t.isMultiple,
        is_mandatory: !!t.isMandatory,
        is_appliable_na: !!t.isAppliableNA,
        is_file_upload_enabled: !!t.isFileUploadEnabled,
        is_verification_required: !!t.isVerificationRequired,
        ask_expiry_date: !!t.askExpiryDate,
        expiry_days: t.expiryDays ?? 0,
        expiry_period: t.expiryPeriod ?? '',
        all_countries: t.allCountries ?? true,
        allowed_countries: t.allowedCountries || [],
        display_order: t.displayOrder ?? 0,
        is_active: t.isActive ?? true,
        created_by_id: t.createdById ?? '',
        updated_by_id: t.updatedById ?? '',
        created_at: t.createdAt ? t.createdAt.toISOString() : '',
        updated_at: t.updatedAt ? t.updatedAt.toISOString() : '',
        field_count: t._count?.fields ?? t.field_count ?? 0,
        assignment_count: t._count?.assignments ?? t.assignment_count ?? 0,
        fields: (t.fields || []).map(mapDocumentField),
    };
}

function mapDocumentFolder(f = {}) {
    return {
        id: f.id ?? '',
        organization_id: f.organizationId ?? '',
        name: f.name ?? '',
        description: f.description ?? '',
        is_confidential: !!f.isConfidential,
        is_active: f.isActive ?? true,
        permissions: f.permissions ? JSON.stringify(f.permissions) : '',
        created_by_id: f.createdById ?? '',
        updated_by_id: f.updatedById ?? '',
        created_at: f.createdAt ? f.createdAt.toISOString() : '',
        updated_at: f.updatedAt ? f.updatedAt.toISOString() : '',
        document_type_count: f._count?.documentTypes ?? f.document_type_count ?? 0,
    };
}

async function assertFolderAccess(folder, organization_id) {
    if (!folder) throw { code: grpc.status.NOT_FOUND, message: 'Document folder not found' };
    if (organization_id && String(organization_id) !== String(folder.organizationId)) {
        throw { code: grpc.status.PERMISSION_DENIED, message: 'Document folder does not belong to this organization.' };
    }
}

const impl = {
    /***************************************************************
     * FOLDERS
     ***************************************************************/
    CreateFolder: async (call, callback) => {
        try {
            const data = call.request;
            if (!data.organization_id) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id is required.' });
            if (!isObjectId(data.organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });
            if (!data.name?.trim()) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Folder name is required.' });
            const name = data.name.trim();
            if (name.length > 255) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Folder name is too long.' });

            const allForDup = await prisma.employeeDocumentFolder.findMany({ where: { organizationId: data.organization_id } });
            const existing = allForDup.find(f => !f.deletedAt && f.name.toLowerCase() === name.toLowerCase());
            if (existing) return callback({ code: grpc.status.ALREADY_EXISTS, message: `Document folder '${name}' already exists.` });

            const permissions = safeParseJson(data.permissions, null);

            const folder = await prisma.employeeDocumentFolder.create({
                data: {
                    organizationId: data.organization_id,
                    name,
                    description: data.description?.trim() || null,
                    isConfidential: data.is_confidential !== undefined && data.is_confidential !== null ? Boolean(data.is_confidential) : false,
                    isActive: data.is_active !== undefined && data.is_active !== null ? Boolean(data.is_active) : true,
                    permissions,
                    createdById: isObjectId(data.created_by_id) ? data.created_by_id : null,
                    updatedById: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
            });
            callback(null, { folder: mapDocumentFolder(folder), message: 'Document folder created successfully', success: true });
        } catch (e) {
            if (e.code === 'P2002') return callback({ code: grpc.status.ALREADY_EXISTS, message: `Document folder '${call.request?.name?.trim() || 'this name'}' already exists.` });
            console.error('CreateFolder Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListFolders: async (call, callback) => {
        try {
            const { organization_id, page = 1, limit = 10, search = '', sort_by = 'created_at', sort_order = 'desc' } = call.request;
            if (!organization_id) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id is required.' });
            if (!isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });
            const skip = (page - 1) * limit;
            let where = { organizationId: organization_id, deletedAt: null };
            if (search) {
                where.OR = [
                    { name: { contains: search, mode: 'insensitive' } },
                    { description: { contains: search, mode: 'insensitive' } },
                ];
            }
            const validSort = { name: 'name', created_at: 'createdAt', updated_at: 'updatedAt' };
            const sortField = validSort[sort_by] || 'createdAt';
            const order = sort_order.toLowerCase() === 'asc' ? 'asc' : 'desc';

            const total = await prisma.employeeDocumentFolder.count({ where });
            const folders = await prisma.employeeDocumentFolder.findMany({
                where,
                orderBy: { [sortField]: order },
                skip,
                take: limit,
            });

            const ids = folders.map(f => f.id);
            const counts = ids.length ? await prisma.employeeDocumentType.groupBy({ by: ['folderId'], where: { folderId: { in: ids }, deletedAt: null }, _count: { _all: true } }) : [];
            const countMap = {};
            counts.forEach(c => { countMap[c.folderId] = c._count._all; });

            callback(null, {
                folders: folders.map(f => mapDocumentFolder({ ...f, _count: { documentTypes: countMap[f.id] || 0 } })),
                total, page, limit, total_pages: Math.ceil(total / limit),
                success: true, message: 'Document folders found successfully',
            });
        } catch (e) {
            console.error('ListFolders Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetFolder: async (call, callback) => {
        try {
            const { folder_id, organization_id } = call.request;
            if (!isObjectId(folder_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid folder id' });
            const folder = await prisma.employeeDocumentFolder.findFirst({ where: { id: folder_id, deletedAt: null } });
            await assertFolderAccess(folder, organization_id);
            const typeCount = await prisma.employeeDocumentType.count({ where: { folderId: folder_id, deletedAt: null } });
            callback(null, { folder: mapDocumentFolder({ ...folder, _count: { documentTypes: typeCount } }), message: 'Document folder found', success: true });
        } catch (e) {
            if (e.code) return callback({ code: e.code, message: e.message });
            console.error('GetFolder Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateFolder: async (call, callback) => {
        try {
            const data = call.request;
            if (!isObjectId(data.id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid folder id' });
            const existing = await prisma.employeeDocumentFolder.findFirst({ where: { id: data.id, deletedAt: null } });
            await assertFolderAccess(existing, data.organization_id);

            const name = data.name !== undefined && data.name !== null && data.name !== '' ? data.name.trim() : existing.name;
            const description = data.description !== undefined ? (data.description?.trim() || null) : existing.description;
            const isConfidential = data.is_confidential !== undefined && data.is_confidential !== null ? Boolean(data.is_confidential) : existing.isConfidential;
            const isActive = data.is_active !== undefined && data.is_active !== null ? Boolean(data.is_active) : existing.isActive;
            const permissions = data.permissions !== undefined && data.permissions !== null ? safeParseJson(data.permissions, null) : existing.permissions;

            if (!name) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Folder name is required.' });

            const allForDup = await prisma.employeeDocumentFolder.findMany({ where: { organizationId: data.organization_id || existing.organizationId } });
            const conflict = allForDup.find(f => !f.deletedAt && String(f.id) !== String(data.id) && f.name.toLowerCase() === name.toLowerCase());
            if (conflict) return callback({ code: grpc.status.ALREADY_EXISTS, message: `Document folder '${name}' already exists.` });

            const updated = await prisma.employeeDocumentFolder.update({
                where: { id: data.id },
                data: {
                    name, description, isConfidential, isActive, permissions,
                    updatedById: isObjectId(data.updated_by_id) ? data.updated_by_id : existing.updatedById,
                    updatedAt: new Date(),
                },
            });
            const typeCount = await prisma.employeeDocumentType.count({ where: { folderId: data.id, deletedAt: null } });
            callback(null, { folder: mapDocumentFolder({ ...updated, _count: { documentTypes: typeCount } }), message: 'Document folder updated successfully', success: true });
        } catch (e) {
            if (e.code === 'P2002') return callback({ code: grpc.status.ALREADY_EXISTS, message: `Document folder '${call.request?.name?.trim() || 'this name'}' already exists.` });
            if (e.code) return callback({ code: e.code, message: e.message });
            console.error('UpdateFolder Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeleteFolder: async (call, callback) => {
        try {
            const { folder_id, organization_id } = call.request;
            if (!isObjectId(folder_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid folder id' });
            const folder = await prisma.employeeDocumentFolder.findFirst({ where: { id: folder_id, deletedAt: null } });
            await assertFolderAccess(folder, organization_id);

            // Soft-delete the folder with renamed unique key to free the (organizationId, name) constraint
            await prisma.employeeDocumentFolder.update({
                where: { id: folder_id },
                data: { deletedAt: new Date(), updatedAt: new Date(), name: `${folder.name}__deleted__${Date.now()}` },
            });
            callback(null, { success: true, message: 'Document folder deleted successfully' });
        } catch (e) {
            if (e.code) return callback({ code: e.code, message: e.message });
            console.error('DeleteFolder Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /***************************************************************
     * DOCUMENT TYPES
     ***************************************************************/
    CreateDocumentType: async (call, callback) => {
        try {
            const data = call.request;
            if (!data.organization_id) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id is required.' });
            if (!isObjectId(data.organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });
            if (!isObjectId(data.folder_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid folder id' });
            if (!data.name?.trim()) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Document type name is required.' });
            const name = data.name.trim();

            const folder = await prisma.employeeDocumentFolder.findFirst({ where: { id: data.folder_id, deletedAt: null } });
            if (!folder) return callback({ code: grpc.status.NOT_FOUND, message: 'Document folder not found' });
            if (String(folder.organizationId) !== String(data.organization_id)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Document folder does not belong to this organization.' });
            }

            const allForDup = await prisma.employeeDocumentType.findMany({ where: { folderId: data.folder_id } });
            const existing = allForDup.find(t => !t.deletedAt && t.name.toLowerCase() === name.toLowerCase());
            if (existing) return callback({ code: grpc.status.ALREADY_EXISTS, message: `Document type '${name}' already exists in this folder.` });

            const type = await prisma.employeeDocumentType.create({
                data: {
                    folderId: data.folder_id,
                    name,
                    description: data.description?.trim() || null,
                    isMultiple: Boolean(data.is_multiple),
                    isMandatory: Boolean(data.is_mandatory),
                    isAppliableNA: Boolean(data.is_appliable_na),
                    isFileUploadEnabled: Boolean(data.is_file_upload_enabled),
                    isVerificationRequired: Boolean(data.is_verification_required),
                    askExpiryDate: Boolean(data.ask_expiry_date),
                    expiryDays: data.expiry_days !== undefined && data.expiry_days !== null ? Number(data.expiry_days) : null,
                    expiryPeriod: data.expiry_period?.trim() || null,
                    allCountries: data.all_countries !== undefined && data.all_countries !== null ? Boolean(data.all_countries) : true,
                    allowedCountries: data.allowed_countries || [],
                    displayOrder: data.display_order !== undefined && data.display_order !== null ? Number(data.display_order) : 0,
                    isActive: data.is_active !== undefined && data.is_active !== null ? Boolean(data.is_active) : true,
                    createdById: isObjectId(data.created_by_id) ? data.created_by_id : null,
                    updatedById: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
            });
            callback(null, { document_type: mapDocumentType(type), message: 'Document type created successfully', success: true });
        } catch (e) {
            if (e.code === 'P2002') return callback({ code: grpc.status.ALREADY_EXISTS, message: `Document type '${call.request?.name?.trim() || 'this name'}' already exists in this folder.` });
            console.error('CreateDocumentType Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListDocumentTypes: async (call, callback) => {
        try {
            const { organization_id, folder_id, page = 1, limit = 10, search = '', sort_by = 'created_at', sort_order = 'desc' } = call.request;
            if (!organization_id) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id is required.' });
            if (!isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });
            if (!isObjectId(folder_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid folder id' });

            const folder = await prisma.employeeDocumentFolder.findFirst({ where: { id: folder_id, deletedAt: null } });
            if (!folder) return callback({ code: grpc.status.NOT_FOUND, message: 'Document folder not found' });
            if (String(folder.organizationId) !== String(organization_id)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Document folder does not belong to this organization.' });
            }

            const skip = (page - 1) * limit;
            let where = { folderId: folder_id, deletedAt: null };
            if (search) {
                where.OR = [
                    { name: { contains: search, mode: 'insensitive' } },
                    { description: { contains: search, mode: 'insensitive' } },
                ];
            }
            const validSort = { name: 'name', display_order: 'displayOrder', created_at: 'createdAt', updated_at: 'updatedAt' };
            const sortField = validSort[sort_by] || 'createdAt';
            const order = sort_order.toLowerCase() === 'asc' ? 'asc' : 'desc';

            const total = await prisma.employeeDocumentType.count({ where });
            const types = await prisma.employeeDocumentType.findMany({
                where,
                orderBy: { [sortField]: order },
                skip,
                take: limit,
            });

            const ids = types.map(t => t.id);
            const fieldCounts = ids.length ? await prisma.employeeDocumentField.groupBy({ by: ['documentTypeId'], where: { documentTypeId: { in: ids }, deletedAt: null }, _count: { _all: true } }) : [];
            const fieldMap = {};
            fieldCounts.forEach(c => { fieldMap[c.documentTypeId] = c._count._all; });

            callback(null, {
                document_types: types.map(t => mapDocumentType({ ...t, _count: { fields: fieldMap[t.id] || 0 } })),
                total, page, limit, total_pages: Math.ceil(total / limit),
                success: true, message: 'Document types found successfully',
            });
        } catch (e) {
            console.error('ListDocumentTypes Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetDocumentType: async (call, callback) => {
        try {
            const { organization_id, folder_id, document_type_id } = call.request;
            if (!isObjectId(document_type_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid document type id' });
            if (!isObjectId(folder_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid folder id' });

            const folder = await prisma.employeeDocumentFolder.findFirst({ where: { id: folder_id, deletedAt: null } });
            if (!folder) return callback({ code: grpc.status.NOT_FOUND, message: 'Document folder not found' });
            if (organization_id && String(organization_id) !== String(folder.organizationId)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Document folder does not belong to this organization.' });
            }

            const type = await prisma.employeeDocumentType.findFirst({
                where: { id: document_type_id, folderId: folder_id, deletedAt: null },
                include: { fields: { where: { deletedAt: null }, orderBy: { displayOrder: 'asc' } } },
            });
            if (!type) return callback({ code: grpc.status.NOT_FOUND, message: 'Document type not found' });

            const assignmentCount = await prisma.employeeDocumentAssignment.count({ where: { documentTypeId: document_type_id, deletedAt: null } });
            callback(null, { document_type: mapDocumentType({ ...type, _count: { fields: type.fields.length, assignments: assignmentCount } }), message: 'Document type found', success: true });
        } catch (e) {
            if (e.code) return callback({ code: e.code, message: e.message });
            console.error('GetDocumentType Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateDocumentType: async (call, callback) => {
        try {
            const data = call.request;
            if (!isObjectId(data.id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid document type id' });
            if (!isObjectId(data.folder_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid folder id' });

            const folder = await prisma.employeeDocumentFolder.findFirst({ where: { id: data.folder_id, deletedAt: null } });
            if (!folder) return callback({ code: grpc.status.NOT_FOUND, message: 'Document folder not found' });
            if (data.organization_id && String(data.organization_id) !== String(folder.organizationId)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Document folder does not belong to this organization.' });
            }

            const existing = await prisma.employeeDocumentType.findFirst({ where: { id: data.id, folderId: data.folder_id, deletedAt: null } });
            if (!existing) return callback({ code: grpc.status.NOT_FOUND, message: 'Document type not found' });

            const name = data.name !== undefined && data.name !== null && data.name !== '' ? data.name.trim() : existing.name;
            const description = data.description !== undefined ? (data.description?.trim() || null) : existing.description;
            const isMultiple = data.is_multiple !== undefined && data.is_multiple !== null ? Boolean(data.is_multiple) : existing.isMultiple;
            const isMandatory = data.is_mandatory !== undefined && data.is_mandatory !== null ? Boolean(data.is_mandatory) : existing.isMandatory;
            const isAppliableNA = data.is_appliable_na !== undefined && data.is_appliable_na !== null ? Boolean(data.is_appliable_na) : existing.isAppliableNA;
            const isFileUploadEnabled = data.is_file_upload_enabled !== undefined && data.is_file_upload_enabled !== null ? Boolean(data.is_file_upload_enabled) : existing.isFileUploadEnabled;
            const isVerificationRequired = data.is_verification_required !== undefined && data.is_verification_required !== null ? Boolean(data.is_verification_required) : existing.isVerificationRequired;
            const askExpiryDate = data.ask_expiry_date !== undefined && data.ask_expiry_date !== null ? Boolean(data.ask_expiry_date) : existing.askExpiryDate;
            const expiryDays = data.expiry_days !== undefined && data.expiry_days !== null ? Number(data.expiry_days) : existing.expiryDays;
            const expiryPeriod = data.expiry_period !== undefined && data.expiry_period !== null && data.expiry_period !== '' ? data.expiry_period.trim() : existing.expiryPeriod;
            const allCountries = data.all_countries !== undefined && data.all_countries !== null ? Boolean(data.all_countries) : existing.allCountries;
            const allowedCountries = data.allowed_countries !== undefined ? (data.allowed_countries || []) : existing.allowedCountries;
            const displayOrder = data.display_order !== undefined && data.display_order !== null ? Number(data.display_order) : existing.displayOrder;
            const isActive = data.is_active !== undefined && data.is_active !== null ? Boolean(data.is_active) : existing.isActive;

            if (!name) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Document type name is required.' });

            const allForDup = await prisma.employeeDocumentType.findMany({ where: { folderId: data.folder_id } });
            const conflict = allForDup.find(t => !t.deletedAt && String(t.id) !== String(data.id) && t.name.toLowerCase() === name.toLowerCase());
            if (conflict) return callback({ code: grpc.status.ALREADY_EXISTS, message: `Document type '${name}' already exists in this folder.` });

            const updated = await prisma.employeeDocumentType.update({
                where: { id: data.id },
                data: {
                    name, description, isMultiple, isMandatory, isAppliableNA, isFileUploadEnabled,
                    isVerificationRequired, askExpiryDate, expiryDays, expiryPeriod, allCountries,
                    allowedCountries, displayOrder, isActive,
                    updatedById: isObjectId(data.updated_by_id) ? data.updated_by_id : existing.updatedById,
                    updatedAt: new Date(),
                },
            });
            const fieldCount = await prisma.employeeDocumentField.count({ where: { documentTypeId: data.id, deletedAt: null } });
            const assignmentCount = await prisma.employeeDocumentAssignment.count({ where: { documentTypeId: data.id, deletedAt: null } });
            callback(null, { document_type: mapDocumentType({ ...updated, _count: { fields: fieldCount, assignments: assignmentCount } }), message: 'Document type updated successfully', success: true });
        } catch (e) {
            if (e.code === 'P2002') return callback({ code: grpc.status.ALREADY_EXISTS, message: `Document type '${call.request?.name?.trim() || 'this name'}' already exists in this folder.` });
            if (e.code) return callback({ code: e.code, message: e.message });
            console.error('UpdateDocumentType Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeleteDocumentType: async (call, callback) => {
        try {
            const { organization_id, folder_id, document_type_id } = call.request;
            if (!isObjectId(document_type_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid document type id' });
            if (!isObjectId(folder_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid folder id' });

            const folder = await prisma.employeeDocumentFolder.findFirst({ where: { id: folder_id, deletedAt: null } });
            if (!folder) return callback({ code: grpc.status.NOT_FOUND, message: 'Document folder not found' });
            if (organization_id && String(organization_id) !== String(folder.organizationId)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Document folder does not belong to this organization.' });
            }

            const type = await prisma.employeeDocumentType.findFirst({ where: { id: document_type_id, folderId: folder_id, deletedAt: null } });
            if (!type) return callback({ code: grpc.status.NOT_FOUND, message: 'Document type not found' });

            await prisma.employeeDocumentType.update({
                where: { id: document_type_id },
                data: { deletedAt: new Date(), updatedAt: new Date(), name: `${type.name}__deleted__${Date.now()}` },
            });
            callback(null, { success: true, message: 'Document type deleted successfully' });
        } catch (e) {
            if (e.code) return callback({ code: e.code, message: e.message });
            console.error('DeleteDocumentType Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /***************************************************************
     * DOCUMENT FIELDS
     ***************************************************************/
    CreateDocumentField: async (call, callback) => {
        try {
            const data = call.request;
            if (!data.organization_id) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id is required.' });
            if (!isObjectId(data.organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });
            if (!isObjectId(data.document_type_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid document type id' });
            if (!data.label?.trim()) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Field label is required.' });
            if (!data.key?.trim()) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Field key is required.' });

            const fieldType = (data.field_type || '').trim();
            if (fieldType && !['TEXTBOX', 'NUMBER', 'DATE', 'TEXTAREA', 'DROPDOWN', 'MULTI_SELECT', 'FILE'].includes(fieldType)) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: `Invalid field_type '${fieldType}'. Must be one of TEXTBOX, NUMBER, DATE, TEXTAREA, DROPDOWN, MULTI_SELECT, FILE.` });
            }

            const chain = await assertFieldOwnership(data.organization_id, data.document_type_id);
            if (chain.error) return callback({ code: chain.error.code, message: chain.error.message });

            const field = await prisma.employeeDocumentField.create({
                data: {
                    documentTypeId: data.document_type_id,
                    label: data.label.trim(),
                    key: data.key.trim(),
                    fieldType,
                    options: safeParseJson(data.options, null),
                    isMandatory: Boolean(data.is_mandatory),
                    displayOrder: data.display_order !== undefined && data.display_order !== null ? Number(data.display_order) : 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
            });
            callback(null, { field: mapDocumentField(field), message: 'Document field created successfully', success: true });
        } catch (e) {
            console.error('CreateDocumentField Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListDocumentFields: async (call, callback) => {
        try {
            const { organization_id, document_type_id } = call.request;
            if (!organization_id) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id is required.' });
            if (!isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });
            if (!isObjectId(document_type_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid document type id' });

            const chain = await assertFieldOwnership(organization_id, document_type_id);
            if (chain.error) return callback({ code: chain.error.code, message: chain.error.message });

            const fields = await prisma.employeeDocumentField.findMany({
                where: { documentTypeId: document_type_id, deletedAt: null },
                orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
            });
            callback(null, { fields: fields.map(mapDocumentField), total: fields.length, success: true, message: 'Document fields found' });
        } catch (e) {
            if (e.code) return callback({ code: e.code, message: e.message });
            console.error('ListDocumentFields Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetDocumentField: async (call, callback) => {
        try {
            const { organization_id, document_type_id, field_id } = call.request;
            if (!isObjectId(field_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid field id' });
            if (!isObjectId(document_type_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid document type id' });

            const chain = await assertFieldOwnership(organization_id, document_type_id);
            if (chain.error) return callback({ code: chain.error.code, message: chain.error.message });

            const field = await prisma.employeeDocumentField.findFirst({ where: { id: field_id, documentTypeId: document_type_id, deletedAt: null } });
            if (!field) return callback({ code: grpc.status.NOT_FOUND, message: 'Document field not found' });
            callback(null, { field: mapDocumentField(field), message: 'Document field found', success: true });
        } catch (e) {
            if (e.code) return callback({ code: e.code, message: e.message });
            console.error('GetDocumentField Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateDocumentField: async (call, callback) => {
        try {
            const data = call.request;
            if (!isObjectId(data.id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid field id' });
            if (!isObjectId(data.document_type_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid document type id' });

            const chain = await assertFieldOwnership(data.organization_id, data.document_type_id);
            if (chain.error) return callback({ code: chain.error.code, message: chain.error.message });

            const existing = await prisma.employeeDocumentField.findFirst({ where: { id: data.id, documentTypeId: data.document_type_id, deletedAt: null } });
            if (!existing) return callback({ code: grpc.status.NOT_FOUND, message: 'Document field not found' });

            const label = data.label !== undefined && data.label !== null && data.label !== '' ? data.label.trim() : existing.label;
            const key = data.key !== undefined && data.key !== null && data.key !== '' ? data.key.trim() : existing.key;
            const fieldType = data.field_type !== undefined && data.field_type !== null && data.field_type !== '' ? data.field_type.trim() : existing.fieldType;
            const options = data.options !== undefined && data.options !== null ? safeParseJson(data.options, null) : existing.options;
            const isMandatory = data.is_mandatory !== undefined && data.is_mandatory !== null ? Boolean(data.is_mandatory) : existing.isMandatory;
            const displayOrder = data.display_order !== undefined && data.display_order !== null ? Number(data.display_order) : existing.displayOrder;

            if (fieldType && !['TEXTBOX', 'NUMBER', 'DATE', 'TEXTAREA', 'DROPDOWN', 'MULTI_SELECT', 'FILE'].includes(fieldType)) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: `Invalid field_type '${fieldType}'. Must be one of TEXTBOX, NUMBER, DATE, TEXTAREA, DROPDOWN, MULTI_SELECT, FILE.` });
            }

            const updated = await prisma.employeeDocumentField.update({
                where: { id: data.id },
                data: { label, key, fieldType, options, isMandatory, displayOrder, updatedAt: new Date() },
            });
            callback(null, { field: mapDocumentField(updated), message: 'Document field updated successfully', success: true });
        } catch (e) {
            if (e.code) return callback({ code: e.code, message: e.message });
            console.error('UpdateDocumentField Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeleteDocumentField: async (call, callback) => {
        try {
            const { organization_id, document_type_id, field_id } = call.request;
            if (!isObjectId(field_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid field id' });
            if (!isObjectId(document_type_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid document type id' });

            const chain = await assertFieldOwnership(organization_id, document_type_id);
            if (chain.error) return callback({ code: chain.error.code, message: chain.error.message });

            const field = await prisma.employeeDocumentField.findFirst({ where: { id: field_id, documentTypeId: document_type_id, deletedAt: null } });
            if (!field) return callback({ code: grpc.status.NOT_FOUND, message: 'Document field not found' });

            await prisma.employeeDocumentField.update({ where: { id: field_id }, data: { deletedAt: new Date(), updatedAt: new Date() } });
            callback(null, { success: true, message: 'Document field deleted successfully' });
        } catch (e) {
            if (e.code) return callback({ code: e.code, message: e.message });
            console.error('DeleteDocumentField Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /***************************************************************
     * ASSIGNMENTS
     ***************************************************************/
    AssignDocument: async (call, callback) => {
        try {
            const { organization_id, employee_id, document_type_id, assigned_by_id } = call.request;
            if (!organization_id) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id is required.' });
            if (!isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });
            if (!isObjectId(employee_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid employee id' });
            if (!isObjectId(document_type_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid document type id' });

            const result = await assignDocumentRecord({ organization_id, employee_id, document_type_id, assigned_by_id });
            if (result.error) return callback({ code: result.error.code, message: result.error.message });
            callback(null, { assignment: mapAssignment(result.assignment, document_type_id, organization_id), message: result.message, success: true });
        } catch (e) {
            if (e.code) return callback({ code: e.code, message: e.message });
            console.error('AssignDocument Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    AssignDocuments: async (call, callback) => {
        try {
            const { organization_id, employee_id, document_type_ids = [], assigned_by_id } = call.request;
            if (!organization_id) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id is required.' });
            if (!isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });
            if (!isObjectId(employee_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid employee id' });
            const validIds = document_type_ids.filter(id => isObjectId(id) && id);
            if (validIds.length === 0) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'At least one valid document type id is required.' });

            const employee = await prisma.organizationEmployees.findFirst({ where: { id: employee_id, deletedAt: null } });
            if (!employee) return callback({ code: grpc.status.NOT_FOUND, message: 'Employee not found' });
            if (String(employee.organizationId) !== String(organization_id)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Employee does not belong to this organization.' });
            }

            const assigned = [];
            const already = [];
            const failed = [];
            for (const dtId of validIds) {
                try {
                    const result = await assignDocumentRecord({ organization_id, employee_id, document_type_id: dtId, assigned_by_id, isBulk: true });
                    if (result.already) already.push(dtId);
                    else if (result.error) failed.push(dtId);
                    else assigned.push(dtId);
                } catch (e) {
                    failed.push(dtId);
                }
            }
            callback(null, {
                assigned_count: assigned.length,
                already_assigned_count: already.length,
                failed_count: failed.length,
                already_assigned: already,
                failed,
                success: true,
                message: `${assigned.length} document(s) assigned. ${already.length} already assigned.${failed.length ? ` ${failed.length} failed.` : ''}`,
            });
        } catch (e) {
            console.error('AssignDocuments Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    BulkAssignDocuments: async (call, callback) => {
        try {
            const { organization_id, employee_ids = [], document_type_ids = [], assigned_by_id } = call.request;
            if (!organization_id) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id is required.' });
            if (!isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });
            const validEmpIds = employee_ids.filter(id => isObjectId(id) && id);
            const validTypeIds = document_type_ids.filter(id => isObjectId(id) && id);
            if (validEmpIds.length === 0) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'At least one valid employee id is required.' });
            if (validTypeIds.length === 0) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'At least one valid document type id is required.' });

            const totalRequested = validEmpIds.length * validTypeIds.length;
            let assignedCount = 0;
            let alreadyCount = 0;
            let failedCount = 0;

            for (const empId of validEmpIds) {
                const employee = await prisma.organizationEmployees.findFirst({ where: { id: empId, deletedAt: null } });
                if (!employee || String(employee.organizationId) !== String(organization_id)) {
                    failedCount += validTypeIds.length;
                    continue;
                }
                for (const dtId of validTypeIds) {
                    try {
                        const result = await assignDocumentRecord({ organization_id, employee_id: empId, document_type_id: dtId, assigned_by_id, isBulk: true });
                        if (result.already) alreadyCount++;
                        else if (result.error) failedCount++;
                        else assignedCount++;
                    } catch (e) {
                        failedCount++;
                    }
                }
            }

            callback(null, {
                total_requested: totalRequested,
                assigned_count: assignedCount,
                already_assigned_count: alreadyCount,
                failed_count: failedCount,
                success: true,
                message: `${assignedCount} assigned. ${alreadyCount} already assigned.${failedCount ? ` ${failedCount} failed.` : ''}`,
            });
        } catch (e) {
            console.error('BulkAssignDocuments Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListEmployeeAssignments: async (call, callback) => {
        try {
            const { organization_id, employee_id } = call.request;
            if (!organization_id) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id is required.' });
            if (!isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });
            if (!isObjectId(employee_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid employee id' });

            const employee = await prisma.organizationEmployees.findFirst({ where: { id: employee_id, deletedAt: null } });
            if (!employee) return callback({ code: grpc.status.NOT_FOUND, message: 'Employee not found' });
            if (String(employee.organizationId) !== String(organization_id)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Employee does not belong to this organization.' });
            }

            const assignments = await prisma.employeeDocumentAssignment.findMany({
                where: { employeeId: employee_id, organizationId: organization_id, deletedAt: null },
                include: { documentType: { include: { folder: true } } },
                orderBy: { createdAt: 'desc' },
            });

            const result = assignments.map(a => mapAssignmentWithType(a));
            callback(null, { assignments: result, total: result.length, success: true, message: 'Assignments found' });
        } catch (e) {
            console.error('ListEmployeeAssignments Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListDocumentAssignments: async (call, callback) => {
        try {
            const { organization_id, document_type_id, page = 1, limit = 10, search = '', sort_by = 'created_at', sort_order = 'desc' } = call.request;
            if (!organization_id) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id is required.' });
            if (!isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });
            if (!isObjectId(document_type_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid document type id' });

            const type = await prisma.employeeDocumentType.findFirst({ where: { id: document_type_id, deletedAt: null } });
            if (!type) return callback({ code: grpc.status.NOT_FOUND, message: 'Document type not found' });
            const folder = await prisma.employeeDocumentFolder.findFirst({ where: { id: type.folderId, deletedAt: null } });
            if (!folder) return callback({ code: grpc.status.NOT_FOUND, message: 'Document folder not found' });
            if (String(folder.organizationId) !== String(organization_id)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Document type does not belong to this organization.' });
            }

            const assignments = await prisma.employeeDocumentAssignment.findMany({
                where: { documentTypeId: document_type_id, organizationId: organization_id, deletedAt: null },
                orderBy: { createdAt: 'desc' },
            });
            const empIds = assignments.map(a => a.employeeId);

            let empWhere = { id: { in: empIds }, deletedAt: null };
            if (search) {
                const q = search.toLowerCase();
                empWhere = {
                    id: { in: empIds }, deletedAt: null,
                    OR: [
                        { fullName: { contains: q, mode: 'insensitive' } },
                        { employeeCode: { contains: q, mode: 'insensitive' } },
                        { email: { contains: q, mode: 'insensitive' } },
                    ],
                };
            }

            const total = await prisma.organizationEmployees.count({ where: empWhere });
            const skip = (page - 1) * limit;
            const employees = await prisma.organizationEmployees.findMany({
                where: empWhere,
                include: {
                    designation: true,
                    location: true,
                    branch: true,
                    departmentAssignments: { where: { deletedAt: null }, include: { department: true } },
                },
                orderBy: { fullName: 'asc' },
                skip,
                take: limit,
            });

            const byId = new Map(assignments.map(a => [a.employeeId, a]));
            const result = employees.map(e => mapAssignment(byId.get(e.id), document_type_id, organization_id, e));
            callback(null, { assignments: result, total, page, limit, total_pages: Math.ceil(total / limit), success: true, message: 'Assignments found' });
        } catch (e) {
            console.error('ListDocumentAssignments Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetAssignment: async (call, callback) => {
        try {
            const { organization_id, assignment_id } = call.request;
            if (!isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });
            if (!isObjectId(assignment_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid assignment id' });

            const assignment = await prisma.employeeDocumentAssignment.findFirst({
                where: { id: assignment_id, deletedAt: null },
                include: { documentType: { include: { folder: true } } },
            });
            if (!assignment) return callback({ code: grpc.status.NOT_FOUND, message: 'Assignment not found' });
            if (String(assignment.organizationId) !== String(organization_id)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Assignment does not belong to this organization.' });
            }
            callback(null, { assignment: mapAssignmentWithType(assignment), message: 'Assignment found', success: true });
        } catch (e) {
            if (e.code) return callback({ code: e.code, message: e.message });
            console.error('GetAssignment Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UnassignDocument: async (call, callback) => {
        try {
            const { organization_id, assignment_id } = call.request;
            if (!isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });
            if (!isObjectId(assignment_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid assignment id' });

            const assignment = await prisma.employeeDocumentAssignment.findFirst({ where: { id: assignment_id, deletedAt: null } });
            if (!assignment) return callback({ code: grpc.status.NOT_FOUND, message: 'Assignment not found' });
            if (String(assignment.organizationId) !== String(organization_id)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Assignment does not belong to this organization.' });
            }

            const submissionCount = await prisma.employeeDocumentSubmission.count({ where: { assignmentId: assignment_id, deletedAt: null } });
            if (submissionCount > 0) {
                return callback({ code: grpc.status.FAILED_PRECONDITION, message: `Cannot unassign. ${submissionCount} submission(s) reference this assignment.` });
            }

            await prisma.employeeDocumentAssignment.update({ where: { id: assignment_id }, data: { deletedAt: new Date(), updatedAt: new Date() } });
            callback(null, { success: true, message: 'Assignment removed successfully' });
        } catch (e) {
            if (e.code) return callback({ code: e.code, message: e.message });
            console.error('UnassignDocument Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListPendingEmployeeDocuments: async (call, callback) => {
        try {
            const { organization_id, page = 1, limit = 10, search = '', sort_by = 'created_at', sort_order = 'desc', employee_id, folder_id, document_type_id } = call.request;
            if (!organization_id) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id is required.' });
            if (!isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });

            // Fetch active (non-deleted) assignments belonging to the org with enriched data.
            // We intentionally avoid N+1 by loading assignments + their type/folder/employee in one pass,
            // then computing which of those have an active submission with a single grouped query.
            const whereAssignment = { organizationId: organization_id, deletedAt: null };
            if (employee_id && isObjectId(employee_id)) whereAssignment.employeeId = employee_id;
            if (document_type_id && isObjectId(document_type_id)) whereAssignment.documentTypeId = document_type_id;

            const assignments = await prisma.employeeDocumentAssignment.findMany({
                where: whereAssignment,
                include: {
                    documentType: { include: { folder: true } },
                    employee: {
                        include: {
                            designation: true,
                            departmentAssignments: { where: { deletedAt: null }, include: { department: true } },
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
            });

            // Keep only assignments whose chain (type/folder) is active and belongs to the org.
            const pendingInitial = assignments.filter(a => {
                const t = a.documentType;
                if (!t || t.deletedAt) return false;
                const f = t.folder;
                if (!f || f.deletedAt) return false;
                if (!t.isActive || !f.isActive) return false;
                if (String(f.organizationId) !== String(organization_id)) return false;
                return true;
            });
            // folder filter
            let pending = pendingInitial;
            if (folder_id && isObjectId(folder_id)) {
                pending = pendingInitial.filter(a => String(a.documentType?.folderId) === String(folder_id));
            }

            // Determine which assignment ids have an ACTIVE submission (deletedAt null, excluding expired/rejected? see below).
            const candidateIds = pending.map(a => a.id);
            const activeSubs = candidateIds.length
                ? await prisma.employeeDocumentSubmission.findMany({
                    where: { assignmentId: { in: candidateIds }, deletedAt: null },
                    select: { assignmentId: true, status: true },
                })
                : [];

            // A submission "blocks" pending-on-employee for PENDING / PENDING_VERIFICATION / VERIFIED / EXPIRED.
            // REJECTED does NOT block — a rejected document becomes actionable again for a later resubmission lifecycle.
            const blockedIds = new Set();
            for (const s of activeSubs) {
                if (['PENDING', 'PENDING_VERIFICATION', 'VERIFIED', 'EXPIRED'].includes(s.status)) blockedIds.add(s.assignmentId);
            }
            pending = pending.filter(a => !blockedIds.has(a.id));

            // Search: employee name/code/email + doc type name + folder name
            if (search) {
                const q = search.toLowerCase();
                pending = pending.filter(a => {
                    const emp = a.employee;
                    const t = a.documentType;
                    const f = t?.folder;
                    return (
                        (emp?.fullName || '').toLowerCase().includes(q) ||
                        (emp?.employeeCode || '').toLowerCase().includes(q) ||
                        (emp?.email || '').toLowerCase().includes(q) ||
                        (t?.name || '').toLowerCase().includes(q) ||
                        (f?.name || '').toLowerCase().includes(q)
                    );
                });
            }

            // Sort
            const validSort = { created_at: 'createdAt', assigned_at: 'assignedAt', name: 'fullName' };
            const dir = sort_order.toLowerCase() === 'asc' ? 1 : -1;
            if (sort_by === 'employee_name') {
                pending.sort((a, b) => String(a.employee?.fullName || '').localeCompare(String(b.employee?.fullName || '')) * dir);
            } else {
                const field = validSort[sort_by] === 'fullName' ? 'createdAt' : (validSort[sort_by] || 'createdAt');
                pending.sort((a, b) => ((a[field] ? new Date(a[field]).getTime() : 0) - (b[field] ? new Date(b[field]).getTime() : 0)) * dir);
            }

            const total = pending.length;
            const totalPendingDocuments = pending.length;
            const uniqueEmployees = new Set(pending.map(a => a.employeeId));
            const totalPendingEmployees = uniqueEmployees.size;

            const skip = (page - 1) * limit;
            const pageRows = pending.slice(skip, skip + limit);

            callback(null, {
                pending_documents: pageRows.map(mapPendingDocument),
                total,
                page,
                limit,
                total_pages: Math.ceil(total / limit),
                total_pending_employees: totalPendingEmployees,
                total_pending_documents: totalPendingDocuments,
                success: true,
                message: 'Pending employee documents found',
            });
        } catch (e) {
            console.error('ListPendingEmployeeDocuments Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /***************************************************************
     * SUBMISSIONS
     ***************************************************************/
    SubmitDocument: async (call, callback) => {
        try {
            const data = call.request;
            const { organization_id, assignment_id, employee_id, document_type_id, submitted_by_id } = data;
            if (!organization_id || !isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });
            if (!isObjectId(assignment_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid assignment id' });
            if (!isObjectId(employee_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid employee id' });
            if (!isObjectId(document_type_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid document type id' });

            const isNA = Boolean(data.is_na);
            const expiryDate = data.expiry_date ? new Date(data.expiry_date) : null;

            // --- Validate ownership chain: assignment -> employee + type -> folder -> org ---
            const assignment = await prisma.employeeDocumentAssignment.findFirst({ where: { id: assignment_id, deletedAt: null } });
            if (!assignment) return callback({ code: grpc.status.NOT_FOUND, message: 'Assignment not found' });
            if (String(assignment.organizationId) !== String(organization_id)) return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Assignment does not belong to this organization.' });
            if (String(assignment.employeeId) !== String(employee_id)) return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Assignment does not belong to this employee.' });
            if (String(assignment.documentTypeId) !== String(document_type_id)) return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Assignment does not reference this document type.' });

            const employee = await prisma.organizationEmployees.findFirst({ where: { id: employee_id, deletedAt: null } });
            if (!employee) return callback({ code: grpc.status.NOT_FOUND, message: 'Employee not found' });
            if (String(employee.organizationId) !== String(organization_id)) return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Employee does not belong to this organization.' });

            const type = await prisma.employeeDocumentType.findFirst({ where: { id: document_type_id, deletedAt: null } });
            if (!type) { return callback({ code: grpc.status.NOT_FOUND, message: 'Document type not found' }); }
            const folder = await prisma.employeeDocumentFolder.findFirst({ where: { id: type.folderId, deletedAt: null } });
            if (!folder) return callback({ code: grpc.status.NOT_FOUND, message: 'Document folder not found' });
            if (String(folder.organizationId) !== String(organization_id)) return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Document type does not belong to this organization.' });

            // --- Single-type duplicate protection (only for non-multiple) ---
            if (!type.isMultiple) {
                const activeSub = await prisma.employeeDocumentSubmission.findFirst({
                    where: { assignmentId: assignment_id, deletedAt: null, status: { in: ['PENDING_VERIFICATION', 'PENDING', 'VERIFIED'] } },
                });
                if (activeSub) return callback({ code: grpc.status.ALREADY_EXISTS, message: 'This document has already been submitted and is awaiting review.' });
            }

            // --- Enforce document-level mandatory via N/A logic ---
            if (type.isMandatory && !isNA && !data.file_buffer?.length && !data.field_values) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'At least a file or field values are required for this mandatory document.' });
            }

            // --- Expiry validation ---
            if (type.askExpiryDate && !data.expiry_date) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Expiry date is required for this document.' });
            }

            // --- File upload (if provided / enabled) ---
            let fileId = null, storageKey = null, fileName = null, fileType = null;
            if (data.file_buffer?.length) {
                const buf = Buffer.from(data.file_buffer);
                const { mime, size } = validateFile({ buffer: buf, fileName: data.file_name || 'document', mimeType: data.file_type || undefined });
                const safeName = String(data.file_name || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
                const storePath = `organizations/${organization_id}/employee-documents`;
                storageKey = `${storePath}/${Date.now()}_${safeName}`;
                await storageService.upload(buf, { storageKey, contentType: mime });
                const fileRow = await prisma.files.create({
                    data: {
                        folderId: null,
                        fileType: mime,
                        storageKey,
                        fileName: data.file_name || 'document',
                        fileSize: size,
                        addedById: submitted_by_id || employee_id,
                        organizationId: organization_id,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        deletedAt: null,
                    },
                });
                fileId = fileRow.id;
                fileType = mime;
                fileName = data.file_name || 'document';
            } else if (type.isFileUploadEnabled && !isNA) {
                // If file upload is enabled but no file was provided and there are no fields, reject.
                if (!data.field_values || data.field_values === '{}') {
                    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'A file is required for this document.' });
                }
            }

            // Parse field_values from JSON string
            let fieldValues = null;
            if (data.field_values && data.field_values !== '') {
                try { fieldValues = JSON.parse(data.field_values); } catch (e) { return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'field_values must be valid JSON.' }); }
            }

            const submission = await prisma.employeeDocumentSubmission.create({
                data: {
                    organizationId: organization_id,
                    assignmentId: assignment_id,
                    employeeId: employee_id,
                    documentTypeId: document_type_id,
                    fileId,
                    storageKey,
                    fileName,
                    fileType,
                    fieldValues,
                    isNA,
                    status: 'PENDING_VERIFICATION',
                    submittedById: isObjectId(submitted_by_id) ? submitted_by_id : null,
                    submittedAt: new Date(),
                    expiryDate,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
            });

            callback(null, { submission: mapSubmission(await enrichSubmission(submission)), message: 'Document submitted successfully', success: true });
        } catch (e) {
            if (e instanceof ValidationError) return callback({ code: grpc.status.INVALID_ARGUMENT, message: e.message });
            if (e.code) return callback({ code: e.code, message: e.message });
            console.error('SubmitDocument Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetSubmission: async (call, callback) => {
        try {
            const { organization_id, submission_id } = call.request;
            if (!isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });
            if (!isObjectId(submission_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid submission id' });
            const submission = await prisma.employeeDocumentSubmission.findFirst({ where: { id: submission_id, deletedAt: null } });
            if (!submission) return callback({ code: grpc.status.NOT_FOUND, message: 'Submission not found' });
            if (String(submission.organizationId) !== String(organization_id)) return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Submission does not belong to this organization.' });
            callback(null, { submission: mapSubmission(await enrichSubmission(submission)), message: 'Submission found', success: true });
        } catch (e) {
            if (e.code) return callback({ code: e.code, message: e.message });
            console.error('GetSubmission Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListEmployeeSubmissions: async (call, callback) => {
        try {
            const { organization_id, employee_id, page = 1, limit = 10 } = call.request;
            if (!isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });
            if (!isObjectId(employee_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid employee id' });
            const employee = await prisma.organizationEmployees.findFirst({ where: { id: employee_id, deletedAt: null } });
            if (!employee) return callback({ code: grpc.status.NOT_FOUND, message: 'Employee not found' });
            if (String(employee.organizationId) !== String(organization_id)) return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Employee does not belong to this organization.' });
            const skip = (page - 1) * limit;
            const where = { employeeId: employee_id, organizationId: organization_id, deletedAt: null };
            const total = await prisma.employeeDocumentSubmission.count({ where });
            const submissions = await prisma.employeeDocumentSubmission.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit });
            const enriched = [];
            for (const s of submissions) enriched.push(await enrichSubmission(s));
            callback(null, { submissions: enriched.map(mapSubmission), total, page, limit, total_pages: Math.ceil(total / limit), success: true, message: 'Submissions found' });
        } catch (e) {
            console.error('ListEmployeeSubmissions Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListAssignmentSubmissions: async (call, callback) => {
        try {
            const { organization_id, assignment_id } = call.request;
            if (!isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });
            if (!isObjectId(assignment_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid assignment id' });
            const assignment = await prisma.employeeDocumentAssignment.findFirst({ where: { id: assignment_id, deletedAt: null } });
            if (!assignment) return callback({ code: grpc.status.NOT_FOUND, message: 'Assignment not found' });
            if (String(assignment.organizationId) !== String(organization_id)) return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Assignment does not belong to this organization.' });
            const submissions = await prisma.employeeDocumentSubmission.findMany({ where: { assignmentId: assignment_id, organizationId: organization_id, deletedAt: null }, orderBy: { createdAt: 'desc' } });
            const enriched = [];
            for (const s of submissions) enriched.push(await enrichSubmission(s));
            callback(null, { submissions: enriched.map(mapSubmission), total: enriched.length, success: true, message: 'Submissions found' });
        } catch (e) {
            console.error('ListAssignmentSubmissions Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeleteSubmission: async (call, callback) => {
        try {
            const { organization_id, submission_id } = call.request;
            if (!isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });
            if (!isObjectId(submission_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid submission id' });
            const submission = await prisma.employeeDocumentSubmission.findFirst({ where: { id: submission_id, deletedAt: null } });
            if (!submission) return callback({ code: grpc.status.NOT_FOUND, message: 'Submission not found' });
            if (String(submission.organizationId) !== String(organization_id)) return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Submission does not belong to this organization.' });
            // Soft-delete only; do not destroy file evidence.
            await prisma.employeeDocumentSubmission.update({ where: { id: submission_id }, data: { deletedAt: new Date(), updatedAt: new Date() } });
            callback(null, { success: true, message: 'Submission removed (soft-deleted)' });
        } catch (e) {
            if (e.code) return callback({ code: e.code, message: e.message });
            console.error('DeleteSubmission Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListPendingVerificationDocuments: async (call, callback) => {
        try {
            const { organization_id, page = 1, limit = 10, search = '', sort_by = 'submitted_at', sort_order = 'desc', employee_id, folder_id, document_type_id } = call.request;
            if (!organization_id) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id is required.' });
            if (!isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });

            // Active submissions with status PENDING_VERIFICATION (NOT assignment status).
            const where = { organizationId: organization_id, deletedAt: null, status: 'PENDING_VERIFICATION' };
            if (employee_id && isObjectId(employee_id)) where.employeeId = employee_id;
            if (document_type_id && isObjectId(document_type_id)) where.documentTypeId = document_type_id;

            const submissions = await prisma.employeeDocumentSubmission.findMany({
                where,
                include: {
                    documentType: { include: { folder: true } },
                    employee: { include: { designation: true, departmentAssignments: { where: { deletedAt: null }, include: { department: true } } } },
                },
                orderBy: { createdAt: 'desc' },
            });

            // Validate org chain on type/folder; apply folder filter.
            let pending = submissions.filter(s => {
                const t = s.documentType;
                if (!t || t.deletedAt) return false;
                const f = t.folder;
                if (!f || f.deletedAt) return false;
                if (String(f.organizationId) !== String(organization_id)) return false;
                return true;
            });
            if (folder_id && isObjectId(folder_id)) {
                pending = pending.filter(s => String(s.documentType?.folderId) === String(folder_id));
            }

            // Search: employee name/code/email + type + folder
            if (search) {
                const q = search.toLowerCase();
                pending = pending.filter(s => {
                    const emp = s.employee;
                    const t = s.documentType;
                    const f = t?.folder;
                    return (
                        (emp?.fullName || '').toLowerCase().includes(q) ||
                        (emp?.employeeCode || '').toLowerCase().includes(q) ||
                        (emp?.email || '').toLowerCase().includes(q) ||
                        (t?.name || '').toLowerCase().includes(q) ||
                        (f?.name || '').toLowerCase().includes(q)
                    );
                });
            }

            // Sort
            const dir = sort_order.toLowerCase() === 'asc' ? 1 : -1;
            if (sort_by === 'employee_name') {
                pending.sort((a, b) => String(a.employee?.fullName || '').localeCompare(String(b.employee?.fullName || '')) * dir);
            } else if (sort_by === 'document_type_name') {
                pending.sort((a, b) => String(a.documentType?.name || '').localeCompare(String(b.documentType?.name || '')) * dir);
            } else {
                const field = sort_by === 'submitted_at' ? 'submittedAt' : 'createdAt';
                pending.sort((a, b) => ((a[field] ? new Date(a[field]).getTime() : 0) - (b[field] ? new Date(b[field]).getTime() : 0)) * dir);
            }

            const total = pending.length;
            const uniqueEmployees = new Set(pending.map(s => s.employeeId));
            const skip = (page - 1) * limit;
            const pageRows = pending.slice(skip, skip + limit);
            const enrichedRows = [];
            for (const s of pageRows) enrichedRows.push(await enrichSubmission(s));

            callback(null, {
                pending_verification_documents: enrichedRows.map(mapPendingVerificationDocument),
                total,
                page,
                limit,
                total_pages: Math.ceil(total / limit),
                total_pending_verification_employees: uniqueEmployees.size,
                total_pending_verification_documents: total,
                success: true,
                message: 'Pending verification documents found',
            });
        } catch (e) {
            console.error('ListPendingVerificationDocuments Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    VerifySubmission: async (call, callback) => {
        try {
            const { organization_id, submission_id, verified_by_id } = call.request;
            const chain = await getReviewableSubmission(organization_id, submission_id, { statuses: ['PENDING_VERIFICATION'], action: 'verify' });
            if (chain.error) return callback({ code: chain.error.code, message: chain.error.message });
            const updated = await prisma.employeeDocumentSubmission.update({
                where: { id: submission_id },
                data: { status: 'VERIFIED', verifiedAt: new Date(), verifiedById: isObjectId(verified_by_id) ? verified_by_id : chain.submission.verifiedById, updatedAt: new Date() },
            });

            // Rule #4/#10: when a renewal submission is VERIFIED, mark the previously-current
            // VERIFIED submission (same assignment) as replaced by this one.
            // Only a current (non-replaced, non-deleted) VERIFIED predecessor is superseded;
            // rejected/interim submissions are left untouched.
            const predecessor = await prisma.employeeDocumentSubmission.findFirst({
                where: {
                    assignmentId: chain.submission.assignmentId,
                    id: { not: submission_id },
                    status: 'VERIFIED',
                    deletedAt: null,
                    replacedBySubmissionId: { isSet: false },
                },
            });
            if (predecessor) {
                await prisma.employeeDocumentSubmission.update({
                    where: { id: predecessor.id },
                    data: { replacedBySubmissionId: submission_id, updatedAt: new Date() },
                });
            }

            callback(null, { submission: mapSubmission(await enrichSubmission(updated)), message: 'Document verified successfully', success: true });
        } catch (e) {
            if (e.code) return callback({ code: e.code, message: e.message });
            console.error('VerifySubmission Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    RejectSubmission: async (call, callback) => {
        try {
            const { organization_id, submission_id, rejection_reason, rejected_by_id } = call.request;
            const reason = (rejection_reason || '').trim();
            if (!reason) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Rejection reason is required.' });
            const chain = await getReviewableSubmission(organization_id, submission_id, { statuses: ['PENDING_VERIFICATION'], action: 'reject' });
            if (chain.error) return callback({ code: chain.error.code, message: chain.error.message });
            const updated = await prisma.employeeDocumentSubmission.update({
                where: { id: submission_id },
                data: { status: 'REJECTED', rejectionReason: reason, rejectedAt: new Date(), rejectedById: isObjectId(rejected_by_id) ? rejected_by_id : chain.submission.rejectedById, updatedAt: new Date() },
            });
            callback(null, { submission: mapSubmission(await enrichSubmission(updated)), message: 'Document rejected successfully', success: true });
        } catch (e) {
            if (e.code) return callback({ code: e.code, message: e.message });
            console.error('RejectSubmission Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListVerifiedDocuments: async (call, callback) => {
        try {
            const { organization_id, page = 1, limit = 10, search = '', sort_by = 'verified_at', sort_order = 'desc', employee_id, folder_id, document_type_id } = call.request;
            if (!organization_id) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id is required.' });
            if (!isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });

            // Active VERIFIED submissions (source of truth = submission status, not assignment).
            // Rule #14: "current" view = VERIFIED, not deleted, not replaced.
            const where = { organizationId: organization_id, deletedAt: null, status: 'VERIFIED', replacedBySubmissionId: { isSet: false } };
            if (employee_id && isObjectId(employee_id)) where.employeeId = employee_id;
            if (document_type_id && isObjectId(document_type_id)) where.documentTypeId = document_type_id;

            const submissions = await prisma.employeeDocumentSubmission.findMany({
                where,
                include: {
                    documentType: { include: { folder: true } },
                    employee: { include: { designation: true, departmentAssignments: { where: { deletedAt: null }, include: { department: true } } } },
                },
                orderBy: { createdAt: 'desc' },
            });

            // Org chain validation + folder filter.
            let verified = submissions.filter(s => {
                const t = s.documentType;
                if (!t || t.deletedAt) return false;
                const f = t.folder;
                if (!f || f.deletedAt) return false;
                if (String(f.organizationId) !== String(organization_id)) return false;
                return true;
            });
            if (folder_id && isObjectId(folder_id)) {
                verified = verified.filter(s => String(s.documentType?.folderId) === String(folder_id));
            }

            // Search: employee name/code/email + type + folder
            if (search) {
                const q = search.toLowerCase();
                verified = verified.filter(s => {
                    const emp = s.employee;
                    const t = s.documentType;
                    const f = t?.folder;
                    return (
                        (emp?.fullName || '').toLowerCase().includes(q) ||
                        (emp?.employeeCode || '').toLowerCase().includes(q) ||
                        (emp?.email || '').toLowerCase().includes(q) ||
                        (t?.name || '').toLowerCase().includes(q) ||
                        (f?.name || '').toLowerCase().includes(q)
                    );
                });
            }

            // Whitelisted sort
            const dir = sort_order.toLowerCase() === 'asc' ? 1 : -1;
            if (sort_by === 'employee_name') {
                verified.sort((a, b) => String(a.employee?.fullName || '').localeCompare(String(b.employee?.fullName || '')) * dir);
            } else if (sort_by === 'document_type_name') {
                verified.sort((a, b) => String(a.documentType?.name || '').localeCompare(String(b.documentType?.name || '')) * dir);
            } else {
                const field = { created_at: 'createdAt', submitted_at: 'submittedAt', verified_at: 'verifiedAt' }[sort_by] || 'verifiedAt';
                verified.sort((a, b) => ((a[field] ? new Date(a[field]).getTime() : 0) - (b[field] ? new Date(b[field]).getTime() : 0)) * dir);
            }

            const total = verified.length;
            const uniqueEmployees = new Set(verified.map(s => s.employeeId));
            const skip = (page - 1) * limit;
            const pageRows = verified.slice(skip, skip + limit);
            const enrichedRows = [];
            for (const s of pageRows) enrichedRows.push(await enrichSubmission(s));

            callback(null, {
                verified_documents: enrichedRows.map(mapVerifiedDocument),
                total,
                page,
                limit,
                total_pages: Math.ceil(total / limit),
                total_verified_employees: uniqueEmployees.size,
                total_verified_documents: total,
                success: true,
                message: 'Verified documents found',
            });
        } catch (e) {
            console.error('ListVerifiedDocuments Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListExpiringDocuments: async (call, callback) => {
        try {
            const { organization_id, page = 1, limit = 10, search = '', sort_by = 'expiry_date', sort_order = 'asc', employee_id, folder_id, document_type_id, days = 30 } = call.request;
            if (!organization_id) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id is required.' });
            if (!isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });

            const windowDays = Number(days);
            const effectiveWindow = Number.isFinite(windowDays) && windowDays > 0 ? windowDays : 30;

            const where = { organizationId: organization_id, deletedAt: null, status: 'VERIFIED', expiryDate: { not: null }, replacedBySubmissionId: { isSet: false } };
            if (employee_id && isObjectId(employee_id)) where.employeeId = employee_id;
            if (document_type_id && isObjectId(document_type_id)) where.documentTypeId = document_type_id;

            const submissions = await prisma.employeeDocumentSubmission.findMany({
                where,
                include: {
                    documentType: { include: { folder: true } },
                    employee: { include: { designation: true, departmentAssignments: { where: { deletedAt: null }, include: { department: true } } } },
                },
                orderBy: { createdAt: 'desc' },
            });

            // Org chain validation + folder filter.
            let expiring = submissions.filter(s => {
                const t = s.documentType;
                if (!t || t.deletedAt) return false;
                const f = t.folder;
                if (!f || f.deletedAt) return false;
                if (String(f.organizationId) !== String(organization_id)) return false;
                return true;
            });
            if (folder_id && isObjectId(folder_id)) {
                expiring = expiring.filter(s => String(s.documentType?.folderId) === String(folder_id));
            }

            // Expiry window: include documents with expiryDate <= today + window (includes already-expired).
            // Use a date-only comparison to avoid timezone drift (expiry is a date, not a timestamp).
            const today = new Date();
            const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
            const cutoff = new Date(todayDate.getTime() + effectiveWindow * 24 * 60 * 60 * 1000);
            expiring = expiring.filter(s => {
                if (!s.expiryDate) return false;
                const exp = new Date(Date.UTC(s.expiryDate.getUTCFullYear(), s.expiryDate.getUTCMonth(), s.expiryDate.getUTCDate()));
                return exp.getTime() <= cutoff.getTime();
            });

            // Search: employee name/code/email + type + folder
            if (search) {
                const q = search.toLowerCase();
                expiring = expiring.filter(s => {
                    const emp = s.employee;
                    const t = s.documentType;
                    const f = t?.folder;
                    return (
                        (emp?.fullName || '').toLowerCase().includes(q) ||
                        (emp?.employeeCode || '').toLowerCase().includes(q) ||
                        (emp?.email || '').toLowerCase().includes(q) ||
                        (t?.name || '').toLowerCase().includes(q) ||
                        (f?.name || '').toLowerCase().includes(q)
                    );
                });
            }

            // Whitelisted sort
            const dir = sort_order.toLowerCase() === 'asc' ? 1 : -1;
            if (sort_by === 'employee_name') {
                expiring.sort((a, b) => String(a.employee?.fullName || '').localeCompare(String(b.employee?.fullName || '')) * dir);
            } else if (sort_by === 'document_type_name') {
                expiring.sort((a, b) => String(a.documentType?.name || '').localeCompare(String(b.documentType?.name || '')) * dir);
            } else {
                const field = { expiry_date: 'expiryDate', submitted_at: 'submittedAt', verified_at: 'verifiedAt' }[sort_by] || 'expiryDate';
                expiring.sort((a, b) => ((a[field] ? new Date(a[field]).getTime() : 0) - (b[field] ? new Date(b[field]).getTime() : 0)) * dir);
            }

            const total = expiring.length;
            const uniqueEmployees = new Set(expiring.map(s => s.employeeId));
            const skip = (page - 1) * limit;
            const pageRows = expiring.slice(skip, skip + limit);
            const enrichedRows = [];
            for (const s of pageRows) enrichedRows.push(await enrichSubmission(s));

            callback(null, {
                expiring_documents: enrichedRows.map(s => mapExpiringDocument(s, todayDate)),
                total,
                page,
                limit,
                total_pages: Math.ceil(total / limit),
                total_expiring_employees: uniqueEmployees.size,
                total_expiring_documents: total,
                success: true,
                message: 'Expiring documents found',
            });
        } catch (e) {
            console.error('ListExpiringDocuments Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    RenewDocument: async (call, callback) => {
        let uploadedStorageKey = null;
        try {
            const data = call.request;
            const { organization_id, submission_id, submitted_by_id } = data;
            if (!organization_id || !isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });
            if (!isObjectId(submission_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid submission id' });

            const isNA = Boolean(data.is_na);
            const expiryDate = data.expiry_date ? new Date(data.expiry_date) : null;

            // --- Load target submission + eligibility ---
            const existing = await prisma.employeeDocumentSubmission.findFirst({ where: { id: submission_id, deletedAt: null } });
            if (!existing) return callback({ code: grpc.status.NOT_FOUND, message: 'Submission not found' });
            if (String(existing.organizationId) !== String(organization_id)) return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Submission does not belong to this organization.' });
            if (existing.status !== 'VERIFIED') return callback({ code: grpc.status.FAILED_PRECONDITION, message: `Only verified documents can be renewed (current status: '${existing.status}').` });

            // --- Derive employee/assignment/type from the existing submission (never trust client) ---
            const assignment = await prisma.employeeDocumentAssignment.findFirst({ where: { id: existing.assignmentId, deletedAt: null } });
            if (!assignment) return callback({ code: grpc.status.NOT_FOUND, message: 'Assignment not found' });
            if (String(assignment.organizationId) !== String(organization_id)) return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Assignment does not belong to this organization.' });

            const employee = await prisma.organizationEmployees.findFirst({ where: { id: existing.employeeId, deletedAt: null } });
            if (!employee) return callback({ code: grpc.status.NOT_FOUND, message: 'Employee not found' });
            if (String(employee.organizationId) !== String(organization_id)) return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Employee does not belong to this organization.' });

            const type = await prisma.employeeDocumentType.findFirst({ where: { id: existing.documentTypeId, deletedAt: null } });
            if (!type) return callback({ code: grpc.status.NOT_FOUND, message: 'Document type not found' });
            if (!type.isActive) return callback({ code: grpc.status.FAILED_PRECONDITION, message: `Document type '${type.name}' is not active.` });
            const folder = await prisma.employeeDocumentFolder.findFirst({ where: { id: type.folderId, deletedAt: null } });
            if (!folder) return callback({ code: grpc.status.NOT_FOUND, message: 'Document folder not found' });
            if (!folder.isActive) return callback({ code: grpc.status.FAILED_PRECONDITION, message: `Document folder '${folder.name}' is not active.` });
            if (String(folder.organizationId) !== String(organization_id)) return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Document type does not belong to this organization.' });

            // --- Expiry validation (config-driven) ---
            if (type.askExpiryDate && !data.expiry_date) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Expiry date is required for this document.' });
            }

            // --- Rule #8: concurrent-renewal guard for single-document types ---
            // Prevent multiple PENDING_VERIFICATION renewal submissions for the same assignment
            // when the document type does not allow multiple documents.
            if (!type.isMultiple) {
                const pendingRenewal = await prisma.employeeDocumentSubmission.findFirst({
                    where: {
                        assignmentId: existing.assignmentId,
                        id: { not: submission_id },
                        status: 'PENDING_VERIFICATION',
                        deletedAt: null,
                    },
                });
                if (pendingRenewal) {
                    return callback({ code: grpc.status.FAILED_PRECONDITION, message: 'This document already has a renewal awaiting verification.' });
                }
            }

            // --- New file upload (reuse Phase 6 storage pattern) ---
            let fileId = null, storageKey = null, fileName = null, fileType = null;
            if (data.file_buffer?.length) {
                const buf = Buffer.from(data.file_buffer);
                const { mime, size } = validateFile({ buffer: buf, fileName: data.file_name || 'document', mimeType: data.file_type || undefined });
                const safeName = String(data.file_name || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
                const storePath = `organizations/${organization_id}/employee-documents`;
                storageKey = `${storePath}/${Date.now()}_${safeName}`;
                uploadedStorageKey = storageKey;
                await storageService.upload(buf, { storageKey, contentType: mime });
                const fileRow = await prisma.files.create({
                    data: {
                        folderId: null,
                        fileType: mime,
                        storageKey,
                        fileName: data.file_name || 'document',
                        fileSize: size,
                        addedById: submitted_by_id || existing.employeeId,
                        organizationId: organization_id,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        deletedAt: null,
                    },
                });
                fileId = fileRow.id;
                fileType = mime;
                fileName = data.file_name || 'document';
            } else if (type.isFileUploadEnabled && !isNA) {
                if (!data.field_values || data.field_values === '{}') {
                    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'A file is required for this document.' });
                }
            }

            // Parse field_values
            let fieldValues = null;
            if (data.field_values && data.field_values !== '') {
                try { fieldValues = JSON.parse(data.field_values); } catch (e) { return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'field_values must be valid JSON.' }); }
            }

            // --- Create NEW submission under the SAME assignment (preserves history) ---
            const submission = await prisma.employeeDocumentSubmission.create({
                data: {
                    organizationId: organization_id,
                    assignmentId: existing.assignmentId,
                    employeeId: existing.employeeId,
                    documentTypeId: existing.documentTypeId,
                    fileId,
                    storageKey,
                    fileName,
                    fileType,
                    fieldValues,
                    isNA,
                    status: 'PENDING_VERIFICATION',
                    submittedById: isObjectId(submitted_by_id) ? submitted_by_id : existing.submittedById,
                    submittedAt: new Date(),
                    expiryDate,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
            });

            // Old submission is intentionally NOT modified (remains VERIFIED + historical).

            callback(null, { submission: mapSubmission(await enrichSubmission(submission)), message: 'Document renewed — new submission created and awaiting verification', success: true });
        } catch (e) {
            // Clean up orphaned uploaded file if submission creation failed after upload.
            if (uploadedStorageKey && e) {
                try { await storageService.delete(uploadedStorageKey); } catch (_) { }
            }
            if (e instanceof ValidationError) return callback({ code: grpc.status.INVALID_ARGUMENT, message: e.message });
            if (e.code) return callback({ code: e.code, message: e.message });
            console.error('RenewDocument Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },
};

// Validate ownership chain: organization -> folder -> document type -> field scope (field-level checked separately)
async function assertFieldOwnership(organization_id, document_type_id) {
    if (!isObjectId(organization_id)) return { error: { code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' } };
    const type = await prisma.employeeDocumentType.findFirst({ where: { id: document_type_id, deletedAt: null } });
    if (!type) return { error: { code: grpc.status.NOT_FOUND, message: 'Document type not found' } };
    const folder = await prisma.employeeDocumentFolder.findFirst({ where: { id: type.folderId, deletedAt: null } });
    if (!folder) return { error: { code: grpc.status.NOT_FOUND, message: 'Document folder not found' } };
    if (String(folder.organizationId) !== String(organization_id)) {
        return { error: { code: grpc.status.PERMISSION_DENIED, message: 'Document folder does not belong to this organization.' } };
    }
    return { type, folder };
}

// Assignment mapper for enriched (list/employee) responses
function mapAssignmentWithType(a) {
    const t = a.documentType || {};
    const f = t.folder || {};
    return {
        id: a.id ?? '',
        organization_id: a.organizationId ?? '',
        employee_id: a.employeeId ?? '',
        document_type_id: a.documentTypeId ?? a.id ?? '',
        assigned_by_id: a.assignedById ?? '',
        assigned_at: a.assignedAt ? a.assignedAt.toISOString() : '',
        status: a.status ?? 'PENDING',
        created_at: a.createdAt ? a.createdAt.toISOString() : '',
        updated_at: a.updatedAt ? a.updatedAt.toISOString() : '',
        employee_name: '',
        employee_code: '',
        department: '',
        designation: '',
        document_type_name: t.name ?? '',
        folder_id: f.id ?? '',
        folder_name: f.name ?? '',
        document_is_mandatory: !!t.isMandatory,
        document_is_multiple: !!t.isMultiple,
        document_is_verification_required: !!t.isVerificationRequired,
    };
}

// Pending-on-employee mapper (assignment + type + folder + employee enriched)
function mapPendingDocument(a) {
    const emp = a.employee || {};
    const t = a.documentType || {};
    const f = t.folder || {};
    return {
        assignment_id: a.id ?? '',
        employee_id: emp.id ?? a.employeeId ?? '',
        employee_name: emp.fullName ?? '',
        employee_code: emp.employeeCode ?? '',
        designation: emp.designation?.name ?? '',
        department: emp.departmentAssignments?.[0]?.department?.name ?? '',
        folder_id: f.id ?? '',
        folder_name: f.name ?? '',
        document_type_id: t.id ?? a.documentTypeId ?? '',
        document_type_name: t.name ?? '',
        document_is_mandatory: !!t.isMandatory,
        document_is_multiple: !!t.isMultiple,
        document_is_appliable_na: !!t.isAppliableNA,
        document_is_verification_required: !!t.isVerificationRequired,
        document_ask_expiry_date: !!t.askExpiryDate,
        assignment_status: a.status ?? 'PENDING',
        assigned_at: a.assignedAt ? a.assignedAt.toISOString() : '',
        assigned_by_id: a.assignedById ?? '',
    };
}

// Submission enrichment: resolve employee, type, folder, submitter, verifier, fields
async function enrichSubmission(s) {
    const sWith = { ...s };
    try {
        const [employee, type, submitter, verifier] = await Promise.all([
            prisma.organizationEmployees.findFirst({ where: { id: s.employeeId, deletedAt: null } }),
            prisma.employeeDocumentType.findFirst({ where: { id: s.documentTypeId, deletedAt: null }, include: { folder: true, fields: { where: { deletedAt: null }, orderBy: { displayOrder: 'asc' } } } }),
            s.submittedById ? prisma.organizationEmployees.findFirst({ where: { id: s.submittedById, deletedAt: null } }) : Promise.resolve(null),
            s.verifiedById ? prisma.organizationEmployees.findFirst({ where: { id: s.verifiedById, deletedAt: null } }) : Promise.resolve(null),
        ]);
        sWith._employee = employee || null;
        sWith._type = type || null;
        sWith._submittedBy = submitter || null;
        sWith._verifiedBy = verifier || null;
    } catch (e) { /* enrichment is best-effort */ }
    return sWith;
}

function mapSubmission(s = {}) {
    const emp = s._employee || {};
    const t = s._type || {};
    const f = t.folder || {};
    const sub = s._submittedBy || {};
    return {
        id: s.id ?? '',
        organization_id: s.organizationId ?? '',
        assignment_id: s.assignmentId ?? '',
        employee_id: s.employeeId ?? '',
        document_type_id: s.documentTypeId ?? '',
        file_id: s.fileId ?? '',
        storage_key: s.storageKey ?? '',
        file_name: s.fileName ?? '',
        file_type: s.fileType ?? '',
        file_url: s.fileId ? `/file/${s.fileId}` : '',
        field_values: s.fieldValues ? JSON.stringify(s.fieldValues) : '',
        is_na: !!s.isNA,
        status: s.status ?? 'PENDING_VERIFICATION',
        submitted_by_id: s.submittedById ?? '',
        submitted_at: s.submittedAt ? s.submittedAt.toISOString() : '',
        expiry_date: s.expiryDate ? s.expiryDate.toISOString() : '',
        created_at: s.createdAt ? s.createdAt.toISOString() : '',
        updated_at: s.updatedAt ? s.updatedAt.toISOString() : '',
        verified_by_id: s.verifiedById ?? '',
        verified_at: s.verifiedAt ? s.verifiedAt.toISOString() : '',
        rejected_by_id: s.rejectedById ?? '',
        rejected_at: s.rejectedAt ? s.rejectedAt.toISOString() : '',
        rejection_reason: s.rejectionReason ?? '',
        replaced_by_submission_id: s.replacedBySubmissionId ?? '',
        is_current: (s.status === 'VERIFIED') && !s.deletedAt && !s.replacedBySubmissionId,
        verified_by_name: (s._verifiedBy || {}).fullName ?? '',
        employee_name: emp.fullName ?? '',
        employee_code: emp.employeeCode ?? '',
        document_type_name: t.name ?? '',
        folder_id: f.id ?? '',
        folder_name: f.name ?? '',
        submitted_by_name: sub.fullName ?? '',
        fields: (t.fields || []).map(mapDocumentField),
    };
}

// Pending-verification mapper (submission + employee + type + folder enriched)
function mapPendingVerificationDocument(s = {}) {
    const emp = s.employee || {};
    const t = s.documentType || {};
    const f = t.folder || {};
    const sub = s._submittedBy || {};
    return {
        submission_id: s.id ?? '',
        assignment_id: s.assignmentId ?? '',
        employee_id: s.employeeId ?? '',
        employee_name: emp.fullName ?? '',
        employee_code: emp.employeeCode ?? '',
        designation: emp.designation?.name ?? '',
        department: emp.departmentAssignments?.[0]?.department?.name ?? '',
        folder_id: f.id ?? '',
        folder_name: f.name ?? '',
        document_type_id: t.id ?? s.documentTypeId ?? '',
        document_type_name: t.name ?? '',
        status: s.status ?? 'PENDING_VERIFICATION',
        submitted_at: s.submittedAt ? s.submittedAt.toISOString() : '',
        submitted_by_id: s.submittedById ?? '',
        submitted_by_name: sub.fullName ?? '',
        file_id: s.fileId ?? '',
        file_name: s.fileName ?? '',
        file_type: s.fileType ?? '',
        file_url: s.fileId ? `/file/${s.fileId}` : '',
        field_values: s.fieldValues ? JSON.stringify(s.fieldValues) : '',
        is_na: !!s.isNA,
        expiry_date: s.expiryDate ? s.expiryDate.toISOString() : '',
        document_ask_expiry_date: !!t.askExpiryDate,
        replaced_by_submission_id: s.replacedBySubmissionId ?? '',
        is_current: false,
    };
}

// Verified-document mapper (submission + employee + type + folder enriched, incl. verifier)
function mapVerifiedDocument(s = {}) {
    const emp = s.employee || {};
    const t = s.documentType || {};
    const f = t.folder || {};
    const sub = s._submittedBy || {};
    return {
        submission_id: s.id ?? '',
        assignment_id: s.assignmentId ?? '',
        employee_id: s.employeeId ?? '',
        employee_name: emp.fullName ?? '',
        employee_code: emp.employeeCode ?? '',
        designation: emp.designation?.name ?? '',
        department: emp.departmentAssignments?.[0]?.department?.name ?? '',
        folder_id: f.id ?? '',
        folder_name: f.name ?? '',
        document_type_id: t.id ?? s.documentTypeId ?? '',
        document_type_name: t.name ?? '',
        status: s.status ?? 'VERIFIED',
        submitted_at: s.submittedAt ? s.submittedAt.toISOString() : '',
        submitted_by_id: s.submittedById ?? '',
        submitted_by_name: sub.fullName ?? '',
        verified_at: s.verifiedAt ? s.verifiedAt.toISOString() : '',
        verified_by_id: s.verifiedById ?? '',
        verified_by_name: (s._verifiedBy || {}).fullName ?? '',
        file_id: s.fileId ?? '',
        file_name: s.fileName ?? '',
        file_type: s.fileType ?? '',
        file_url: s.fileId ? `/file/${s.fileId}` : '',
        field_values: s.fieldValues ? JSON.stringify(s.fieldValues) : '',
        is_na: !!s.isNA,
        expiry_date: s.expiryDate ? s.expiryDate.toISOString() : '',
        document_is_multiple: !!t.isMultiple,
        submission_count: 1,
        replaced_by_submission_id: s.replacedBySubmissionId ?? '',
        is_current: !s.deletedAt && !s.replacedBySubmissionId,
    };
}

// Expiring-document mapper (submission + employee + type + folder enriched, incl. days left)
function mapExpiringDocument(s = {}, todayDate) {
    const emp = s.employee || {};
    const t = s.documentType || {};
    const f = t.folder || {};
    const sub = s._submittedBy || {};
    const today = todayDate ? todayDate.getTime() : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())).getTime();
    let daysLeft = null;
    let expiryState = 'UPCOMING';
    if (s.expiryDate) {
        const exp = new Date(Date.UTC(s.expiryDate.getUTCFullYear(), s.expiryDate.getUTCMonth(), s.expiryDate.getUTCDate()));
        const diffMs = exp.getTime() - today;
        daysLeft = Math.round(diffMs / (24 * 60 * 60 * 1000));
        if (daysLeft < 0) expiryState = 'EXPIRED';
        else if (daysLeft === 0) expiryState = 'TODAY';
        else expiryState = 'UPCOMING';
    }
    return {
        submission_id: s.id ?? '',
        assignment_id: s.assignmentId ?? '',
        employee_id: s.employeeId ?? '',
        employee_name: emp.fullName ?? '',
        employee_code: emp.employeeCode ?? '',
        designation: emp.designation?.name ?? '',
        department: emp.departmentAssignments?.[0]?.department?.name ?? '',
        folder_id: f.id ?? '',
        folder_name: f.name ?? '',
        document_type_id: t.id ?? s.documentTypeId ?? '',
        document_type_name: t.name ?? '',
        status: s.status ?? 'VERIFIED',
        submitted_at: s.submittedAt ? s.submittedAt.toISOString() : '',
        submitted_by_id: s.submittedById ?? '',
        submitted_by_name: sub.fullName ?? '',
        verified_at: s.verifiedAt ? s.verifiedAt.toISOString() : '',
        verified_by_id: s.verifiedById ?? '',
        verified_by_name: (s._verifiedBy || {}).fullName ?? '',
        file_id: s.fileId ?? '',
        file_name: s.fileName ?? '',
        file_type: s.fileType ?? '',
        file_url: s.fileId ? `/file/${s.fileId}` : '',
        field_values: s.fieldValues ? JSON.stringify(s.fieldValues) : '',
        is_na: !!s.isNA,
        expiry_date: s.expiryDate ? s.expiryDate.toISOString() : '',
        days_left: daysLeft,
        expiry_state: expiryState,
        document_is_multiple: !!t.isMultiple,
        replaced_by_submission_id: s.replacedBySubmissionId ?? '',
        is_current: !s.deletedAt && !s.replacedBySubmissionId,
    };
}

// Validate a submission is reviewable: exists, belongs to org, not deleted, and in the allowed statuses.
async function getReviewableSubmission(organization_id, submission_id, { statuses = ['PENDING_VERIFICATION'], action = 'review' } = {}) {
    if (!isObjectId(organization_id)) return { error: { code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' } };
    if (!isObjectId(submission_id)) return { error: { code: grpc.status.INVALID_ARGUMENT, message: 'Invalid submission id' } };
    const submission = await prisma.employeeDocumentSubmission.findFirst({ where: { id: submission_id, deletedAt: null } });
    if (!submission) return { error: { code: grpc.status.NOT_FOUND, message: 'Submission not found' } };
    if (String(submission.organizationId) !== String(organization_id)) return { error: { code: grpc.status.PERMISSION_DENIED, message: 'Submission does not belong to this organization.' } };
    if (!statuses.includes(submission.status)) {
        return { error: { code: grpc.status.FAILED_PRECONDITION, message: `Cannot ${action} a submission with status '${submission.status}'.` } };
    }
    return { submission };
}

// Assignment mapper for document-type listing (employee records provided)
function mapAssignment(a, document_type_id, organization_id, e) {
    const emp = e || {};
    return {
        id: a?.id ?? '',
        organization_id: organization_id ?? a?.organizationId ?? '',
        employee_id: emp.id ?? a?.employeeId ?? '',
        document_type_id: document_type_id ?? a?.documentTypeId ?? '',
        assigned_by_id: a?.assignedById ?? '',
        assigned_at: a?.assignedAt ? a.assignedAt.toISOString() : '',
        status: a?.status ?? 'PENDING',
        created_at: a?.createdAt ? a.createdAt.toISOString() : '',
        updated_at: a?.updatedAt ? a.updatedAt.toISOString() : '',
        employee_name: emp.fullName ?? '',
        employee_code: emp.employeeCode ?? '',
        department: emp.departmentAssignments?.[0]?.department?.name ?? '',
        designation: emp.designation?.name ?? '',
        document_type_name: '',
        folder_id: '',
        folder_name: '',
        document_is_mandatory: false,
        document_is_multiple: false,
        document_is_verification_required: false,
    };
}

// Core assign/unassign record logic respecting the @unique([employeeId, documentTypeId]) soft-delete caveat.
// If an ACTIVE assignment exists -> return ALREADY_EXISTS. If a soft-deleted one exists -> reactivate it.
async function assignDocumentRecord({ organization_id, employee_id, document_type_id, assigned_by_id, isBulk = false }) {
    if (!isObjectId(organization_id)) return { error: { code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' } };
    if (!isObjectId(employee_id)) return { error: { code: grpc.status.INVALID_ARGUMENT, message: 'Invalid employee id' } };
    if (!isObjectId(document_type_id)) return { error: { code: grpc.status.INVALID_ARGUMENT, message: 'Invalid document type id' } };

    // 1. Employee must exist & belong to org
    const employee = await prisma.organizationEmployees.findFirst({ where: { id: employee_id, deletedAt: null } });
    if (!employee) return { error: { code: grpc.status.NOT_FOUND, message: 'Employee not found' } };
    if (String(employee.organizationId) !== String(organization_id)) {
        return { error: { code: grpc.status.PERMISSION_DENIED, message: 'Employee does not belong to this organization.' } };
    }

    // 2. Type -> folder -> org ownership chain + active checks
    const type = await prisma.employeeDocumentType.findFirst({ where: { id: document_type_id, deletedAt: null } });
    if (!type) return { error: { code: grpc.status.NOT_FOUND, message: 'Document type not found' } };
    const folder = await prisma.employeeDocumentFolder.findFirst({ where: { id: type.folderId, deletedAt: null } });
    if (!folder) return { error: { code: grpc.status.NOT_FOUND, message: 'Document folder not found' } };
    if (String(folder.organizationId) !== String(organization_id)) {
        return { error: { code: grpc.status.PERMISSION_DENIED, message: 'Document type does not belong to this organization.' } };
    }
    if (!type.isActive) return { error: { code: grpc.status.FAILED_PRECONDITION, message: `Document type '${type.name}' is not active.` } };
    if (!folder.isActive) return { error: { code: grpc.status.FAILED_PRECONDITION, message: `Document folder '${folder.name}' is not active.` } };

    // 3. Check existing assignment (any deletedAt state, since unique spans soft-deleted)
    const existing = await prisma.employeeDocumentAssignment.findFirst({
        where: { employeeId: employee_id, documentTypeId: document_type_id, organizationId: organization_id },
    });

    if (existing) {
        if (!existing.deletedAt) {
            if (isBulk) return { already: true };
            return { error: { code: grpc.status.ALREADY_EXISTS, message: 'This document is already assigned to the employee.' } };
        }
        // Reactivate soft-deleted assignment
        const reactivated = await prisma.employeeDocumentAssignment.update({
            where: { id: existing.id },
            data: {
                deletedAt: null,
                status: 'PENDING',
                assignedById: isObjectId(assigned_by_id) ? assigned_by_id : existing.assignedById,
                assignedAt: new Date(),
                updatedAt: new Date(),
            },
        });
        return { assignment: reactivated, message: 'Assignment reactivated successfully' };
    }

    // 4. Create new
    const created = await prisma.employeeDocumentAssignment.create({
        data: {
            organizationId: organization_id,
            employeeId: employee_id,
            documentTypeId: document_type_id,
            assignedById: isObjectId(assigned_by_id) ? assigned_by_id : null,
            assignedAt: new Date(),
            status: 'PENDING',
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
        },
    });
    return { assignment: created, message: 'Document assigned successfully' };
}

async function main() {
    await checkDbConnection('employee-document-service');
    const server = new grpc.Server();
    server.addService(employeeDocumentProto.EmployeeDocumentService.service, impl);
    await new Promise((resolve, reject) => {
        server.bindAsync(`0.0.0.0:${PORT}`, grpc.ServerCredentials.createInsecure(), (err) => (err ? reject(err) : resolve()));
    });
    console.log(`[employee-document-service] gRPC running on :${PORT}`);
    const shutdown = async (signal) => {
        console.log(`\n[employee-document-service] Received ${signal}, shutting down...`);
        try { server.tryShutdown(() => console.log('[employee-document-service] gRPC stopped.')); await prisma.$disconnect(); process.exit(0); } catch (e) { console.error(e); process.exit(1); }
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => { console.error('[employee-document-service] Fatal error:', err); process.exit(1); });
