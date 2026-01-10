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
log(
    '🔍 EMP_ONBOARDING_FLOW_SERVICE_ADDR =',
    process.env.EMP_ONBOARDING_FLOW_SERVICE_ADDR
);
log(
    '🔍 EMP_ONBOARDING_STEP_SERVICE_ADDR =',
    process.env.EMP_ONBOARDING_STEP_SERVICE_ADDR
);
log(
    '🔍 EMP_ONBOARDING_FEATURE_SERVICE_ADDR =',
    process.env.EMP_ONBOARDING_FEATURE_SERVICE_ADDR
);
log(
    '🔍 EMP_ONBOARDING_PROGRESS_SERVICE_ADDR =',
    process.env.EMP_ONBOARDING_PROGRESS_SERVICE_ADDR
);
log("🔍 SHIFT_SERVICE =", process.env.SHIFT_SERVICE_ADDR);
log("🔍 SHIFT_ASSIGNMENT_SERVICE =", process.env.SHIFT_ASSIGNMENT_SERVICE_ADDR);
log("🔍 SHIFT_POLICY_SERVICE =", process.env.SHIFT_POLICY_SERVICE_ADDR);
log("🔍 ATTENDANCE_SERVICE =", process.env.ATTENDANCE_SERVICE_ADDR);
log("🔍 ATTENDANCE_LOG_SERVICE =", process.env.ATTENDANCE_LOG_SERVICE_ADDR);
log("🔍 APPROVAL_SERVICE =", process.env.APPROVAL_SERVICE_ADDR);
log('🔍 ASSET_CATEGORY_SERVICE_ADDR =', process.env.ASSET_CAT_SERVICE_ADDR);
log('🔍 ASSET_MODEL_SERVICE_ADDR =', process.env.ASSET_MOD_SERVICE_ADDR);
log('🔍 ASSET_SERVICE_ADDR =', process.env.ASSETS_SERVICE_ADDR);
log('🔍 ASSET_REQUEST_SERVICE_ADDR =', process.env.ASSET_REQ_SERVICE_ADDR);
log('🔍 ASSET_ASSIGNMENT_SERVICE_ADDR =', process.env.ASSET_ASSIGN_SERVICE_ADDR);
log('🔍 ASSET_CONDITION_SERVICE_ADDR =', process.env.ASSET_CON_SERVICE_ADDR);
log('🔍 POST_POLL_SERVICE_ADDR =', process.env.POST_POLL_SERVICE_ADDR);
log('🔍 LEAVE_TYPES_ADDR =', process.env.LEAVE_TYPE_SERVICE_ADDR);
log('🔍 LEAVE_REQUESTS_ADDR =', process.env.LEAVE_REQUEST_SERVICE_ADDR);
log('🔍 HOLIDAYS_ADDR =', process.env.HOLIDAY_SERVICE_ADDR);
log('🔍 HOLIDAY_POLICY_ADDR =', process.env.HOLIDAY_POLICY_SERVICE_ADDR);
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


import registerOrganizationRoutes from './routes/organization.routes.js';
import registerEmployeeCategoryRoutes from './routes/employee_category.routes.js';
import registerEmployeeRoutes from './routes/employee.routes.js';
import registerAdminRoutes from './routes/admin.routes.js';
import registerOrgDepartmentRoutes from './routes/org_department.routes.js';
import registerOrgDesignationRoutes from './routes/org_designation.routes.js';
import registerEmployeeDepartmentRoutes from './routes/emp_department.routes.js';
import registerEmployeeOnboardingFlowRoutes from './routes/emp_onboard_flow.routes.js';
import registerEmployeeOnboardingStepRoutes from './routes/emp_onboard_step.routes.js';
import registerEmployeeOnboardingFeatureRoutes from './routes/emp_onboard_feature.routes.js';
import registerEmployeeOnboardingProgressRoutes from './routes/emp_onboard_progress.routes.js';
import registerShiftRoutes from './routes/shift.routes.js';
import registerShiftAssignmentRoutes from './routes/shift_assignment.routes.js';
import registerShiftPolicyRoutes from './routes/shift_policy.routes.js';
import registerAttendanceRoutes from './routes/attendance.routes.js';
import registerAttendanceLogRoutes from './routes/attendance_logs.routes.js';
import registerApprovalRoutes from './routes/approval.routes.js';
import registerAssetCategoryRoutes from './routes/asset_category.routes.js';
import registerAssetModelRoutes from './routes/asset_model.routes.js';
import registerAssetRoutes from './routes/assets.routes.js';
import registerAssetRequestRoutes from './routes/asset_request.routes.js';
import registerAssetAssignmentRoutes from './routes/asset_assignment.routes.js';
import registerAssetConditionRoutes from './routes/asset_condition.routes.js';
import registerHierarchyRoutes from './routes/hierarchy.routes.js';
import registerPostPollRoutes from './routes/post_poll.routes.js';
import registerHealthRoutes from './routes/health.routes.js';
import registerLeaveTypeRoutes from './routes/leaveType.routes.js';
import registerLeaveRequestRoutes from './routes/leaveRequest.routes.js';
import registerHolidayRoutes from './routes/holidays.routes.js';
import registerHolidayPolicyRoutes from './routes/holidayPolicy.routes.js';
import registerSalaryRoutes from './routes/salary.routes.js';
import registerSalaryComponentsRoutes from './routes/salary-components.routes.js';
import registerSalaryTemplateRoutes from './routes/salary_template.routes.js';
import registerReportsRoutes from './routes/report.routes.js';
import registerFinanceRoutes from './routes/finance.routes.js';
import registerSalaryRangeRoutes from './routes/salary-range.routes.js';
import registerSubscriptionPlanRoutes from './routes/subscription-plans.routes.js';
import registerInvoiceRoutes from './routes/invoices.routes.js';
import registerOrganizationSubscriptionRoutes from './routes/organization-subscriptions.routes.js';
import registerStorageRoutes from './routes/storage.routes.js';

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

        // EMPLOYEES
        { service: "employee", prefixes: ["/employees", "/employee"] },

        // EMPLOYEE CATEGORIES (keeping your typo path too)
        { service: "employee_category", prefixes: ["/employee-categories", "/employee-categorie"] },

        // DEPARTMENTS
        { service: "department", prefixes: ["/departments", "/department"] },

        // DESIGNATIONS
        { service: "designation", prefixes: ["/designations", "/designation"] },

        // ADMIN USERS (cover both)
        { service: "admin", prefixes: ["/admins", "/admin"] },

        // APPROVAL
        { service: "approval", prefixes: ["/approval"] },

        // ASSETS (group all asset-* + assets)
        {
            service: "asset",
            prefixes: [
                "/assets",
                "/asset-assignments",
                "/asset-categories",
                "/asset-conditions",
                "/asset-models",
                "/asset-requests",
            ],
        },

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

        // POSTS / POLLS
        { service: "post", prefixes: ["/posts", "/post-polls"] },

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

        // EMPLOYEE ONBOARDING (group)
        {
            service: "employee_onboarding",
            prefixes: [
                "/employee-onboarding-features",
                "/employee-onboarding-flows",
                "/employee-onboarding-progress",
                "/employee-onboarding-steps",
            ],
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

const wrapService = (serviceName) => (def, handler) =>
    app.openapi(def, withQueue(withServiceMetrics(serviceName, handler)));

const wrapSystem = (def, handler) => app.openapi(def, handler);

registerOrganizationRoutes({ openapi: wrapService('organization') });
registerHierarchyRoutes({ openapi: wrapService('hierarchy') });
registerEmployeeCategoryRoutes({ openapi: wrapService('employee_category') });
registerEmployeeRoutes({ openapi: wrapService('employee') });
registerAdminRoutes({ openapi: wrapService('admin') });
registerOrgDepartmentRoutes({ openapi: wrapService('org_department') });
registerOrgDesignationRoutes({ openapi: wrapService('org_designation') });
registerEmployeeDepartmentRoutes({ openapi: wrapService('emp_department') });
registerEmployeeOnboardingFlowRoutes({ openapi: wrapService('emp_onboard_flow') });
registerEmployeeOnboardingStepRoutes({ openapi: wrapService('emp_onboard_step') });
registerEmployeeOnboardingFeatureRoutes({ openapi: wrapService('emp_onboard_feature') });
registerEmployeeOnboardingProgressRoutes({ openapi: wrapService('emp_onboard_progress') });
registerAssetCategoryRoutes({ openapi: wrapService('asset_category') });
registerAssetModelRoutes({ openapi: wrapService('asset_model') });
registerAssetRoutes({ openapi: wrapService('asset') });
registerAssetRequestRoutes({ openapi: wrapService('asset_request') });
registerAssetAssignmentRoutes({ openapi: wrapService('asset_assignment') });
registerAssetConditionRoutes({ openapi: wrapService('asset_condition') });
registerPostPollRoutes({ openapi: wrapService('post_poll') });
registerShiftRoutes({ openapi: wrapService('shift') });
registerShiftAssignmentRoutes({ openapi: wrapService('shift_assignment') });
registerShiftPolicyRoutes({ openapi: wrapService('shift_policy') });
registerAttendanceRoutes({ openapi: wrapService('attendance') });
registerAttendanceLogRoutes({ openapi: wrapService('attendance_logs') });
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
registerSubscriptionPlanRoutes({ openapi: wrapService('subscription_plan') });
registerOrganizationSubscriptionRoutes({ openapi: wrapService('organization_subscription') });
registerInvoiceRoutes({ openapi: wrapService('invoice') });
registerStorageRoutes({ openapi: wrapService('storage') });
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