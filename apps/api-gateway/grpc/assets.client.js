import { loadProto, grpc } from '@jury-hrms/proto';

const AssetsProto = loadProto('assets');
const ASSETS_SERVICE_ADDR = process.env.ASSETS_SERVICE_ADDR || 'localhost:50065';

export const assetClient = new AssetsProto.AssetService(
    ASSETS_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);