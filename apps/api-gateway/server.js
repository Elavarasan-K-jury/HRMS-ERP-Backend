/* ------------------------------------------------------------------ */
/* 🌱 Environment Setup                                                */
/* ------------------------------------------------------------------ */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

/* ------------------------------------------------------------------ */
/* 🏗️  App Setup                                                       */
/* ------------------------------------------------------------------ */

// Initialize Hono app with Zod/OpenAPI hook
const app = new OpenAPIHono({
    defaultHook: (result, c) => {
        if (!result.success) return c.json({ error: result.error }, 400);
    },
});

function parseAllowedIPs() {
    const raw = process.env.ALLOWED_IPS || "";
    const ips = raw.split(",").map(ip => ip.trim());

    return ips.map(ip => {
        // Convert wildcard: "192.168.68.*"
        if (ip.endsWith(".*")) {
            const base = ip.replace(".*", "").replace(/\./g, "\\.");
            return new RegExp(`^http:\\/\\/${base}\\.\\d+(?::\\d+)?$`);
        }

        // Exact IP (localhost, IPv4, IPv6)
        return new RegExp(`^http:\\/\\/${ip.replace(/\./g, "\\.")}(?::\\d+)?$`);
    });
}

const allowedOriginPatterns = parseAllowedIPs();

app.use(
    "*",
    cors({
        origin: (origin) => {
            if (!origin) return "*"; // allow curl / mobile apps

            // Match any allowed IP range
            for (const pattern of allowedOriginPatterns) {
                if (pattern.test(origin)) {
                    return origin;
                }
            }

            console.warn("CORS BLOCKED:", origin);
            return false;
        },
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    })
);

// Common middlewares
app.use('*', requestLogger); // 📝 Log requests
app.use('*', ipWhitelist); // 🛡️ IP Whitelist
app.use('*', rateLimiter); // ⏱️ Rate limiting

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