import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const FinanceProto = loadProto('finance');

const SALARY_PAYROLL_SERVICE_ADDR = process.env.SALARY_PAYROLL_SERVICE_ADDR || 'localhost:50063';

export const financeClient = new FinanceProto.FinanceService(
    SALARY_PAYROLL_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
