import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const PayGrade = loadProto('pay_grade');
const PAY_GRADE_SERVICE_ADDR = process.env.PAY_GRADE_SERVICE_ADDR || 'localhost:50072';

export const payGradeClient = new PayGrade.PayGradeService(
    PAY_GRADE_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
