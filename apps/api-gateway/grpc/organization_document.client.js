import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const OrganizationDocument = loadProto('organization_document');
const ORG_DOCUMENT_SERVICE_ADDR = process.env.ORGANIZATION_DOCUMENT_SERVICE_ADDR || 'localhost:5070';

export const organizationDocumentClient = new OrganizationDocument.OrganizationDocumentService(
    ORG_DOCUMENT_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
