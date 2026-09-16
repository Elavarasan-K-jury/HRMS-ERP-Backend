# Jury HRMS Backend

A microservices-based Human Resource Management System (HRMS) backend built with **Node.js**, **gRPC**, **MongoDB (Prisma ORM)**, **Redis**, and **Hono** (REST API framework).

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   API Gateway (Port 50050)               │
│              Hono REST API + OpenAPI/Swagger             │
│         Middlewares: CORS, IP Whitelist, Rate Limit,     │
│         Request Queue, Traffic Logging, Usage Tracking   │
├─────────────────────────────────────────────────────────┤
│                        gRPC Layer                        │
├────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┤
│    │    │    │    │    │    │    │    │    │    │    │    │
│ 30+ Microservices (each in its own container/process)    │
├─────────────────────────────────────────────────────────┤
│                    Shared Packages                       │
│  @jury-hrms/proto  @jury-hrms/db  @jury-hrms/redis      │
│  @jury-hrms/auth   @jury-hrms/mailer  @jury-hrms/files  │
│  @jury-hrms/payments                                     │
├─────────────────────────────────────────────────────────┤
│              Infrastructure (Docker Compose)             │
│        MongoDB 7    Redis 7    Node.js 20 (Alpine)       │
└─────────────────────────────────────────────────────────┘
```

## Tech Stack

| Technology | Purpose |
|---|---|
| **Node.js 20** | Runtime |
| **Hono** | REST API framework for API Gateway |
| **gRPC** (@grpc/grpc-js) | Inter-service communication |
| **Prisma** | ORM for MongoDB |
| **MongoDB 7** | Primary database |
| **Redis 7** | Caching, pub/sub, rate limiting, distributed locks |
| **Docker** | Containerization |
| **PM2** | Process management (production) |
| **Jose** | JWT signing/verification |
| **Puppeteer** | PDF generation (invoices, attendance reports) |
| **Nodemailer** | Email (OTP, invoices, notifications) |
| **Razorpay** | Payment gateway |
| **ioredis** | Redis client |
| **node-cron** | Scheduled jobs |
| **PQueue** | Request queuing |
| **EJS** | Payslip template engine |

## Project Structure

```
Backend/
├── apps/                              # Application services
│   ├── api-gateway/                   # REST API Gateway (Hono + gRPC clients)
│   ├── traffic-reporting-service/     # Traffic analytics & aggregation
│   ├── invoice-generator-service/     # Automated invoice generation
│   └── usage-reporting-service/       # Usage metrics endpoint
├── services/                          # gRPC Microservices (30+)
│   ├── organization-service/          # Organization CRUD + hierarchy
│   ├── employee-service/              # Employee CRUD + auth
│   ├── employee-category-service/     # Employee categories
│   ├── admin-service/                 # Admin auth + CRUD
│   ├── org_department-service/        # Organization departments
│   ├── org_designation-service/       # Organization designations
│   ├── emp-department-service/        # Employee-department assignments
│   ├── emp-onboarding-flow-service/   # Onboarding flow definitions
│   ├── emp-onboarding-step-service/   # Onboarding step definitions
│   ├── emp-onboarding-feature-service/ # Onboarding feature definitions
│   ├── emp-onboarding-progress-service/ # Employee onboarding progress
│   ├── attendance-service/            # Check-in/out, policies, geofences
│   ├── attendance-logs-service/       # Attendance log queries
│   ├── attendance-regularisation-service/ # Attendance corrections
│   ├── shift-service/                 # Shift definitions
│   ├── shift-assignment-service/      # Employee shift assignments
│   ├── shift-policy-service/          # Shift policies
│   ├── holiday-service/               # Holiday definitions
│   ├── holiday-policy-service/        # Holiday policies
│   ├── leave-type-service/            # Leave type definitions
│   ├── leave-request-service/         # Leave applications & approval
│   ├── approval-service/              # Approval flows & instances
│   ├── asset-category-service/        # Asset categories
│   ├── asset-models-service/          # Asset models
│   ├── assets-service/                # Asset inventory
│   ├── asset-request-service/         # Asset requests
│   ├── asset-assignment-service/      # Asset assignments
│   ├── asset-condition-service/       # Asset condition reports
│   ├── salary-and-payroll-service/    # Salary components, templates, payroll
│   ├── report-service/                # Employee insight reports
│   ├── storage-service/               # Folder & file management
│   └── subscription-service/          # Plans, subscriptions, invoices
├── packages/                          # Shared libraries
│   ├── proto/                         # Protobuf loader
│   ├── db/                            # Prisma client + schema
│   ├── redis/                         # Redis client + helpers
│   ├── auth/                          # JWT (sign/verify)
│   ├── mailer/                        # Nodemailer transport + templates
│   ├── file/                          # File storage (local/S3)
│   └── payments/                      # Razorpay integration
├── docker-compose.yml                 # Full stack orchestration
├── Dockerfile                         # Multi-service container image
└── ecosystem.config.cjs               # PM2 production config
```

## Getting Started

### Prerequisites

- Node.js 20+
- Docker & Docker Compose (for MongoDB & Redis)
- npm or bun

### Environment Variables

Copy `.env` and configure:

```bash
# Core
DATABASE_URL=mongodb+srv://...
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret
JWT_ACCESS_EXPIRES_IN=86400
JWT_REFRESH_EXPIRES_IN=2592000

# SMTP (for emails)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...

# File Storage (local or s3)
FILE_STORAGE=local

# Razorpay
RAZORPAY_KEY_ID=...
RAZORPAY_KEY_SECRET=...
```

### Install & Run

```bash
# Install dependencies
npm install

# Generate Prisma client
npm run prisma:generate

# Start infrastructure (MongoDB + Redis)
docker compose up -d mongodb redis

# Run all services in dev mode
npm run dev

# Or run individual services
npm run dev:gateway
npm run dev:emp
npm run dev:atte
```

### Service Ports

| Service | Port |
|---|---|
| API Gateway | 50050 |
| Organization | 50055 |
| Employee | 50048 |
| Employee Category | 50047 |
| Admin | 50031 |
| Org Department | 50053 |
| Org Designation | 50054 |
| Employee Department | 50042 |
| Employee Onboarding Flow | 50044 |
| Employee Onboarding Step | 50046 |
| Employee Onboarding Feature | 50043 |
| Employee Onboarding Progress | 50045 |
| Attendance | 50041 |
| Attendance Logs | 50039 |
| Attendance Regularisation | 50040 |
| Shift | 50061 |
| Shift Assignment | 50059 |
| Shift Policy | 50060 |
| Holiday | 50066 |
| Holiday Policy | 50049 |
| Approval | 50032 |
| Asset Category | 50034 |
| Asset Model | 50036 |
| Assets | 50038 |
| Asset Request | 50037 |
| Asset Assignment | 50033 |
| Asset Condition | 50035 |
| Post/Poll | 50056 |
| Leave Type | 50052 |
| Leave Request | 50051 |
| Salary & Payroll | 50058 |
| Report | 50057 |
| Traffic Reporting | 50064 |
| Usage Reporting | 50065 |
| Subscription | 50063 |
| Storage | 50062 |

## API Gateway

The API Gateway (`apps/api-gateway/`) is a **Hono** REST server with:
- **OpenAPI/Swagger** documentation at `/swagger`
- **CORS** with IP/domain allowlisting
- **Rate limiting** per organization (configurable, Redis-backed)
- **IP whitelisting**
- **Request queuing** (p-queue)
- **Service metrics** (in-flight count, latency, success/error rate)
- **Traffic logging** (batched inserts to MongoDB)
- **Usage tracking** per organization
- All routes proxy to gRPC microservices via wrapper pattern

## Microservice Pattern

Every microservice follows the same pattern:

```javascript
import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';

const PORT = process.env.SERVICE_PORT || 5000;
const proto = loadProto('service_name');

const impl = {
  MethodName: async (call, callback) => {
    try {
      // Business logic with Prisma
      callback(null, { success: true, ...data });
    } catch (e) {
      callback({ code: grpc.status.INTERNAL, message: e.message });
    }
  },
};

async function main() {
  const server = new grpc.Server();
  server.addService(proto.ServiceName.service, impl);
  await server.bindAsync(`0.0.0.0:${PORT}`, grpc.ServerCredentials.createInsecure(), ...);
  // Graceful shutdown
}
main();
```

## Shared Packages

### `@jury-hrms/proto`
Dynamically loads `.proto` files from a shared proto directory using `@grpc/proto-loader`.

### `@jury-hrms/db`
Singleton Prisma client for MongoDB. Exports `prisma` instance and `checkDbConnection()` health check.

### `@jury-hrms/redis`
Redis utilities: singleton client (ioredis), hash helpers, JSON get/set with TTL, generic cache wrapper, pub/sub with separate subscriber, distributed locks (redlock), and namespaced key helpers.

### `@jury-hrms/auth`
JWT signing (`signAccessToken`, `signRefreshToken`) and verification (`verifyToken`) using the `jose` library.

### `@jury-hrms/mailer`
Nodemailer-based email service with templates for: OTP emails, invoice emails, expense notifications, onboarding emails.

### `@jury-hrms/files`
Abstract file storage service supporting local filesystem and AWS S3. Provides `FileService` with upload/download/delete/list operations.

### `@jury-hrms/payments`
Razorpay integration for order creation, payment links, and payment verification.

## Database Schema (Prisma + MongoDB)

Key models:
- **Organizations** - Tenant companies with configurable limits
- **OrganizationEmployees** - Employee records with org/designation/department relations
- **Admins** - System administrators
- **Attendance** - Daily attendance with check-in/out, status
- **Shifts** - Shift definitions with time windows
- **LeaveTypes / LeaveRequests** - Leave policies and applications
- **ApprovalFlows / ApprovalInstance** - Multi-level approval engine
- **Assets / AssetAssignments** - Asset lifecycle management
- **Posts / PostVotes / PostLikes** - Social/poll features
- **ComponentDefinition / SalaryTemplate / SalaryStructure** - Salary engine
- **Invoices / OrganizationSubscriptions** - Billing
- **TrafficEvent / TrafficAlert** - Traffic analytics
- **OrganizationUsageEvent** - Usage metering

## Cron Jobs

| Job | Service | Schedule | Description |
|---|---|---|---|
| Hourly Aggregation | traffic-reporting | Every 5 min | Aggregates traffic into hourly stats |
| Daily Aggregation | traffic-reporting | Daily 00:20 | Aggregates traffic into daily stats |
| Anomaly Checks | traffic-reporting | Every minute | Evaluates alert rules |
| Retention Cleanup | traffic-reporting | Daily 00:30 | Deletes old traffic events |
| Invoice Generation | invoice-generator | Daily 02:00 | Generates subscription invoices |
| Payment Link Expiry | invoice-generator | Every 5 min | Marks expired payment links |

## Key Features

- **Multi-tenant** architecture (organizations as tenants)
- **Employee lifecycle**: Onboarding flows → category assignment → department/designation → shift assignment
- **Attendance management**: Check-in/out with geofencing, network policy enforcement, regularization
- **Leave management**: Configurable leave types with accrual, carry-forward, sandwich rule, multi-level approval
- **Shift management**: Rotational shifts, policies, assignment with overlap detection
- **Asset management**: Categories → Models → Inventory → Assignments → Requests → Condition reports
- **Social/Communication**: Posts, polls with voting, comments, likes, shares
- **Salary engine**: Component definitions, templates, salary structures, formula-based calculation, payroll runs
- **Subscription & Billing**: Plans with feature limits, Razorpay integration, auto-invoicing, payment links
- **Traffic analytics**: Per-service metrics, latency percentiles, anomaly detection, retention policies
- **File storage**: Folder hierarchy, file uploads with local/S3 backends
