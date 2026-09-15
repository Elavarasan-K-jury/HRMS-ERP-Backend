import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import { storageService, validateFile, ValidationError } from '@jury-hrms/files';
import dotenv from 'dotenv';
dotenv.config();

const PORT = Number(process.env.ORGANIZATION_DOCUMENT_SERVICE_PORT || 5070);
const orgDocumentProto = loadProto('organization_document');

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

function isObjectId(id) {
    return typeof id === 'string' && OBJECT_ID.test(id);
}

async function resolveAdminName(adminId) {
    if (!adminId || !isObjectId(adminId)) return '';
    try {
        const admin = await prisma.admins.findFirst({ where: { id: adminId, deletedAt: null } });
        if (admin?.fullName) return admin.fullName;
        if (admin?.email) return admin.email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return '';
    } catch { return ''; }
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

const WORKER_TYPES = [
    { id: 'FULL_TIME', name: 'Full-time' },
    { id: 'PART_TIME', name: 'Part-time' },
    { id: 'CONTRACT', name: 'Contract' },
    { id: 'INTERN', name: 'Intern' },
    { id: 'PERMANENT', name: 'Permanent' },
];

const EXPIRY_WARNING_DAYS = 30;

function getExpiryStatus(doc) {
    if (!doc.askExpiryDate || !doc.expiryDate) return 'NO_EXPIRY';
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const exp = new Date(Date.UTC(doc.expiryDate.getUTCFullYear(), doc.expiryDate.getUTCMonth(), doc.expiryDate.getUTCDate()));
    if (exp.getTime() < today.getTime()) return 'EXPIRED';
    const warningCutoff = new Date(today.getTime() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000);
    if (exp.getTime() <= warningCutoff.getTime()) return 'EXPIRING_SOON';
    return 'ACTIVE';
}

function getExpiryStatusFromRaw(askExpiryDate, expiryDateStr) {
    if (!askExpiryDate || !expiryDateStr) return 'NO_EXPIRY';
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const expDate = new Date(expiryDateStr);
    const exp = new Date(Date.UTC(expDate.getUTCFullYear(), expDate.getUTCMonth(), expDate.getUTCDate()));
    if (exp.getTime() < today.getTime()) return 'EXPIRED';
    const warningCutoff = new Date(today.getTime() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000);
    if (exp.getTime() <= warningCutoff.getTime()) return 'EXPIRING_SOON';
    return 'ACTIVE';
}

async function getApplicableEmployees(organizationId, folder) {
    const targeting = {
        branchIds: folder.branchIds || [],
        locationIds: folder.locationIds || [],
        departmentIds: folder.departmentIds || [],
        subDepartmentIds: folder.subDepartmentIds || [],
        workerTypes: folder.workerTypes || [],
        legalEntityIds: folder.legalEntityIds || [],
    };

    const hasAnyFilter = targeting.branchIds.length || targeting.locationIds.length || targeting.departmentIds.length ||
        targeting.subDepartmentIds.length || targeting.workerTypes.length || targeting.legalEntityIds.length;

    if (!hasAnyFilter) return [];

    const where = { organizationId, deletedAt: null, isActive: true };

    if (targeting.legalEntityIds.length) {
        const branches = await prisma.branches.findMany({
            where: { organizationId, legalEntityId: { in: targeting.legalEntityIds }, deletedAt: null },
            select: { id: true },
        });
        const branchIds = branches.map(b => b.id);
        if (!branchIds.length) return [];
        where.branchId = { in: branchIds };
    } else if (targeting.branchIds.length) {
        where.branchId = { in: targeting.branchIds };
    }

    if (targeting.locationIds.length) {
        where.locationId = { in: targeting.locationIds };
    }

    if (targeting.workerTypes.length) {
        where.workerType = { in: targeting.workerTypes };
    }

    let employees = await prisma.organizationEmployees.findMany({
        where,
        select: { id: true, branchId: true, locationId: true, workerType: true, fullName: true, employeeCode: true, designationId: true, branch: true, designation: true },
    });

    if (targeting.departmentIds.length) {
        const deptAssignments = await prisma.employeeDepartments.findMany({
            where: { employeeId: { in: employees.map(e => e.id) }, departmentId: { in: targeting.departmentIds }, deletedAt: null },
            select: { employeeId: true },
        });
        const validEmpIds = new Set(deptAssignments.map(d => d.employeeId));
        employees = employees.filter(e => validEmpIds.has(e.id));
    }

    if (targeting.subDepartmentIds.length) {
        const subDeptAssignments = await prisma.employeeDepartments.findMany({
            where: { employeeId: { in: employees.map(e => e.id) }, departmentId: { in: targeting.subDepartmentIds }, deletedAt: null },
            select: { employeeId: true },
        });
        const validEmpIds = new Set(subDeptAssignments.map(d => d.employeeId));
        employees = employees.filter(e => validEmpIds.has(e.id));
    }

    const empIds = employees.map(e => e.id);
    if (!empIds.length) return [];

    const deptAssignments = await prisma.employeeDepartments.findMany({
        where: { employeeId: { in: empIds }, deletedAt: null },
        include: { department: true },
    });
    const deptMap = {};
    for (const da of deptAssignments) {
        if (!deptMap[da.employeeId]) deptMap[da.employeeId] = da.department?.name ?? '';
    }

    return employees.map(e => ({
        employee_id: e.id,
        employee_name: e.fullName ?? '',
        employee_code: e.employeeCode ?? '',
        branch_id: e.branchId ?? '',
        branch_name: e.branch?.name ?? '',
        designation_id: e.designationId ?? '',
        designation_name: e.designation?.name ?? '',
        department_id: deptMap[e.id] ? (deptAssignments.find(d => d.employeeId === e.id)?.departmentId ?? '') : '',
        department_name: deptMap[e.id] ?? '',
        worker_type: e.workerType ?? '',
    }));
}

async function getFolderTargetingNames(folder, organizationId) {
    const result = { branch_names: [], location_names: [], department_names: [], sub_department_names: [], legal_entity_names: [], worker_type_names: [] };

    if (folder.branchIds?.length) {
        const rows = await prisma.branches.findMany({ where: { id: { in: folder.branchIds }, deletedAt: null }, select: { name: true } });
        result.branch_names = rows.map(r => r.name);
    }
    if (folder.locationIds?.length) {
        const rows = await prisma.locations.findMany({ where: { id: { in: folder.locationIds }, deletedAt: null }, select: { name: true } });
        result.location_names = rows.map(r => r.name);
    }
    if (folder.departmentIds?.length) {
        const rows = await prisma.organizationDepartments.findMany({ where: { id: { in: folder.departmentIds }, deletedAt: null }, select: { name: true } });
        result.department_names = rows.map(r => r.name);
    }
    if (folder.subDepartmentIds?.length) {
        const rows = await prisma.organizationDepartments.findMany({ where: { id: { in: folder.subDepartmentIds }, deletedAt: null }, select: { name: true } });
        result.sub_department_names = rows.map(r => r.name);
    }
    if (folder.legalEntityIds?.length) {
        const rows = await prisma.legalEntities.findMany({ where: { id: { in: folder.legalEntityIds }, deletedAt: null }, select: { name: true } });
        result.legal_entity_names = rows.map(r => r.name);
    }
    if (folder.workerTypes?.length) {
        result.worker_type_names = folder.workerTypes.map(wt => WORKER_TYPES.find(w => w.id === wt)?.name || wt);
    }
    return result;
}

async function enrichFolder(folder) {
    if (!folder) return folder;
    const names = await getFolderTargetingNames(folder, folder.organizationId);
    const [createdByName, updatedByName] = await Promise.all([
        resolveAdminName(folder.createdById),
        resolveAdminName(folder.updatedById),
    ]);
    return { ...folder, ...names, created_by_name: createdByName, updated_by_name: updatedByName };
}

async function enrichDocument(doc) {
    if (!doc) return doc;
    const [createdByName, updatedByName] = await Promise.all([
        resolveAdminName(doc.createdById),
        resolveAdminName(doc.updatedById),
    ]);
    return { ...doc, created_by_name: createdByName, updated_by_name: updatedByName };
}

function mapFolder(f = {}) {
    return {
        id: f.id ?? '',
        organization_id: f.organizationId ?? '',
        name: f.name ?? '',
        description: f.description ?? '',
        is_confidential: !!f.isConfidential,
        branch_ids: f.branchIds || [],
        location_ids: f.locationIds || [],
        department_ids: f.departmentIds || [],
        sub_department_ids: f.subDepartmentIds || [],
        worker_types: f.workerTypes || [],
        legal_entity_ids: f.legalEntityIds || [],
        branch_names: f.branch_names || [],
        location_names: f.location_names || [],
        department_names: f.department_names || [],
        sub_department_names: f.sub_department_names || [],
        legal_entity_names: f.legal_entity_names || [],
        is_active: f.isActive ?? true,
        document_count: f._count?.documents ?? f.document_count ?? 0,
        created_by_id: f.createdById ?? '',
        updated_by_id: f.updatedById ?? '',
        created_by_name: f.created_by_name || '',
        updated_by_name: f.updated_by_name || '',
        created_at: f.createdAt ? f.createdAt.toISOString() : '',
        updated_at: f.updatedAt ? f.updatedAt.toISOString() : '',
    };
}

function mapDocument(d = {}) {
    return {
        id: d.id ?? '',
        organization_id: d.organizationId ?? '',
        folder_id: d.folderId ?? '',
        name: d.name ?? '',
        description: d.description ?? '',
        allow_download: d.allowDownload ?? true,
        acknowledgement_required: d.acknowledgementRequired ?? false,
        block_until_acknowledged: d.blockUntilAcknowledged ?? false,
        ask_expiry_date: d.askExpiryDate ?? false,
        expiry_date: d.expiryDate ? d.expiryDate.toISOString() : '',
        expiry_status: d._expiryStatus ?? getExpiryStatusFromRaw(d.askExpiryDate, d.expiryDate ? d.expiryDate.toISOString() : ''),
        file_id: d.fileId ?? '',
        storage_key: d.storageKey ?? '',
        file_name: d.fileName ?? '',
        file_type: d.fileType ?? '',
        file_size: d.fileSize ?? 0,
        file_url: d.fileId ? `/file/${d.fileId}` : '',
        is_active: d.isActive ?? true,
        folder_name: d._folderName ?? '',
        created_by_id: d.createdById ?? '',
        updated_by_id: d.updatedById ?? '',
        created_by_name: d.created_by_name || '',
        updated_by_name: d.updated_by_name || '',
        created_at: d.createdAt ? d.createdAt.toISOString() : '',
        updated_at: d.updatedAt ? d.updatedAt.toISOString() : '',
    };
}

async function assertOrgFolderOwnership(folder, organizationId) {
    if (!folder) throw { code: grpc.status.NOT_FOUND, message: 'Document folder not found' };
    if (organizationId && String(organizationId) !== String(folder.organizationId)) {
        throw { code: grpc.status.PERMISSION_DENIED, message: 'Document folder does not belong to this organization.' };
    }
}

const impl = {
    /***************************************************************
     * FOLDERS
     ***************************************************************/
    CreateOrgDocFolder: async (call, callback) => {
        try {
            const data = call.request;
            if (!data.organization_id) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id is required.' });
            if (!isObjectId(data.organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });
            if (!data.name?.trim()) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Folder name is required.' });
            const name = data.name.trim();
            if (name.length > 255) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Folder name is too long.' });

            const allForDup = await prisma.organizationDocumentFolder.findMany({ where: { organizationId: data.organization_id } });
            const existing = allForDup.find(f => !f.deletedAt && f.name.toLowerCase() === name.toLowerCase());
            if (existing) return callback({ code: grpc.status.ALREADY_EXISTS, message: `Document folder '${name}' already exists.` });

            const branchIds = safeParseJson(data.branch_ids, []);
            const locationIds = safeParseJson(data.location_ids, []);
            const departmentIds = safeParseJson(data.department_ids, []);
            const subDepartmentIds = safeParseJson(data.sub_department_ids, []);
            const workerTypes = safeParseJson(data.worker_types, []);
            const legalEntityIds = safeParseJson(data.legal_entity_ids, []);

            const folder = await prisma.organizationDocumentFolder.create({
                data: {
                    organizationId: data.organization_id,
                    name,
                    description: data.description?.trim() || null,
                    isConfidential: data.is_confidential !== undefined && data.is_confidential !== null ? Boolean(data.is_confidential) : false,
                    branchIds, locationIds, departmentIds, subDepartmentIds, workerTypes, legalEntityIds,
                    isActive: data.is_active !== undefined && data.is_active !== null ? Boolean(data.is_active) : true,
                    createdById: isObjectId(data.admin_id) ? data.admin_id : null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
            });

            const enriched = await enrichFolder(folder);
            callback(null, { folder: mapFolder(enriched), message: 'Document folder created successfully', success: true });
        } catch (e) {
            if (e.code === 'P2002') return callback({ code: grpc.status.ALREADY_EXISTS, message: `Document folder '${call.request?.name?.trim() || 'this name'}' already exists.` });
            console.error('CreateOrgDocFolder Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListOrgDocFolders: async (call, callback) => {
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

            const total = await prisma.organizationDocumentFolder.count({ where });
            const folders = await prisma.organizationDocumentFolder.findMany({
                where,
                orderBy: { [sortField]: order },
                skip,
                take: limit,
            });

            const ids = folders.map(f => f.id);
            const counts = ids.length ? await prisma.organizationDocument.groupBy({ by: ['folderId'], where: { folderId: { in: ids }, deletedAt: null }, _count: { _all: true } }) : [];
            const countMap = {};
            counts.forEach(c => { countMap[c.folderId] = c._count._all; });

            const enriched = [];
            for (const f of folders) {
                enriched.push(await enrichFolder({ ...f, _count: { documents: countMap[f.id] || 0 } }));
            }

            callback(null, {
                folders: enriched.map(mapFolder),
                total, page, limit, total_pages: Math.ceil(total / limit),
                success: true, message: 'Document folders found successfully',
            });
        } catch (e) {
            console.error('ListOrgDocFolders Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetOrgDocFolder: async (call, callback) => {
        try {
            const { folder_id, organization_id } = call.request;
            if (!isObjectId(folder_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid folder id' });
            const folder = await prisma.organizationDocumentFolder.findFirst({ where: { id: folder_id, deletedAt: null } });
            if (!folder) return callback({ code: grpc.status.NOT_FOUND, message: 'Document folder not found' });
            if (organization_id && String(organization_id) !== String(folder.organizationId)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Document folder does not belong to this organization.' });
            }
            const docCount = await prisma.organizationDocument.count({ where: { folderId: folder_id, deletedAt: null } });
            const enriched = await enrichFolder({ ...folder, _count: { documents: docCount } });
            callback(null, { folder: mapFolder(enriched), message: 'Document folder found', success: true });
        } catch (e) {
            if (e.code) return callback({ code: e.code, message: e.message });
            console.error('GetOrgDocFolder Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateOrgDocFolder: async (call, callback) => {
        try {
            const data = call.request;
            const folderId = data.folder_id;
            if (!isObjectId(folderId)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid folder id' });
            const existing = await prisma.organizationDocumentFolder.findFirst({ where: { id: folderId, deletedAt: null } });
            if (!existing) return callback({ code: grpc.status.NOT_FOUND, message: 'Document folder not found' });
            if (data.organization_id && String(data.organization_id) !== String(existing.organizationId)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Document folder does not belong to this organization.' });
            }

            const name = data.name !== undefined && data.name !== null && data.name !== '' ? data.name.trim() : existing.name;
            const description = data.description !== undefined ? (data.description?.trim() || null) : existing.description;
            const isConfidential = data.is_confidential !== undefined && data.is_confidential !== null ? Boolean(data.is_confidential) : existing.isConfidential;
            const isActive = data.is_active !== undefined && data.is_active !== null ? Boolean(data.is_active) : existing.isActive;

            if (!name) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Folder name is required.' });

            const orgId = data.organization_id || existing.organizationId;
            const allForDup = await prisma.organizationDocumentFolder.findMany({ where: { organizationId: orgId } });
            const conflict = allForDup.find(f => !f.deletedAt && String(f.id) !== String(folderId) && f.name.toLowerCase() === name.toLowerCase());
            if (conflict) return callback({ code: grpc.status.ALREADY_EXISTS, message: `Document folder '${name}' already exists.` });

            const branchIds = data.branch_ids !== undefined ? safeParseJson(data.branch_ids, []) : existing.branchIds;
            const locationIds = data.location_ids !== undefined ? safeParseJson(data.location_ids, []) : existing.locationIds;
            const departmentIds = data.department_ids !== undefined ? safeParseJson(data.department_ids, []) : existing.departmentIds;
            const subDepartmentIds = data.sub_department_ids !== undefined ? safeParseJson(data.sub_department_ids, []) : existing.subDepartmentIds;
            const workerTypes = data.worker_types !== undefined ? safeParseJson(data.worker_types, []) : existing.workerTypes;
            const legalEntityIds = data.legal_entity_ids !== undefined ? safeParseJson(data.legal_entity_ids, []) : existing.legalEntityIds;

            const updated = await prisma.organizationDocumentFolder.update({
                where: { id: folderId },
                data: {
                    name, description, isConfidential, isActive,
                    branchIds, locationIds, departmentIds, subDepartmentIds, workerTypes, legalEntityIds,
                    updatedById: isObjectId(data.admin_id) ? data.admin_id : existing.updatedById,
                    updatedAt: new Date(),
                },
            });
            const docCount = await prisma.organizationDocument.count({ where: { folderId: folderId, deletedAt: null } });
            const enriched = await enrichFolder({ ...updated, _count: { documents: docCount } });
            callback(null, { folder: mapFolder(enriched), message: 'Document folder updated successfully', success: true });
        } catch (e) {
            if (e.code === 'P2002') return callback({ code: grpc.status.ALREADY_EXISTS, message: `Document folder '${call.request?.name?.trim() || 'this name'}' already exists.` });
            if (e.code) return callback({ code: e.code, message: e.message });
            console.error('UpdateOrgDocFolder Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeleteOrgDocFolder: async (call, callback) => {
        try {
            const { folder_id, organization_id } = call.request;
            if (!isObjectId(folder_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid folder id' });
            const folder = await prisma.organizationDocumentFolder.findFirst({ where: { id: folder_id, deletedAt: null } });
            if (!folder) return callback({ code: grpc.status.NOT_FOUND, message: 'Document folder not found' });
            if (organization_id && String(organization_id) !== String(folder.organizationId)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Document folder does not belong to this organization.' });
            }

            const docCount = await prisma.organizationDocument.count({ where: { folderId: folder_id, deletedAt: null } });
            if (docCount > 0) {
                return callback({ code: grpc.status.FAILED_PRECONDITION, message: `Cannot delete folder. ${docCount} document(s) still exist in this folder.` });
            }

            await prisma.organizationDocumentFolder.update({
                where: { id: folder_id },
                data: { deletedAt: new Date(), updatedAt: new Date(), name: `${folder.name}__deleted__${Date.now()}`, updatedById: isObjectId(call.request.admin_id) ? call.request.admin_id : folder.updatedById },
            });
            callback(null, { success: true, message: 'Document folder deleted successfully' });
        } catch (e) {
            if (e.code) return callback({ code: e.code, message: e.message });
            console.error('DeleteOrgDocFolder Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /***************************************************************
     * DOCUMENTS
     ***************************************************************/
    CreateOrgDocument: async (call, callback) => {
        let uploadedStorageKey = null;
        try {
            const data = call.request;
            if (!data.organization_id) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id is required.' });
            if (!isObjectId(data.organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });
            if (!isObjectId(data.folder_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid folder_id.' });
            if (!data.name?.trim()) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Document name is required.' });
            const name = data.name.trim();

            const folder = await prisma.organizationDocumentFolder.findFirst({ where: { id: data.folder_id, deletedAt: null } });
            if (!folder) return callback({ code: grpc.status.NOT_FOUND, message: 'Document folder not found' });
            if (String(folder.organizationId) !== String(data.organization_id)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Document folder does not belong to this organization.' });
            }

            const actorId = isObjectId(data.admin_id) ? data.admin_id : null;

            let fileId = null, storageKey = null, fileName = null, fileType = null, fileSize = null;
            if (data.file_buffer?.length) {
                const buf = Buffer.from(data.file_buffer);
                const { mime, size } = validateFile({ buffer: buf, fileName: data.file_name || 'document', mimeType: data.file_type || undefined });
                const safeName = String(data.file_name || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
                const storePath = `organizations/${data.organization_id}/organization-documents`;
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
                        addedById: actorId,
                        organizationId: data.organization_id,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        deletedAt: null,
                    },
                });
                fileId = fileRow.id;
                fileType = mime;
                fileName = data.file_name || 'document';
                fileSize = size;
            }

            const expiryDate = data.expiry_date ? new Date(data.expiry_date) : null;

            const document = await prisma.organizationDocument.create({
                data: {
                    organizationId: data.organization_id,
                    folderId: data.folder_id,
                    name,
                    description: data.description?.trim() || null,
                    allowDownload: data.allow_download !== undefined && data.allow_download !== null ? Boolean(data.allow_download) : true,
                    acknowledgementRequired: data.acknowledgement_required !== undefined && data.acknowledgement_required !== null ? Boolean(data.acknowledgement_required) : false,
                    blockUntilAcknowledged: data.block_until_acknowledged !== undefined && data.block_until_acknowledged !== null ? Boolean(data.block_until_acknowledged) : false,
                    askExpiryDate: data.ask_expiry_date !== undefined && data.ask_expiry_date !== null ? Boolean(data.ask_expiry_date) : false,
                    expiryDate,
                    fileId, storageKey, fileName, fileType, fileSize,
                    isActive: data.is_active !== undefined && data.is_active !== null ? Boolean(data.is_active) : true,
                    createdById: actorId,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
            });

            callback(null, { document: mapDocument(await enrichDocument({ ...document, _folderName: folder.name })), message: 'Organization document created successfully', success: true });
        } catch (e) {
            if (uploadedStorageKey && e) {
                try { await storageService.delete(uploadedStorageKey); } catch (_) { }
            }
            if (e instanceof ValidationError) return callback({ code: grpc.status.INVALID_ARGUMENT, message: e.message });
            if (e.code === 'P2002') return callback({ code: grpc.status.ALREADY_EXISTS, message: `Document '${call.request?.name?.trim() || 'this name'}' already exists in this folder.` });
            console.error('CreateOrgDocument Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    ListOrgDocuments: async (call, callback) => {
        try {
            const { organization_id, folder_id, page = 1, limit = 10, search = '', sort_by = 'created_at', sort_order = 'desc', expiry_status = '' } = call.request;
            if (!organization_id) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'organization_id is required.' });
            if (!isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });
            if (!isObjectId(folder_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid folder_id.' });

            const folder = await prisma.organizationDocumentFolder.findFirst({ where: { id: folder_id, deletedAt: null } });
            if (!folder) return callback({ code: grpc.status.NOT_FOUND, message: 'Document folder not found' });
            if (String(folder.organizationId) !== String(organization_id)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Document folder does not belong to this organization.' });
            }

            const skip = (page - 1) * limit;
            let where = { folderId: folder_id, organizationId: organization_id, deletedAt: null };
            if (search) {
                where.OR = [
                    { name: { contains: search, mode: 'insensitive' } },
                    { description: { contains: search, mode: 'insensitive' } },
                ];
            }
            const validSort = { name: 'name', created_at: 'createdAt', updated_at: 'updatedAt', expiry_date: 'expiryDate' };
            const sortField = validSort[sort_by] || 'createdAt';
            const order = sort_order.toLowerCase() === 'asc' ? 'asc' : 'desc';

            const total = await prisma.organizationDocument.count({ where });
            const documents = await prisma.organizationDocument.findMany({
                where,
                orderBy: { [sortField]: order },
                skip,
                take: limit,
            });

            let mapped = [];
            for (const d of documents) {
                mapped.push(mapDocument(await enrichDocument({ ...d, _folderName: folder.name })));
            }

            if (expiry_status) {
                const filterStatus = expiry_status.toUpperCase();
                mapped = mapped.filter(d => d.expiry_status === filterStatus);
            }

            callback(null, {
                documents: mapped,
                total, page, limit, total_pages: Math.ceil(total / limit),
                success: true, message: 'Organization documents found successfully',
            });
        } catch (e) {
            console.error('ListOrgDocuments Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    GetOrgDocument: async (call, callback) => {
        try {
            const { document_id, organization_id } = call.request;
            if (!isObjectId(document_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid document id' });
            if (!isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });

            const document = await prisma.organizationDocument.findFirst({ where: { id: document_id, deletedAt: null } });
            if (!document) return callback({ code: grpc.status.NOT_FOUND, message: 'Organization document not found' });
            if (String(document.organizationId) !== String(organization_id)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Organization document does not belong to this organization.' });
            }

            const folder = await prisma.organizationDocumentFolder.findFirst({ where: { id: document.folderId, deletedAt: null } });
            if (!folder || String(folder.organizationId) !== String(organization_id)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Document folder does not belong to this organization.' });
            }

            callback(null, { document: mapDocument(await enrichDocument({ ...document, _folderName: folder.name })), message: 'Organization document found', success: true });
        } catch (e) {
            if (e.code) return callback({ code: e.code, message: e.message });
            console.error('GetOrgDocument Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    UpdateOrgDocument: async (call, callback) => {
        let uploadedStorageKey = null;
        try {
            const data = call.request;
            const docId = data.document_id;
            if (!isObjectId(docId)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid document id' });
            if (!isObjectId(data.organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });

            const existing = await prisma.organizationDocument.findFirst({ where: { id: docId, deletedAt: null } });
            if (!existing) return callback({ code: grpc.status.NOT_FOUND, message: 'Organization document not found' });
            if (String(existing.organizationId) !== String(data.organization_id)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Organization document does not belong to this organization.' });
            }

            const name = data.name !== undefined && data.name !== null && data.name !== '' ? data.name.trim() : existing.name;
            const description = data.description !== undefined ? (data.description?.trim() || null) : existing.description;
            const isActive = data.is_active !== undefined && data.is_active !== null ? Boolean(data.is_active) : existing.isActive;
            const allowDownload = data.allow_download !== undefined && data.allow_download !== null ? Boolean(data.allow_download) : existing.allowDownload;
            const acknowledgementRequired = data.acknowledgement_required !== undefined && data.acknowledgement_required !== null ? Boolean(data.acknowledgement_required) : existing.acknowledgementRequired;
            const blockUntilAcknowledged = data.block_until_acknowledged !== undefined && data.block_until_acknowledged !== null ? Boolean(data.block_until_acknowledged) : existing.blockUntilAcknowledged;
            const askExpiryDate = data.ask_expiry_date !== undefined && data.ask_expiry_date !== null ? Boolean(data.ask_expiry_date) : existing.askExpiryDate;
            const expiryDate = data.expiry_date !== undefined ? (data.expiry_date ? new Date(data.expiry_date) : null) : existing.expiryDate;
            const folderId = data.folder_id && isObjectId(data.folder_id) ? data.folder_id : existing.folderId;

            if (!name) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Document name is required.' });

            const folder = await prisma.organizationDocumentFolder.findFirst({ where: { id: folderId, deletedAt: null } });
            if (!folder) return callback({ code: grpc.status.NOT_FOUND, message: 'Document folder not found' });
            if (String(folder.organizationId) !== String(data.organization_id)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Document folder does not belong to this organization.' });
            }

            const actorId = isObjectId(data.admin_id) ? data.admin_id : existing.updatedById;

            let fileId = existing.fileId, storageKey = existing.storageKey, fileName = existing.fileName, fileType = existing.fileType, fileSize = existing.fileSize;
            if (data.file_buffer?.length) {
                if (existing.storageKey) {
                    try { await storageService.delete(existing.storageKey); } catch (_) { }
                }
                const buf = Buffer.from(data.file_buffer);
                const { mime, size } = validateFile({ buffer: buf, fileName: data.file_name || 'document', mimeType: data.file_type || undefined });
                const safeName = String(data.file_name || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
                const storePath = `organizations/${data.organization_id}/organization-documents`;
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
                        addedById: actorId || data.admin_id,
                        organizationId: data.organization_id,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        deletedAt: null,
                    },
                });
                fileId = fileRow.id;
                fileType = mime;
                fileName = data.file_name || 'document';
                fileSize = size;
            }

            const updated = await prisma.organizationDocument.update({
                where: { id: docId },
                data: {
                    name, description, isActive, folderId, allowDownload, acknowledgementRequired,
                    blockUntilAcknowledged, askExpiryDate, expiryDate, fileId, storageKey, fileName, fileType, fileSize,
                    updatedById: actorId,
                    updatedAt: new Date(),
                },
            });

            callback(null, { document: mapDocument(await enrichDocument({ ...updated, _folderName: folder.name })), message: 'Organization document updated successfully', success: true });
        } catch (e) {
            if (uploadedStorageKey && e) {
                try { await storageService.delete(uploadedStorageKey); } catch (_) { }
            }
            if (e instanceof ValidationError) return callback({ code: grpc.status.INVALID_ARGUMENT, message: e.message });
            if (e.code === 'P2002') return callback({ code: grpc.status.ALREADY_EXISTS, message: `Document '${call.request?.name?.trim() || 'this name'}' already exists in this folder.` });
            if (e.code) return callback({ code: e.code, message: e.message });
            console.error('UpdateOrgDocument Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    DeleteOrgDocument: async (call, callback) => {
        try {
            const { document_id, organization_id } = call.request;
            if (!isObjectId(document_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid document id' });
            if (!isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });

            const document = await prisma.organizationDocument.findFirst({ where: { id: document_id, deletedAt: null } });
            if (!document) return callback({ code: grpc.status.NOT_FOUND, message: 'Organization document not found' });
            if (String(document.organizationId) !== String(organization_id)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Organization document does not belong to this organization.' });
            }

            await prisma.organizationDocument.update({ where: { id: document_id }, data: { deletedAt: new Date(), updatedAt: new Date(), updatedById: isObjectId(call.request.admin_id) ? call.request.admin_id : document.updatedById } });
            callback(null, { success: true, message: 'Organization document deleted successfully' });
        } catch (e) {
            if (e.code) return callback({ code: e.code, message: e.message });
            console.error('DeleteOrgDocument Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /***************************************************************
     * APPLICABLE EMPLOYEES
     ***************************************************************/
    ListApplicableEmployees: async (call, callback) => {
        try {
            const { organization_id, folder_id, page = 1, limit = 10, search = '' } = call.request;
            if (!isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });
            if (!isObjectId(folder_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid folder_id.' });

            const folder = await prisma.organizationDocumentFolder.findFirst({ where: { id: folder_id, deletedAt: null } });
            if (!folder) return callback({ code: grpc.status.NOT_FOUND, message: 'Document folder not found' });
            if (String(folder.organizationId) !== String(organization_id)) {
                return callback({ code: grpc.status.PERMISSION_DENIED, message: 'Document folder does not belong to this organization.' });
            }

            let employees = await getApplicableEmployees(organization_id, folder);

            if (search) {
                const q = search.toLowerCase();
                employees = employees.filter(e =>
                    (e.employee_name || '').toLowerCase().includes(q) ||
                    (e.employee_code || '').toLowerCase().includes(q)
                );
            }

            const total = employees.length;
            const skip = (page - 1) * limit;
            const paged = employees.slice(skip, skip + limit);

            callback(null, {
                employees: paged,
                total, page, limit, total_pages: Math.ceil(total / limit),
                success: true, message: 'Applicable employees found successfully',
            });
        } catch (e) {
            console.error('ListApplicableEmployees Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /***************************************************************
     * STATS
     ***************************************************************/
    GetOrgDocumentStats: async (call, callback) => {
        try {
            const { organization_id, document_id } = call.request;
            if (!isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });
            if (!isObjectId(document_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid document_id.' });

            const document = await prisma.organizationDocument.findFirst({ where: { id: document_id, organizationId: organization_id, deletedAt: null } });
            if (!document) return callback({ code: grpc.status.NOT_FOUND, message: 'Document not found' });

            const folder = await prisma.organizationDocumentFolder.findFirst({ where: { id: document.folderId, deletedAt: null } });
            if (!folder) return callback({ code: grpc.status.NOT_FOUND, message: 'Document folder not found' });

            const applicableEmployees = await getApplicableEmployees(organization_id, folder);
            const applicable_employee_count = applicableEmployees.length;

            const viewed_count = await prisma.organizationDocumentView.count({ where: { documentId: document_id } });
            const acknowledged_count = await prisma.organizationDocumentAcknowledgement.count({ where: { documentId: document_id } });

            callback(null, {
                applicable_employee_count,
                viewed_count,
                acknowledged_count,
                success: true, message: 'Organization document stats found successfully',
            });
        } catch (e) {
            console.error('GetOrgDocumentStats Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /***************************************************************
     * TARGETING OPTIONS
     ***************************************************************/
    GetTargetingOptions: async (call, callback) => {
        try {
            const { organization_id } = call.request;
            if (!isObjectId(organization_id)) return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid organization_id.' });

            const [legalEntities, branches, locations, departments] = await Promise.all([
                prisma.legalEntities.findMany({ where: { organizationId: organization_id, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
                prisma.branches.findMany({ where: { organizationId: organization_id, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
                prisma.locations.findMany({ where: { organizationId: organization_id, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
                prisma.organizationDepartments.findMany({ where: { organizationId: organization_id, deletedAt: null }, select: { id: true, name: true, parentId: true }, orderBy: { name: 'asc' } }),
            ]);

            const deptMap = {};
            const rootDepts = [];
            for (const d of departments) {
                deptMap[d.id] = { id: d.id, name: d.name, sub_departments: [] };
            }
            for (const d of departments) {
                if (d.parentId && deptMap[d.parentId]) {
                    deptMap[d.parentId].sub_departments.push({ id: d.id, name: d.name });
                } else {
                    rootDepts.push(deptMap[d.id]);
                }
            }

            callback(null, {
                legal_entities: legalEntities,
                branches: branches,
                locations: locations,
                departments: rootDepts,
                worker_types: WORKER_TYPES,
                success: true, message: 'Targeting options found successfully',
            });
        } catch (e) {
            console.error('GetTargetingOptions Error:', e);
            callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },
};

async function main() {
    await checkDbConnection('organization-document-service');
    const server = new grpc.Server({
        'grpc.max_send_message_length': 16 * 1024 * 1024,
        'grpc.max_receive_message_length': 16 * 1024 * 1024,
    });
    server.addService(orgDocumentProto.OrganizationDocumentService.service, impl);
    await new Promise((resolve, reject) => {
        server.bindAsync(`0.0.0.0:${PORT}`, grpc.ServerCredentials.createInsecure(), (err) => (err ? reject(err) : resolve()));
    });
    console.log(`[organization-document-service] gRPC running on :${PORT}`);
    const shutdown = async (signal) => {
        console.log(`\n[organization-document-service] Received ${signal}, shutting down...`);
        try { server.tryShutdown(() => console.log('[organization-document-service] gRPC stopped.')); await prisma.$disconnect(); process.exit(0); } catch (e) { console.error(e); process.exit(1); }
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => { console.error('[organization-document-service] Fatal error:', err); process.exit(1); });
