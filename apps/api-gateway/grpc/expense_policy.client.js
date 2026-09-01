import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const ExpensePolicy = loadProto('expense_policy');
const EXPENSE_POLICY_SERVICE_ADDR = process.env.EXPENSE_POLICY_SERVICE_ADDR || 'localhost:5067';

export const expensePolicyClient = new ExpensePolicy.ExpensePolicyService(
    EXPENSE_POLICY_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
