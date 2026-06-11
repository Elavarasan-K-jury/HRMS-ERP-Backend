# Employee Service

## Purpose
Core employee management service providing CRUD operations, employee authentication (OTP login, JWT management), and employee listing with comprehensive related data (organization, category, designation, departments).

## Key gRPC Methods

### Employee CRUD
- **CreateEmployee** - Creates an employee with auto-generated employee code (`{idPrefix}-{count}`), enforces organization limits (max employees, max admin accounts), validates designation and category, and sends an onboarding email.
```js
const getEmployeeCode = () => {
    const totalEmployee = organizationExists.totalEmployee;
    const employeeCode = `${categoryExists.idPrefix}-${totalEmployee + 1}`;
    return employeeCode;
};
```
- **GetEmployee** - Fetches employee with organization, category, designation, and department assignments.
- **GetEmployeeData** - Lighter fetch without department assignments.
- **ListAllEmployees** - Unpaginated listing with optional organization and department filters.
- **ListEmployees** - Paginated listing with filters (organization, category, designation, department) and search (first name, last name, full name, email, phone).
- **UpdateEmployee** - Updates employee with admin limit enforcement on promoting to admin.
- **DeleteEmployee** - Soft-deletes an employee.

### Employee Authentication
- **RequestLoginOtp** - Generates OTP, stores in `otps` table, sends via email.
- **VerifyLoginOtp** - Validates OTP (5-min TTL), issues JWT tokens, fetches full employee data with relations.
- **VerifyToken** - Validates JWT and returns decoded payload with full employee data for employee-scoped tokens.
- **RefreshTokens** - Rotates access/refresh tokens with mismatch detection.

```js
// OTP generation with development override
function genOtp() {
    const env = process.env.ENVIRONMENT || 'DEVELOPMENT';
    if (env === 'DEVELOPMENT') return '123456';
    return String(Math.floor(100000 + Math.random() * 900000));
}
```

## Helpers and Mappers

| Helper | Purpose |
|--------|---------|
| `genOtp()` | Returns `123456` in dev, random 6-digit otherwise |
| `normEmail(email)` / `normPhone(phone)` | Normalizes email/phone for lookup |
| `findEmployeeByEMailOrPhone({email, phone})` | Finds non-deleted employee by email or phone |
| `formatDate(date)` | Formats date to Indian locale (DD/MM/YYYY, HH:MM AM/PM) |
| `mapEmployee(emp)` | Deeply maps employee with `organization`, `category`, `designation` objects, and `departments` array with nested department objects |

**Server port:** `process.env.EMP_SERVICE_PORT || 5053`
