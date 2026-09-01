import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const UsageType = loadProto('usage_type');
const USAGE_TYPE_SERVICE_ADDR = process.env.USAGE_TYPE_SERVICE_ADDR || 'localhost:5065';

export const usageTypeClient = new UsageType.UsageTypeService(
    USAGE_TYPE_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
