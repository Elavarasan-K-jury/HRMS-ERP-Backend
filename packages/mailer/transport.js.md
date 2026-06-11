# `transport.js` — Nodemailer SMTP Transport

Configures a Nodemailer transporter from environment variables. Falls back to console logging when no SMTP credentials are provided.

## Configuration

| Env Var | Default | Description |
|---|---|---|
| `SMTP_HOST` | — | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |
| `MAIL_FROM` | `Jury HRMS <noreply@juryhrms.com>` | From address |
| `SMTP_POOL` | `true` | Enable connection pooling |
| `SMTP_MAX_CONNECTIONS` | `5` | Max pooled connections |
| `SMTP_MAX_MESSAGES` | `100` | Max messages per connection |

## Exports

### `getFromAddress()`
Returns the configured `MAIL_FROM` string.

### `sendRaw({ to, subject, text, html, attachments })`
Sends an email. If no SMTP credentials exist, logs the email contents to the console and returns a mock response with `messageId: 'dev-fallback'`.

```js
await sendRaw({ to: 'a@b.com', subject: 'Hi', html: '<p>Hello</p>' });
```

### `verifyTransport()`
Returns `{ ok: true }` if SMTP connection verifies, or `{ ok: false, reason: '...' }` otherwise.

```js
const { ok } = await verifyTransport();
```

## Dependencies

- `nodemailer` — SMTP email sending
