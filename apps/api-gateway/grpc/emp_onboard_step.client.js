import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const EmpOnboardingStepProto = loadProto('emp_onboarding_step');
const EMP_ONBOARDING_STEP_SERVICE_ADDR = process.env.EMP_ONBOARDING_STEP_SERVICE_ADDR || 'localhost:50058';

export const onboardingStepClient = new EmpOnboardingStepProto.EmployeeOnboardingStepService(
    EMP_ONBOARDING_STEP_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);