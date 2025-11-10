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

import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { swaggerUI } from '@hono/swagger-ui';
import { ipWhitelist } from './middlewares/ipWhitelist.js';
import { rateLimiter } from './middlewares/rateLimiter.js';
import { withQueue } from './middlewares/requestQueue.js';
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

// ---- Initialize Hono App ---- //
const app = new OpenAPIHono({
    defaultHook: (result, c) => {
        if (!result.success) return c.json({ error: result.error }, 400);
    }
});

app.use('*', cors({
    origin: ['http://localhost:3001', 'http://127.0.0.1:3001'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

// 🧩 Apply middlewares
app.use('*', ipWhitelist);   // 🛡️ Add this before others
app.use('*', rateLimiter);   // ⏱️ Then rate limiting

// ---- Health Check ---- //
app.get('/', (c) => c.text('🚀 Jury-HRMS API Gateway is running!'));

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
registerOrgDesignationRoutes({
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

// ---- OpenAPI Info ---- //
app.doc('/doc', {
    openapi: '3.1.0',
    info: {
        title: 'Jury HRMS API Gateway',
        version: '1.0.0',
        description: 'REST gateway for Jury HRMS microservices (Organization, etc.)',
    },
});

// ---- Swagger UI ---- //
app.get('/swagger', swaggerUI({ url: '/doc' }));


// ---- Start Server (HMR-safe) ---- //
if (import.meta.main) {
    const PORT = Number(process.env.GATEWAY_PORT || 3030);

    // 🧹 Stop any previous instance (for Bun --watch)
    if (globalThis.__gatewayServer) {
        try {
            globalThis.__gatewayServer.stop?.(); // Bun v1.1+
            globalThis.__gatewayServer.shutdown?.();
            console.log('[gateway] previous server stopped');
        } catch (err) {
            console.warn('[gateway] cleanup failed:', err);
        }
        globalThis.__gatewayServer = undefined;
    }

    try {
        const server = Bun.serve({ port: PORT, fetch: app.fetch });
        globalThis.__gatewayServer = server;
        console.log(`🚀 API Gateway running on :${server.port}`);
        console.log(`📘 Swagger Docs → http://localhost:${server.port}/swagger`);
    } catch (err) {
        if (err.code === 'EADDRINUSE') {
            console.error(`❌ Port ${PORT} already in use.`);
            console.error('Either stop the old process or set GATEWAY_PORT to a new value.');
        } else {
            console.error('❌ Failed to start server:', err);
        }
    }

    // Graceful shutdown (Ctrl+C, Docker stop, etc.)
    for (const sig of ['SIGINT', 'SIGTERM']) {
        process.on(sig, () => {
            try {
                globalThis.__gatewayServer?.stop?.();
            } catch { }
            console.log('[gateway] shutting down gracefully...');
            process.exit(0);
        });
    }
}

export default app;