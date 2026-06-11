# emp_onboard_progress.routes.js

**Service:** Proxies to `onboardingProgressClient` (gRPC employee onboarding progress service)

**Export:** `registerEmployeeOnboardingProgressRoutes(app)` — registers routes on an OpenAPIHono app

## Routes

#### `POST /employee-onboarding-progress`
- **Summary:** Create onboarding progress record for an employee
- **Tags:** `Employee Onboarding Progress`
- **Request Body:** `{ employee_id, flow_id, step_id, step_feature_id, step_feature_value? }`
- **Response 201:** `{ id, employee_id, flow_id, step_id, step_feature_id, step_feature_value? }`

#### `GET /employee-onboarding-progress/{id}`
- **Summary:** Get onboarding progress by ID
- **Tags:** `Employee Onboarding Progress`
- **Params:** `id`
- **Response 200:** Progress details / 404

#### `GET /employee-onboarding-progress`
- **Summary:** List onboarding progress records by employee or flow
- **Tags:** `Employee Onboarding Progress`
- **Query:** `{ employee_id?, flow_id? }` — at least one required
- **Response 200:** Array of progress records

#### `PUT /employee-onboarding-progress/{id}`
- **Summary:** Update progress feature value for an employee
- **Tags:** `Employee Onboarding Progress`
- **Params:** `id`
- **Request Body:** `{ step_feature_value }`
- **Response 200:** Updated / 404

#### `DELETE /employee-onboarding-progress/{id}`
- **Summary:** Delete onboarding progress record by ID
- **Tags:** `Employee Onboarding Progress`
- **Params:** `id`
- **Response 200:** `{ success, message }` / 404

## Unique Logic

- List query uses `.refine()` to require at least `employee_id` or `flow_id`
- All extract `resp.progress` / `resp.progresses` from gRPC response
- Update and delete check existence first

## Code Snippet

```js
app.openapi(
    {
        method: 'post',
        path: '/employee-onboarding-progress',
        tags: ['Employee Onboarding Progress'],
        summary: 'Create onboarding progress record for an employee',
        request: {
            body: {
                content: {
                    'application/json': { schema: createOnboardingProgressSchema },
                },
            },
        },
        responses: {
            201: {
                description: 'Progress created successfully',
                content: {
                    'application/json': {
                        schema: z.object({ id: z.string(), employee_id: z.string(), flow_id: z.string(), step_id: z.string(), step_feature_id: z.string(), step_feature_value: z.string().optional() }),
                    },
                },
            },
        },
    },
    async (c) => {
        try {
            const body = await c.req.json();
            const parsed = createOnboardingProgressSchema.parse(body);
            const response = await new Promise((resolve, reject) => {
                onboardingProgressClient.CreateEmployeeOnboardingProgress(parsed, (err, resp) => {
                    if (err) return reject(err);
                    resolve(resp.progress);
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
