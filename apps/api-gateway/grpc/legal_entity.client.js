import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const LegalEntity = loadProto('legal_entity');
const LEGAL_ENTITY_SERVICE_ADDR =
    process.env.LEGAL_ENTITY_SERVICE_ADDR || '127.0.0.1:5070';

export const legalEntityClient = new LegalEntity.LegalEntityService(
    LEGAL_ENTITY_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);