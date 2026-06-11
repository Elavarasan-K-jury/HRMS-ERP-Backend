# server.js — API Gateway Entry Point

## Purpose
Initializes and starts the Hono HTTP server with OpenAPI (Zod) support, registers all cross-cutting middlewares, wires up gRPC route handlers, and serves Swagger UI documentation.

## Key Components

### Environment Loading
Loads the root `.env` file and logs every microservice address for debugging:

```js
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
log('🔍 EMP_CAT_SERVICE_ADDR =', process.env.EMP_CAT_SERVICE_ADDR);
```

### App Initialization
Creates an `OpenAPIHono` instance with a default validation hook that returns `400` on schema failures:

```js
const app = new OpenAPIHono({
    defaultHook: (result, c) => {
        if (!result.success) return c.json({ error: result.error }, 400);
    },
});
```

### CORS Configuration
Parses `ALLOWED_IPS` and `ALLOWED_DOMAINS` from environment, then builds a CORS middleware that checks origin against IP regexes and domain whitelists:

```js
app.use("*", cors({
    origin: (origin) => {
        if (!origin) return true;
        // checks allowedIPs regex list and allowedDomains list
        for (const regex of allowedIPs) {
            if (regex.test(hostname)) return origin;
        }
        for (const domain of allowedDomains) {
            if (hostname === domain || hostname.endsWith(`.${domain}`)) return origin;
        }
        return false;
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
}));
```

An `ipToRegex` helper converts wildcard patterns like `192.168.68.*` into proper RegExp objects.

### Service Detection
`detectServiceByPath(c)` maps request URL paths to logical service names using a prefix-based routing table:

```js
const routes = [
    { service: "organization", prefixes: ["/organizations", "/organization"] },
    { service: "employee", prefixes: ["/employees", "/employee"] },
    // ...
];
for (const r of routes) {
    if (startsWithAny(r.prefixes)) return r.service;
}
```

### Middleware Stack
All global middlewares are registered in order:

```js
app.use('*', requestLogger);
app.use('*', ipWhitelist);
app.use('*', rateLimiter);
app.use('*', usageMiddleware({ serviceNameResolver, moduleResolver, featureResolver }));
app.use('*', trafficMiddleware({ serviceNameResolver, moduleResolver, publish }));
```

### Route Registration
A `wrapService` helper applies `withQueue` and `withServiceMetrics` to every route handler, while `wrapSystem` is used for internal routes (like health):

```js
const wrapService = (serviceName) => (def, handler) =>
    app.openapi(def, withQueue(withServiceMetrics(serviceName, handler)));

const wrapSystem = (def, handler) => app.openapi(def, handler);

registerOrganizationRoutes({ openapi: wrapService('organization') });
// ... all 30+ route modules registered similarly
```

### Static File Serving
Serves local uploads at `/uploads/*` via `serveStatic`:

```js
app.use('/uploads/*', serveStatic({
    root: uploadsPath,
    rewriteRequestPath: (path) => path.replace('/uploads', ''),
}));
```

### Swagger Documentation
Generates OpenAPI 3.1.0 spec at `/doc` and Swagger UI at `/swagger`:

```js
app.doc('/doc', {
    openapi: '3.1.0',
    info: { title: 'Jury HRMS API Gateway', version: '1.0.0' },
});
app.get('/swagger', swaggerUI({ url: '/doc' }));
```

### Server Start
Starts `@hono/node-server` with graceful shutdown handling:

```js
if (isMain) {
    serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' });
    for (const sig of ['SIGINT', 'SIGTERM']) {
        process.on(sig, () => { process.exit(0); });
    }
}
```

## Dependencies
- `@hono/zod-openapi` — OpenAPI integration with Zod validation
- `@hono/swagger-ui` — Swagger UI endpoint
- `hono/cors` — CORS middleware
- `@hono/node-server` — Node.js HTTP server adapter
- `@hono/node-server/serve-static` — Static file serving
- `dotenv` — Environment variable loading
- All `./routes/*.routes.js` modules — Route registration
- All `./middlewares/*.js` modules — Global middleware

## Patterns
- **Decorator (wrapService)**: Every route handler is wrapped with queue and metrics middleware at registration time.
- **Service-oriented routing**: Path prefixes deterministically map to backend microservices.
- **HMR-safe start**: Uses `process.argv[1]` comparison to ensure the server only starts when executed directly.
- **Environment-driven configuration**: All addresses, ports, allowed IPs/domains come from environment variables.
