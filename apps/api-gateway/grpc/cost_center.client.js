import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const CostCenter = loadProto('cost_center');
const COST_CENTER_SERVICE_ADDR = process.env.COST_CENTER_SERVICE_ADDR || 'localhost:50071';

export const costCenterClient = new CostCenter.CostCenterService(
    COST_CENTER_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);