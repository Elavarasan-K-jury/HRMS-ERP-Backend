# Admin Service

## Purpose
Provides authentication (OTP-based login, JWT token management) and CRUD operations for admin users in the Jury HRMS system.

## Key gRPC Methods

### Authentication
- **RequestLoginOtp** - Generates a 6-digit OTP (returns `123456` in development), stores it in the `otps` table, and sends it via email to the admin's registered email address.
- **VerifyLoginOtp** - Validates the OTP against the latest non-expired record (5-minute TTL), consumes it via soft-delete, issues JWT access/refresh tokens, and stores them on the admin record.
- **VerifyToken** - Decodes and validates a JWT, verifies it matches the stored `accessToken` on the admin record, and returns the token payload (sub, email, scope, iat, exp).
- **RefreshTokens** - Rotates both access and refresh tokens by verifying the old refresh token, generating new ones, and updating the admin record.

```js
// OTP verification with TTL check
const age = Date.now() - new Date(record.createdAt).getTime();
if (age > OTP_TTL_MS) {
    await prisma.otps.update({
        where: { id: record.id },
        data: { deletedAt: new Date(), updatedAt: new Date() },
    });
    return cb({ code: grpc.status.PERMISSION_DENIED, message: 'OTP expired' });
}
```

### Admin CRUD
- **CreateAdmin** - Creates a new admin after duplicate email/phone check.
- **GetAdmin** - Fetches a single admin by ID (excluding soft-deleted).
- **UpdateAdmin** - Updates email/phone with duplicate prevention.
- **ListAdmins** - Paginated listing with search (email, phone), sorting, and pagination.
- **DeleteAdmin** - Soft-deletes an admin by setting `deletedAt`.

## Helpers and Mappers

| Helper | Purpose |
|--------|---------|
| `toApiAdmin(a)` | Maps Prisma admin object to gRPC response format (snake_case) |
| `genOtp()` | Returns `123456` in development, random 6-digit string otherwise |
| `normEmail(email)` | Trims and lowercases email |
| `normPhone(phone)` | Trims phone string |
| `findAdminByEmailOrPhone({email, phone})` | Looks up non-deleted admin by email or phone |
