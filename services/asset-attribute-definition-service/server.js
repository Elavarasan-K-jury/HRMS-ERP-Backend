import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';

dotenv.config();

const PORT = Number(process.env.ASSET_ATTR_DEF_SERVICE_PORT || 5071);
const proto = loadProto('asset_model_attribute_definitions');
const service = proto.AssetModelAttributeDefinitionService.service;

function mapDefinition(d) {
  return {
    id: d.id,
    asset_model_id: d.assetModelId,
    organization_id: d.organizationId,
    label: d.label,
    key: d.key,
    field_type: d.fieldType,
    options: d.options ? JSON.stringify(d.options) : '',
    is_mandatory: d.isMandatory,
    is_unique: d.isUnique,
    display_order: d.displayOrder,
    created_at: d.createdAt?.toISOString?.() || '',
    updated_at: d.updatedAt?.toISOString?.() || '',
    deleted_at: d.deletedAt?.toISOString?.() || '',
  };
}

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function parseOptions(optionsStr) {
  if (!optionsStr) return null;
  try {
    return JSON.parse(optionsStr);
  } catch {
    return null;
  }
}

async function CreateAttributeDefinition(call, callback) {
  try {
    const { asset_model_id, organization_id, label, key, field_type, options, is_mandatory, is_unique, display_order } = call.request;

    const org = await prisma.organizations.findUnique({ where: { id: organization_id } });
    if (!org) return callback(null, { definition: null, success: false, message: 'Organization not found' });

    const model = await prisma.assetModels.findFirst({
      where: { id: asset_model_id, organizationId: organization_id, deletedAt: null },
    });
    if (!model) return callback(null, { definition: null, success: false, message: 'Asset Model not found' });

    const generatedKey = key && key.trim() ? key.trim() : slugify(label);

    const existing = await prisma.assetModelAttributeDefinition.findFirst({
      where: { assetModelId: asset_model_id, key: generatedKey, deletedAt: null },
    });
    if (existing) return callback(null, { definition: null, success: false, message: `Attribute key "${generatedKey}" already exists for this model` });

    const definition = await prisma.assetModelAttributeDefinition.create({
      data: {
        assetModelId: asset_model_id,
        organizationId: organization_id,
        label,
        key: generatedKey,
        fieldType: field_type,
        options: parseOptions(options),
        isMandatory: is_mandatory,
        isUnique: is_unique,
        displayOrder: display_order || 0,
        deletedAt: null,
      },
    });

    callback(null, { definition: mapDefinition(definition), success: true, message: 'Created' });
  } catch (err) {
    console.error('[ASSET-ATTR-DEF] CreateAttributeDefinition error:', err);
    callback({ code: grpc.status.INTERNAL, message: err.message }, null);
  }
}

async function GetAttributeDefinition(call, callback) {
  try {
    const { id } = call.request;
    const definition = await prisma.assetModelAttributeDefinition.findFirst({
      where: { id, deletedAt: null },
    });
    if (!definition) return callback(null, { definition: null, success: false, message: 'Not found' });
    callback(null, { definition: mapDefinition(definition), success: true, message: 'OK' });
  } catch (err) {
    console.error('[ASSET-ATTR-DEF] GetAttributeDefinition error:', err);
    callback({ code: grpc.status.INTERNAL, message: err.message }, null);
  }
}

async function ListAttributeDefinitions(call, callback) {
  try {
    const { asset_model_id, organization_id } = call.request;
    const where = { deletedAt: null };
    if (asset_model_id) where.assetModelId = asset_model_id;
    if (organization_id) where.organizationId = organization_id;

    const definitions = await prisma.assetModelAttributeDefinition.findMany({
      where,
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    });

    callback(null, {
      definitions: definitions.map(mapDefinition),
      success: true,
      message: 'OK',
    });
  } catch (err) {
    console.error('[ASSET-ATTR-DEF] ListAttributeDefinitions error:', err);
    callback({ code: grpc.status.INTERNAL, message: err.message }, null);
  }
}

async function UpdateAttributeDefinition(call, callback) {
  try {
    const { id, label, key, field_type, options, is_mandatory, is_unique, display_order } = call.request;

    const existing = await prisma.assetModelAttributeDefinition.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) return callback(null, { definition: null, success: false, message: 'Not found' });

    if (key && key !== existing.key) {
      const dup = await prisma.assetModelAttributeDefinition.findFirst({
        where: { assetModelId: existing.assetModelId, key, deletedAt: null, NOT: { id } },
      });
      if (dup) return callback(null, { definition: null, success: false, message: `Attribute key "${key}" already exists` });
    }

    const updated = await prisma.assetModelAttributeDefinition.update({
      where: { id },
      data: {
        label: label || existing.label,
        key: key || existing.key,
        fieldType: field_type || existing.fieldType,
        options: options !== undefined ? parseOptions(options) : existing.options,
        isMandatory: is_mandatory !== undefined ? is_mandatory : existing.isMandatory,
        isUnique: is_unique !== undefined ? is_unique : existing.isUnique,
        displayOrder: display_order !== undefined ? display_order : existing.displayOrder,
      },
    });

    callback(null, { definition: mapDefinition(updated), success: true, message: 'Updated' });
  } catch (err) {
    console.error('[ASSET-ATTR-DEF] UpdateAttributeDefinition error:', err);
    callback({ code: grpc.status.INTERNAL, message: err.message }, null);
  }
}

async function DeleteAttributeDefinition(call, callback) {
  try {
    const { id } = call.request;
    const existing = await prisma.assetModelAttributeDefinition.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) return callback(null, { success: false, message: 'Not found' });

    await prisma.assetModelAttributeDefinition.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    callback(null, { success: true, message: 'Deleted' });
  } catch (err) {
    console.error('[ASSET-ATTR-DEF] DeleteAttributeDefinition error:', err);
    callback({ code: grpc.status.INTERNAL, message: err.message }, null);
  }
}

async function SyncAttributeDefinitions(call, callback) {
  try {
    const { asset_model_id, organization_id, definitions } = call.request;

    const org = await prisma.organizations.findUnique({ where: { id: organization_id } });
    if (!org) return callback(null, { definitions: [], success: false, message: 'Organization not found' });

    const model = await prisma.assetModels.findFirst({
      where: { id: asset_model_id, organizationId: organization_id, deletedAt: null },
    });
    if (!model) return callback(null, { definitions: [], success: false, message: 'Asset Model not found' });

    const incomingIds = definitions.filter(d => d.id).map(d => d.id);
    const existingDefs = await prisma.assetModelAttributeDefinition.findMany({
      where: { assetModelId: asset_model_id, deletedAt: null },
    });

    const toDelete = existingDefs.filter(d => !incomingIds.includes(d.id));
    if (toDelete.length > 0) {
      await prisma.assetModelAttributeDefinition.updateMany({
        where: { id: { in: toDelete.map(d => d.id) } },
        data: { deletedAt: new Date() },
      });
    }

    const results = [];
    for (let i = 0; i < definitions.length; i++) {
      const def = definitions[i];
      const generatedKey = def.key && def.key.trim() ? def.key.trim() : slugify(def.label);

      if (def.id) {
        const updated = await prisma.assetModelAttributeDefinition.update({
          where: { id: def.id },
          data: {
            label: def.label,
            key: generatedKey,
            fieldType: def.field_type,
            options: parseOptions(def.options),
            isMandatory: def.is_mandatory,
            isUnique: def.is_unique,
            displayOrder: def.display_order !== undefined ? def.display_order : i,
          },
        });
        results.push(mapDefinition(updated));
      } else {
        const created = await prisma.assetModelAttributeDefinition.create({
          data: {
            assetModelId: asset_model_id,
            organizationId: organization_id,
            label: def.label,
            key: generatedKey,
            fieldType: def.field_type,
            options: parseOptions(def.options),
            isMandatory: def.is_mandatory,
            isUnique: def.is_unique,
            displayOrder: def.display_order !== undefined ? def.display_order : i,
            deletedAt: null,
          },
        });
        results.push(mapDefinition(created));
      }
    }

    callback(null, { definitions: results, success: true, message: 'Synced' });
  } catch (err) {
    console.error('[ASSET-ATTR-DEF] SyncAttributeDefinitions error:', err);
    callback({ code: grpc.status.INTERNAL, message: err.message }, null);
  }
}

async function main() {
  await checkDbConnection('asset-attr-def');

  const server = new grpc.Server();
  server.addService(service, {
    createAttributeDefinition: CreateAttributeDefinition,
    getAttributeDefinition: GetAttributeDefinition,
    listAttributeDefinitions: ListAttributeDefinitions,
    updateAttributeDefinition: UpdateAttributeDefinition,
    deleteAttributeDefinition: DeleteAttributeDefinition,
    syncAttributeDefinitions: SyncAttributeDefinitions,
  });

  server.bindAsync(`0.0.0.0:${PORT}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
    if (err) {
      console.error('[ASSET-ATTR-DEF] Failed to bind:', err);
      process.exit(1);
    }
    console.log(`[ASSET-ATTR-DEF] running on :${port}`);
  });
}

main();

process.on('SIGTERM', () => { prisma.$disconnect(); process.exit(0); });
process.on('SIGINT', () => { prisma.$disconnect(); process.exit(0); });
