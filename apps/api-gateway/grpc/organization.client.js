import { loadProto, grpc } from '@jury-hrms/proto';

const organizationProto = loadProto('organization');
const ORG_SERVICE_ADDR = process.env.ORG_SERVICE_ADDR || 'localhost:50051';

export const orgClient = new organizationProto.OrganizationService(
    ORG_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
