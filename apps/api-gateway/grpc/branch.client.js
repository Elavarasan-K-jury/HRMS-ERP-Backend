import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const Branch = loadProto('branch');
const BRANCH_SERVICE_ADDR = process.env.BRANCH_SERVICE_ADDR || '127.0.0.1:5065';

export const branchClient = new Branch.BranchService(
    BRANCH_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
