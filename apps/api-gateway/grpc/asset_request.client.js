import { loadProto, grpc } from '@jury-hrms/proto';

const AssetRequestsProto = loadProto('asset_request');
const ASSET_REQ_SERVICE_ADDR = process.env.ASSET_REQ_SERVICE_ADDR || 'localhost:50066';

export const assetRequestClient = new AssetRequestsProto.AssetRequestService(
    ASSET_REQ_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);