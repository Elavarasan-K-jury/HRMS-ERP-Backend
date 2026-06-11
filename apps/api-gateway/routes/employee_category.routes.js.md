# employee_category.routes.js

**Service:** Proxies to `employeeClient` (gRPC employee category service from `employee-category.client.js`)

**Export:** `registerEmployeeCategoryRoutes(app)` — registers routes on an OpenAPIHono app

## Routes

#### `POST /employee-categories`
- **Summary:** Create a new employee category
- **Tags:** `Employee Categories`
- **Request Body:** `{ organization_id, name, code?, description?, id_prefix?, is_permanent, benefits_applicable, is_active?, training_required?, training_months?, probation_required?, probation_months?, notice_required?, notice_months? }`
- **Response 201:** `{ id, name, organization_id, created_at }`

#### `GET /employee-categorie/{id}`
- **Summary:** Get an employee category by ID
- **Tags:** `Employee Categories`
- **Params:** `id`
- **Response 200:** Category details / 404
- **Note:** Path is `employee-categorie` (singular), inconsistent with other routes

#### `GET /employee-categories/all`
- **Summary:** List all employee categories for an organization
- **Tags:** `Employee Categories`
- **Query:** `{ organization_id }`
- **Response 200:** Array of categories

#### `GET /employee-categories`
- **Summary:** List employee categories with pagination
- **Tags:** `Employee Categories`
- **Query:** `{ organization_id, page?, limit?, search?, sort_by?, sort_order? }`
- **Response 200:** Array of categories

#### `PUT /employee-categories/{id}`
- **Summary:** Update an existing employee category
- **Tags:** `Employee Categories`
- **Params:** `id`
- **Request Body:** Partial create schema + organization_id required
- **Response 200:** Updated / 400/404

#### `DELETE /employee-categories/{id}`
- **Summary:** Soft delete an employee category by ID
- **Tags:** `Employee Categories`
- **Params:** `id`
- **Response 200:** `{ success, message }` / 400/404/500

## Unique Logic

- Import is from `employee-category.client.js` but client variable is `employeeClient`
- Has 2 list endpoints: `/all` (simple) and paginated
- Update/delete check existence first via `GetEmployeeCategory`
- Note the path typo: `employee-categorie/{id}` (missing 's')

## Code Snippet

```js
app.openapi(
    {
        method: 'post',
        path: '/employee-categories',
        tags: ['Employee Categories'],
        summary: 'Create a new employee category',
        request: {
            body: {
                content: {
                    'application/json': { schema: createEmployeeCategorySchema }
                }
            }
        },
        responses: {
            201: {
                description: 'Employee Category created successfully',
                content: {
                    'application/json': {
                        schema: z.object({ id: z.string(), name: z.string(), organization_id: z.string(), created_at: z.string() })
                    }
                }
            }
        }
    },
    async (c) => {
        try {
            const body = await c.req.json();
            const parsed = createEmployeeCategorySchema.parse(body);
            const payload = { ...parsed };
            const response = await new Promise((resolve, reject) => {
                employeeClient.CreateEmployeeCategory(payload, (err, resp) => {
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
