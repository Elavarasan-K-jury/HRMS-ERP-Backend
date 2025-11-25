import { loadProto, grpc } from '@jury-hrms/proto';

const AssetConditionProto = loadProto('asset_condition');
const ASSET_CON_SERVICE_ADDR = process.env.ASSET_CON_SERVICE_ADDR || 'localhost:50068';

export const assetConditionClient = new AssetConditionProto.AssetConditionService(
    ASSET_CON_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);