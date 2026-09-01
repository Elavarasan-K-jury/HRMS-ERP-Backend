import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const probationPolicyProto = loadProto('probation_policy');
const PROBATION_POLICY_SERVICE_ADDR =
    process.env.PROBATION_POLICY_SERVICE_ADDR || 'localhost:5075';

export const probationPolicyClient = new probationPolicyProto.ProbationPolicyService(
    PROBATION_POLICY_SERVICE_ADDR,
    grpc.credentials.createInsecure(),
);
