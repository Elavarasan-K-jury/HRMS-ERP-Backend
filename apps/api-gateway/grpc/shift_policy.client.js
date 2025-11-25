import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const shiftPolicyProto = loadProto('shift_policy');
const SHIFT_POLICY_SERVICE_ADDR =
  process.env.SHIFT_POLICY_SERVICE_ADDR || 'localhost:5065';

export const shiftPolicyClient = new shiftPolicyProto.ShiftPolicyService(
  SHIFT_POLICY_SERVICE_ADDR,
  grpc.credentials.createInsecure(),
);
