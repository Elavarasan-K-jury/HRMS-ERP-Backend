import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const Band = loadProto('band');
const BAND_SERVICE_ADDR = process.env.BAND_SERVICE_ADDR || 'localhost:50073';

export const bandClient = new Band.BandsService(
    BAND_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);