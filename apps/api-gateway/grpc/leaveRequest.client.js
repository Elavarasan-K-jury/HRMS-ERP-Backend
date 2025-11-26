import { loadProto, grpc } from '@jury-hrms/proto';

const leaveRequestProto = loadProto('leave_request');

// SAME pattern as leaveTypeClient
const LEAVE_REQUEST_SERVICE_ADDR =
    process.env.LEAVE_REQUEST_SERVICE_ADDR || 'localhost:5078';

export const leaveRequestClient = new leaveRequestProto.LeaveRequestService(
    LEAVE_REQUEST_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
