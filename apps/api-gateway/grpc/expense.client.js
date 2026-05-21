import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const ExpenseProto = loadProto('expense');
const SALARY_PAYROLL_SERVICE_ADDR = process.env.SALARY_PAYROLL_SERVICE_ADDR || 'localhost:50063';

export const expenseClient = new ExpenseProto.ExpenseService(
    SALARY_PAYROLL_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);