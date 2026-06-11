# employee.routes.js

**Service:** Proxies to `employeeClient` (gRPC employee service)

**Export:** `registerEmployeeRoutes(app)` — registers routes on an OpenAPIHono app

## Routes

#### `POST /employees`
- **Summary:** Create a new employee
- **Tags:** `Employee`
- **Request Body:** `{ organizationId, categoryId, designationId?, firstName?, lastName?, fullName?, email?, phone (10 digits), altPhone?, isAdmin?, gender?, dateOfBirth? }`
- **Response 201:** Full employee object / 400
- **Note:** camelCase to snake_case field transformation in handler

#### `GET /employee/{id}`
- **Summary:** Fetch employee by ID
- **Tags:** `Employee`
- **Params:** `id`
- **Response 200:** Employee details / 404

#### `GET /employees/all`
- **Summary:** List employees for single organization
- **Tags:** `Employee`
- **Query:** `{ organization_id?, department_id? }`
- **Response 200:** `{ employees: [...], total, page, limit, total_pages }`

#### `GET /employees`
- **Summary:** List employees with pagination, search, and sorting
- **Tags:** `Employee`
- **Query:** `{ organization_id?, category_id?, designation_id?, search?, sort_by?, sort_order?, limit?, page? }`
- **Response 200:** Paginated employee list

#### `PUT /employees/{id}`
- **Summary:** Update employee details
- **Tags:** `Employee`
- **Params:** `id`
- **Request Body:** Partial create schema
- **Response 200:** Updated

#### `DELETE /employees/{id}`
- **Summary:** Delete an employee
- **Tags:** `Employee`
- **Params:** `id`
- **Response 200:** Deleted

### Employee Authentication

#### `POST /employee/login/request-otp`
- **Summary:** Request login OTP (email-only delivery)
- **Tags:** `Employee`
- **Request Body:** `{ email?, phone?, purpose? }` — requires at least email or phone
- **Response 200:** `{ message }` / 404

#### `POST /employee/auth/verify-token`
- **Summary:** Verify a JWT token and return decoded data
- **Tags:** `Employee`
- **Request Body:** `{ token }`
- **Response 200:** `{ sub, user, email?, scope?, typ, iat, exp, success, message }`

#### `POST /employee/login/verify`
- **Summary:** Verify OTP and get tokens
- **Tags:** `Employee`
- **Request Body:** `{ email?, phone?, otp (6-digit) }` — requires at least email or phone
- **Response 200:** `{ access_token, refresh_token, token_type, expires_in, admin: {...} }` / 403

#### `POST /employee/token/refresh`
- **Summary:** Issue new tokens using refresh token
- **Tags:** `Employee`
- **Request Body:** `{ refresh_token }`
- **Response 200:** Tokens

## Unique Logic

- Extensive camelCase-to-snake_case field mapping in create/update
- Phone validated with `/^[0-9]{10}$/`
- Gender is mapped to a number for gRPC
- `updateEmployeeSchema` is `createEmployeeSchema.extend({ id }).partial()`
- OTP routes use `.refine()` for email/phone mutual exclusivity
- Employee routes mirror admin routes for auth (same patterns)

## Code Snippet

```js
app.openapi(
    {
        method: 'post',
        path: '/employees',
        tags: ['Employee'],
        summary: 'Create a new employee',
        request: {
            body: { content: { 'application/json': { schema: createEmployeeSchema } } },
        },
        responses: {
            201: {
                description: 'Employee created successfully',
                content: {
                    'application/json': {
                        schema: z.object({ id: z.string(), organization_id: z.string(), category_id: z.string(), designation_id: z.string().optional(), first_name: z.string().optional(), last_name: z.string().optional(), full_name: z.string(), email: z.string().optional(), phone: z.string(), alt_phone: z.string().optional(), gender: z.number(), date_of_birth: z.string(), created_at: z.string(), updated_at: z.string() }),
                    },
                },
            },
        },
    },
    async (c) => {
        try {
            const body = await c.req.json();
            const parsed = createEmployeeSchema.parse(body);
            const grpcPayload = {
                organization_id: parsed.organizationId,
                category_id: parsed.categoryId,
                designation_id: parsed.designationId ?? null,
                first_name: parsed.firstName ?? null,
                last_name: parsed.lastName ?? null,
                full_name: parsed.fullName ?? null,
                is_admin: parsed.isAdmin ?? null,
                email: parsed.email ?? null,
                phone: parsed.phone,
                alt_phone: parsed.altPhone ?? null,
                gender: parsed.gender,
                date_of_birth: parsed.dateOfBirth ?? null,
            };
            const response = await new Promise((resolve, reject) => {
                employeeClient.CreateEmployee(grpcPayload, (err, resp) => {
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
```
