# Route Files — Pattern Documentation

All route files under `routes/*.routes.js` follow a consistent pattern. Each file registers one or more OpenAPI endpoints on the Hono app instance using Zod schemas for validation and gRPC clients for backend calls.

## Universal Pattern

Every route file:

1. **Exports a default function** that receives `{ openapi }` (or `app`) — a wrapped `app.openapi()` call
2. **Defines Zod schemas** for request validation and response shapes
3. **Registers endpoints** via `openapi({ method, path, tags, request, responses }, handler)`
4. **Handler functions** validate input with `zod.parse()`, call a gRPC client, and return JSON responses

```js
import { z, ZodError } from 'zod';
import { someClient } from '../grpc/some.client.js';

export default function registerSomeRoutes({ openapi }) {
    const createSchema = z.object({
        name: z.string(),
        // ...
    });

    openapi(
        {
            method: 'post',
            path: '/some-resource',
            tags: ['SomeTag'],
            summary: 'Create a resource',
            request: {
                body: {
                    content: { 'application/json': { schema: createSchema } },
                },
            },
            responses: {
                201: { description: 'Created', content: { 'application/json': { schema: z.object({ id: z.string() }) } } },
                400: { description: 'Validation error' },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = createSchema.parse(body);
                const response = await new Promise((resolve, reject) => {
                    someClient.CreateResource(parsed, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });
                return c.json(response, 201);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({ error: 'Validation failed', details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message })) }, 400);
                }
                return c.json({ error: error.message }, 500);
            }
        }
    );
}
```

## Common CRUD Operations

Most route files implement some combination of:

| Operation | HTTP Method | Pattern |
|---|---|---|
| **Create** | `POST` | Parse request body with Zod, map camelCase to `snake_case` gRPC fields, call `client.CreateX()`, return 201 |
| **Get by ID** | `GET /{id}` | Extract `id` from route params, call `client.GetX({ id })`, return 200 or 404 |
| **List** | `GET` | Validate query params (pagination, search, sort), call `client.ListX(query)`, return paginated 200 |
| **Update** | `PUT /{id}` | Parse partial body, map fields, call `client.UpdateX(payload)`, return 200 |
| **Delete** | `DELETE /{id}` | Extract `id`, call `client.DeleteX({ id })`, return 200 |

## Error Handling Pattern

All handlers follow the same try-catch approach:

```js
try {
    // validation + gRPC call
} catch (error) {
    if (error instanceof ZodError) {
        return c.json({ error: 'Validation failed', details: [...] }, 400);
    }
    return c.json({ error: error.message }, 500);
}
```

Some routes also handle gRPC error codes for specific HTTP status mappings:
```js
const code = error.code === 7 ? 403 : (error.code === 5 ? 404 : 500);
return c.json({ error: error.message }, code);
```

## Special Cases

- **`health.routes.js`** — Uses `wrapSystem` (no queue/metrics), reads from the in-memory `serviceMetrics` store instead of calling a gRPC client.
- **Auth routes** (in `employee.routes.js`) — Handle OTP requests, OTP verification, and token refresh.
- **File upload routes** (in `storage.routes.js`) — May use multipart body parsing.

## Files

| File | Service Client | Tag |
|---|---|---|
| `organization.routes.js` | `orgClient` | Organization |
| `employee.routes.js` | `employeeClient` | Employee |
| `employee_category.routes.js` | — | Employee Category |
| `admin.routes.js` | — | Admin |
| `org_department.routes.js` | — | Department |
| `org_designation.routes.js` | — | Designation |
| `emp_department.routes.js` | — | Employee Department |
| `emp_onboard_flow.routes.js` | — | Employee Onboarding Flow |
| `emp_onboard_step.routes.js` | — | Employee Onboarding Step |
| `emp_onboard_feature.routes.js` | — | Employee Onboarding Feature |
| `emp_onboard_progress.routes.js` | — | Employee Onboarding Progress |
| `shift.routes.js` | — | Shift |
| `shift_assignment.routes.js` | — | Shift Assignment |
| `shift_policy.routes.js` | — | Shift Policy |
| `attendance.routes.js` | — | Attendance |
| `attendance_logs.routes.js` | — | Attendance Logs |
| `approval.routes.js` | — | Approval |
| `post_poll.routes.js` | — | Post/Poll |
| `hierarchy.routes.js` | — | Hierarchy |
| `leaveType.routes.js` | — | Leave Type |
| `leaveRequest.routes.js` | — | Leave Request |
| `holidays.routes.js` | — | Holidays |
| `holidayPolicy.routes.js` | — | Holiday Policy |
| `salary.routes.js` | — | Salary |
| `salary-components.routes.js` | — | Salary Components |
| `salary_template.routes.js` | — | Salary Template |
| `salary-range.routes.js` | — | Salary Range |
| `report.routes.js` | — | Reports |
| `finance.routes.js` | — | Finance |
| `subscription-plans.routes.js` | — | Subscription Plans |
| `organization-subscriptions.routes.js` | — | Organization Subscriptions |
| `invoices.routes.js` | — | Invoices |
| `storage.routes.js` | — | Storage |
| `payslip.routes.js` | — | Payslip |
| `expense.routes.js` | — | Expense |
| `payroll.routes.js` | — | Payroll |
| `health.routes.js` | `serviceMetrics` (in-memory) | System |

## Dependencies
- `zod` — Runtime schema validation and TypeScript type inference
- `../grpc/*.client.js` — gRPC client instances for each microservice

## Patterns
- **OpenAPI-first**: Every route is defined with a full OpenAPI operation spec (method, path, request schema, response schema).
- **Zod validation**: Input validation happens at the handler level with `.parse()` — returns 400 with structured error details on failure.
- **camelCase → snake_case mapping**: Incoming camelCase JSON fields are mapped to `snake_case` gRPC protobuf fields before sending.
- **gRPC promisification**: Every gRPC call is wrapped in `new Promise((resolve, reject) => client.Method(payload, callback))` for async/await compatibility.
- **Consistent error responses**: Validation errors return `{ error, details: [{ field, message }] }`; server errors return `{ error: message }`.
