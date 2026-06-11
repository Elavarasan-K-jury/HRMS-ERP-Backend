# `ecosystem.config.cjs` — PM2 Process Manager Configuration

## Purpose

Configures [PM2](https://pm2.keymetrics.io/) to run the Backend as a production daemon. PM2 handles auto-restart, memory limits, and environment variables.

## File Content

```cjs
module.exports = {
    apps: [
        {
            name: "Jury-HRMS||Backend",
            script: "npm",
            args: "run start",
            cwd: "/root/JuryHRMS/Backend",
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: "300M",
            env: {
                NODE_ENV: "production"
            }
        }
    ]
};
```

## Key Elements

| Key | Value | Description |
|---|---|---|
| `name` | `Jury-HRMS\|\|Backend` | Human-readable process name in PM2 dashboards |
| `script` | `npm` | Runtime binary — PM2 invokes `npm run start` |
| `args` | `run start` | NPM script to execute (defined in `package.json`) |
| `cwd` | `/root/JuryHRMS/Backend` | Working directory on the server |
| `instances` | `1` | Single instance (not clustered) |
| `autorestart` | `true` | Restart automatically on crash |
| `watch` | `false` | Disable file-watch restarts |
| `max_memory_restart` | `300M` | Restart process when RSS memory exceeds 300 MB |
| `env.NODE_ENV` | `production` | Environment flag set at runtime |

## Dependencies

- **PM2** must be installed globally on the server (`npm i -g pm2`).
- The `npm run start` script must exist in the project's `package.json`.
