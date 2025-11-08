import { loadProto, grpc } from '@jury-hrms/proto';

const EmpOnboardingFeatureProto = loadProto('emp_onboarding_feature');
const EMP_ONBOARDING_FEATURE_SERVICE_ADDR = process.env.EMP_ONBOARDING_FEATURE_SERVICE_ADDR || 'localhost:50059';

export const onboardingFeatureClient = new EmpOnboardingFeatureProto.EmployeeOnboardingFeatureService(
    EMP_ONBOARDING_FEATURE_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);