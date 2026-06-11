# organization-service/server.js

## Purpose
gRPC microservice for organization CRUD plus department and organizational hierarchy builders.

## Key gRPC Handlers

| Method | Description |
|---|---|
| `CreateOrganization` | Creates or restores a soft-deleted org by domain |
| `GetOrganization` | Fetches organization by ID |
| `ListOrganizations` | Paginated, searchable list |
| `UpdateOrganization` | Updates all org fields including limits |
| `DeleteOrganization` | Soft-deletes an organization |
| `DepartmentHierarchy` | Builds a reporting tree for a single department |
| `OrganizationHierarchy` | Builds org-wide hierarchy grouped by designation levels |

## Important Logic

### Department Reporting Hierarchy
Builds a tree-structure of employees within a department, attaching orphans (employees without a `reportingTo`) to the department head:

```js
// Attach orphan employees (no reportingTo and not head)
Object.values(employeeMap).forEach(emp => {
    if (emp.id === headId) return;
    const hasParent = emp.reportingTo && employeeMap[emp.reportingTo];
    if (!hasParent) {
        emp.reportingTo = headId;
        employeeMap[headId].reportees.push(emp);
    }
});
```

### Organization-Wide Hierarchy
Groups employees by their designation's `level` field using a predefined level order (Board → Entry), returning counts and details per level:

```js
const LEVEL_ORDER = [
    "board_level", "executive_level", "senior_management",
    "managerial_level", "lead_level", "senior_level",
    "intermediate_level", "junior_level", "entry_level",
];

const hierarchy = LEVEL_ORDER.map((levelValue) => {
    const levelEmployees = filteredEmployees.filter(
        (emp) => emp.designation?.level === levelValue
    );
    return {
        level: levelValue,
        label: LEVEL_LABELS[levelValue],
        employeeCount: levelEmployees.length,
        employees: levelEmployees.map(/* ... */),
    };
});
```

### Soft-Delete Restore
If an organization with the same domain was previously soft-deleted, it is restored instead of creating a new one:

```js
if (domainExists && domainExists.deletedAt !== null) {
    const restored = await prisma.organizations.update({
        where: { id: domainExists.id },
        data: mappedData,
    });
    return callback(null, { organization: mapOrg(restored), success: true, message: 'Organization restored successfully' });
}
```

## Helper Functions

- **`mapOrg(org)`** — Maps all org fields including extended limits (maxEmployees, maxStorageInGB, etc.).
- **`buildTree(node)` / `cleanNode(node)`** — Recursive tree builders for the department hierarchy response.
