# emp_onboard_feature.routes.js

**Service:** Proxies to `onboardingFeatureClient` (gRPC employee onboarding feature service)

**Export:** `registerEmployeeOnboardingFeatureRoutes(app)` — registers routes on an OpenAPIHono app

## Routes

#### `POST /employee-onboarding-features`
- **Summary:** Create a new onboarding feature under a step
- **Tags:** `Employee Onboarding Features`
- **Request Body:** `{ step_id, feature_name (min 2 chars), feature_type, has_options (default false), options? (transformed to JSON string) }`
- **Response 201:** `{ id, step_id, feature_name, feature_type, has_options, options? }`

#### `GET /employee-onboarding-features/{id}`
- **Summary:** Get an onboarding feature by ID
- **Tags:** `Employee Onboarding Features`
- **Params:** `id`
- **Response 200:** Feature details / 404

#### `GET /employee-onboarding-features`
- **Summary:** List all features for a specific onboarding step
- **Tags:** `Employee Onboarding Features`
- **Query:** `{ step_id }`
- **Response 200:** Array of features

#### `PUT /employee-onboarding-features/{id}`
- **Summary:** Update an existing onboarding feature
- **Tags:** `Employee Onboarding Features`
- **Params:** `id`
- **Request Body:** Partial create schema + step_id required
- **Response 200:** Updated / 404

#### `DELETE /employee-onboarding-features/{id}`
- **Summary:** Delete an onboarding feature by ID
- **Tags:** `Employee Onboarding Features`
- **Params:** `id`
- **Response 200:** `{ success, message }` / 404

## Unique Logic

- `options` field uses `.transform(val => val ? JSON.stringify(val) : '')` to serialize to string
- Update and delete check existence before performing the operation
- Uses `c.req.query()` (raw) for list endpoint

## Code Snippet

```js
app.openapi(
    {
        method: 'post',
        path: '/employee-onboarding-features',
        tags: ['Employee Onboarding Features'],
        summary: 'Create a new onboarding feature under a step',
        request: {
            body: {
                content: {
                    'application/json': { schema: createOnboardingFeatureSchema },
                },
            },
        },
        responses: {
            201: {
                description: 'Feature created successfully',
                content: {
                    'application/json': {
                        schema: z.object({ id: z.string(), step_id: z.string(), feature_name: z.string(), feature_type: z.string(), has_options: z.boolean(), options: z.string().optional() }),
                    },
                },
            },
        },
    },
    async (c) => {
        try {
            const body = await c.req.json();
            const parsed = createOnboardingFeatureSchema.parse(body);
            const response = await new Promise((resolve, reject) => {
                onboardingFeatureClient.CreateEmployeeOnboardingFeature(parsed, (err, resp) => {
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
