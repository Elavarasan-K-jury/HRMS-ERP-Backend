import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const Location = loadProto('location');
const LOCATION_SERVICE_ADDR = process.env.LOCATION_SERVICE_ADDR || '127.0.0.1:50068';

export const locationClient = new Location.LocationService(
    LOCATION_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);