import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const EmpOnboardingFlowProto = loadProto('emp_onboarding_flow');
const EMP_ONBOARDING_FLOW_SERVICE_ADDR = process.env.EMP_ONBOARDING_FLOW_SERVICE_ADDR || 'localhost:50057';

export const onboardingFlowClient = new EmpOnboardingFlowProto.EmployeeOnboardingFlowService(
    EMP_ONBOARDING_FLOW_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);