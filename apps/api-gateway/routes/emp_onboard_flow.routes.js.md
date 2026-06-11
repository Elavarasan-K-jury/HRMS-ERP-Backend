# emp_onboard_flow.routes.js

**Service:** Proxies to `onboardingFlowClient` (gRPC employee onboarding flow service)

**Export:** `registerEmployeeOnboardingFlowRoutes(app)` — registers routes on an OpenAPIHono app

## Routes

#### `POST /employee-onboarding-flows`
- **Summary:** Create a new employee onboarding flow
- **Tags:** `Employee Onboarding Flows`
- **Request Body:** `{ organization_id, name (min 2 chars), description?, steps?, estimated_days? }`
- **Response 201:** `{ id, name, organization_id, created_at }`

#### `GET /employee-onboarding-flows/{id}`
- **Summary:** Get an onboarding flow by ID
- **Tags:** `Employee Onboarding Flows`
- **Params:** `id`
- **Response 200:** Flow details / 404

#### `GET /employee-onboarding-flows`
- **Summary:** List all employee onboarding flows for an organization
- **Tags:** `Employee Onboarding Flows`
- **Query:** `{ organization_id, page?, limit?, search?, sort_by?, sort_order? }`
- **Response 200:** Array of flows

#### `PUT /employee-onboarding-flows/{id}`
- **Summary:** Update an existing employee onboarding flow
- **Tags:** `Employee Onboarding Flows`
- **Params:** `id`
- **Request Body:** Partial create schema + organization_id required
- **Response 200:** Updated / 400/404

#### `DELETE /employee-onboarding-flows/{id}`
- **Summary:** Soft delete an onboarding flow by ID
- **Tags:** `Employee Onboarding Flows`
- **Params:** `id`
- **Response 200:** `{ success, message }` / 400/404/500

## Unique Logic

- Update and delete check existence first via `GetEmployeeOnboardingFlow`
- Uses `c.req.query()` (destructured) for list parameters instead of `c.req.valid`
- Page/limit use `.transform(Number)` on string values

## Code Snippet

```js
app.openapi(
    {
        method: 'post',
        path: '/employee-onboarding-flows',
        tags: ['Employee Onboarding Flows'],
        summary: 'Create a new employee onboarding flow',
        request: {
            body: {
                content: {
                    'application/json': { schema: createOnboardingFlowSchema },
                },
            },
        },
        responses: {
            201: {
                description: 'Onboarding Flow created successfully',
                content: {
                    'application/json': {
                        schema: z.object({ id: z.string(), name: z.string(), organization_id: z.string(), created_at: z.string() }),
                    },
                },
            },
        },
    },
    async (c) => {
        try {
            const body = await c.req.json();
            const parsed = createOnboardingFlowSchema.parse(body);
            const response = await new Promise((resolve, reject) => {
                onboardingFlowClient.CreateEmployeeOnboardingFlow(parsed, (err, resp) => {
                    if (err) return reject(err);
                    resolve(resp);
                });
            });
            return c.json(response, 201);
        } catch (error) {
            if (error instanceof ZodError) {
                return c.json({ error: 'Validation failed', details: error.errors.map((e) => ({ field: e.path.join('.'), message: e.message })) }, 400);
            }
            return c.json({ error: error.message }, 500);
        }
    }
);
```
