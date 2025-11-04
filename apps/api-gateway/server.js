import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import registerOrganizationRoutes from './routes/organization.routes.js';

// ---- Initialize Hono App ---- //
const app = new OpenAPIHono({
    defaultHook: (result, c) => {
        if (!result.success) return c.json({ error: result.error }, 400);
    }
});

// ---- OpenAPI Info ---- //
app.doc('/doc', {
    openapi: '3.1.0',
    info: {
        title: 'Jury HRMS API Gateway',
        version: '1.0.0',
        description: 'REST gateway for Jury HRMS microservices (Organization, etc.)'
    }
});

// ---- Swagger UI ---- //
app.get('/swagger', swaggerUI({ url: '/doc' }));

// ---- Health Check ---- //
app.get('/', (c) => c.text('🚀 Jury-HRMS API Gateway is running!'));

// ---- Register Routes ---- //
registerOrganizationRoutes(app);

// ---- Start Server ---- //
if (import.meta.main) {
    const PORT = Number(process.env.GATEWAY_PORT || 3030);
    Bun.serve({ port: PORT, fetch: app.fetch });
    console.log(`🚀 API Gateway running on :${PORT}`);
    console.log(`📘 Swagger Docs → http://localhost:${PORT}/swagger`);
}

export default app;
