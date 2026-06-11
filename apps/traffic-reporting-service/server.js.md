# server.js

**Purpose:** Entry point for the traffic-reporting microservice — sets up an OpenAPI/Hono HTTP server, connects to MongoDB, registers routes, starts cron jobs, and exposes Swagger UI.

## Key Exports

- **`app`** — `OpenAPIHono` instance (used internally, not exported)
- **`start()`** — async function that connects Prisma and starts the HTTP server (currently commented out)

## Dependencies

| Package | Purpose |
|---|---|
| `dotenv` | Load environment variables from `../../.env` |
| `@hono/zod-openapi` | OpenAPI-compatible Hono router with Zod validation |
| `@hono/node-server` | Node.js adapter for Hono |
| `hono/cors` | CORS middleware |
| `@hono/swagger-ui` | Swagger UI page |
| `@jury-hrms/db/client.js` | Prisma client |
| `./jobs/cron.js` | Side-effect import to start cron jobs |
| `./routes/superadmin.reports.js` | Super admin report routes |

## Important Logic

### Default validation hook (line 34–37)
```js
defaultHook: (result, c) => {
    if (!result.success) return c.json({ error: result.error }, 400);
},
```
Returns a 400 with validation error details when Zod validation fails.

### CORS configuration (line 39)
```js
app.use("*", cors({ origin: "*", allowMethods: ["GET"] }));
```
Allows all origins but only GET methods — reports are read-only.

### OpenAPI doc & Swagger UI (lines 56–66)
```js
app.doc("/doc", { openapi: "3.1.0", info: { title: "Jury HRMS – Traffic Reporting Service", ... } });
app.get("/swagger", swaggerUI({ url: "/doc" }));
```
Serves an OpenAPI 3.1 document at `/doc` and a Swagger UI at `/swagger`.

### Graceful shutdown (lines 101–106)
```js
for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
        await prisma.$disconnect();
        process.exit(0);
    });
}
```
Disconnects Prisma on SIGINT/SIGTERM for a clean shutdown.
