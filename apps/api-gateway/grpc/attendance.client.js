import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const AttendanceProto = loadProto('attendance');

const ATTENDANCE_SERVICE_ADDR =
  process.env.ATTENDANCE_SERVICE_ADDR || 'localhost:50062';

export const attendanceClient = new AttendanceProto.AttendanceService(
  ATTENDANCE_SERVICE_ADDR,
  grpc.credentials.createInsecure()
);