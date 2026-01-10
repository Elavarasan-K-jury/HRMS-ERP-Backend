// storage-service.js
import { grpc, loadProto } from "@jury-hrms/proto";
import { prisma, checkDbConnection } from "@jury-hrms/db/client.js";
import { FileService } from "@jury-hrms/files";
import dotenv from "dotenv";
dotenv.config();

const PORT = Number(process.env.STORAGE_SERVICE_PORT || 5081);

// ✅ change this to your actual proto package name (like you did: loadProto("organization"))
// e.g. const storageProto = loadProto("files");
const storageProto = loadProto("storage");

/* ------------------------------------------------------------------ */
/* ✅ Helpers                                                         */
/* ------------------------------------------------------------------ */
const isObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

function toISO(d) {
    return d ? d.toISOString() : "";
}

function mapFolder(folder) {
    return {
        id: folder.id,
        name: folder.name,
        color: folder.color ?? "",
        folder_image_id: folder.folderImageId ?? "",
        files_count: folder.filesCount ?? 0,
        folder_storage_used_in_bytes: folder.folderStorageUsedInBytes ?? 0,
        organization_id: folder.organizationId,
        created_by_id: folder.createdById,
        visibility: folder.visibility,
        created_at: toISO(folder.createdAt),
        updated_at: toISO(folder.updatedAt),
        deleted_at: toISO(folder.deletedAt),
    };
}

function mapFile(file) {
    return {
        id: file.id,
        folder_name: file.folder?.name ?? "",
        folder_id: file.folderId ?? "",
        file_url: file.fileUrl,
        file_key: file.fileKey,
        added_by_id: file.addedById,
        size: file.folderStorageUsedInBytes || 0,
        organization_id: file.organizationId,
        created_at: toISO(file.createdAt),
        updated_at: toISO(file.updatedAt),
        deleted_at: toISO(file.deletedAt),
    };
}

function mapShareRow(row) {
    return {
        id: row.id,
        folder_id: row.folderId,
        employee_id: row.employeeId,
        added_by_id: row.addedById,
        created_at: toISO(row.createdAt),
        updated_at: toISO(row.updatedAt),
        deleted_at: toISO(row.deletedAt),
    };
}

/**
 * Folder image handling:
 * - If request contains folder_image_buffer + folder_image_name, we upload it using FileService
 * - Then create a Files row (folderId = null) for this uploaded image
 * - Store folder.folderImageId = <Files.id>
 */
async function uploadFolderImageAndCreateFileRow({
    tx,
    organizationId,
    addedById,
    buffer,
    originalName,
}) {
    const uploaded = await FileService.upload(buffer, originalName, "folder-images");
    // uploaded: { url, key } (your FileService returns this for s3), or local saveLocal output
    // We'll normalize:
    const fileUrl = uploaded?.url || uploaded?.fileUrl || uploaded?.path || "";
    const fileKey = uploaded?.key || uploaded?.fileKey || uploaded?.filename || "";

    const fileRow = await tx.files.create({
        data: {
            folderId: null,
            fileUrl,
            fileKey,
            addedById,
            organizationId,
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
        },
    });

    return { fileRow, fileUrl, fileKey };
}

/* ------------------------------------------------------------------ */
/* 🧩 Implementation                                                  */
/* ------------------------------------------------------------------ */
const impl = {
    /* ------------------------------------------------------------------ */
    /* 🟢 Create Folder                                                   */
    /* ------------------------------------------------------------------ */
    CreateFolder: async (call, callback) => {
        try {
            const data = call.request;

            const organization_id = data.organization_id;
            const created_by_id = data.created_by_id;

            if (!organization_id || !created_by_id || !data.name) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "organization_id, created_by_id, and name are required",
                });
            }

            if (!isObjectId(organization_id) || !isObjectId(created_by_id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "Invalid organization_id or created_by_id",
                });
            }

            const folder = await prisma.$transaction(async (tx) => {
                // 1) create folder first
                const created = await tx.folders.create({
                    data: {
                        name: data.name,
                        color: data.color ?? null,
                        folderImageId: null,
                        filesCount: 0,
                        folderStorageUsedInBytes: 0,
                        organizationId: organization_id,
                        createdById: created_by_id,
                        visibility: data.visibility ?? "PRIVATE",
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        deletedAt: null,
                    },
                });

                // 2) optional folder image upload
                // Expecting proto fields:
                // - folder_image_buffer (bytes)
                // - folder_image_name (string)
                if (data.folder_image_buffer?.length && data.folder_image_name) {
                    const buf = Buffer.from(data.folder_image_buffer);
                    const { fileRow } = await uploadFolderImageAndCreateFileRow({
                        tx,
                        organizationId: organization_id,
                        addedById: created_by_id,
                        buffer: buf,
                        originalName: data.folder_image_name,
                    });

                    // set folderImageId to Files.id (recommended)
                    const updated = await tx.folders.update({
                        where: { id: created.id },
                        data: {
                            folderImageId: fileRow.id,
                            // if you want folder image size to count in storage used:
                            folderStorageUsedInBytes: (created.folderStorageUsedInBytes || 0) + buf.length,
                            updatedAt: new Date(),
                        },
                    });

                    return updated;
                }

                return created;
            });

            return callback(null, {
                folder: mapFolder(folder),
                success: true,
                message: "Folder created successfully",
            });
        } catch (e) {
            console.error("CreateFolder Error:", e);
            return callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* ------------------------------------------------------------------ */
    /* 🟣 Get Folder                                                      */
    /* ------------------------------------------------------------------ */
    GetFolder: async (call, callback) => {
        try {
            const { id } = call.request;
            if (!id || !isObjectId(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "Invalid folder id",
                });
            }

            const folder = await prisma.folders.findUnique({
                where: { id, deletedAt: null },
            });

            if (!folder) {
                return callback({ code: grpc.status.NOT_FOUND, message: "Folder not found" });
            }

            return callback(null, { folder: mapFolder(folder), success: true });
        } catch (e) {
            console.error("GetFolder Error:", e);
            return callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* ------------------------------------------------------------------ */
    /* 🔵 List Folders (org)                                               */
    /* ------------------------------------------------------------------ */
    ListFolders: async (call, callback) => {
        try {
            const {
                organization_id,
                page = 1,
                limit = 10,
                search = "",
                visibility, // optional filter
                sort_by = "created_at",
                sort_order = "desc",
            } = call.request;

            if (!organization_id || !isObjectId(organization_id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "organization_id is required and must be valid",
                });
            }

            const organization = await prisma.organizations.findFirst({
                where: {
                    id: organization_id
                }
            })

            function sizeToBytes(value, unit) {
                if (!Number.isFinite(Number(value))) return 0;
                if (!unit) return 0;

                const units = {
                    B: 0,
                    KB: 1,
                    MB: 2,
                    GB: 3,
                    TB: 4,
                    PB: 5,
                    EB: 6,
                };

                const u = unit.toUpperCase();
                if (!(u in units)) return 0;

                return Math.round(Number(value) * Math.pow(1024, units[u]));

            }

            const totalStorage = sizeToBytes(Number(organization.maxStorageInGB || 0), 'GB')

            const where = {
                organizationId: organization_id,
                deletedAt: null,
                ...(visibility ? { visibility } : {}),
                ...(search
                    ? {
                        OR: [
                            { name: { contains: search, mode: "insensitive" } },
                            { color: { contains: search, mode: "insensitive" } },
                        ],
                    }
                    : {}),
            };

            const validSortFields = {
                name: "name",
                created_at: "createdAt",
                updated_at: "updatedAt",
                files_count: "filesCount",
                storage_used: "folderStorageUsedInBytes",
            };

            const sortField = validSortFields[sort_by] || "createdAt";
            const sortOrder = String(sort_order).toLowerCase() === "asc" ? "asc" : "desc";

            const total = await prisma.folders.count({ where });

            const folders = await prisma.folders.findMany({
                where,
                orderBy: { [sortField]: sortOrder },
                skip: (page - 1) * limit,
                take: limit,
            });

            const folderStorage = await prisma.folders.aggregate({
                where: {
                    organizationId: organization_id,
                },
                _sum: { folderStorageUsedInBytes: true },
            });

            const totalBytes = folderStorage._sum.folderStorageUsedInBytes ?? 0;

            return callback(null, {
                folders: folders.map(mapFolder),
                total,
                page,
                limit,
                total_pages: Math.ceil(total / limit),
                total_storage: totalStorage,
                used_storage: totalBytes,
                success: true,
                message: "Folders fetched successfully",
            });
        } catch (e) {
            console.error("ListFolders Error:", e);
            return callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* ------------------------------------------------------------------ */
    /* 🟠 Update Folder                                                   */
    /* - update name/color/visibility                                     */
    /* - optionally replace folder image                                  */
    /* ------------------------------------------------------------------ */
    UpdateFolder: async (call, callback) => {
        try {
            const data = call.request;

            if (!data.id || !isObjectId(data.id)) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: "Invalid folder id" });
            }

            const existing = await prisma.folders.findUnique({
                where: { id: data.id, deletedAt: null },
            });

            if (!existing) {
                return callback({ code: grpc.status.NOT_FOUND, message: "Folder not found" });
            }

            const updated = await prisma.$transaction(async (tx) => {
                let nextFolderImageId = existing.folderImageId;

                // optional replace image
                if (data.folder_image_buffer?.length && data.folder_image_name) {
                    const buf = Buffer.from(data.folder_image_buffer);

                    // (optional) delete old image file row + underlying storage
                    if (existing.folderImageId && isObjectId(existing.folderImageId)) {
                        const oldImg = await tx.files.findUnique({
                            where: { id: existing.folderImageId },
                        });
                        if (oldImg && !oldImg.deletedAt) {
                            try {
                                await FileService.delete(oldImg.fileKey);
                            } catch (err) {
                                // don't fail entire update if storage delete fails
                                console.warn("Old folder image delete failed:", err?.message || err);
                            }
                            await tx.files.update({
                                where: { id: oldImg.id },
                                data: { deletedAt: new Date(), updatedAt: new Date() },
                            });
                        }
                    }

                    const { fileRow } = await uploadFolderImageAndCreateFileRow({
                        tx,
                        organizationId: existing.organizationId,
                        addedById: existing.createdById,
                        buffer: buf,
                        originalName: data.folder_image_name,
                    });

                    nextFolderImageId = fileRow.id;

                    // storage usage: add new bytes (and we are not subtracting old image bytes because we don't store size per file)
                    // If you want exact, add fileSizeBytes field to Files model.
                    const newStorage = (existing.folderStorageUsedInBytes || 0) + buf.length;

                    const f = await tx.folders.update({
                        where: { id: existing.id },
                        data: {
                            name: data.name ?? existing.name,
                            color: data.color ?? existing.color,
                            visibility: data.visibility ?? existing.visibility,
                            folderImageId: nextFolderImageId,
                            folderStorageUsedInBytes: newStorage,
                            updatedAt: new Date(),
                        },
                    });

                    return f;
                }

                // normal update
                return tx.folders.update({
                    where: { id: existing.id },
                    data: {
                        name: data.name ?? existing.name,
                        color: data.color ?? existing.color,
                        visibility: data.visibility ?? existing.visibility,
                        updatedAt: new Date(),
                    },
                });
            });

            return callback(null, {
                folder: mapFolder(updated),
                success: true,
                message: "Folder updated successfully",
            });
        } catch (e) {
            console.error("UpdateFolder Error:", e);
            return callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* ------------------------------------------------------------------ */
    /* 🔴 Soft Delete Folder                                               */
    /* - also soft-delete files + shares                                  */
    /* - optionally delete underlying storage keys                         */
    /* ------------------------------------------------------------------ */
    DeleteFolder: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!id || !isObjectId(id)) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: "Invalid folder id" });
            }

            const folder = await prisma.folders.findUnique({
                where: { id, deletedAt: null },
            });

            if (!folder) {
                return callback({ code: grpc.status.NOT_FOUND, message: "Folder not found" });
            }

            await prisma.$transaction(async (tx) => {
                // soft delete folder
                await tx.folders.update({
                    where: { id },
                    data: { deletedAt: new Date(), updatedAt: new Date() },
                });

                // soft delete shares
                await tx.folderSharedWithEmployees.updateMany({
                    where: { folderId: id, deletedAt: null },
                    data: { deletedAt: new Date(), updatedAt: new Date() },
                });

                // soft delete files (and try removing from storage)
                const files = await tx.files.findMany({
                    where: { folderId: id, deletedAt: null },
                });

                for (const f of files) {
                    try {
                        await FileService.delete(f.fileKey);
                    } catch (err) {
                        console.warn("DeleteFolder storage delete failed:", err?.message || err);
                    }
                }

                await tx.files.updateMany({
                    where: { folderId: id, deletedAt: null },
                    data: { deletedAt: new Date(), updatedAt: new Date() },
                });

                // folder image file row (if folderImageId is a Files.id)
                if (folder.folderImageId && isObjectId(folder.folderImageId)) {
                    const img = await tx.files.findUnique({ where: { id: folder.folderImageId } });
                    if (img && !img.deletedAt) {
                        try {
                            await FileService.delete(img.fileKey);
                        } catch (err) {
                            console.warn("DeleteFolder image storage delete failed:", err?.message || err);
                        }
                        await tx.files.update({
                            where: { id: img.id },
                            data: { deletedAt: new Date(), updatedAt: new Date() },
                        });
                    }
                }
            });

            return callback(null, { success: true, message: "Folder deleted successfully" });
        } catch (e) {
            console.error("DeleteFolder Error:", e);
            return callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* ------------------------------------------------------------------ */
    /* 🟢 Upload File to Folder                                            */
    /* - uses FileService.upload                                           */
    /* - creates Files row                                                 */
    /* - updates folder counters                                           */
    /* ------------------------------------------------------------------ */
    UploadFileToFolder: async (call, callback) => {
        try {
            const data = call.request;

            const folder_id = data.folder_id || null;
            const organization_id = data.organization_id;
            const added_by_id = data.added_by_id;

            if (!organization_id || !added_by_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "organization_id and added_by_id are required",
                });
            }

            if (!isObjectId(organization_id) || !isObjectId(added_by_id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "Invalid organization_id or added_by_id",
                });
            }

            if (folder_id && !isObjectId(folder_id)) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: "Invalid folder_id" });
            }

            if (!data.file_buffer?.length || !data.file_name) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "file_buffer and file_name are required",
                });
            }

            // If folderId provided, validate it
            let folder = null;
            if (folder_id) {
                folder = await prisma.folders.findUnique({
                    where: { id: folder_id, deletedAt: null },
                });
                if (!folder) {
                    return callback({ code: grpc.status.NOT_FOUND, message: "Folder not found" });
                }
            }

            const buf = Buffer.from(data.file_buffer);
            const storePath = folder_id ? `org-${organization_id}/folders/${folder_id}` : `org-${organization_id}/misc`;

            const uploaded = await FileService.upload(buf, data.file_name, storePath);
            const fileUrl = uploaded?.url || uploaded?.fileUrl || uploaded?.path || "";
            const fileKey = uploaded?.key || uploaded?.fileKey || uploaded?.filename || "";

            const created = await prisma.$transaction(async (tx) => {
                const fileRow = await tx.files.create({
                    data: {
                        folderId: folder_id,
                        fileUrl,
                        fileKey,
                        addedById: added_by_id,
                        folderStorageUsedInBytes: buf.length,
                        organizationId: organization_id,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        deletedAt: null,
                    },
                });

                if (folder_id) {
                    await tx.folders.update({
                        where: { id: folder_id },
                        data: {
                            filesCount: { increment: 1 },
                            folderStorageUsedInBytes: { increment: buf.length },
                            updatedAt: new Date(),
                        },
                    });
                }

                return fileRow;
            });

            return callback(null, {
                file: mapFile(created),
                success: true,
                message: "File uploaded successfully",
            });
        } catch (e) {
            console.error("UploadFileToFolder Error:", e);
            return callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* ------------------------------------------------------------------ */
    /* 🔵 List Files in Folder                                             */
    /* ------------------------------------------------------------------ */
    ListFiles: async (call, callback) => {
        try {
            const { organization_id, folder_id, page = 1, limit = 20 } = call.request;

            if (!organization_id || !isObjectId(organization_id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "organization_id is required and must be valid",
                });
            }

            if (folder_id && !isObjectId(folder_id)) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: "Invalid folder_id" });
            }

            const where = {
                organizationId: organization_id,
                deletedAt: null,
                ...(folder_id ? { folderId: folder_id } : {}),
            };

            const total = await prisma.files.count({ where });

            const files = await prisma.files.findMany({
                where,
                include: {
                    folder: true
                },
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
            });

            return callback(null, {
                files: files.map(mapFile),
                total,
                page,
                limit,
                total_pages: Math.ceil(total / limit),
                success: true,
                message: "Files fetched successfully",
            });
        } catch (e) {
            console.error("ListFiles Error:", e);
            return callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* ------------------------------------------------------------------ */
    /* 🔴 Delete File (soft + delete storage key)                           */
    /* - decrements folder counters if file belongs to a folder            */
    /* ------------------------------------------------------------------ */
    DeleteFile: async (call, callback) => {
        try {
            const { id } = call.request;

            if (!id || !isObjectId(id)) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: "Invalid file id" });
            }

            const file = await prisma.files.findUnique({
                where: { id, deletedAt: null },
            });

            if (!file) {
                return callback({ code: grpc.status.NOT_FOUND, message: "File not found" });
            }

            // best-effort delete from storage
            try {
                await FileService.delete(file.fileKey);
            } catch (err) {
                console.warn("DeleteFile storage delete failed:", err?.message || err);
            }

            await prisma.$transaction(async (tx) => {
                await tx.files.update({
                    where: { id: file.id },
                    data: { deletedAt: new Date(), updatedAt: new Date() },
                });

                // We don’t know exact file size from DB (no size field).
                // If you want perfect decrements, add fileSizeBytes to Files model.
                if (file.folderId) {
                    await tx.folders.update({
                        where: { id: file.folderId },
                        data: {
                            filesCount: { decrement: 1 },
                            updatedAt: new Date(),
                        },
                    });
                }
            });

            return callback(null, { success: true, message: "File deleted successfully" });
        } catch (e) {
            console.error("DeleteFile Error:", e);
            return callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* ------------------------------------------------------------------ */
    /* 🟡 Share Folder with Employees                                      */
    /* - creates share rows (soft-restore if already exists)               */
    /* ------------------------------------------------------------------ */
    ShareFolder: async (call, callback) => {
        try {
            const { folder_id, employee_ids, added_by_id } = call.request;

            if (!folder_id || !isObjectId(folder_id)) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: "Invalid folder_id" });
            }

            if (!added_by_id || !isObjectId(added_by_id)) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: "Invalid added_by_id" });
            }

            if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "employee_ids must be a non-empty array",
                });
            }

            const folder = await prisma.folders.findUnique({
                where: { id: folder_id, deletedAt: null },
            });

            if (!folder) {
                return callback({ code: grpc.status.NOT_FOUND, message: "Folder not found" });
            }

            const rows = await prisma.$transaction(async (tx) => {
                const out = [];

                for (const empId of employee_ids) {
                    if (!isObjectId(empId)) continue;

                    const existing = await tx.folderSharedWithEmployees.findFirst({
                        where: {
                            folderId: folder_id,
                            employeeId: empId,
                        },
                    });

                    if (existing && existing.deletedAt) {
                        const restored = await tx.folderSharedWithEmployees.update({
                            where: { id: existing.id },
                            data: { deletedAt: null, updatedAt: new Date(), addedById: added_by_id },
                        });
                        out.push(restored);
                        continue;
                    }

                    if (existing && !existing.deletedAt) {
                        out.push(existing);
                        continue;
                    }

                    const created = await tx.folderSharedWithEmployees.create({
                        data: {
                            folderId: folder_id,
                            employeeId: empId,
                            addedById: added_by_id,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                            deletedAt: null,
                        },
                    });

                    out.push(created);
                }

                return out;
            });

            return callback(null, {
                shares: rows.map(mapShareRow),
                success: true,
                message: "Folder shared successfully",
            });
        } catch (e) {
            console.error("ShareFolder Error:", e);
            return callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* ------------------------------------------------------------------ */
    /* 🟠 Unshare Folder                                                   */
    /* ------------------------------------------------------------------ */
    UnshareFolder: async (call, callback) => {
        try {
            const { folder_id, employee_id } = call.request;

            if (!folder_id || !isObjectId(folder_id)) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: "Invalid folder_id" });
            }
            if (!employee_id || !isObjectId(employee_id)) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: "Invalid employee_id" });
            }

            const share = await prisma.folderSharedWithEmployees.findFirst({
                where: { folderId: folder_id, employeeId: employee_id, deletedAt: null },
            });

            if (!share) {
                return callback({ code: grpc.status.NOT_FOUND, message: "Share record not found" });
            }

            await prisma.folderSharedWithEmployees.update({
                where: { id: share.id },
                data: { deletedAt: new Date(), updatedAt: new Date() },
            });

            return callback(null, { success: true, message: "Folder unshared successfully" });
        } catch (e) {
            console.error("UnshareFolder Error:", e);
            return callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },

    /* ------------------------------------------------------------------ */
    /* 🔵 List Shared Employees for a Folder                                */
    /* ------------------------------------------------------------------ */
    ListFolderShares: async (call, callback) => {
        try {
            const { folder_id, page = 1, limit = 20 } = call.request;

            if (!folder_id || !isObjectId(folder_id)) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: "Invalid folder_id" });
            }

            const where = { folderId: folder_id, deletedAt: null };

            const total = await prisma.folderSharedWithEmployees.count({ where });

            const rows = await prisma.folderSharedWithEmployees.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
            });

            return callback(null, {
                shares: rows.map(mapShareRow),
                total,
                page,
                limit,
                total_pages: Math.ceil(total / limit),
                success: true,
                message: "Folder shares fetched successfully",
            });
        } catch (e) {
            console.error("ListFolderShares Error:", e);
            return callback({ code: grpc.status.INTERNAL, message: e.message });
        }
    },
};

/* ------------------------------------------------------------------ */
/* 🧩 Graceful Server Setup                                            */
/* ------------------------------------------------------------------ */
async function main() {
    await checkDbConnection("storage-service");
    const server = new grpc.Server();

    // ✅ Change this service name to your proto service:
    // server.addService(storageProto.StorageService.service, impl);
    server.addService(storageProto.StorageService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[storage-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[storage-service] Received ${signal}, shutting down gracefully...`);
        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error("[storage-service] Force closing due to error:", err);
                    server.forceShutdown();
                } else {
                    console.log("[storage-service] gRPC server stopped.");
                }
            });

            await prisma.$disconnect();
            console.log("[storage-service] Prisma disconnected.");
            process.exit(0);
        } catch (e) {
            console.error("[storage-service] Error during shutdown:", e);
            process.exit(1);
        }
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
    console.error("[storage-service] Fatal error:", err);
    process.exit(1);
});
