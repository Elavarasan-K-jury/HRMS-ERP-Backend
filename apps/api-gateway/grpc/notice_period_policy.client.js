import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const NoticePeriodPolicy = loadProto('notice_period_policy');
const NOTICE_PERIOD_POLICY_SERVICE_ADDR = process.env.NOTICE_PERIOD_POLICY_SERVICE_ADDR || 'localhost:5080';

export const noticePeriodPolicyClient = new NoticePeriodPolicy.NoticePeriodPolicyService(
    NOTICE_PERIOD_POLICY_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
