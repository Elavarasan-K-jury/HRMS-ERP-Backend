import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const AssetIdSeriesProto = loadProto('asset_id_series');
const ASSET_ID_SERIES_SERVICE_ADDR = process.env.ASSET_ID_SERIES_SERVICE_ADDR || 'localhost:5069';

export const assetIdSeriesClient = new AssetIdSeriesProto.AssetIdSeriesService(
    ASSET_ID_SERIES_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
