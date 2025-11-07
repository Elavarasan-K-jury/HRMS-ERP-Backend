import { loadProto, grpc } from '@jury-hrms/proto';

const OrgDesignation = loadProto('org_designation');
const ORG_DESG_SERVICE_ADDR = process.env.ORG_DESG_SERVICE_ADDR || 'localhost:50055';

export const orgDesignationClient = new OrgDesignation.OrgDesignationService(
    ORG_DESG_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);