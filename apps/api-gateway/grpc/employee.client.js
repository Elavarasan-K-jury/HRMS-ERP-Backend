import { grpc, loadProto } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

// Load the compiled proto definition
const employeeProto = loadProto('employee');

// Use env variable or fallback
const EMP_SERVICE_ADDR = process.env.EMP_SERVICE_ADDR || 'localhost:50053';

// Export client instance
export const employeeClient = new employeeProto.EmployeeService(
    EMP_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
