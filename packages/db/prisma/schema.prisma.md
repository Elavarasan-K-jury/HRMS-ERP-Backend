# `schema.prisma` — Database Schema (MongoDB via Prisma)

Defines the complete Jury HRMS data model using Prisma's schema language, targeting MongoDB with `prisma-client-js` generator.

## Generator & Datasource

- **Generator**: `prisma-client-js`
- **Datasource**: `mongodb` with `DATABASE_URL` from env

## Core Business Models

### Admins
Platform administrators. Each admin has email, phone, and refresh/access tokens for auth.

```prisma
model Admins {
  id           String    @id @default(auto()) @map("_id") @db.ObjectId
  email        String
  phone        String
  accessToken  String?
  refreshToken String?
}
```

### Organizations
The central tenant model. Holds org profile, billing limits, notification preferences, and relates to nearly every other model (departments, employees, attendance, leave, assets, payroll, subscriptions, files, expenses).

Key limit fields: `maxEmployees` (20), `maxStorageInGB` (10), `maxApiRatePerMin` (1000), `maxPayrollRunsPerMonth` (1), `maxLeavePolicies` (5), `maxAdminAccounts` (3).

### OrganizationEmployees
Every employee belongs to an organization. Fields include personal info (`firstName`, `lastName`, `fullName`, `email`, `phone`, `gender`, `dateOfBirth`), auth tokens, designation, category, and relations to attendance, leave, assets, payroll, posts, and folders.

```prisma
enum Gender { MALE, FEMALE, OTHER }
```

### OrganizationDepartments & OrganizationDesignations
Hierarchical org structure. Departments optionally have a `departmentHead` (employee). Designations belong to a department and an organization, and employees can be assigned to them via `OrganizationDesignations`.

### EmployeeCategories
Defines employee types (permanent, trainee, etc.) with configurable training/probation/notice periods and an `idPrefix` for employee code generation.

## Attendance Models

### Attendance
Daily attendance record per employee. Tracks `checkIn`/`checkOut`, location (JSON), `grossHours`/`effectiveHours`, late minutes, status (`PENDING` / `PRESENT` / `ABSENT` / `LATE` / `HALF_DAY` / `HOLIDAY`), and mode (`OFFICE` / `WORK_FROM_HOME` / `ON_DUTY` / `PARTIAL_DAY`).

### AttendanceLogs
Each check-in/check-out/adjustment event with IP, geo-location, and source tracking.

### Shifts
Defines work shifts per organization with start/end time, break, weekly off days, and applicable days.

### EmployeeShiftAssignment
Maps employees to shifts with validity dates.

### AttendanceRegularisation
Employees can request attendance corrections with reason, status (`PENDING` / `APPROVED` / `REJECTED`), and approver tracking.

### AttendanceReports
Report generation tracking with status (`INITIATED` → `PROCESSING` → `COMPLETED` / `FAILED`), PDF URL, and timeline stamps.

## Leave Models

### LeaveTypes
Highly configurable leave policy per organization:
- Paid/unpaid, max per year, half-day allowance
- Carry-forward & encashment rules
- Gender restriction, probation eligibility
- Accrual configuration (frequency, rate, after how many days)
- Sandwich rule, max consecutive days
- Document requirement after N days

```prisma
model LeaveTypes {
  name              String
  code              String
  paid              Boolean  @default(true)
  maxPerYear        Int?
  carryForward      Boolean  @default(true)
  accrualEnabled    Boolean  @default(true)
  accrualFrequency  String   @default("monthly")
  monthlyAccrualRate Float?  @default(1.0)
}
```

### LeaveRequests
Employee leave applications with status workflow (`PENDING` → `APPROVED` / `REJECTED` / `CANCELLED`), half-day support, documents, cancellation tracking, and approval instance integration.

## Approval System

### ApprovalFlows
Configurable multi-level approval flows per entity type (`LEAVE`, `REGULARISATION`, `WORKDAY`).

### ApprovalFlowLevels
Each level has an `autoApproveDays` timeout and optional escalation role.

### ApprovalFlowApprovers
Assigns a specific user or role (`MANAGER` / `HR` / `LEAD`) to each approval level.

### ApprovalInstance
Tracks the current state of an approval request with `currentLevel`, status, and linked logs.

### ApprovalLogs
Audit trail of every approval action (`APPROVED`, `REJECTED`, `AUTO_APPROVED`) with timestamps and remarks.

## Workday Requests

### WorkdayRequests
Covers `WORK_FROM_HOME`, `ON_DUTY`, and `PARTIAL_DAY` requests with date/time ranges, approval workflow, and link to attendance.

## Asset Management

### AssetCategories → AssetModels → Assets → AssetAssignments → AssetCondition → AssetRequest
Full asset lifecycle: categories (Laptop, Monitor), models (MacBook Pro M3), individual assets with serial/asset tag, assignments to employees, condition reports, and asset requests with priority (`CRITICAL` → `NEGLIGIBLE`).

## Payroll Models

### ComponentDefinition
Library of payroll components (`basic`, `hra`, `pf_employee`) — each with type (`earning` / `deduction` / `reimbursement`), formula, taxability flags, and display order.

### SalaryTemplate
Reusable salary structures with versioning (`baseTemplateId` → versions), department/designation scoping, and gross/CTC ranges (`SalaryTemplateRange`).

### TemplateComponent
Links a `ComponentDefinition` to a `SalaryTemplate` with formula override, fixed value, priority, and optional range association.

### SalaryStructure
Employee-specific salary with effective dates, computed totals (`totalEarnings`, `totalDeductions`, `inHandMonthly`, etc.), and status (`ACTIVE` / `INACTIVE` / `SUPERSEDED`).

### StructureComponent
Breakdown of each component in an employee's salary structure — annual & monthly amounts, with override support.

### SalaryRevision
History of salary changes: type (`INCREMENT` / `PROMOTION`), previous/new gross, change percent/amount, approval tracking.

### Payslip
Monthly payslip with earnings/deductions/net pay, working days, arrears/bonus/penalty, and payment info. Status lifecycle: `DRAFT` → `GENERATED` → `APPROVED` → `PAID`.

### PayslipComponent
Line items on a payslip showing component name, type, and amount.

## Post / Social Feed

### Posts
Organization-wide feed posts with optional image, tags, and voting poll flag.

### PostOptions / PostVotes
Poll options and employee votes on poll posts.

### PostLikes / PostComments / PostSaves / PostShares
Social engagement tracking per post.

## Subscription & Billing

### SubscriptionPlans
Pricing plans with monthly/yearly prices, GST, trial days, and feature definitions via `SubscriptionPlanFeatures`.

### OrganizationSubscriptions
Links an organization to a plan with status (`TRIAL` → `ACTIVE` → `PAST_DUE` → `SUSPENDED` → `CANCELLED` → `EXPIRED`), billing interval, price snapshot, and cancel-at-period-end support.

### Invoices
Invoice generation with unique number, amount/tax/total, Razorpay payment link, order ID, and status workflow (`DRAFT` → `ISSUED` → `PAID` / `FAILED` / `CANCELLED`).

### SubscriptionUsageSnapshot
Tracks usage metrics per period (API requests, storage, employee count) against plan limits.

### SubscriptionChangeLog
Audit trail of plan changes (UPGRADE / DOWNGRADE / RENEW / CANCEL).

## Document Management

### Folders
Organizational file folders with visibility (`PUBLIC` / `SHARED` / `PRIVATE`), storage tracking, and employee sharing (`FolderSharedWithEmployees`).

### Files
Individual files linked to a folder, with URL, key, storage size, and uploader tracking.

## HR Configuration

### Holidays
Organization holidays with type (`PUBLIC` / `RESTRICTED` / `OPTIONAL` / `WEEK_OFF` / `COMPANY_EVENT`), linked to holiday policies.

### AttendancePolicies
Configurable attendance rules: grace period, half-day/full-day thresholds, geo-fencing, overtime, rounding strategy.

### ShiftPolicies
Shift-specific policies: rotational shifts, night shift windows, grace periods.

### HolidayPolicies
Region-based holiday policies scoped to branches/depts, linked to holidays.

### NetworkPolicies
IP-based network enforcement for login or attendance.

### GeoFences
Location-based geofences with lat/lng and radius for attendance verification.

### PayslipTemplates
EJS-based customizable payslip templates with variable definitions per organization.

### EmployeeOnboardingFlows / EmployeeOnboardingSteps / OnboardingStepFeatures / OnboardingProgress
Configurable employee onboarding checklists with steps, features (form fields), and per-employee progress tracking.

## Finance

### OrgaizationFinance
Organization-level finance configuration: PF/ESI/PTax formulas, registration numbers, enablement flags.

### Expenses
Employee expense reports with type (`TRAVEL` / `FOOD` / `ACCOMMODATION` / `OTHER`), amount, receipt, status, and approver workflow.

## Traffic / Observability

### TrafficEvent
Raw API/log event store with service, module, endpoint, method, status code, latency, user agent, and geo. Indexed on `[timestamp]`, `[service, timestamp]`, `[organizationId, timestamp]`.

### TrafficHourlyStat / TrafficDailyStat
Aggregated traffic statistics (request count, success/error, latency percentiles, unique users).

### TrafficAlertRule / TrafficAlert
Configurable alert rules (`ERROR_RATE` / `LATENCY_P95` / `REQUEST_SPIKE`) with threshold, cooldown, and triggered alerts.

### OrganizationUsageEvent
Granular usage tracking per organization per module/feature/action with duration, success/failure, and normalized date.

## Utility

### InvoiceCounter
Yearly auto-incrementing counter for invoice number generation.

### Otps
One-time passwords for authentication with purpose, linked to admin or employee and organization.

## Dependencies

- Prisma CLI (`prisma-client-js` generator)
- MongoDB
