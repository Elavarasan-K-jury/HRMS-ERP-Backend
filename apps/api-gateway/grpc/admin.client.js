import { loadProto, grpc } from '@jury-hrms/proto';

const adminProto = loadProto('admin');
const ADMIN_SERVICE_ADDR = process.env.ADMIN_SERVICE_ADDR || 'localhost:50054';

export const adminClient = new adminProto.AdminService(
    ADMIN_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
