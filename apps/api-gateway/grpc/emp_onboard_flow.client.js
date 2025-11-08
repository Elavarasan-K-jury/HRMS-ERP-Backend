import { loadProto, grpc } from '@jury-hrms/proto';

const EmpOnboardingFlowProto = loadProto('emp_onboarding_flow');
const EMP_ONBOARDING_FLOW_SERVICE_ADDR = process.env.EMP_ONBOARDING_FLOW_SERVICE_ADDR || 'localhost:50057';

export const onboardingFlowClient = new EmpOnboardingFlowProto.EmployeeOnboardingFlowService(
    EMP_ONBOARDING_FLOW_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);