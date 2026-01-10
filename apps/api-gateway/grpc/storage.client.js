import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const storageProto = loadProto('storage');
const STORAGE_SERVICE_ADDR = process.env.STORAGE_SERVICE_ADDR || 'localhost:5084';
console.log(STORAGE_SERVICE_ADDR);

export const storageClient = new storageProto.StorageService(
    STORAGE_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);