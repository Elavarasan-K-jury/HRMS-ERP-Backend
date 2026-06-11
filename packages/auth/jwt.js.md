# `jwt.js` — JWT Token Signing & Verification

Provides async functions for signing and verifying HS256 JWTs using the `jose` library, supporting separate access and refresh token lifetimes.

## Exports

### `signAccessToken(payload)`
Signs a JWT with the given payload and an expiration time of `JWT_ACCESS_EXPIRES_IN` seconds (default 10,000s ≈ 2.8h).

```js
const token = await signAccessToken({ userId: "abc" });
```

### `signRefreshToken(payload)`
Signs a JWT with the given payload and an expiration time of `JWT_REFRESH_EXPIRES_IN` seconds (default 604,800s = 7 days).

```js
const refresh = await signRefreshToken({ userId: "abc" });
```

### `verifyToken(token)`
Verifies and decodes a JWT. Throws if the token is invalid, expired, or not signed with HS256.

```js
const payload = await verifyToken(token);
// => { userId: "abc", iat: ..., exp: ... }
```

### `ACCESS_EXPIRES_IN`
Exported constant reflecting the configured access token TTL in seconds.

## Dependencies

- `jose` — JWT signing (`SignJWT`) and verification (`jwtVerify`)
