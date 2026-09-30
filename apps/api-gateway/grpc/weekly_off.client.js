import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';

dotenv.config();

const weeklyOffProto = loadProto('weekly_off');

// Prefer full ADDR (IPv4 127.0.0.1 avoids localhost → ::1 ECONNREFUSED)
const WEEKLY_OFF_SERVICE_ADDR =
    process.env.WEEKLY_OFF_SERVICE_ADDR ||
    `127.0.0.1:${process.env.WEEKLY_OFF_SERVICE_PORT || 5075}`;

console.log('[gateway] WEEKLY_OFF_SERVICE_ADDR =', WEEKLY_OFF_SERVICE_ADDR);

export const weeklyOffPolicyClient = new weeklyOffProto.WeeklyOffPolicyService(
    WEEKLY_OFF_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);

export const weeklyOffAssignmentClient = new weeklyOffProto.WeeklyOffAssignmentService(
    WEEKLY_OFF_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
