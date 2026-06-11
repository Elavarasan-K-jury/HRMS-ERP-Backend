# org_designation-service/server.js

## Purpose
gRPC microservice for managing organization designations (job titles/levels) with optional department association.

## Key gRPC Handlers

| Method | Description |
|---|---|
| `CreateDesignation` | Creates a designation with unique name per org |
| `GetDesignation` | Fetches a single designation by ID |
| `ListDesignations` | Paginated list with search, sort, and department filter |
| `ListAllDesignations` | Fetches all designations (no pagination) for dropdowns |
| `UpdateDesignation` | Updates designation with conflict and department validation |
| `DeleteDesignation` | Soft-deletes a designation |

## Important Logic

### Department Validation
If a `department_id` is provided, the service validates the department belongs to the organization:

```js
if (data.department_id) {
    const departmentExists = await prisma.organizationDepartments.findFirst({
        where: {
            id: data.department_id,
            organizationId: data.organization_id,
            deletedAt: null,
        },
    });
    if (!departmentExists) {
        return callback({ code: grpc.status.NOT_FOUND, message: 'Department not found in organization.' });
    }
}
```

### Employee Count
On listing, each designation includes the count of employees assigned to it:

```js
const mappedDesignations = designations.map(desg => ({
    ...mapDesignation(desg),
    employee_count: desg.employees.length,
}));
```

## Helper Functions

| Function | Purpose |
|---|---|
| `mapDesignation(d)` | Full mapper — includes org, department, and employees |
| `mapDesignationOnly(d)` | Lightweight mapper — id, name, level only |
| `mapOrg(org)` | Maps organization sub-object |
| `mapDepartment(dept)` | Maps department sub-object |
| `mapEmployee(emp)` | Maps employee sub-object |
| `formatDate(date)` | Formats date to `en-IN` locale |

```js
function mapDesignation(d = {}) {
    return {
        id: d.id ?? '',
        organization_id: d.organizationId ?? '',
        department_id: d.departmentId ?? '',
        name: d.name ?? '',
        level: d.level ?? '',
        description: d.description ?? '',
        organization: mapOrg(d.organization),
        department: mapDepartment(d.department),
        employees: Array.isArray(d.employees) ? d.employees.map(mapEmployee) : [],
    };
}
```
