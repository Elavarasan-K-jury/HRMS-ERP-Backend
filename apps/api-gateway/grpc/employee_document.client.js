import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const EmployeeDocument = loadProto('employee_document');
const EMPLOYEE_DOCUMENT_SERVICE_ADDR = process.env.EMPLOYEE_DOCUMENT_SERVICE_ADDR || 'localhost:5068';

export const employeeDocumentClient = new EmployeeDocument.EmployeeDocumentService(
    EMPLOYEE_DOCUMENT_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
