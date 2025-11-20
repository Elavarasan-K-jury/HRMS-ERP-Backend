// src/grpc/attendance_log.client.js
import { loadProto, grpc } from '@jury-hrms/proto';

const attendanceLogProto = loadProto('attendance_log'); 
// 👆 change string if your proto name is different

const ATTENDANCE_LOG_SERVICE_ADDR =
  process.env.ATTENDANCE_LOG_SERVICE_ADDR || 'localhost:5067';

export const attendanceLogClient = new attendanceLogProto.AttendanceLogService(
  ATTENDANCE_LOG_SERVICE_ADDR,
  grpc.credentials.createInsecure(),
);
