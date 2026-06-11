# JuryHRMS Backend — Complete Feature Documentation

**JuryHRMS** is a microservices-based Human Resource Management System built with **Node.js 20**, using **gRPC** for inter-service communication, **MongoDB 7** (via Prisma ORM) as the primary database, **Redis 7** for caching, rate limiting, and pub/sub, and a **Hono-based REST API Gateway** that proxies to gRPC microservices.

The system comprises **33 gRPC microservices**, **4 application services**, and **7 shared packages**.

---

## Table of Contents

1. [Core Infrastructure](#1-core-infrastructure)
   - 1.1 API Gateway
   - 1.2 Traffic Reporting Service
   - 1.3 Usage Reporting Service (WebSocket)
   - 1.4 Invoice Generator Service (Cron)
2. [Shared Packages](#2-shared-packages)
   - 2.1 Proto Package
   - 2.2 Database Package
   - 2.3 Redis Package
   - 2.4 Auth Package
   - 2.5 Mailer Package
   - 2.6 File Storage Package
   - 2.7 Payments Package
3. [Organization & Employee Management](#3-organization--employee-management)
   - 3.1 Organization Management
   - 3.2 Admin Management
   - 3.3 Employee Management
   - 3.4 Employee Categories
   - 3.5 Departments
   - 3.6 Designations
   - 3.7 Employee-Department Assignment
4. [Employee Onboarding](#4-employee-onboarding)
   - 4.1 Onboarding Flows
   - 4.2 Onboarding Steps
   - 4.3 Onboarding Features
   - 4.4 Onboarding Progress Tracking
5. [Attendance & Time Management](#5-attendance--time-management)
   - 5.1 Attendance Management
   - 5.2 Attendance Logs
   - 5.3 Attendance Regularisation
   - 5.4 Shift Management
   - 5.5 Shift Policies
   - 5.6 Shift Assignments
6. [Holiday & Leave Management](#6-holiday--leave-management)
   - 6.1 Holiday Management
   - 6.2 Holiday Policies
   - 6.3 Leave Types
   - 6.4 Leave Requests
7. [Approval Engine](#7-approval-engine)
   - 7.1 Approval Flow Configuration
   - 7.2 Approval Instances
8. [Asset Management](#8-asset-management)
   - 8.1 Asset Categories
   - 8.2 Asset Models
   - 8.3 Asset Inventory
   - 8.4 Asset Requests
   - 8.5 Asset Assignments
   - 8.6 Asset Condition Reports
9. [Social & Communication](#9-social--communication)
   - 9.1 Posts & Polls
10. [Salary & Payroll](#10-salary--payroll)
    - 10.1 Component Definitions
    - 10.2 Salary Templates
    - 10.3 Salary Ranges
    - 10.4 Salary Assignment
    - 10.5 Salary Revisions
    - 10.6 Payslip Management
    - 10.7 Payroll Processing
    - 10.8 Organization Finance (Statutory Compliance)
    - 10.9 Expense Management
11. [Subscription & Billing](#11-subscription--billing)
    - 11.1 Subscription Plans
    - 11.2 Organization Subscriptions
    - 11.3 Invoice Management
12. [File Storage](#12-file-storage)
    - 12.1 Folder Management
    - 12.2 File Management
    - 12.3 Folder Sharing
13. [Reports](#13-reports)
    - 13.1 Employee Insight Reports

---

## 1. Core Infrastructure

### 1.1 API Gateway

The API Gateway is the central REST entry point for the entire system, running on port **50050**. Built with **Hono** framework, it provides OpenAPI/Zod schema validation with a Swagger UI at the `/swagger` endpoint.

**Security Features:**

- **CORS with IP/Domain Allowlisting**: Restricts incoming requests based on allowlisted IP addresses and domains. Supports regex-based matching including wildcard patterns (e.g., `192.168.68.*`). Controlled via `ALLOWED_IPS` and `ALLOWED_DOMAINS` environment variables.
- **IP Whitelisting Middleware**: Blocks requests from IP addresses that are not explicitly allowlisted.
- **Rate Limiting**: Redis-backed rate limiting that operates per organization. Each organization has a configurable time window and maximum request count, preventing abuse.

**Request Processing:**

- **Request Queuing**: Incoming requests are placed in a queue managed by `p-queue` to control concurrency and prevent service overload.
- **Traffic Logging Middleware**: Every request and response is captured and published as a `TrafficEvent` record in MongoDB. A publisher queue handles this asynchronously to avoid blocking the request flow.
- **Usage Tracking Middleware**: Records per-organization usage events (`OrganizationUsageEvent`) capturing the module, feature, action, latency, and success/error status. This feeds into the Usage Reporting Service for real-time dashboards.
- **Service Metrics**: Tracks real-time metrics per downstream gRPC service, including in-flight request count, latency distribution, and success/error rates.
- **Request Logger**: Logs all incoming requests for debugging and auditing.

**Routing:**

- **Static File Serving**: Serves uploaded files from the `uploads/` directory at the `/uploads/*` route.
- **Route-to-Service Detection**: Automatically determines which gRPC microservice a request should be forwarded to based on URL path prefixes. For example, paths starting with `/employees` are routed to the employee service.
- **42 Registered Route Files**: Covering every domain — organizations, employees, categories, departments, designations, onboarding, shifts, attendance, leave, holidays, assets, posts/polls, approvals, salary/payroll, reports, subscriptions, invoices, storage, expenses, finance, and health checks.

---

### 1.2 Traffic Reporting Service

Runs on port **50064** and provides real-time API traffic analytics with REST endpoints for super-admins. Includes automated cron-based aggregation and anomaly detection.

**Cron Jobs:**

| Job | Schedule | Description |
|-----|----------|-------------|
| Hourly Aggregation | Every 5 minutes | Aggregates raw `TrafficEvent` records into `TrafficHourlyStat` documents containing request counts, success/error breakdowns, average/p95/p99 latency percentiles, and unique user counts. |
| Daily Aggregation | Daily at 00:20 | Rolls up hourly statistics into `TrafficDailyStat` records for historical trend analysis. |
| Anomaly Detection | Every 1 minute | Evaluates all configured `TrafficAlertRule` configurations. If a threshold is breached — such as error rate, p95 latency, or request volume spike — and the minimum request threshold is met, a `TrafficAlert` is created. Includes cool-down logic to prevent alert fatigue. |
| Retention Cleanup | Daily at 00:30 | Purges raw traffic event records that exceed the configured retention period. |

**Data Models:**

- **TrafficEvent**: Raw request/response record containing service name, endpoint, HTTP method, status code, latency, IP address, user agent, and timestamp.
- **TrafficHourlyStat**: Pre-aggregated hourly statistics with request counts, latency percentiles, error counts, and unique user counts.
- **TrafficDailyStat**: Daily rollup of hourly statistics.
- **TrafficAlertRule**: User-configurable alert rules defining threshold conditions, evaluation windows, and minimum request requirements.
- **TrafficAlert**: Generated alert records when a rule is breached, including severity, rule reference, actual vs. threshold values, and timestamps.

**Super Admin APIs:** REST endpoints for querying traffic statistics, managing alert rules, and viewing alert history.

---

### 1.3 Usage Reporting Service (WebSocket)

Runs on port **50065** and provides real-time organization usage metrics via **Socket.IO** WebSocket connections.

**Features:**

- **WebSocket Real-time Dashboard**: Authenticated connections (via JWT) join organization-specific rooms and receive:
  - `usage:metrics` — Current requests per second (RPS), error count, error rate, average latency, and p95 latency.
  - `usage:timeseries` — Historical minute-bucketed time series data covering the last 30 minutes.
- **In-memory Rolling Window State**: Maintains an O(1) per-organization sliding window of 60 one-second buckets with latency histograms. This allows instant metric computation without database queries.
- **Database Warm-up**: When a client connects, the service loads the last 30 minutes of `OrganizationUsageEvent` records from MongoDB to populate the initial state.
- **Poller**: Periodically polls for new `OrganizationUsageEvent` records from MongoDB and broadcasts updates to all connected WebSocket clients. The poll interval is configurable via the `POLL_MS` environment variable.
- **Health Endpoint**: A `/health` endpoint returns JSON status for monitoring.

**Data Model:**

- **OrganizationUsageEvent**: Records per-feature usage including module name, feature name, action performed, resource identifier, source (API/user), latency, and success/error status.

---

### 1.4 Invoice Generator Service (Cron)

Runs as a background job process (no gRPC port) responsible for automated invoice generation and payment link management.

**Cron Jobs:**

| Job | Schedule | Description |
|-----|----------|-------------|
| Invoice Generation | Daily at 02:00 | Scans organization subscriptions nearing their billing period end and auto-generates invoices using Razorpay payment links. Uses Puppeteer for PDF generation. |
| Payment Link Expiry | Every 5 minutes | Checks invoices whose `paymentLinkExpiredBy` timestamp has passed and marks them as CANCELLED. |

**Data Models:**

- **Invoices**: Generated billing documents with invoice number, amount, tax, total, billing period, status, Razorpay order ID, payment link, and payment status.
- **InvoiceCounter**: Year-based auto-incrementing sequence counter for generating unique invoice numbers (e.g., INV-2024-0001).

---

## 2. Shared Packages

### 2.1 Proto Package (`@jury-hrms/proto`)

Dynamic gRPC protobuf loader using `@grpc/proto-loader`. Loads `.proto` definition files and provides the shared protocol buffer definitions used by all gRPC microservices for type-safe inter-service communication.

---

### 2.2 Database Package (`@jury-hrms/db`)

Singleton **Prisma Client** configured for MongoDB 7. Exports:

- **prisma**: A shared, configured Prisma client instance used by all services to interact with MongoDB. Avoids connection pool exhaustion by maintaining a single instance.
- **checkDbConnection()**: Health check function that pings the database to verify connectivity.

---

### 2.3 Redis Package (`@jury-hrms/redis`)

Redis utilities built on top of **ioredis** providing:

- **Singleton Client**: `getRedis()` returns a shared ioredis instance, preventing multiple connections.
- **Hash Helpers**: `hsetObject`, `hgetObject`, `hdel`, `expire` for working with Redis hash data structures.
- **JSON Cache**: `setJSON`/`getJSON` functions with configurable TTL support for caching serialized objects.
- **Generic Cache Wrapper**: `cache(key, ttl, fetcher)` implements the cache-aside pattern — checks Redis first; on a cache miss, calls the fetcher function and stores the result with the specified TTL.
- **Pub/Sub**: `publish`, `subscribe`, `getSubscriber` for inter-service event broadcasting. Uses a separate subscriber connection to avoid blocking the main Redis client.
- **Distributed Locks**: `getLock`/`runWithLock` using the **redlock** algorithm for distributed mutual exclusion across service instances.
- **Namespaced Key Helpers**: A `keys` utility providing consistent, namespaced Redis key patterns across all services.

---

### 2.4 Auth Package (`@jury-hrms/auth`)

JWT authentication library using the **jose** library:

- **signAccessToken(payload)**: Signs an HS256 JWT with a short configurable expiry (default accessible via `JWT_ACCESS_EXPIRES_IN`).
- **signRefreshToken(payload)**: Signs an HS256 JWT for refresh tokens with a longer configurable expiry.
- **verifyToken(token)**: Verifies the JWT signature, checks expiry, and returns the decoded payload.

Configuration is driven by `JWT_SECRET`, `JWT_ACCESS_EXPIRES_IN`, and `JWT_REFRESH_EXPIRES_IN` environment variables.

---

### 2.5 Mailer Package (`@jury-hrms/mailer`)

Email notification service using **Nodemailer** with configurable SMTP transport and connection pooling:

- **sendOtpEmail(to, otp, ttlMinutes)**: Sends a one-time password email with an HTML template displaying the OTP and its time-to-live.
- **sendOnboardEmail(...)**: Sends an onboarding welcome email to newly created employees with relevant instructions.
- **sendInvoiceEmail(...)**: Sends an invoice email with a PDF attachment and a payment link.
- **sendExpenseNotificationEmail(...)**: Notifies designated approvers when a new expense request is submitted.
- **sendExpenseStatusUpdateEmail(...)**: Notifies employees when their expense request status changes (approved/rejected).
- **sendFinanceEnabledEmail(...)**: Notifies relevant parties when an organization's finance features are enabled.

Supports connection pooling via `SMTP_POOL=true` configuration.

---

### 2.6 File Storage Package (`@jury-hrms/files`)

Abstract file storage service supporting two backends:

- **Local Filesystem**: Saves files to a configurable `LOCAL_STORAGE_PATH` directory on the server.
- **AWS S3**: Uploads files to an S3 bucket with configurable AWS credentials and region.

**Methods:**

- **upload(buffer, originalName, storePath)**: Generates UUID-based filenames, detects MIME types, and stores the file. Returns the storage key/URL.
- **get(fileKey)**: Retrieves a file as a buffer by its key.
- **delete(filePathOrKey)**: Deletes a file from the configured storage backend.

The backend selection is transparent to the calling services, allowing seamless switching between local and cloud storage.

---

### 2.7 Payments Package (`@jury-hrms/payments`)

**Razorpay** payment gateway integration providing:

- **Order Creation**: Creates Razorpay orders for payment processing.
- **Payment Link Generation**: Generates Razorpay payment links that can be sent to customers for payment.
- **Payment Verification**: Verifies payment signatures to confirm successful payments.

---

## 3. Organization & Employee Management

### 3.1 Organization Management

Runs on port **50055**. Manages the core organization entity.

**gRPC Methods:**

- **CreateOrganization**: Creates a new organization with domain uniqueness enforcement. If a soft-deleted organization exists with the same domain, it is restored rather than creating a duplicate. Enforces configurable limits including maximum employees, storage capacity, API rate limits, payroll runs, leave policies, and admin accounts.
- **GetOrganization**: Fetches an organization by its ID with validation.
- **ListOrganizations**: Paginated listing with search (by name, domain, industry), sorting by multiple fields.
- **UpdateOrganization**: Partial updates of any organization properties.
- **DeleteOrganization**: Soft deletion by setting the `deletedAt` timestamp. All related queries filter out deleted records.

**Hierarchy Features:**

- **DepartmentHierarchy**: Builds a complete reporting tree for a given department. Identifies the department head, maps all employees with their reporting relationships, attaches orphan employees (those without a manager) to the department head, and returns a recursive tree structure.
- **OrganizationHierarchy**: Builds an organization-wide hierarchy organized by the 9-tier designation level system (Entry → Junior → Intermediate → Senior → Lead → Managerial → Senior Management → Executive → Board/Governance). Provides counts and employee lists per level.

**Entity:** `Organizations`

---

### 3.2 Admin Management

Runs on port **50031**. Handles admin (super-admin/system administrator) authentication and management.

**gRPC Methods:**

- **RequestLoginOtp**: Generates a 6-digit one-time password for admin login. In development mode, the OTP is static (`123456`); in production, it is randomly generated. The OTP is stored in the `Otps` table with a TTL and sent to the admin's email.
- **VerifyLoginOtp**: Validates the provided OTP against the stored record with TTL enforcement (configurable via `OTP_TTL_MS`). On success, issues a JWT access token and a refresh token, and stores both tokens on the admin record for server-side validation.
- **VerifyToken**: Validates the JWT token and returns admin details.
- **RefreshTokens**: Rotates both the access and refresh tokens. Verifies the current refresh token against the stored value on the admin record before issuing new tokens, providing an additional security layer.
- **CreateAdmin**: Creates a new admin with email and phone number.
- **GetAdmin**: Fetches admin details by ID.
- **ListAdmins**: Paginated listing with search.
- **UpdateAdmin**: Partial updates of admin properties.
- **DeleteAdmin**: Soft deletion.

**Entities:** `Admins`, `Otps`

---

### 3.3 Employee Management

Runs on port **50048**. Manages employee records and employee authentication.

**gRPC Methods:**

- **CreateEmployee**: Creates an employee with an auto-generated employee code following the pattern `{category.idPrefix}-{totalEmployees+1}`. Enforces organization-level maximum employee limits and maximum admin account limits. Validates that the assigned designation and category belong to the same organization. Prevents duplicate email addresses. Sends an onboarding welcome email via the mailer package.
- **GetEmployee**: Fetches an employee by ID with populated references to organization, category, designation, and department assignments.
- **GetEmployeeData**: Simplified employee fetch returning core data.
- **ListAllEmployees**: Lists all employees across an organization with optional department filtering.
- **ListEmployees**: Paginated listing with filters including organization, category, designation, department, and text search across name, email, and phone. Supports sorting by multiple fields.
- **UpdateEmployee**: Partial updates with designation validation and admin limit checks.
- **DeleteEmployee**: Soft deletion.

**Employee Authentication:**

- **RequestLoginOtp**: Generates and emails an OTP for employee login.
- **VerifyLoginOtp**: Validates the OTP and issues JWT tokens (access + refresh), storing them on the employee record.
- **VerifyToken**: Validates a JWT and returns full employee data with populated organization, category, designation, and department information.
- **RefreshTokens**: Rotates token pairs with stored-token security verification.

**Entities:** `OrganizationEmployees`, `Otps`

---

### 3.4 Employee Categories

Runs on port **50047**. Defines employee types that determine employment terms.

**Configuration Fields:**

- **Name**: Category name (e.g., Permanent, Contract, Intern, Probationary).
- **ID Prefix**: Auto-generated prefix for employee codes (e.g., "PERM", "CONT", "INT").
- **Benefits Applicable**: Whether employees in this category are eligible for benefits.
- **Training Required / Training Months**: Whether training is mandatory and its duration.
- **Probation Required / Probation Months**: Whether a probation period is required and its duration.
- **Notice Period Required / Notice Period Months**: Notice period requirements and duration.
- **Status**: Active or inactive.

**gRPC Methods:** Full CRUD operations for categories.

**Entity:** `EmployeeCategories`

---

### 3.5 Departments

Runs on port **50053**. Manages organization-level departments.

**Configuration Fields:**

- **Name**: Department name, unique per organization.
- **Code**: Optional department code for internal reference.
- **Department Head**: An employee assigned as the department head, validated to exist in the same organization.
- **Department Head Start Date**: Tracks when the current head was assigned.
- **Description**: Additional notes about the department.

**gRPC Methods:** Full CRUD for departments.

**Entity:** `OrganizationDepartments`

---

### 3.6 Designations

Runs on port **50054**. Manages job designations with a standardized 9-tier hierarchy.

**Configuration Fields:**

- **Name**: Designation title, unique per organization.
- **Level**: Classification using the 9-tier hierarchy system:
  1. Entry Level
  2. Junior
  3. Intermediate
  4. Senior
  5. Lead
  6. Managerial
  7. Senior Management
  8. Executive
  9. Board/Governance
- **Department**: Optional association with a specific department.
- **Description**: Additional notes.

**gRPC Methods:** Full CRUD for designations.

**Entity:** `OrganizationDesignations`

---

### 3.7 Employee-Department Assignment

Runs on port **50042**. Manages many-to-many relationships between employees and departments.

**Features:**

- **Reporting-to Hierarchy**: Tracks manager relationships within departments. Prevents self-reference (an employee cannot report to themselves).
- **Historical Tracking**: Start and end dates are tracked for each assignment, allowing historical reporting structure queries.
- **Scope Validation**: Ensures the assigned department belongs to the same organization as the employee.

**gRPC Methods:** AssignDepartment, GetDepartmentAssignment, ListDepartmentAssignments, UpdateDepartmentAssignment, DeleteDepartmentAssignment.

**Entity:** `EmployeeDepartments`

---

## 4. Employee Onboarding

### 4.1 Onboarding Flows

Runs on port **50044**. Defines structured onboarding processes.

**Configuration Fields:**

- **Flow Name**: Unique name per organization.
- **Description**: Overview of the onboarding process.
- **Step Count**: Total number of steps in the flow.
- **Estimated Days**: Expected duration to complete the flow.

**gRPC Methods:** Full CRUD for onboarding flows.

**Entity:** `EmployeeOnboardingFlows`

---

### 4.2 Onboarding Steps

Runs on port **50046**. Defines individual steps within an onboarding flow.

**Features:**

- Linked to a parent onboarding flow.
- Active/inactive status to enable or disable steps without deletion.
- Steps represent logical phases of the onboarding process (e.g., Documentation, IT Setup, Training, Orientation).

**gRPC Methods:** CRUD for steps, linked to flows.

**Entity:** `EmployeeOnboardingSteps`

---

### 4.3 Onboarding Features

Runs on port **50043**. Defines granular tasks or items within each onboarding step.

**Configuration Fields:**

- **Feature Name**: Description of the task.
- **Feature Type**: Categorization of the feature.
- **Required/Optional**: Whether the feature is mandatory for onboarding completion.
- **Options**: For option-based features, predefined choices are stored as JSON.

**gRPC Methods:** CRUD for features, linked to steps.

**Entity:** `OnboardingStepFeatures`

---

### 4.4 Onboarding Progress Tracking

Runs on port **50045**. Tracks individual employee progress through the onboarding process.

**Features:**

- Links an employee to a specific flow, step, and feature.
- Stores the value or completion status for each feature.
- Enables progress monitoring at both the individual and organization level.
- Provides a complete view of where each employee is in their onboarding journey.

**gRPC Methods:** Create, update, list, and get progress records.

**Entity:** `OnboardingProgress`

---

## 5. Attendance & Time Management

### 5.1 Attendance Management

Runs on port **50041**. The core attendance tracking system with geo-fencing, network policy enforcement, and policy-driven status determination.

**gRPC Methods:**

- **CheckIn**: Records an employee's check-in with comprehensive validation:
  - **Geo-location Validation**: Uses the Haversine formula to check the employee's location against active `GeoFences`. The check-in is rejected if outside the allowed radius.
  - **Network Policy Enforcement**: Validates the employee's IP address against active `NetworkPolicies` to ensure they are connecting from an approved network.
  - **Attendance Policy Application**: Applies the configured `AttendancePolicies` including grace period and late marking logic.
  - Creates an `AttendanceLog` with type `CHECK_IN`.
- **CheckOut**: Records check-out, calculates effective hours worked, and determines attendance status:
  - **Status Determination**: Uses policy thresholds to determine if the employee is PRESENT, LATE, HALF_DAY, or ABSENT based on total hours worked.
  - **Grace Minutes**: Configurable buffer time for late arrivals.
  - **Half-Day Threshold**: Configurable minimum hours to be marked as half-day (default: 240 minutes).
  - **Full-Day Threshold**: Configurable minimum hours to be marked as full-day (default: 480 minutes).
  - Creates an `AttendanceLog` with type `CHECK_OUT`.
- **GetAttendance**: Fetches an attendance record by ID, including all associated logs and regularisation requests.
- **ListAttendance**: Paginated listing with filters for employee, organization, date range, status, and attendance mode.
- **GenerateAttendanceReport**: Creates an `AttendanceReport` record asynchronously for PDF generation. Triggers a background worker that uses Puppeteer to generate the PDF.
- **GetAttendanceReport**: Fetches generated reports with status tracking (INITIATED → PROCESSING → COMPLETED/FAILED).

**Attendance Policy Settings:**

| Setting | Description |
|---------|-------------|
| graceMinutes | Late arrival grace period in minutes |
| halfDayMinutes | Minimum minutes for half-day attendance (default: 240) |
| fullDayMinutes | Minimum minutes for full-day attendance (default: 480) |
| allowGeoCheckIn | Whether geo-fencing is enabled |
| allowOutsideGeo | Whether check-in is allowed outside geo-fences |
| autoMarkAbsent | Auto-mark as absent if no check-in recorded |
| checkInBufferMin | Buffer window before shift start for check-in |
| checkOutBufferMin | Buffer window after shift end for check-out |
| roundingStrategy | Time rounding strategy (e.g., nearest 15 minutes) |
| overtimeAllowed | Whether overtime is permitted |
| minOvertimeMinutes | Minimum duration to count as overtime |

**Attendance Modes:** OFFICE, WORK_FROM_HOME, ON_DUTY, PARTIAL_DAY

**Attendance Statuses:** PENDING, PRESENT, ABSENT, LATE, HALF_DAY, HOLIDAY

**CRUD Methods:** Full CRUD for attendance policies, geo-fences, and network policies.

**Entities:** `Attendance`, `AttendancePolicies`, `GeoFences`, `NetworkPolicies`

---

### 5.2 Attendance Logs

Runs on port **50039**. Provides read-only querying of attendance audit logs.

**Log Types:** CHECK_IN, CHECK_OUT, ADJUSTMENT

Each log captures: IP address, geo-location coordinates, source (device/app identifier), and precise timestamp.

**Filters:** Organization, employee, attendance record, date range.

**Entity:** `AttendanceLogs`

---

### 5.3 Attendance Regularisation

Runs on port **50040**. Allows employees to request corrections to attendance records.

**Features:**

- Employees submit regularisation requests with:
  - Reason for the correction.
  - Corrected check-in and/or check-out times.
  - Supporting documents if needed.
- **Status Tracking**: PENDING → APPROVED/REJECTED.
- **Approval Tracking**: Records who approved/rejected, when, and any remarks.
- **Filtering**: List requests by employee, organization, or status.
- **Modification**: Update or delete pending requests.

**Entity:** `AttendanceRegularisation`

---

### 5.4 Shift Management

Runs on port **50061**. Defines work shifts.

**Configuration Fields:**

- **Name**: Shift name, unique per organization.
- **Start Time / End Time**: Shift timing with validation that end time is after start time.
- **Break Minutes**: Duration of break within the shift.
- **Applicable Days**: Flags for Monday through Sunday indicating which days the shift applies.
- **Weekly Off Days**: Array of days designated as weekly off.

**gRPC Methods:** Full CRUD for shifts.

**Entity:** `Shifts`

---

### 5.5 Shift Policies

Runs on port **50060**. Defines policies governing shift behavior and rules.

**Configuration Fields:**

- **Auto-assignment Toggle**: Whether the system should automatically assign shifts to employees.
- **Grace Period Before Start**: Allowable late arrival window at the beginning of a shift.
- **Grace Period After End**: Allowable early departure window at the end of a shift.
- **Night Shift Definition**: Start and end times defining what constitutes a night shift.
- **Rotational Shift Support**: Whether rotational shifts are enabled, with a configurable rotation period in days.
- **Status**: Active or inactive.

**gRPC Methods:** Full CRUD for shift policies.

**Entity:** `ShiftPolicies`

---

### 5.6 Shift Assignments

Runs on port **50059**. Assigns employees to specific shifts.

**Features:**

- **Valid From / Valid To**: Date range for the shift assignment.
- **Overlap Detection**: Prevents conflicting shift assignments for the same employee.
- **Validation**: Ensures both the employee and shift exist and belong to the same organization.

**gRPC Methods:** Create, list (with employee details), get, update, and delete shift assignments.

**Entity:** `EmployeeShiftAssignment`

---

## 6. Holiday & Leave Management

### 6.1 Holiday Management

Runs on port **50066**. Defines company holidays.

**Configuration Fields:**

- **Date**: The specific holiday date.
- **Name**: Holiday name (e.g., "Independence Day").
- **Region**: Geographic region the holiday applies to.
- **Holiday Type**: PUBLIC, RESTRICTED, OPTIONAL, WEEK_OFF, or COMPANY_EVENT.
- **Policy Association**: Optional link to a `HolidayPolicy`.
- **Uniqueness**: Holiday name must be unique per organization.

**gRPC Methods:** Full CRUD for holidays.

**Entity:** `Holidays`

---

### 6.2 Holiday Policies

Runs on port **50049**. Groups holidays into regional or departmental policies.

**Configuration Fields:**

- **Name**: Policy name.
- **Region**: Geographic region designation.
- **Applicable To**: Branch codes or department IDs that this policy applies to.
- **Holidays**: Links to `Holidays` records that belong to this policy.

**gRPC Methods:** Full CRUD for holiday policies.

**Entity:** `HolidayPolicies`

---

### 6.3 Leave Types

Runs on port **50052**. Configurable leave categories with extensive rule settings.

**Core Settings:**

- **Name**: Display name (e.g., "Casual Leave").
- **Code**: Short code (e.g., "CL").
- **Description**: Explanatory text.
- **Paid/Unpaid**: Whether the leave is paid.
- **Max Per Year**: Annual allowance.

**Rules:**

| Rule | Description |
|------|-------------|
| Half-Day Allowed | Whether employees can take half-day leave |
| Half-Day Type | FIRST_HALF or SECOND_HALF |
| Document Required After | Number of days after which a document (e.g., medical certificate) is required |
| Carry Forward | Whether unused leave can be carried to the next year |
| Max Carry Forward | Maximum days that can be carried forward |
| Encashment | Whether leave can be encashed |
| Max Encashment Per Year | Maximum days encashable per year |
| Gender Restriction | MALE, FEMALE, or NONE |
| Probation Restriction | Whether employees on probation are ineligible |
| Minimum Service Months | Minimum tenure required to apply |

**Accrual System:**

- **Accrual Enabled**: Whether leave accrues over time.
- **Accrual Frequency**: Daily, monthly, or yearly.
- **Accrue After Days**: Waiting period before accrual begins.
- **Monthly Accrual Rate**: Rate of accrual per month (e.g., 1 CL per month).

**Constraints:**

- **Max Consecutive Days**: Maximum number of consecutive days that can be taken.
- **Sandwich Rule**: When enabled, weekends between leave days are counted as leave.

**gRPC Methods:** Full CRUD for leave types.

**Entity:** `LeaveTypes`

---

### 6.4 Leave Requests

Runs on port **50051**. Handles the complete leave application lifecycle.

**gRPC Methods:**

- **ApplyLeave**: Creates a leave request with date range, half-day option, reason, and supporting documents. Automatically calculates total days including half-day logic.
- **ListLeaveRequests**: Paginated listing with filters including employee, organization, leave type, status, and date range. Supports sorting.
- **GetLeaveRequest**: Fetches a single request with full details.
- **UpdateLeaveRequest**: Modifies a pending leave request.
- **CancelLeaveRequest**: Cancels a request with reason tracking and cancellation metadata.
- **ApproveLeave / RejectLeave**: Status transitions with timestamp tracking for approval actions.

**Leave Statuses:** PENDING, APPROVED, REJECTED, CANCELLED

**Approval Integration:** Each leave request links to an `ApprovalInstance`, enabling multi-level approval workflows through the Approval Engine.

**Entity:** `LeaveRequests`

---

## 7. Approval Engine

### 7.1 Approval Flow Configuration

Runs on port **50032**. A generalized multi-level approval engine that can be attached to any entity type.

**Supported Entity Types:** LEAVE, REGULARISATION, WORKDAY

**gRPC Methods:**

- **CreateApprovalFlow**: Creates an approval flow configured for a specific entity type with multiple hierarchical levels.
- **GetApprovalFlow**: Fetches the complete flow with all levels, approvers, and associated employee details.
- **ListApprovalFlows**: Lists all flows for an organization.
- **UpdateApprovalFlow**: Updates flow details.
- **DeleteApprovalFlow**: Soft deletion.
- **AddLevel / UpdateLevel / RemoveLevel**: Manages hierarchical levels within a flow. Each level represents a step in the approval chain.
- **AddApprover / RemoveApprover**: Manages approvers at each level. Approvers can be specified by user ID or by role (MANAGER, HR, LEAD).
- **GetFlowForEntity**: Retrieves the approval flow applicable to a specific entity type.

**Level Configuration:**

- **Order**: Position in the approval sequence.
- **Auto-approve Days**: If no action is taken within N days, the request is auto-approved.
- **Escalation Role**: Designated role for escalation when an approver is unresponsive.

**Entities:** `ApprovalFlows`, `ApprovalFlowLevels`, `ApprovalFlowApprovers`

---

### 7.2 Approval Instances

Handles the lifecycle of individual approval requests.

**gRPC Methods:**

- **CreateApprovalInstance**: Creates an approval instance for a specific entity (e.g., a leave request, regularisation) linked to its configured flow. Initializes the current level to the first approver level.
- **ProcessApproval**: Processes an approval or rejection at the current level:
  - On **approval**: Auto-advances to the next level in the flow. If all levels are approved, the entire instance is marked as COMPLETED.
  - On **rejection**: The instance is marked as REJECTED immediately.
  - Supports auto-approval based on level configuration.
- **GetApprovalInstance**: Fetches the instance with all associated approval logs and current status.
- **ListApprovalInstances**: Paginated listing with filters including organization, entity type, entity ID, status, and approver.

**Logging:** Every action (APPROVED, REJECTED, AUTO_APPROVED) is recorded in `ApprovalLogs` with the approver's identity, remarks, and timestamp.

**Entities:** `ApprovalInstance`, `ApprovalLogs`

---

## 8. Asset Management

### 8.1 Asset Categories

Runs on port **50034**. Defines the taxonomy of asset types.

**Configuration Fields:**

- **Name**: Category name (e.g., Laptops, Monitors, Phones, Vehicles).
- **Code**: Short code for reference.
- **Description**: Explanatory text.
- **Status**: Active or inactive.

**gRPC Methods:** Full CRUD.

**Entity:** `AssetCategories`

---

### 8.2 Asset Models

Runs on port **50036**. Defines specific models within asset categories.

**Configuration Fields:**

- **Brand**: Manufacturer name.
- **Model Name**: Specific model identifier.
- **Code**: Reference code.
- **Description**: Product description.
- **Specifications**: Technical specifications stored as JSON.
- **Category**: Link to `AssetCategories`.
- **Organization**: Scope to organization.
- **Status**: Active or inactive.

**gRPC Methods:** Full CRUD.

**Entity:** `AssetModels`

---

### 8.3 Asset Inventory

Runs on port **50038**. Tracks individual assets in the organization.

**Fields:**

- **Serial Number**: Globally unique identifier.
- **Asset Tag**: Unique per organization.
- **Purchase Date**: When the asset was acquired.
- **Warranty Expiry**: Warranty end date.
- **Credentials**: User name and password (for IT assets like laptops).
- **Status**: Available, Assigned, Under Repair, or Retired.
- **Location**: Physical location stored as JSON.
- **Category and Model**: Links to `AssetCategories` and `AssetModels`.

**gRPC Methods:** Full CRUD with uniqueness enforcement on serial numbers and asset tags.

**Entity:** `Assets`

---

### 8.4 Asset Requests

Runs on port **50037**. Allows employees to request asset assignments.

**Fields:**

- **Assignment Link**: Optional link to an existing assignment.
- **Quantity**: Number of assets requested.
- **Reason**: Justification for the request.
- **Priority**: CRITICAL, URGENT, HIGH, MEDIUM, LOW, or NEGLIGIBLE.
- **Status**: PENDING, APPROVED, REJECTED.
- **Approval Tracking**: Records who approved/rejected, when, and rejection reason.

**gRPC Methods:** Full CRUD with status updates. Responses include detailed assignment, employee, and asset data.

**Entity:** `AssetRequest`

---

### 8.5 Asset Assignments

Runs on port **50033**. Tracks which asset is assigned to which employee.

**Fields:**

- **Asset**: Link to the specific `Assets` record.
- **Employee**: Link to the assigned employee.
- **Assigned Date**: When the asset was assigned.
- **Return Date**: When the asset was returned (if applicable).
- **Condition at Assignment**: Condition notes stored as JSON.
- **Status**: Active or Returned.
- **Notes**: Additional assignment notes.

**Constraint:** Prevents duplicate active assignments for the same asset — an asset cannot be assigned to two employees simultaneously.

**gRPC Methods:** Full CRUD.

**Entity:** `AssetAssignments`

---

### 8.6 Asset Condition Reports

Runs on port **50035**. Reports and tracks asset condition issues.

**Fields:**

- **Report Date**: When the issue was reported.
- **Description**: Detailed issue description.
- **Ratings**: Condition ratings (e.g., Good, Fair, Poor).
- **Images**: Array of image URLs.
- **Action Taken**: Description of any remedial action.
- **Acknowledgment**: Who acknowledged the report and when.
- **Status**: Reported, Reviewed, or Acknowledged.
- **Links**: To the specific assignment, employee, and asset.

**gRPC Methods:** Full CRUD.

**Entity:** `AssetCondition`

---

## 9. Social & Communication

### 9.1 Posts & Polls

Runs on port **50056**. A complete social feed system within the organization for announcements, discussions, and polling.

**gRPC Methods:**

- **CreatePostPoll**: Creates a new post. Supports two modes:
  - **Regular Posts**: Text with optional title, description, image, and tags.
  - **Poll Posts**: Require at least two non-empty voting options. Employees can vote on poll options.
- **GetPost**: Fetches a single post with all related data including options, votes, likes, comments, saves, shares, and computed engagement counts.
- **ListPosts**: Paginated listing with filters for organization, employee, tags, and feed type (latest, popular, trending). Includes computed engagement metrics for each post.
- **UpdatePost**: Updates post content. Ownership verification required.
- **DeletePost**: Soft deletion with ownership verification and cascading deletion of all related engagement data.

**Engagement Methods:**

- **VotePoll**: Casts a vote on a poll option. Duplicate voting is prevented — one vote per employee per poll.
- **LikePost / UnlikePost**: Toggle like with idempotent operations (safe to call multiple times).
- **CommentOnPost**: Adds a text comment to a post.
- **SavePost / UnsavePost**: Bookmark toggle for saving posts for later viewing.
- **SharePost**: Tracks shares with share count increment.
- **GetVotes**: Lists poll results with voter details.

**Engagement Counters:** All counts (likes, comments, saves, shares, votes per option) are computed on read to ensure accuracy.

**Entities:** `Posts`, `PostOptions`, `PostVotes`, `PostLikes`, `PostComments`, `PostSaves`, `PostShares`

---

## 10. Salary & Payroll

All salary and payroll services run on port **50058**.

### 10.1 Component Definitions

Defines the master library of salary components — the building blocks of any salary structure.

**Component Types:**

| Type | Description |
|------|-------------|
| earning | Income components (e.g., Basic, HRA) |
| deduction | Deduction components (e.g., PF, PT) |
| reimbursement | Reimbursable expenses |
| benefit | Non-cash benefits |
| tax | Tax-related components |

**Categories:** recurring, adhoc, allowance, custom

**Configuration:**

- **key**: Unique identifier (e.g., "basic", "hra", "pf_employee").
- **name**: Display name (e.g., "Basic Salary").
- **defaultFormula**: Default calculation formula (e.g., "gross * 0.5").
- **description**: Explanatory text.

**Behavior Flags:**

| Flag | Description |
|------|-------------|
| isTaxable | Whether the component is subject to tax |
| isVariable | Whether the amount can vary period-to-period |
| isStatutory | Whether legally mandated (PF, ESI, PT) |
| includeInCTC | Whether included in Cost to Company |
| includeInGross | Whether included in gross salary |
| displayOrder | Sort order in payslip display |
| isDefault | System-defined vs. custom component |
| isDeletable | Protected system components cannot be deleted |

**gRPC Methods:** Fetch, Create, Update, Delete component definitions.

**Entity:** `ComponentDefinition`

---

### 10.2 Salary Templates

Reusable salary structure templates that can be applied to employees.

**Template Properties:**

- **Name**: Template name.
- **Description**: Explanatory text.
- **Target Departments**: Array of department IDs where this template applies.
- **Target Designations**: Array of designation IDs where this template applies.
- **Default Template**: Flag to mark as the organization default.
- **Versioning**: Supports versioning with `version`, `baseTemplateId` (link to previous version), and version chain tracking.
- **Status**: Active or inactive.

**Template Components:**

Each template contains components mapped to salary ranges (gross slabs or CTC slabs). Components have:

- **Kind**: EARNING, EMPLOYEE (employee-side deductions), EMPLOYER (employer-side contributions).
- **Formula**: Calculation expression.
- **Fixed Value**: Fixed amount if not formula-driven.
- **Priority**: Evaluation order.
- **Min/Max Values**: Constraints for the calculated amount.
- **Conditional Logic**: Conditions under which the component applies.

**Salary Ranges:** Each range defines grossLow/grossHigh and ctcLow/ctcHigh boundaries, with infinity support for open-ended ranges.

**gRPC Methods:** List, upsert (create or update with versioning), delete salary templates.

**Entities:** `SalaryTemplate`, `TemplateComponent`

---

### 10.3 Salary Ranges

Manages salary brackets/ranges within salary templates.

**Configuration Fields:**

- **Gross Salary Range**: Low and high boundaries for gross salary.
- **CTC Range**: Low and high boundaries for cost to company.
- **Label**: Human-readable label for the range.

**gRPC Methods:** Create, Update, Delete, List ranges. Save/Get range components. Preview salary for an employee based on a specific range.

**Entity:** `SalaryTemplateRange`

---

### 10.4 Salary Assignment

The core salary computation engine that creates and manages individual employee salary structures.

**gRPC Methods:**

- **AssignSalary**: Creates a salary structure for an employee with:
  - Gross annual amount (CTC).
  - Effective from/to dates defining the validity period.
  - Individual salary components with annual and monthly amounts.
  - Optional template link back to a `SalaryTemplate`.
  - Computed totals: total earnings, total deductions, total benefits, in-hand annual, in-hand monthly.
- **UpdateSalary**: Updates an existing salary structure.
- **ApplyTemplate**: Applies a salary template to create or update an employee's structure, calculating all components from the template's formulas and ranges.
- **Recalculate**: Recalculates all components based on their formulas, useful when component definitions change.
- **BulkRecalculate**: Batch recalculation for multiple employees at once.
- **GetStructure**: Gets the current active salary structure for an employee.
- **GetStructureById**: Gets a specific structure by its ID.
- **PreviewTemplateCalculation**: Previews what a salary would look like with a given template before actually applying it.

**Salary Structure Fields:**

- **grossAnnual**: Annual cost to company.
- **effectiveFrom / effectiveTo**: Validity period.
- **deductFromInHand**: Whether deductions are applied to in-hand calculation.
- **totalEarnings**: Sum of all earning components.
- **totalDeductions**: Sum of all deduction components.
- **totalBenefits**: Sum of all benefit components.
- **inHandAnnual / inHandMonthly**: Computed take-home amounts.
- **Status**: ACTIVE, INACTIVE, or SUPERSEDED.
- **isCurrentActive**: Flag indicating the currently active structure.

**Entities:** `SalaryStructure`, `StructureComponent`

---

### 10.5 Salary Revisions

Tracks all historical changes to an employee's salary.

**Revision Fields:**

- **revisionType**: INCREMENT, PROMOTION, ANNUAL_REVIEW, or CORRECTION.
- **previousGross**: Salary before revision.
- **newGross**: Salary after revision.
- **changePercent**: Percentage change.
- **changeAmount**: Absolute change amount.
- **reason**: Justification for the revision.
- **approvedBy**: Who approved the revision.
- **approvalDate**: When it was approved.
- **Links**: To the old and new salary structures.

**gRPC Methods:** Get revision history for an employee. Override a specific component value with audit notes.

**Entity:** `SalaryRevision`

---

### 10.6 Payslip Management

Customizable payslip generation using the **EJS** templating engine.

**Payslip Template Configuration:**

- **Name**: Template name.
- **EJS Content**: The full EJS template markup for the payslip layout.
- **Template Variables**: JSON configuration for template variables.
- **Status**: Active or inactive.
- **Scope**: Organization-specific or global.

**gRPC Methods:**

- **GetEjsTemplate**: Retrieves template EJS content.
- **SaveEjsTemplate**: Saves or updates a template.
- **RenderEjsTemplate**: Renders the EJS template with employee salary data including:
  - Salary structure components.
  - Working days (total, actual, leave, LOP).
  - Arrears, bonus, and penalty amounts.
  - Computed net pay.

**Payslip Fields:**

- **month/year**: Payslip period.
- **grossPay / netPay**: Earnings and take-home.
- **earnings / deductions**: Breakdown of all components.
- **workingDays**: Total, actual, leave, LOP breakdown.
- **arrears, bonus, penalty**: Additional adjustments.
- **Status**: DRAFT, GENERATED, APPROVED, PAID.
- **paymentMethod / paymentRef**: Payment tracking.

**Entities:** `PayslipTemplates`, `Payslip`, `PayslipComponent`

---

### 10.7 Payroll Processing

System-wide batch payroll computation.

**gRPC Methods:**

- **GetSystemPayroll**: Gets the organization's payroll configuration including finance settings and current processing period.
- **CalculatePayroll**: Runs full payroll calculation:
  1. Fetches attendance data for the period (working days, leaves, LOP).
  2. Applies employee salary structures.
  3. Computes pro-rata adjustments if the employee joined mid-period.
  4. Handles arrears from previous periods.
  5. Applies bonuses and penalties.
  6. Generates payslips for all employees.

**Entity:** `Payslip`

---

### 10.8 Organization Finance (Statutory Compliance)

Manages statutory compliance configuration for each organization.

**Components:**

| Component | Configuration |
|-----------|---------------|
| PF (Provident Fund) | Enable/disable, formula configuration, PF registration number, registered organization name |
| ESI (Employee State Insurance) | Enable/disable, formula configuration, ESI registration details |
| PT (Professional Tax) | Enable/disable, formula configuration, PT registration details |

**gRPC Methods:** Check if finance is enabled, enable/save PF/ESI/PT details, enable/disable each component individually, get full organization finance details.

**Entity:** `OrgaizationFinance`

---

### 10.9 Expense Management

Employee expense reporting and reimbursement workflow.

**Expense Types:** TRAVEL, FOOD, ACCOMMODATION, OTHER

**Lifecycle:**

1. **RegisterExpense**: Employee submits an expense with type, amount, description, and receipt URL.
2. **GetMyExpenses**: Employee views their own submitted expenses.
3. **GetAllExpenses**: Manager or admin views all expenses across teams.
4. **GetExpenseDetails**: Single expense with full details.
5. **UpdateExpense**: Edit a pending expense.
6. **DeleteExpense**: Employee soft-deletes their own expense.
7. **AdminDeleteExpense**: Admin force-deletes any expense.
8. **UpdateExpenseStatus**: Approve or reject an expense with approver tracking.

**Statuses:** PENDING, APPROVED, REJECTED

**Entity:** `Expenses`

---

## 11. Subscription & Billing

### 11.1 Subscription Plans

Runs on port **50063**. Configurable subscription tiers for organizations.

**Plan Properties:**

- **Name**: Plan name (e.g., Basic, Pro, Enterprise).
- **Description**: Plan overview.
- **Monthly/Yearly Pricing**: Cost per billing interval.
- **GST Percentage**: Tax rate (default: 18%).
- **Trial Days**: Trial period duration (default: 14).
- **Admin-only Flag**: Whether only admins can subscribe.
- **Status**: Active or inactive.

**Plan Features:** Key-value pairs defining feature limits:

- **max_employees**: Maximum employee count.
- **max_storage_gb**: Maximum storage capacity.
- **api_rate_limit**: Maximum API requests per minute.
- **payroll_runs**: Maximum monthly payroll runs.
- **leave_policies**: Maximum leave policy configurations.
- **admin_accounts**: Maximum admin accounts.

Each feature includes unit specification (employees, GB, requests/min), and can be flagged as unlimited.

**gRPC Methods:** Full CRUD for plans and features (add, update, list, remove).

**Entities:** `SubscriptionPlans`, `SubscriptionPlanFeatures`

---

### 11.2 Organization Subscriptions

Manages which plan each organization is subscribed to.

**Lifecycle:**

1. **AssignPlanToOrganization**: Creates a subscription with the selected plan, billing interval (MONTHLY or YEARLY), trial period, and a snapshot of plan pricing.
2. **GetOrganizationSubscription**: Retrieves the current subscription with usage snapshots and change history.
3. **CancelOrganizationSubscription**: Cancels with optional end-of-period flag to continue service until the current billing period ends.
4. **ChangeSubscriptionPlan**: Upgrades or downgrades the plan. All changes are logged in the change history.

**Subscription Statuses:** TRIAL, ACTIVE, PAST_DUE, SUSPENDED, CANCELLED, EXPIRED

**Usage Snapshots:** Period-based usage tracking per metric key, with an exceeded flag indicating whether the organization has exceeded plan limits.

**Change Log:** Full history of all plan changes categorized as UPGRADE, DOWNGRADE, RENEW, or CANCEL.

**Entities:** `OrganizationSubscriptions`, `SubscriptionUsageSnapshot`, `SubscriptionChangeLog`

---

### 11.3 Invoice Management

Automated billing invoice generation and management.

**Invoice Properties:**

- **Invoice Number**: Unique auto-generated number using year-based sequence (e.g., INV-2024-0001).
- **Amount, Tax, Total**: Financial breakdown.
- **Currency**: Currency code.
- **Billing Period**: Start and end dates.
- **Status**: DRAFT, ISSUED, PAID, FAILED, CANCELLED.
- **Payment Integration**: Razorpay order ID, payment link URL, payment expiry date.
- **Payment Status**: SUCCESS, PENDING, FAILED.
- **Payment Ref / Provider**: Payment reference and gateway identifier.

**gRPC Methods:**

- **ListInvoices**: Paginated with filters (subscription, organization, status, date range).
- **GetInvoice**: Single invoice with full details.
- **ProcessInvoicePayment**: Creates a Razorpay order and payment link, sets expiry date, returns the payment URL.
- **MarkInvoicePaid**: Manual payment status update for offline payments.
- **RegenerateInvoicePaymentLink**: Creates a new payment link for failed or expired invoices.

**Entity:** `Invoices`

---

## 12. File Storage

### 12.1 Folder Management

Runs on port **50062**. A complete file organization system with folders.

**Fields:**

- **Name**: Folder name.
- **Color**: Display color for UI.
- **Folder Image**: Optional image displayed for the folder.
- **Files Count**: Running count of files in the folder.
- **Storage Used**: Running total of storage consumed by files in the folder.
- **Visibility**: PRIVATE, SHARED, or PUBLIC.
- **Organization and Creator**: Scope tracking.

**gRPC Methods:**

- **CreateFolder**: Creates a folder with optional folder image (auto-uploaded via FileService), color, and visibility.
- **GetFolder**: Fetches folder with sharing information and file listing.
- **ListFolders**: Paginated listing with search (by name) and visibility filter.
- **UpdateFolder**: Updates name, color, visibility, or folder image.
- **DeleteFolder**: Soft deletion.

**Entity:** `Folders`

---

### 12.2 File Management

File upload, retrieval, and deletion within folders.

**Fields:**

- **URL and Key**: Storage backend references supporting both local filesystem and S3.
- **Size**: File size in bytes.
- **Organization and Uploader**: Scope and ownership.
- **Folder Association**: Optional link to a folder; files without a folder are root-level.

**gRPC Methods:**

- **UploadFile**: Accepts file buffer, stores via FileService (local or S3), creates a `Files` record, and updates the parent folder's storage statistics.
- **ListFiles**: Paginated listing with folder and organization filters.
- **DeleteFile**: Deletes from the storage backend, removes the database record, and updates folder storage statistics.

**Entity:** `Files`

---

### 12.3 Folder Sharing

Allows folders to be shared with specific employees.

**gRPC Methods:**

- **ShareFolder**: Shares a folder with designated employees. Records are added to `FolderSharedWithEmployees` tracking who the folder was shared with and who initiated the share.
- **RemoveShare**: Removes an employee from the shared list.
- **GetSharedFolders**: Lists all folders that have been shared with the current employee.

**Entity:** `FolderSharedWithEmployees`

---

## 13. Reports

### 13.1 Employee Insight Reports

Runs on port **50057**. Generates comprehensive employee insight reports.

**gRPC Method:** `GenerateEmployeeInsightTemplateReport`

**Process:**

1. Accepts an `employee_id`.
2. Fetches comprehensive employee data including:
   - Personal information.
   - Organization details.
   - Employee category.
   - Designation.
   - Department assignments.
3. Generates an HTML report using a template renderer.
4. Returns the HTML string for frontend display or PDF conversion.

**Scope:** Read-only aggregation from existing employee data. No dedicated database entities — operates on existing employee data.

---

## Cross-Cutting Concerns

### Security & Authentication

- **JWT-based Authentication**: HS256-signed tokens using the `jose` library.
- **Dual Token System**: Short-lived access tokens + long-lived refresh tokens that are rotated on each use.
- **OTP-based Login**: Both admins and employees authenticate via emailed one-time passwords.
- **Token Verification**: Server-side endpoint for validating tokens.
- **IP Whitelisting**: Gateway-level IP restriction middleware.
- **Token Storage**: Tokens stored on user records to enable server-side validation and forced logout.

### Multi-tenancy

- All entities are scoped to an `organizationId`.
- Organization-level limits enforced throughout (employees, storage, API rate, payroll, leave policies, admin accounts).
- Subscription plans define feature limits per organization.
- Usage tracking per organization provides billing and capacity planning data.

### Data Soft-Delete

- Every model includes a `deletedAt` timestamp field.
- All queries filter `deletedAt: null` by default.
- Some services support restoring soft-deleted records.

### Audit Trail

- **TrafficEvent**: Full HTTP request/response logging (service, endpoint, method, status, latency, IP, user agent).
- **OrganizationUsageEvent**: Feature-level usage tracking (module, feature, action, resource, source).
- **ApprovalLogs**: Every approval action is logged with approver, action, remarks, and timestamp.
- **SalaryRevision**: Full salary change history with revision type, amounts, and approval.
- **SubscriptionChangeLog**: Complete plan change history with upgrade/downgrade tracking.
- **AttendanceLogs**: Check-in/out/adjustment audit trails with IP and geo-location.

### Statutory Compliance

- **PF (Provident Fund)**: Configurable formula and registration.
- **ESI (Employee State Insurance)**: Configurable formula and registration.
- **PT (Professional Tax)**: Configurable formula and registration.
- **GST**: Applied to subscription invoices.
- **Invoice Numbering**: Year-based sequence for compliant invoice numbering.
