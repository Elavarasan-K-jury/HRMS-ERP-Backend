# routes/superadmin.reports.js

**Purpose:** Defines 6 OpenAPI-documented endpoints for super admin traffic analytics — platform overview, service health, top routes, error breakdown, latency summary, and recent alerts.

## Key Exports

```js
export const superAdminReports = new OpenAPIHono();
```

## Dependencies

| Package | Purpose |
|---|---|
| `@hono/zod-openapi` | OpenAPI route builder with Zod schemas |
| `@jury-hrms/db/client.js` | Prisma client |

## Endpoints

### 1. `GET /superadmin/traffic/overview` — Platform Traffic Overview
- **Query:** `days` (1–90, default 1)
- Auto-selects `hourly` vs `daily` granularity based on the days parameter
- Returns totals (`requests`, `errors`, `errorRate`) and a time-series `trend` array
- Critical normalization: for daily granularity, `since` is set to midnight (line 95):
  ```js
  if (granularity === "daily") { since.setHours(0, 0, 0, 0); }
  ```

### 2. `GET /superadmin/traffic/services` — Service Health Summary
- **Query:** `days` (1–90, default 1)
- Fetches from `trafficHourlyStat`, groups in memory using a `Map`
- Computes health status per service:
  ```js
  if (errorRate > 5 || p95LatencyMs > 2000) status = "UNHEALTHY";
  else if (errorRate > 1 || p95LatencyMs > 1000) status = "DEGRADED";
  else status = "HEALTHY";
  ```
- Results sorted ascending by score (worst first)

### 3. `GET /superadmin/traffic/routes` — Top Routes
- MongoDB aggregation on `TrafficEvent`, groups by route+method, sorts by request count desc, limits to 20

### 4. `GET /superadmin/traffic/errors` — Error Breakdown
- MongoDB aggregation on `TrafficEvent`, groups by `statusClass`, sorts by count desc

### 5. `GET /superadmin/traffic/latency` — Latency Summary
- MongoDB aggregation computes `avg`, `min`, `max`, `p95` (`$percentile`), `p99` across all events

### 6. `GET /superadmin/traffic/alerts` — Recent Alerts
- Simple `findMany` on `trafficAlert`, ordered by `triggeredAt` desc, limited to 20
