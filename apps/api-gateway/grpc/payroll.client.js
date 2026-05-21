import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const PayrollProto = loadProto('payroll');
const SALARY_PAYROLL_SERVICE_ADDR = process.env.SALARY_PAYROLL_SERVICE_ADDR || 'localhost:50063';

export const payrollClient = new PayrollProto.PayrollService(
    SALARY_PAYROLL_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);