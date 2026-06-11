# org_department-service/server.js

## Purpose
gRPC microservice managing organization departments — CRUD, employee listing within departments, and department head assignment.

## Key gRPC Handlers

| Method | Description |
|---|---|
| `CreateDepartment` | Creates a department with name uniqueness validation per org |
| `GetDepartment` | Fetches a single department by ID |
| `ListDepartments` | Paginated, searchable list with sort by name/code/dates |
| `ListDepartmentEmployees` | Returns employees in a department, head first, with reporting manager |
| `UpdateDepartment` | Updates department metadata with name-conflict prevention |
| `DeleteDepartment` | Soft-deletes a department |

## Important Logic

### Department Head Validation
When creating or updating, the service ensures the `department_head_id` references a real employee within the same organization:

```js
if (data.department_head_id) {
    const employeeExists = await prisma.organizationEmployees.findFirst({
        where: {
            id: data.department_head_id,
            organizationId: data.organization_id,
        },
    });
    if (!employeeExists) {
        return callback({
            code: grpc.status.NOT_FOUND,
            message: 'Department head employee not found in organization.',
        });
    }
}
```

### Name Uniqueness (per Org)
Duplicate department names within the same organization are rejected:

```js
const nameExists = await prisma.organizationDepartments.findFirst({
    where: {
        organizationId: data.organization_id,
        name: data.name,
        deletedAt: null,
    },
});
if (nameExists) {
    return callback({
        code: grpc.status.ALREADY_EXISTS,
        message: 'Department with this name already exists in the organization.',
    });
}
```

### Employee Listing with Head Priority
`ListDepartmentEmployees` returns the department head first (marked `isHead: true`), then all other employees, excluding duplicates, with their reporting manager:

```js
const mappedEmployees = employees.map(emp => {
    if (usedIds.includes(emp.employee.id)) return null;
    usedIds.push(emp.employee.id);
    return {
        ...mapDepartmentHead(emp.employee),
        reporting: emp.reporting ? mapDepartmentHead(emp.reporting) : mapDepartmentHead(head),
        isHead: emp.employee.id === head.id,
    };
});
```

## Helper Functions

- **`mapDepartment(dept)`** — Maps Prisma department + included relations (organization, departmentHead) to gRPC shape.
- **`mapDepartmentHead(head)`** — Extracts employee fields relevant to a head-of-department response.
- **`mapOrg(org)`** — Maps the parent organization summary.
- **`formatDate(date)`** — Formats a Date to `en-IN` locale string (dd/mm/yyyy, hh:mm AM/PM).
