# admin.routes.js

**Service:** Proxies to `adminClient` (gRPC admin service)

**Export:** `registerAdminRoutes(app)` — registers routes on an OpenAPIHono app

## Routes

### Admin Auth

#### `POST /admin/login/request-otp`
- **Summary:** Request login OTP (email-only delivery)
- **Tags:** `Admin Auth`
- **Request Body:** `{ email?: string, phone?: string, purpose?: string (default "login") }` — requires at least email or phone
- **Response 200:** `{ message: string }`
- **Response 404:** Admin not found

#### `POST /auth/verify-token`
- **Summary:** Verify a JWT token and return decoded data
- **Tags:** `Admin Auth`
- **Request Body:** `{ token: string }`
- **Response 200:** `{ sub, user, email?, scope?, typ, iat, exp, success, message }`
- **Note:** Parses `response.user` from JSON string to object

#### `POST /admin/login/verify`
- **Summary:** Verify OTP and get tokens
- **Tags:** `Admin Auth`
- **Request Body:** `{ email?: string, phone?: string, otp: string (6-digit) }` — requires at least email or phone
- **Response 200:** `{ access_token, refresh_token, token_type, expires_in, admin: { id, email, phone } }`
- **Response 403:** Invalid/expired OTP

#### `POST /admin/token/refresh`
- **Summary:** Issue new tokens using refresh token
- **Tags:** `Admin Auth`
- **Request Body:** `{ refresh_token: string }`
- **Response 200:** Tokens

### Admins

#### `POST /admins`
- **Summary:** Create admin
- **Tags:** `Admins`
- **Request Body:** `{ email: string, phone: string }`
- **Response 201:** `{ admin: { id, email, phone, created_at?, updated_at? } }`
- **Response 409:** Already exists

#### `PUT /admins/{id}`
- **Summary:** Update admin
- **Tags:** `Admins`
- **Params:** `id` (string)
- **Request Body:** `{ email?: string, phone?: string }`
- **Response 200:** Updated / 404: Not found

#### `GET /admins/{id}`
- **Summary:** Get admin by id
- **Tags:** `Admins`
- **Params:** `id` (string)
- **Response 200:** Admin data / 404: Not found

#### `GET /admins`
- **Summary:** List admins
- **Tags:** `Admins`
- **Query:** `{ page?, limit?, search?, sort_by?, sort_order? }`
- **Response 200:** Paginated list

#### `DELETE /admins/{id}`
- **Summary:** Soft delete admin
- **Tags:** `Admins`
- **Params:** `id` (string)
- **Response 200:** Deleted / 404: Not found

## Unique Logic

- `response.user` is `JSON.parse`'d in verify-token route
- gRPC error code `5` maps to HTTP `404`, code `6` to `409`, code `7` to `403`
- Zod `.refine()` ensures email or phone is provided for OTP routes

## Code Snippet

```js
app.openapi(
    {
        method: 'post',
        path: '/admin/login/request-otp',
        tags: ['Admin Auth'],
        summary: 'Request login OTP (email-only delivery)',
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: z.object({
                            email: z.string().email().optional(),
                            phone: z.string().optional(),
                            purpose: z.string().optional().default('login'),
                        })
                            .refine(b => b.email || b.phone, { message: 'Provide email or phone' })
                    }
                }
            }
        },
        responses: {
            200: {
                description: 'OTP sent',
                content: { 'application/json': { schema: z.object({ message: z.string() }) } }
            },
            404: { description: 'Admin not found' }
        }
    },
    async (c) => {
        try {
            const body = await c.req.json();
            const resp = await new Promise((resolve, reject) => {
                adminClient.RequestLoginOtp(body, (err, r) => err ? reject(err) : resolve(r));
            });
            return c.json(resp, 200);
        } catch (error) {
            return c.json({ error: error.message }, error.code === 5 ? 404 : 500);
        }
    }
);
```
