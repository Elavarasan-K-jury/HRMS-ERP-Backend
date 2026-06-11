# emp_department.routes.js

**Service:** Proxies to `empDepartment` (gRPC employee department service)

**Export:** `registerEmployeeDepartmentRoutes(app)` — registers routes on an OpenAPIHono app

## Routes

#### `POST /employees/departments`
- **Summary:** Assign an employee to a department
- **Tags:** `Employee Departments`
- **Request Body:** `{ department_id (ObjectId), employee_id (ObjectId), reporting_to?, start_date (ISO date), end_date? }`
- **Response 201:** `{ id, department_id, employee_id, start_date, end_date?, created_at, updated_at }`
- **Response 400/404/409**

#### `GET /employees/departments/{id}`
- **Summary:** Get department assignment details for an employee by ID
- **Tags:** `Employee Departments`
- **Params:** `id` (ObjectId)
- **Response 200:** Assignment details / 404

#### `GET /employees/{employeeId}/departments`
- **Summary:** List departments assigned to an employee
- **Tags:** `Employee Departments`
- **Params:** `employeeId` (ObjectId)
- **Query:** `{ department_id?, page?, limit?, search?, sort_by?, sort_order? }`
- **Response 200:** Array of assignments

#### `GET /employees/{department_id}/employees`
- **Summary:** List employees assigned to a department
- **Tags:** `Employee Departments`
- **Params:** `department_id`
- **Response 200:** Array of employee-department records

#### `PUT /employees/departments/{id}`
- **Summary:** Update an existing employee department assignment
- **Tags:** `Employee Departments`
- **Params:** `id` (ObjectId)
- **Request Body:** Partial create schema
- **Response 200:** Updated / 404

#### `DELETE /employees/departments/{id}`
- **Summary:** Soft delete an employee department record
- **Tags:** `Employee Departments`
- **Params:** `id` (ObjectId)
- **Response 200:** `{ success, message }` / 404

## Unique Logic

- All IDs validated with ObjectId regex (`/^[0-9a-fA-F]{24}$/`)
- Delete checks existence first via `GetEmployeeDepartment` before soft-deleting via `RemoveEmployeeDepartment`
- Uses `c.req.query()` (raw) for list instead of `c.req.valid('query')` in one route

## Code Snippet

```js
app.openapi(
    {
        method: 'post',
        path: '/employees/departments',
        tags: ['Employee Departments'],
        summary: 'Assign an employee to a department',
        request: {
            body: {
                content: {
                    'application/json': { schema: createEmployeeDepartmentSchema },
                },
            },
        },
        responses: {
            201: {
                description: 'Employee assigned to department successfully',
                content: {
                    'application/json': {
                        schema: z.object({
                            id: z.string(),
                            department_id: z.string(),
                            employee_id: z.string(),
                            start_date: z.string(),
                            end_date: z.string().optional(),
                            created_at: z.string(),
                            updated_at: z.string(),
                        }),
                    },
                },
            },
        },
    },
    async (c) => {
        try {
            const body = await c.req.json();
            const parsed = createEmployeeDepartmentSchema.parse(body);
            const response = await new Promise((resolve, reject) => {
                empDepartment.AssignDepartment(parsed, (err, resp) => {
                    if (err) return reject(err);
                    resolve(resp.employee_department);
                });
            });
            return c.json(response, 201);
        } catch (error) {
            if (error instanceof ZodError)
                return c.json({ error: 'Validation failed', details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message })) }, 400);
            return c.json({ error: error.message }, 500);
        }
    }
);
```
