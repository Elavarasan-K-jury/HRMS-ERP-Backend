import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';

dotenv.config();

const AssetAssignmentProto = loadProto('asset_assignment');
const ASSET_ASSIGN_SERVICE_ADDR = process.env.ASSET_ASSIGN_SERVICE_ADDR || 'localhost:50067';

export const assetAssignmentClient = new AssetAssignmentProto.AssetAssignmentService(
    ASSET_ASSIGN_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);