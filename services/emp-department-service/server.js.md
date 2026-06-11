# Employee Department Service

## Purpose
Manages the assignment of employees to departments, including reporting hierarchy, department head tracking, and listing employees within departments.

## Key gRPC Methods
- **AssignDepartment** - Assigns an employee to a department with a start date, optional end date, and optional reporting manager. Validates that the reporting manager is in the same department (or is the department head).
- **GetEmployeeDepartment** - Fetches a single department assignment by ID.
- **ListEmployeeDepartments** - Paginated listing of assignments for an employee with search by department name.
- **ListEmployeeInDepartments** - Lists all employees in a department with their reporting managers. Falls back to department head if no direct reporting manager is assigned.
```js
// List employees with department head as default reporting
const departmentHead = await prisma.organizationEmployees.findFirst({
    where: { id: department.departmentHeadId },
});
```
- **UpdateEmployeeDepartment** - Updates assignment fields (department, reporting, dates).
- **RemoveEmployeeDepartment** - Soft-removes by setting `endDate` to current date.

## Helpers and Mappers

| Helper | Purpose |
|--------|---------|
| `formatDate(date)` | Formats date to Indian locale string (DD/MM/YYYY, HH:MM AM/PM) |
| `mapEmployee(emp)` | Maps employee with organization, category, designation, department fields |
| `mapDepartment(dept)` | Maps department with head and description fields |
| `mapAssignment(a)` | Maps assignment with nested employee, reporting, and department |
| `mapAssignmentNew(a)` | Maps assignment for ListEmployeeInDepartments (flatter structure) |

**Server port:** `process.env.EMP_DEPT_SERVICE_PORT || 5056`
