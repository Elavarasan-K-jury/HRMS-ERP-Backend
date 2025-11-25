console.log("🔍 EMP_CAT_SERVICE_ADDR =", process.env.EMP_CAT_SERVICE_ADDR);
console.log("🔍 ORG_SERVICE_ADDR =", process.env.ORG_SERVICE_ADDR);
console.log("🔍 EMP_SERVICE_ADDR =", process.env.EMP_SERVICE_ADDR);
console.log("🔍 ADMIN_SERVICE_ADDR =", process.env.ADMIN_SERVICE_ADDR);
console.log("🔍 ORG_DEPT_SERVICE_ADDR =", process.env.ORG_DEPT_SERVICE_ADDR);
console.log("🔍 EMP_DEPT_SERVICE_ADDR =", process.env.EMP_DEPT_SERVICE_ADDR)
console.log("🔍 ORG_DESG_SERVICE_ADDR =", process.env.ORG_DESG_SERVICE_ADDR);
console.log("🔍 EMP_ONBOARDING_FLOW_SERVICE_ADDR =", process.env.EMP_ONBOARDING_FLOW_SERVICE_ADDR);
console.log("🔍 EMP_ONBOARDING_STEP_SERVICE_ADDR =", process.env.EMP_ONBOARDING_STEP_SERVICE_ADDR);
console.log("🔍 EMP_ONBOARDING_FEATURE_SERVICE_ADDR =", process.env.EMP_ONBOARDING_FEATURE_SERVICE_ADDR);
console.log("🔍 SHIFT_SERVICE =", process.env.SHIFT_SERVICE_ADDR);
console.log("🔍 SHIFT_ASSIGNMENT_SERVICE =", process.env.SHIFT_ASSIGNMENT_SERVICE_ADDR);
console.log("🔍 SHIFT_POLICY_SERVICE =", process.env.SHIFT_POLICY_SERVICE_ADDR);
console.log("🔍 ATTENDANCE_SERVICE =", process.env.ATTENDANCE_SERVICE_ADDR);
console.log("🔍 ATTENDANCE_LOG_SERVICE =", process.env.ATTENDANCE_LOG_SERVICE_ADDR);
cobsole.log("🔍 APPROVAL_SERVICE =", process.env.APPROVAL_SERVICE_ADDR);


/* ------------------------------------------------------------------ */
/* 🌱 Environment Setup                                                */
/* ------------------------------------------------------------------ */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load root .env (../../.env from apps/api-gateway/server.js)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

console.log('🔍 EMP_CAT_SERVICE_ADDR =', process.env.EMP_CAT_SERVICE_ADDR);
console.log('🔍 ORG_SERVICE_ADDR =', process.env.ORG_SERVICE_ADDR);
console.log('🔍 EMP_SERVICE_ADDR =', process.env.EMP_SERVICE_ADDR);
console.log('🔍 ADMIN_SERVICE_ADDR =', process.env.ADMIN_SERVICE_ADDR);
console.log('🔍 ORG_DEPT_SERVICE_ADDR =', process.env.ORG_DEPT_SERVICE_ADDR);
console.log('🔍 EMP_DEPT_SERVICE_ADDR =', process.env.EMP_DEPT_SERVICE_ADDR);
console.log('🔍 ORG_DESG_SERVICE_ADDR =', process.env.ORG_DESG_SERVICE_ADDR);
console.log(
    '🔍 EMP_ONBOARDING_FLOW_SERVICE_ADDR =',
    process.env.EMP_ONBOARDING_FLOW_SERVICE_ADDR
);
console.log(
    '🔍 EMP_ONBOARDING_STEP_SERVICE_ADDR =',
    process.env.EMP_ONBOARDING_STEP_SERVICE_ADDR
);
console.log(
    '🔍 EMP_ONBOARDING_FEATURE_SERVICE_ADDR =',
    process.env.EMP_ONBOARDING_FEATURE_SERVICE_ADDR
);
console.log(
    '🔍 EMP_ONBOARDING_PROGRESS_SERVICE_ADDR =',
    process.env.EMP_ONBOARDING_PROGRESS_SERVICE_ADDR
);
console.log('🔍 ASSET_CATEGORY_SERVICE_ADDR =', process.env.ASSET_CATEGORY_SERVICE_ADDR);
console.log('🔍 ASSET_MODEL_SERVICE_ADDR =', process.env.ASSET_MODEL_SERVICE_ADDR);
console.log('🔍 ASSET_SERVICE_ADDR =', process.env.ASSET_SERVICE_ADDR);
console.log('🔍 ASSET_REQUEST_SERVICE_ADDR =', process.env.ASSET_REQUEST_SERVICE_ADDR);
console.log('🔍 ASSET_ASSIGNMENT_SERVICE_ADDR =', process.env.ASSET_ASSIGNMENT_SERVICE_ADDR);
console.log('🔍 ASSET_CONDITION_SERVICE_ADDR =', process.env.ASSET_CONDITION_SERVICE_ADDR);
console.log('🔍 HIERARCHY_SERVICE_ADDR =', process.env.HIERARCHY_SERVICE_ADDR);
console.log('🔍 POST_POLL_SERVICE_ADDR =', process.env.POST_POLL_SERVICE_ADDR);

/* ------------------------------------------------------------------ */
/* 📦 Imports                                                          */
/* ------------------------------------------------------------------ */
import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';

import { ipWhitelist } from './middlewares/ipWhitelist.js';
import { rateLimiter } from './middlewares/rateLimiter.js';
import { withQueue } from './middlewares/requestQueue.js';
import { requestLogger } from './middlewares/reqLogged.js';

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
import registerShiftAssignmentRoutes from './routes/shift-assignment.routes.js';
import registerShiftPolicyRoutes from './routes/shiftPolicy.routes.js';
import registerAttendanceRoutes from './routes/attendance.routes.js';
import registerAttendanceLogRoutes from './routes/attendanceLogs.routes.js';
import registerApprovalRoutes from './routes/approval.routes.js';
import registerAssetCategoryRoutes from './routes/asset_category.routes.js';
import registerAssetModelRoutes from './routes/asset_model.routes.js';
import registerAssetRoutes from './routes/assets.routes.js';
import registerAssetRequestRoutes from './routes/asset_request.routes.js';
import registerAssetAssignmentRoutes from './routes/asset_assignment.routes.js';
import registerAssetConditionRoutes from './routes/asset_condition.routes.js';
import registerHierarchyRoutes from './routes/hierarchy.routes.js';
import registerPostPollRoutes from './routes/post_poll.routes.js';

/* ------------------------------------------------------------------ */
/* 🏗️  App Setup                                                       */
/* ------------------------------------------------------------------ */

// Initialize Hono app with Zod/OpenAPI hook
const app = new OpenAPIHono({
    defaultHook: (result, c) => {
        if (!result.success) return c.json({ error: result.error }, 400);
    },
});

// CORS
app.use(
    '*',
    cors({
        origin: ['http://localhost:3030', 'http://127.0.0.1:3030'],
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    })
);

// Common middlewares
app.use('*', requestLogger); // 📝 Log requests
app.use('*', ipWhitelist); // 🛡️ IP Whitelist
app.use('*', rateLimiter); // ⏱️ Rate limiting

// Health check
app.get('/', (c) => c.text('🚀 Jury-HRMS API Gateway is running!'));

/* ------------------------------------------------------------------ */
/* 🔗 Route Registration (same usage as before)                        */
/* ------------------------------------------------------------------ */

const openapiWithQueue = (def, handler) => app.openapi(def, withQueue(handler));

registerOrganizationRoutes({ openapi: openapiWithQueue });
registerHierarchyRoutes({ openapi: openapiWithQueue });
registerEmployeeCategoryRoutes({ openapi: openapiWithQueue });
registerEmployeeRoutes({ openapi: openapiWithQueue });
registerAdminRoutes({ openapi: openapiWithQueue });
registerOrgDepartmentRoutes({ openapi: openapiWithQueue });
registerOrgDesignationRoutes({ openapi: openapiWithQueue });
registerEmployeeDepartmentRoutes({ openapi: openapiWithQueue });
registerEmployeeOnboardingFlowRoutes({ openapi: openapiWithQueue });
registerEmployeeOnboardingStepRoutes({ openapi: openapiWithQueue });
registerEmployeeOnboardingFeatureRoutes({ openapi: openapiWithQueue });
registerEmployeeOnboardingProgressRoutes({ openapi: openapiWithQueue });
registerAssetCategoryRoutes({ openapi: openapiWithQueue });
registerAssetModelRoutes({ openapi: openapiWithQueue });
registerAssetRoutes({ openapi: openapiWithQueue });
registerAssetRequestRoutes({ openapi: openapiWithQueue });
registerAssetAssignmentRoutes({ openapi: openapiWithQueue });
registerAssetConditionRoutes({ openapi: openapiWithQueue });
registerPostPollRoutes({ openapi: openapiWithQueue });

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

/* ------------------------------------------------------------------ */
/* 🚀 Server Start (Node.js, no Bun/HMR)                               */
/* ------------------------------------------------------------------ */


// ---- Register Routes ---- //
registerOrganizationRoutes({
    openapi: (def, handler) => {
        // wrap each route handler in queue
        app.openapi(def, withQueue(handler));
    },
});
registerEmployeeCategoryRoutes({
    openapi: (def, handler) => {
        // wrap each route handler in queue
        app.openapi(def, withQueue(handler));
    },
});
registerEmployeeRoutes({
    openapi: (def, handler) => {
        // wrap each route handler in queue
        app.openapi(def, withQueue(handler));
    },
});
registerAdminRoutes({
    openapi: (def, handler) => {
        // wrap each route handler in queue
        app.openapi(def, withQueue(handler));
    },
});
registerOrgDepartmentRoutes({
    openapi: (def, handler) => {
        // wrap each route handler in queue
        app.openapi(def, withQueue(handler));
    },
});
registerorgDesignationRoutes({
    openapi: (def, handler) => {
        // wrap each route handler in queue
        app.openapi(def, withQueue(handler));
    },
});
registerEmployeeDepartmentRoutes({
    openapi: (def, handler) => {
        // wrap each route handler in queue
        app.openapi(def, withQueue(handler));
    },
});
registerEmployeeOnboardingFlowRoutes({
    openapi: (def, handler) => {
        // wrap each route handler in queue
        app.openapi(def, withQueue(handler));
    },
});
registerEmployeeOnboardingStepRoutes({
    openapi: (def, handler) => {
        // wrap each route handler in queue
        app.openapi(def, withQueue(handler));
    },
});
registerEmployeeOnboardingFeatureRoutes({
    openapi: (def, handler) => {
        // wrap each route handler in queue
        app.openapi(def, withQueue(handler));
    },
});
registerEmployeeOnboardingProgressRoutes({
    openapi: (def, handler) => {
        // wrap each route handler in queue
        app.openapi(def, withQueue(handler));
    },
});
registerShiftRoutes({
    openapi: (def, handler) => {
        // wrap each route handler in queue
        app.openapi(def, withQueue(handler));
    },
});
registerShiftAssignmentRoutes({
    openapi: (def, handler) => {
        // wrap each route handler in queue
        app.openapi(def, withQueue(handler));
    },
});
registerShiftPolicyRoutes({
    openapi: (def, handler) => {
        // wrap each route handler in queue
        app.openapi(def, withQueue(handler));
    },
});
registerAttendanceRoutes({
    openapi: (def, handler) => {
        // wrap each route handler in queue
        app.openapi(def, withQueue(handler));
    },
});
registerAttendanceLogRoutes({
    openapi: (def, handler) => {
        // wrap each route handler in queue
        app.openapi(def, withQueue(handler));
    },
});
registerApprovalRoutes({
    openapi: (def, handler) => {
        // wrap each route handler in queue
        app.openapi(def, withQueue(handler));
    },
});

// ---- Start Server (HMR-safe) ---- //
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
 
if (isMain) {
    const PORT = Number(process.env.GATEWAY_PORT || 3030);

    try {
        serve({
            fetch: app.fetch,
            port: PORT,
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

export default app;
