# server.js

**Purpose:** Real-time usage reporting server using Socket.IO — polls `OrganizationUsageEvent` from the database, computes per-organization KPIs (RPS, error rate, latency percentiles) in O(1) sliding windows, and pushes metrics/time-series to connected clients.

## Key Exports

None (self-contained HTTP + Socket.IO server).

## Dependencies

| Package | Purpose |
|---|---|
| `socket.io` | WebSocket server for real-time push |
| `@jury-hrms/db/client.js` | Prisma client |
| `@jury-hrms/auth/jwt.js` | `verifyToken` for Socket.IO auth |

## Important Logic

### Sliding-window state (lines 82–97)
```js
function createWindowState() {
    return {
        headSec: Math.floor(Date.now() / 1000),
        buckets: Array.from({ length: WINDOW_BUCKETS }, () => ({
            sec: 0, count: 0, errors: 0, latencySum: 0,
            latencyHist: new Uint32Array(LAT_BUCKETS),
        })),
    };
}
```
Each organization gets a circular buffer of 60 one-second buckets (METRIC_WINDOW_MS = 60s, WINDOW_BUCKET_MS = 1s). Latency histogram uses `Uint32Array` with configurable bucket size (default 50ms, 40 buckets = 0–2000ms).

### Event ingestion (lines 138–177)
```js
function ingest(orgId, events) {
    for (const e of events) {
        const sec = Math.floor(new Date(e.occurredAt).getTime() / 1000);
        if (sec < win.headSec - (WINDOW_BUCKETS - 1)) continue;
        const b = win.buckets[sec % WINDOW_BUCKETS];
        // ...
    }
}
```
Events are slotted into the circular buffer by their timestamp's second. Stale events outside the window are dropped. Also maintains a minute-bucketed time-series map (up to 30 minutes).

### Metric computation (lines 182–217)
```js
function computeMetrics(win) {
    // aggregates all non-stale buckets into totals and latency histogram
    // computes p95 by walking the histogram cumulative sum
    return { rps, errors, errorRate, avgLatency, p95Latency };
}
```
Scans the circular buffer for the last 60 seconds, aggregates counts/errors/latency, and computes p95 latency by iterating the histogram buckets.

### Socket.IO auth middleware (lines 55–77)
```js
io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    const payload = await verifyToken(String(token));
    socket.user = { organizationId, employeeId, role, userId };
    return next();
});
```
Requires a JWT token in `socket.handshake.auth.token`. The `organizationId` and `employeeId` are also passed in `handshake.auth`.

### Connection & warmup (lines 257–279)
On connection, the socket joins a room (`org:<id>` or `__ALL_ORGS__`). If the client has an `organizationId`, the server:
1. Warms the sliding window from the last 30 minutes of DB events (`warmOrgFromDB`)
2. Emits `usage:timeseries` (30 min history) and `usage:metrics` (current 60s KPIs)

### Realtime poller (lines 284–329)
```js
setInterval(async () => {
    // collect org IDs from connected rooms + recent DB events
    // for each org, fetch new events since lastSeenByOrg cursor
    // ingest and emit usage:metrics + usage:timeseries to org room and global room
}, POLL_MS);
```
Polls every `POLL_MS` (default 1s), fetches only new events (using `id: { gt: lastId }`), processes them, and pushes metrics to connected clients.

### Graceful shutdown (lines 339–348)
```js
function shutdown(signal) {
    io.close(() => httpServer.close(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000);
}
```
Closes Socket.IO and HTTP server on SIGTERM/SIGINT, with a 10s forced-exit fallback.
