import { loadProto, grpc } from '@jury-hrms/proto';

const OrgDepartment = loadProto('org_department');
const ORG_DEP_SERVICE_ADDR = process.env.ORG_DEPT_SERVICE_ADDR || 'localhost:50054';

export const orgDepartmentClient = new OrgDepartment.OrgDepartmentService(
    ORG_DEP_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
