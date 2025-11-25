import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const shiftAssignmentProto = loadProto('shift_assignment');
const SHIFT_ASSIGNMENT_SERVICE_ADDR = process.env.SHIFT_ASSIGNMENT_SERVICE_ADDR || 'localhost:5064';

export const shiftAssignmentClient = new shiftAssignmentProto.ShiftAssignmentService(
  SHIFT_ASSIGNMENT_SERVICE_ADDR,
  grpc.credentials.createInsecure()
);
