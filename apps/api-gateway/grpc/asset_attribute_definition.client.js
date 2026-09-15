import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const AssetAttrDefProto = loadProto('asset_model_attribute_definitions');
const ASSET_ATTR_DEF_SERVICE_ADDR = process.env.ASSET_ATTR_DEF_SERVICE_ADDR || 'localhost:5070';

export const assetAttributeDefinitionClient = new AssetAttrDefProto.AssetModelAttributeDefinitionService(
    ASSET_ATTR_DEF_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
