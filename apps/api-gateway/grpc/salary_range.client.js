import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const SalaryRangeProto = loadProto('salary_range');

const SALARY_PAYROLL_SERVICE_ADDR = process.env.SALARY_PAYROLL_SERVICE_ADDR || 'localhost:50063';

export const SalaryRangeClient = new SalaryRangeProto.SalaryRangeService(
    SALARY_PAYROLL_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
