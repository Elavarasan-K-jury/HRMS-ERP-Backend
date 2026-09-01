import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const storageProto = loadProto('storage');
const STORAGE_SERVICE_ADDR = process.env.STORAGE_SERVICE_ADDR || 'localhost:5084';
console.log(STORAGE_SERVICE_ADDR);

const MAX_MESSAGE_BYTES = 50 * 1024 * 1024; // 50 MB

export const storageClient = new storageProto.StorageService(
    STORAGE_SERVICE_ADDR,
    grpc.credentials.createInsecure(),
    {
        'grpc.max_send_message_length': MAX_MESSAGE_BYTES,
        'grpc.max_receive_message_length': MAX_MESSAGE_BYTES,
    }
);