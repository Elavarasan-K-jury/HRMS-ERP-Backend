import { grpc, loadProto } from '@jury-hrms/proto';

const employeeCategoryProto = loadProto('employee_category');
const EMP_CAT_SERVICE_ADDR = process.env.EMP_CAT_SERVICE_ADDR || 'localhost:50052';

export const employeeClient = new employeeCategoryProto.EmployeeCategoryService(
    EMP_CAT_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
