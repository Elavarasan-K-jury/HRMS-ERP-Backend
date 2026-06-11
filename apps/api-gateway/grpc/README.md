# gRPC Client Files — Pattern Documentation

All gRPC client files under `grpc/*.client.js` follow an identical pattern. Each file creates a single gRPC service client instance and exports it.

## Universal Pattern

Every client file:

1. **Loads the proto definition** using `@jury-hrms/proto`
2. **Reads the service address** from an environment variable
3. **Creates and exports** a gRPC client instance with insecure credentials

```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const someProto = loadProto('some_service');
const SERVICE_ADDR = process.env.SOME_SERVICE_ADDR || 'localhost:50XXX';

export const someClient = new someProto.SomeService(
    SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Files and Service Mappings

| File | Proto Service | Env Variable | Default Port |
|---|---|---|---|
| `organization.client.js` | `OrganizationService` | `ORG_SERVICE_ADDR` | 50051 |
| `employee.client.js` | `EmployeeService` | `EMP_SERVICE_ADDR` | 50053 |
| `employee-category.client.js` | `EmployeeCategoryService` | `EMP_CAT_SERVICE_ADDR` | — |
| `admin.client.js` | `AdminService` | `ADMIN_SERVICE_ADDR` | — |
| `org_department.client.js` | `OrgDepartmentService` | `ORG_DEPT_SERVICE_ADDR` | — |
| `org_designation.client.js` | `OrgDesignationService` | `ORG_DESG_SERVICE_ADDR` | — |
| `emp_department.client.js` | `EmpDepartmentService` | `EMP_DEPT_SERVICE_ADDR` | — |
| `emp_onboard_flow.client.js` | `EmployeeOnboardingFlowService` | `EMP_ONBOARDING_FLOW_SERVICE_ADDR` | — |
| `emp_onboard_step.client.js` | `EmployeeOnboardingStepService` | `EMP_ONBOARDING_STEP_SERVICE_ADDR` | — |
| `emp_onboard_feature.client.js` | `EmployeeOnboardingFeatureService` | `EMP_ONBOARDING_FEATURE_SERVICE_ADDR` | — |
| `emp_onboard_progress.client.js` | `EmployeeOnboardingProgressService` | `EMP_ONBOARDING_PROGRESS_SERVICE_ADDR` | — |
| `shift.client.js` | `ShiftService` | `SHIFT_SERVICE_ADDR` | 5063 |
| `shift_assignment.client.js` | `ShiftAssignmentService` | `SHIFT_ASSIGNMENT_SERVICE_ADDR` | — |
| `shift_policy.client.js` | `ShiftPolicyService` | `SHIFT_POLICY_SERVICE_ADDR` | — |
| `attendance.client.js` | `AttendanceService` | `ATTENDANCE_SERVICE_ADDR` | — |
| `attendance_log.client.js` | `AttendanceLogService` | `ATTENDANCE_LOG_SERVICE_ADDR` | — |
| `approval.client.js` | `ApprovalService` | `APPROVAL_SERVICE_ADDR` | — |
| `asset_category.client.js` | `AssetCategoryService` | `ASSET_CAT_SERVICE_ADDR` | — |
| `asset_model.client.js` | `AssetModelService` | `ASSET_MOD_SERVICE_ADDR` | — |
| `assets.client.js` | `AssetService` | `ASSETS_SERVICE_ADDR` | — |
| `asset_request.client.js` | `AssetRequestService` | `ASSET_REQ_SERVICE_ADDR` | — |
| `asset_assignment.client.js` | `AssetAssignmentService` | `ASSET_ASSIGN_SERVICE_ADDR` | — |
| `asset_condition.client.js` | `AssetConditionService` | `ASSET_CON_SERVICE_ADDR` | — |
| `post_poll.client.js` | `PostPollService` | `POST_POLL_SERVICE_ADDR` | — |
| `leaveType.client.js` | `LeaveTypeService` | `LEAVE_TYPE_SERVICE_ADDR` | — |
| `leaveRequest.client.js` | `LeaveRequestService` | `LEAVE_REQUEST_SERVICE_ADDR` | — |
| `holiday.client.js` | `HolidayService` | `HOLIDAY_SERVICE_ADDR` | — |
| `holiday-policy.client.js` | `HolidayPolicyService` | `HOLIDAY_POLICY_SERVICE_ADDR` | — |
| `salary.client.js` | `SalaryService` | — | — |
| `salary_template.client.js` | `SalaryTemplateService` | — | — |
| `salary_range.client.js` | `SalaryRangeService` | — | — |
| `finance.client.js` | `FinanceService` | — | — |
| `report.client.js` | `ReportService` | — | — |
| `storage.client.js` | `StorageService` | — | — |
| `subscription.client.js` | `SubscriptionPlanService` | — | — |
| `organization_subscription.client.js` | `OrganizationSubscriptionService` | — | — |
| `invoice.client.js` | `InvoiceService` | — | — |
| `payslip.client.js` | `PayslipService` | — | — |
| `expense.client.js` | `ExpenseService` | — | — |
| `payroll.client.js` | `PayrollService` | — | — |
| `regularization.client.js` | `RegularizationService` | — | — |
| `component_definition.client.js` | `ComponentDefinitionService` | — | — |

## Dependencies
- `@jury-hrms/proto` — Shared proto loading and gRPC library wrapper
- `dotenv` — Environment variable loading

## Patterns
- **Single-instance singleton**: Each file creates exactly one client instance at module load time.
- **Environment-configured addresses**: All service endpoints are configured via environment variables with localhost fallbacks.
- **Insecure credentials**: All clients use `grpc.credentials.createInsecure()` (suitable for internal service mesh).
- **Consistent naming**: Exports follow the pattern `{serviceName}Client` (e.g., `orgClient`, `employeeClient`).
