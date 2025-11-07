import { loadProto, grpc } from '@jury-hrms/proto';

const EmpOnboardingProgressProto = loadProto('emp_onboarding_progress');
const EMP_ONBOARDING_PROGRESS_SERVICE_ADDR = process.env.EMP_ONBOARDING_PROGRESS_SERVICE_ADDR || 'localhost:50061';

export const onboardingProgressClient = new EmpOnboardingProgressProto.EmployeeOnboardingProgressService(
    EMP_ONBOARDING_PROGRESS_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);