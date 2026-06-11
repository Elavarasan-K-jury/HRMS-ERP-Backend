# emp_onboard_step.routes.js

**Service:** Proxies to `onboardingStepClient` (gRPC employee onboarding step service)

**Export:** `registerEmployeeOnboardingStepRoutes(app)` — registers routes on an OpenAPIHono app

## Routes

#### `POST /employee-onboarding-steps`
- **Summary:** Create a new employee onboarding step for a flow
- **Tags:** `Employee Onboarding Steps`
- **Request Body:** `{ onboarding_id, name (min 2 chars), is_active (default true) }`
- **Response 201:** `{ id, name, onboarding_id, created_at }`

#### `GET /employee-onboarding-steps/{id}`
- **Summary:** Get a specific onboarding step by ID
- **Tags:** `Employee Onboarding Steps`
- **Params:** `id`
- **Response 200:** Step details / 404

#### `GET /employee-onboarding-steps`
- **Summary:** List all onboarding steps for a specific onboarding flow
- **Tags:** `Employee Onboarding Steps`
- **Query:** `{ onboarding_id }`
- **Response 200:** Array of steps

#### `PUT /employee-onboarding-steps/{id}`
- **Summary:** Update an existing employee onboarding step
- **Tags:** `Employee Onboarding Steps`
- **Params:** `id`
- **Request Body:** Partial create schema + onboarding_id required
- **Response 200:** Updated / 404

#### `DELETE /employee-onboarding-steps/{id}`
- **Summary:** Soft delete an onboarding step by ID
- **Tags:** `Employee Onboarding Steps`
- **Params:** `id`
- **Response 200:** `{ success, message }` / 404

## Unique Logic

- Uses `c.req.query()` (raw) for list endpoint
- Update and delete check existence first via `GetEmployeeOnboardingStep`
- Response schema for create/update includes `is_active` field

## Code Snippet

```js
app.openapi(
    {
        method: 'post',
        path: '/employee-onboarding-steps',
        tags: ['Employee Onboarding Steps'],
        summary: 'Create a new employee onboarding step for a flow',
        request: {
            body: {
                content: {
                    'application/json': { schema: createOnboardingStepSchema },
                },
            },
        },
        responses: {
            201: {
                description: 'Onboarding step created successfully',
                content: {
                    'application/json': {
                        schema: z.object({ id: z.string(), name: z.string(), onboarding_id: z.string(), created_at: z.string() }),
                    },
                },
            },
        },
    },
    async (c) => {
        try {
            const body = await c.req.json();
            const parsed = createOnboardingStepSchema.parse(body);
            const response = await new Promise((resolve, reject) => {
                onboardingStepClient.CreateEmployeeOnboardingStep(parsed, (err, resp) => {
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
