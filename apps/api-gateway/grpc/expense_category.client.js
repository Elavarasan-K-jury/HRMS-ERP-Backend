import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const ExpenseCategory = loadProto('expense_category');
const EXPENSE_CATEGORY_SERVICE_ADDR = process.env.EXPENSE_CATEGORY_SERVICE_ADDR || 'localhost:5066';

export const expenseCategoryClient = new ExpenseCategory.ExpenseCategoryService(
    EXPENSE_CATEGORY_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
