# expense.routes.js

**Service:** Proxies to `expenseClient` (gRPC expense service)

**Export:** `registerExpenseRoutes({ openapi })` — registers routes on an OpenAPIHono app

## Routes

### Employee Expense

#### `POST /organisation/{organization_id}/expense`
- **Summary:** Employee register expense
- **Tags:** `Expense`
- **Params:** `organization_id`
- **Request Body:** `{ employee_id, type?, amount, description, receipt_url? }`
- **Response 201:** `{ success, message, expense: {...} }`

#### `GET /organisation/{organization_id}/expense`
- **Summary:** Employee fetch own expenses with filters
- **Tags:** `Expense`
- **Params:** `organization_id`
- **Query:** `{ employee_id, from_date?, to_date?, search?, type?, status?, page?, limit? }`
- **Response 200:** `{ success, message, expenses: [...], total_count, page, limit }`

#### `PUT /organisation/{organization_id}/expense/{expense_id}`
- **Summary:** Employee update expense
- **Tags:** `Expense`
- **Params:** `organization_id`, `expense_id`
- **Request Body:** `{ employee_id, type?, amount?, description?, receipt_url? }`
- **Response 200:** Single expense response

#### `DELETE /organisation/{organization_id}/expense/{expense_id}`
- **Summary:** Employee delete expense
- **Tags:** `Expense`
- **Params:** `organization_id`, `expense_id`
- **Query:** `{ employee_id }`
- **Response 200:** `{ success, message }`

### Admin Expense

#### `GET /organisation/{organization_id}/expense/admin`
- **Summary:** Admin fetch all expenses with filters
- **Tags:** `Expense Admin`
- **Params:** `organization_id`
- **Query:** `{ from_date?, to_date?, employee_id?, type?, status?, search?, page?, limit? }`
- **Response 200:** `{ success, message, expenses: [...], total_count, page, limit }`

#### `PATCH /organisation/{organization_id}/expense/{expense_id}/status`
- **Summary:** Admin approve or reject expense
- **Tags:** `Expense Admin`
- **Params:** `organization_id`, `expense_id`
- **Request Body:** `{ approver_id, status: "APPROVED"|"REJECTED" }`
- **Response 200:** Single expense response

#### `GET /organisation/{organization_id}/expense/{expense_id}`
- **Summary:** Admin view expense details
- **Tags:** `Expense Admin`
- **Params:** `organization_id`, `expense_id`
- **Response 200:** Single expense response

#### `DELETE /organisation/{organization_id}/expense/admin/{expense_id}`
- **Summary:** Admin delete expense
- **Tags:** `Expense Admin`
- **Params:** `organization_id`, `expense_id`
- **Response 200:** `{ success, message }`

## Unique Logic

- Note: path uses British spelling `organisation` not `organization`
- Shared error handler `handleRouteError` at bottom of file
- Uses `c.req.valid('param')` for path parameters
- Admin/employee routes share the same base path with `/admin` suffix and `PATCH` method

## Code Snippet

```js
openapi(
    {
        method: 'post',
        path: '/organisation/{organization_id}/expense',
        tags: ['Expense'],
        summary: 'Employee register expense',
        request: {
            params: organizationParamSchema,
            body: {
                content: {
                    'application/json': { schema: registerExpenseSchema },
                },
            },
        },
        responses: {
            201: {
                description: 'Expense registered successfully',
                content: { 'application/json': { schema: expenseSingleResponseSchema } },
            },
        },
    },
    async (c) => {
        try {
            const params = c.req.valid('param');
            const body = await c.req.json();
            const parsed = registerExpenseSchema.parse(body);
            const response = await new Promise((resolve, reject) => {
                expenseClient.RegisterExpense(
                    { organization_id: params.organization_id, ...parsed },
                    (err, resp) => { if (err) return reject(err); resolve(resp); }
                );
            });
            return c.json(response, 201);
        } catch (error) {
            return handleRouteError(c, error);
        }
    }
);
```
