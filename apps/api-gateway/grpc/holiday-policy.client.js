import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const holidayPolicyProto = loadProto('holiday_policy');  // ✅ FIXED

const HOLIDAY_POLICY_SERVICE_ADDR =
    process.env.HOLIDAY_POLICY_SERVICE_ADDR || 'localhost:5080';

console.log('holiday-policy.client.js @ Line 10:', HOLIDAY_POLICY_SERVICE_ADDR);

export const holidayPolicyClient = new holidayPolicyProto.HolidayPolicyService(
    HOLIDAY_POLICY_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
