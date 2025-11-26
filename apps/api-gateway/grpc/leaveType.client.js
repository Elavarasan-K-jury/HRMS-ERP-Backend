import { loadProto, grpc } from '@jury-hrms/proto';

const leaveTypeProto = loadProto('leave_type');
const LEAVE_TYPE_SERVICE_ADDR = process.env.LEAVE_TYPE_SERVICE_ADDR || 'localhost:5077';

export const leaveTypeClient = new leaveTypeProto.LeaveTypeService(
    LEAVE_TYPE_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
