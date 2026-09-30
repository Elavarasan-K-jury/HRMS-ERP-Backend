/* ------------------------------------------------------------------ */
/* 🌱 Environment Setup                                                */
/* ------------------------------------------------------------------ */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trafficMiddleware } from "./middlewares/traffic.middleware.js";
import { publishTrafficEvent } from "./queue/traffic.publisher.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const log = console.log;

// Load root .env (../../.env from apps/api-gateway/server.js)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

log('🔍 EMP_CAT_SERVICE_ADDR =', process.env.EMP_CAT_SERVICE_ADDR);
log('🔍 ORG_SERVICE_ADDR =', process.env.ORG_SERVICE_ADDR);
log('🔍 EMP_SERVICE_ADDR =', process.env.EMP_SERVICE_ADDR);
log('🔍 ADMIN_SERVICE_ADDR =', process.env.ADMIN_SERVICE_ADDR);
log('🔍 ORG_DEPT_SERVICE_ADDR =', process.env.ORG_DEPT_SERVICE_ADDR);
log('🔍 EMP_DEPT_SERVICE_ADDR =', process.env.EMP_DEPT_SERVICE_ADDR);
log('🔍 ORG_DESG_SERVICE_ADDR =', process.env.ORG_DESG_SERVICE_ADDR);
log("🔍 SHIFT_SERVICE =", process.env.SHIFT_SERVICE_ADDR);
log("🔍 SHIFT_ASSIGNMENT_SERVICE =", process.env.SHIFT_ASSIGNMENT_SERVICE_ADDR);
log("🔍 SHIFT_POLICY_SERVICE =", process.env.SHIFT_POLICY_SERVICE_ADDR);
log("🔍 ATTENDANCE_SERVICE =", process.env.ATTENDANCE_SERVICE_ADDR);
log("🔍 ATTENDANCE_LOG_SERVICE =", process.env.ATTENDANCE_LOG_SERVICE_ADDR);
log("🔍 APPROVAL_SERVICE =", process.env.APPROVAL_SERVICE_ADDR);
log('🔍 LEAVE_TYPES_ADDR =', process.env.LEAVE_TYPE_SERVICE_ADDR);
log('🔍 LEAVE_REQUESTS_ADDR =', process.env.LEAVE_REQUEST_SERVICE_ADDR);
log('🔍 HOLIDAYS_ADDR =', process.env.HOLIDAY_SERVICE_ADDR);
log('🔍 HOLIDAY_POLICY_ADDR =', process.env.HOLIDAY_POLICY_SERVICE_ADDR);
log('🔍 USAGE_TYPE_ADDR =', process.env.USAGE_TYPE_SERVICE_ADDR);
log('🔍 EXPENSE_CATEGORY_ADDR =', process.env.EXPENSE_CATEGORY_SERVICE_ADDR);
log('🔍 EXPENSE_POLICY_ADDR =', process.env.EXPENSE_POLICY_SERVICE_ADDR);
log()
log('---------------------------------------------------');

/* ------------------------------------------------------------------ */
/* 📦 Imports                                                          */
/* ------------------------------------------------------------------ */
import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';

import { ipWhitelist } from './middlewares/ip_whitelist.js';
import { rateLimiter } from './middlewares/rate_limiter.js';
import { withQueue } from './middlewares/request_queue.js';
import { requestLogger } from './middlewares/req_logged.js';
import { withServiceMetrics } from './middlewares/service_metrics.js';
import { usageMiddleware } from './middlewares/usage_tracking.js';
import { authAdmin } from './middlewares/auth_admin.js';
import { authAdminOrEmployee } from './middlewares/auth_admin_employee.js';
import { authEmployee } from './middlewares/auth_employee.js';
import { organizationIpEnforcement } from './middlewares/organization_ip_enforcement.js';


import registerOrganizationRoutes from './routes/organization.routes.js';
import registerIpNetworkRoutes from './routes/ip_network.routes.js';
import registerEmployeeCategoryRoutes from './routes/employee_category.routes.js';
import registerEmployeeRoutes from './routes/employee.routes.js';
import registerAdminRoutes from './routes/admin.routes.js';
import registerOrgDepartmentRoutes from './routes/org_department.routes.js';
import registerOrgDesignationRoutes from './routes/org_designation.routes.js';
import registerEmployeeDepartmentRoutes from './routes/emp_department.routes.js';
import registerShiftRoutes from './routes/shift.routes.js';
import registerShiftAssignmentRoutes from './routes/shift_assignment.routes.js';
import registerShiftPolicyRoutes from './routes/shift_policy.routes.js';
import registerWeeklyOffPolicyRoutes from './routes/weeklyOffPolicy.routes.js';
import registerWeeklyOffAssignmentRoutes from './routes/weeklyOffAssignment.routes.js';
import registerProbationPolicyRoutes from './routes/probation_policy.routes.js';
import registerPayGradeRoutes from './routes/pay_grade.routes.js';
import registerNoticePeriodPolicyRoutes from './routes/notice_period_policy.routes.js';
import registerAttendanceRoutes from './routes/attendance.routes.js';
import registerAttendanceLogRoutes from './routes/attendance_logs.routes.js';
import registerAttendanceRegularisationRoutes from './routes/attendanceRegularisation.routes.js';
import registerApprovalRoutes from './routes/approval.routes.js';
import registerHierarchyRoutes from './routes/hierarchy.routes.js';
import registerHealthRoutes from './routes/health.routes.js';
import registerLeaveTypeRoutes from './routes/leaveType.routes.js';
import registerLeaveRequestRoutes from './routes/leaveRequest.routes.js';
import registerHolidayRoutes from './routes/holidays.routes.js';
import registerHolidayPolicyRoutes from './routes/holidayPolicy.routes.js';
import registerSalaryRoutes from './routes/salary.routes.js';
import registerSalaryComponentsRoutes from './routes/salary-components.routes.js';
import registerSalaryTemplateRoutes from './routes/salary_template.routes.js';
import registerReportsRoutes from './routes/report.routes.js';
import registerBranchRoutes from './routes/branch.routes.js';
import registerLegalEntityRoutes from './routes/legal_entity.routes.js';
import registerLocationRoutes from './routes/location.routes.js';
import registerUsageTypeRoutes from './routes/usage_type.routes.js';
import registerExpenseCategoryRoutes from './routes/expense_category.routes.js';
import registerExpensePolicyRoutes from './routes/expense_policy.routes.js';
import registerEmployeeDocumentRoutes from './routes/employee_document.routes.js';
import registerEmployeeProfileSelfRoutes from './routes/employee_profile_self.routes.js';
import registerOrganizationDocumentRoutes from './routes/organization_document.routes.js';
import registerFinanceRoutes from './routes/finance.routes.js';
import registerSalaryRangeRoutes from './routes/salary-range.routes.js';
import registerStorageRoutes from './routes/storage.routes.js';
import registerFileRoutes from './routes/file.routes.js';
import registerPayslipRoutes from './routes/payslip.routes.js';
import registerExpenseRoutes from './routes/expense.routes.js';
import registerPayrollRoutes from './routes/payroll.routes.js';

/* ------------------------------------------------------------------ */
/* 🏗️  App Setup                                                       */
/* ------------------------------------------------------------------ */

// Initialize Hono app with Zod/OpenAPI hook
const app = new OpenAPIHono({
    defaultHook: (result, c) => {
        if (!result.success) return c.json({ error: result.error }, 400);
    },
});

function parseList(envValue = "") {
    return envValue
        .split(",")
        .map(v => v.trim())
        .filter(Boolean);
}

function ipToRegex(ip) {
    // 192.168.68.*
    if (ip.endsWith(".*")) {
        const base = ip
            .replace(".*", "")
            .replace(/\./g, "\\.");
        return new RegExp(`^${base}\\.\\d+$`);
    }

    // exact IP (IPv4 / IPv6 / localhost)
    return new RegExp(`^${ip.replace(/\./g, "\\.")}$`);
}

const allowedIPs = parseList(process.env.ALLOWED_IPS)
    .map(ipToRegex);

const allowedDomains = parseList(process.env.ALLOWED_DOMAINS);

app.use(
    "*",
    cors({
        origin: (origin) => {
            // allow curl / mobile apps / server-to-server
            if (!origin) return true

            let hostname
            try {
                hostname = new URL(origin).hostname
            } catch {
                console.warn("Invalid origin:", origin)
                return false
            }

            console.log("CORS origin:", origin)
            console.log("Parsed hostname:", hostname)

            // ✅ Check IPs
            for (const regex of allowedIPs) {
                if (regex.test(hostname)) {
                    return origin
                }
            }

            // ✅ Check domains & subdomains
            for (const domain of allowedDomains) {
                if (
                    hostname === domain ||
                    hostname.endsWith(`.${domain}`)
                ) {
                    return origin
                }
            }

            console.warn("CORS BLOCKED:", origin)
            return false
        },
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        credentials: true,
    })
);


// Common middlewares
app.use('*', requestLogger); // 📝 Log requests
app.use('*', ipWhitelist); // 🛡️ IP Whitelist
app.use('*', rateLimiter); // ⏱️ Rate limiting
const detectServiceByPath = (c) => {
    const p = new URL(c.req.url).pathname;

    // global “cross-cutting” routes
    if (p.includes("/hierarchy")) return "hierarchy";
    if (p.includes("/login") || p.includes("/token") || p.startsWith("/auth")) return "auth";

    // Helper: matches exact segment prefix (avoids "/admin" matching "/adminsX" weirdness)
    const startsWithAny = (prefixes) => prefixes.some((x) => p.startsWith(x));

    // Service routing map (add/edit here)
    const routes = [
        // ORGANIZATION
        { service: "organization", prefixes: ["/organizations", "/organization"] },

        { service: "organization_ip_network", prefixes: ["/ip-networks"] },

        // LEGAL ENTITIES
        { service: "legal_entity", prefixes: ["/legal-entities", "/legal-entity"] },

        // EMPLOYEES
        { service: "employee", prefixes: ["/employees", "/employee"] },

        // EMPLOYEE CATEGORIES (keeping your typo path too)
        { service: "employee_category", prefixes: ["/employee-categories", "/employee-categorie"] },

        // PROBATION POLICIES
        { service: "probation_policy", prefixes: ["/probation-policies"] },

        { service: "pay_grade", prefixes: ["/pay-grades"] },

        // USAGE TYPES & EXPENSE CATEGORIES
        { service: "usage_type", prefixes: ["/usage-types"] },
        { service: "expense_category", prefixes: ["/expense-categories"] },
        { service: "expense_policy", prefixes: ["/expense-policies"] },
        { service: "employee_document", prefixes: ["/employee-documents"] },
        { service: "organization_document", prefixes: ["/organization-documents"] },

        // DEPARTMENTS
        { service: "department", prefixes: ["/departments", "/department"] },

        // DESIGNATIONS
        { service: "designation", prefixes: ["/designations", "/designation"] },

        // ADMIN USERS (cover both)
        { service: "admin", prefixes: ["/admins", "/admin"] },

        // APPROVAL
        { service: "approval", prefixes: ["/approval"] },

        // ATTENDANCE
        { service: "attendance", prefixes: ["/attendance", "/attendance-policies"] },

        // FINANCE / SALARY
        { service: "finance", prefixes: ["/finance", "/salary"] },

        // GEO FENCES
        { service: "geo_fence", prefixes: ["/geo-fences"] },

        // HOLIDAYS / HOLIDAY POLICIES
        { service: "holiday", prefixes: ["/holidays", "/holiday-policies"] },

        // LEAVE
        { service: "leave", prefixes: ["/leave", "/leave-types"] },

        // NETWORK POLICIES
        { service: "network_policy", prefixes: ["/network-policies"] },

        // REPORTS
        { service: "reports", prefixes: ["/reports"] },

        // SERVICE METRICS
        { service: "service_metrics", prefixes: ["/service-metrics"] },

        // SHIFTS
        {
            service: "shift",
            prefixes: ["/shifts", "/shift-policies", "/shift-assignments"],
        },

        // STORAGE
        {
            service: "storage",
            prefixes: ["/folders", "/files"],
        },

    ];

    for (const r of routes) {
        if (startsWithAny(r.prefixes)) return r.service;
    }

    return "api-gateway";
};


app.use('*', usageMiddleware({
    serviceNameResolver: (c) =>
        c.req.header("x-target-service") || detectServiceByPath(c),

    moduleResolver: (c) =>
        c.req.header("x-module") || detectServiceByPath(c), // optional
    featureResolver: (c) => "generic"
})
); // 📈 Usage tracking

app.use(
    "*",
    trafficMiddleware({
        serviceNameResolver: (c) =>
            c.req.header("x-target-service") || detectServiceByPath(c),

        moduleResolver: (c) =>
            c.req.header("x-module") || null, // optional

        publish: publishTrafficEvent
    })
);
// Auth middleware for protected admin routes
app.use('/admin/*', authAdmin);
app.use('/admins/*', authAdmin);

// Shift assignments: shared by admin portal (mutations + list) and employee portal
// (GET own assignments). Dual admin/employee scope; per-route checks inside handlers.
app.use('/shift-assignments/*', authAdminOrEmployee);

// Shift master read/mutation routes: same dual-scope guard (admin portal
// Shift Master + employee portal profile shift drawer both send Bearer tokens).
app.use('/shifts', authAdminOrEmployee);
app.use('/shifts/*', authAdminOrEmployee);

// Weekly off assignments: admin portal (Job tab, Assignments tab) reads and
// mutates; employee portal reads own assignment only. Dual admin/employee
// scope; per-route ownership checks inside handlers.
app.use('/weekly-off/assignments', authAdminOrEmployee);
app.use('/weekly-off/assignments/*', authAdminOrEmployee);

// Weekly off policies: org-admin only (policy admin UI). The employee portal
// has no consumer of these routes.
app.use('/weekly-off/policies', authAdmin);
app.use('/weekly-off/policies/*', authAdmin);

// Auth middleware for probation policy routes (permission-gated)
app.use('/probation-policies/*', authAdmin);
app.use('/notice-period-policies/*', authAdmin);

// Auth middleware for approval routes
app.use('/approval/*', authAdmin);

// Auth middleware for pay-grade and expense routes
app.use('/pay-grades/*', authAdmin);
app.use('/ip-networks', authAdmin);
app.use('/ip-networks/*', authAdmin);
app.use('/usage-types/*', authAdmin);
app.use('/expense-categories/*', authAdmin);
app.use('/expense-policies/*', authAdmin);
// Attendance regularisation: dual portal API (employee submits own requests,
// admin portal reviews/manages via regularisation UI + requirePermission).
app.use('/attendance/regularise/bulk', authAdmin);
app.use('/attendance/regularise/*', authAdminOrEmployee);
app.use('/employee-documents/my/*', authEmployee);
app.use('/employee-documents/*', authAdmin);
app.use('/employee-profile/my/*', authEmployee);
app.use('/organization-documents/*', authAdmin);

// Centralized file serving is auth-protected (supports ?token= for <img> tags)
app.use('/file/*', authAdmin);

// ---- Phase 3D: attendance route authentication (endpoint-by-endpoint audit) ----
// All /attendance* endpoints are portal-facing (Employee Portal + Admin Portal
// stores); no device/import/background/internal HTTP consumers exist.
// Dual-scope (employee + admin portal callers):
app.use('/attendance/check-in', authAdminOrEmployee);
app.use('/attendance/check-out', authAdminOrEmployee);
app.use('/attendance/recompute', authAdminOrEmployee);
// Exact '/attendance': GET list is used by both portals; POST (manual create /
// payroll run) is admin-only -> method-classified dispatch over existing auth.
app.use('/attendance', (c, next) =>
    c.req.method === 'POST' ? authAdmin(c, next) : authAdminOrEmployee(c, next)
);
// Admin-portal only attendance APIs:
app.use('/attendance/organization-monthly', authAdmin);
app.use('/attendance/report', authAdmin);
app.use('/attendance/report/*', authAdmin);
app.use('/attendance/logs', authAdmin);
app.use('/attendance-policies', authAdmin);
app.use('/attendance-policies/*', authAdmin);
app.use('/network-policies', authAdmin);
app.use('/network-policies/*', authAdmin);
app.use('/geo-fences', authAdmin);
app.use('/geo-fences/*', authAdmin);

// ---- Phase 3D: holidays route authentication (endpoint-by-endpoint audit) ----
// All /holidays endpoints are portal-facing; no public/background consumers.
// NOTE: Hono '/holidays/*' also matches the bare '/holidays' path, so a single
// classifying registration covers both: GET list is shared by both portals
// (employee calendar + admin management); POST create and every subresource
// (by-id CRUD, available-years, calendar view, bulk-import) are admin-only.
app.use('/holidays/*', (c, next) => {
    const path = new URL(c.req.url).pathname;
    return path === '/holidays' && c.req.method === 'GET'
        ? authAdminOrEmployee(c, next)
        : authAdmin(c, next);
});

// Organization IP enforcement (Phase 3C) - single authoritative enforcement
// point. Registered AFTER all auth middlewares above (principal established)
// and BEFORE route handlers (denied requests never reach handlers).
// No principal (public/unauthenticated routes) -> skipped by design.
app.use('*', organizationIpEnforcement);

// Health check
app.get('/', (c) => c.text('🚀 Jury-HRMS API Gateway is running!'));


/* ------------------------------------------------------------------ */
/* 📁 STATIC FILE SERVER (LOCAL UPLOADS)                              */
/* ------------------------------------------------------------------ */
const uploadsPath = process.env.LOCAL_STORAGE_PATH
    ? path.resolve(process.env.LOCAL_STORAGE_PATH)
    : path.resolve(__dirname, '../../uploads'); // <-- correct path from api-gateway


console.log("📂 Serving local files from:", uploadsPath);

// Serve local files at /uploads/*
app.use(
    '/uploads/*',
    serveStatic({
        root: uploadsPath, // absolute path
        rewriteRequestPath: (path) => path.replace('/uploads', ''),
    })
);


/* ------------------------------------------------------------------ */
/* 🔗 Route Registration (same usage as before)                        */
/* ------------------------------------------------------------------ */

const wrapService = (serviceName) => (def, ...handlers) => {
    const last = handlers.pop();
    app.openapi(def, ...handlers, withQueue(withServiceMetrics(serviceName, last)));
};

const wrapSystem = (def, handler) => app.openapi(def, handler);

registerOrganizationRoutes({ openapi: wrapService('organization') });
registerIpNetworkRoutes({ openapi: wrapService('organization_ip_network') });
registerHierarchyRoutes({ openapi: wrapService('hierarchy') });
registerEmployeeCategoryRoutes({ openapi: wrapService('employee_category') });
registerEmployeeRoutes({ openapi: wrapService('employee') });
registerAdminRoutes({ openapi: wrapService('admin') });
registerOrgDepartmentRoutes({ openapi: wrapService('org_department') });
registerOrgDesignationRoutes({ openapi: wrapService('org_designation') });
registerEmployeeDepartmentRoutes({ openapi: wrapService('emp_department') });
registerShiftRoutes({ openapi: wrapService('shift') });
registerShiftAssignmentRoutes({ openapi: wrapService('shift_assignment') });
registerShiftPolicyRoutes({ openapi: wrapService('shift_policy') });
registerWeeklyOffPolicyRoutes({ openapi: wrapService('weekly_off') });
registerWeeklyOffAssignmentRoutes({ openapi: wrapService('weekly_off') });
registerProbationPolicyRoutes({ openapi: wrapService('probation_policy') });
registerPayGradeRoutes({ openapi: wrapService('pay_grade') });
registerNoticePeriodPolicyRoutes({ openapi: wrapService('notice_period_policy') });
registerAttendanceRoutes({ openapi: wrapService('attendance') });
registerAttendanceLogRoutes({ openapi: wrapService('attendance_logs') });
registerAttendanceRegularisationRoutes({ openapi: wrapService('attendance_regularisation') });
registerApprovalRoutes({ openapi: wrapService('approval') });
registerLeaveTypeRoutes({ openapi: wrapService('leave_type') });
registerLeaveRequestRoutes({ openapi: wrapService('leave_request') });
registerHolidayRoutes({ openapi: wrapService('holidays') });
registerHolidayPolicyRoutes({ openapi: wrapService('holiday_policy') });
registerFinanceRoutes({ openapi: wrapService('finance') });
registerSalaryComponentsRoutes({ openapi: wrapService('salary_component') });
registerSalaryTemplateRoutes({ openapi: wrapService('salary_template') });
registerSalaryRangeRoutes({ openapi: wrapService('salary_range') });
registerSalaryRoutes({ openapi: wrapService('salary') });
registerReportsRoutes({ openapi: wrapService('reports') });
registerStorageRoutes({ openapi: wrapService('storage') });
registerFileRoutes({ openapi: wrapService('storage') });
registerPayslipRoutes({ openapi: wrapService('payslip') });
registerExpenseRoutes({ openapi: wrapService('expense') });
registerPayrollRoutes({ openapi: wrapService('payroll') });
registerBranchRoutes({ openapi: wrapService('branch') });
registerLegalEntityRoutes({ openapi: wrapService('legal_entity') });
registerLocationRoutes({ openapi: wrapService('location') });
registerUsageTypeRoutes({ openapi: wrapService('usage_type') });
registerExpenseCategoryRoutes({ openapi: wrapService('expense_category') });
registerExpensePolicyRoutes({ openapi: wrapService('expense_policy') });
registerEmployeeDocumentRoutes({ openapi: wrapService('employee_document') });
registerEmployeeProfileSelfRoutes({ openapi: wrapService('employee_profile_self') });
registerOrganizationDocumentRoutes({ openapi: wrapService('organization_document') });
registerHealthRoutes({ openapi: wrapSystem });

/* ------------------------------------------------------------------ */
/* 📜 OpenAPI / Swagger                                                */
/* ------------------------------------------------------------------ */
app.doc('/doc', {
    openapi: '3.1.0',
    info: {
        title: 'Jury HRMS API Gateway',
        version: '1.0.0',
        description: 'REST gateway for Jury HRMS microservices (Organization, etc.)',
    },
});

app.get('/swagger', swaggerUI({ url: '/doc' }));

// ---- Start Server (HMR-safe) ---- //
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMain) {
    const PORT = Number(process.env.GATEWAY_PORT || 50050);

    try {
        serve({
            fetch: app.fetch,
            port: PORT,
            hostname: '0.0.0.0',
        });

        console.log(`🚀 API Gateway running on :${PORT}`);
        console.log(`📘 Swagger Docs → http://localhost:${PORT}/swagger`);
    } catch (err) {
        if (err && err.code === 'EADDRINUSE') {
            console.error(`❌ Port ${PORT} already in use.`);
            console.error(
                'Either stop the old process or set GATEWAY_PORT to a different value.'
            );
        } else {
            console.error('❌ Failed to start server:', err);
        }
    }

    // Graceful shutdown
    for (const sig of ['SIGINT', 'SIGTERM']) {
        process.on(sig, () => {
            console.log('[gateway] shutting down gracefully...');
            process.exit(0);
        });
    }
}