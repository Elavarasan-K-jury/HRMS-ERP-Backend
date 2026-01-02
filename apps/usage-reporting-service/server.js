// usage-reporting-server.js
import http from "http";
import { Server } from "socket.io";
import { prisma } from "@jury-hrms/db/client.js";
import { verifyToken } from "@jury-hrms/auth/jwt.js";

/* -----------------------------------------------------
   CONFIG
----------------------------------------------------- */
const PORT = Number(process.env.USAGE_REPORT_PORT || 5099);
const POLL_MS = Number(process.env.POLL_MS || 1000);

// KPI rolling window (last 60 seconds)
const METRIC_WINDOW_MS = 60_000;
const WINDOW_BUCKET_MS = 1_000;
const WINDOW_BUCKETS = METRIC_WINDOW_MS / WINDOW_BUCKET_MS;

// Initial chart window (last 30 minutes)
const INITIAL_TS_MINUTES = 30;
const MAX_TS_BUCKETS = INITIAL_TS_MINUTES;

// Latency histogram
const LAT_BUCKET_MS = Number(process.env.LAT_BUCKET_MS || 50);
const LAT_BUCKETS = Number(process.env.LAT_BUCKETS || 40);

// Global room
const GLOBAL_ROOM = "__ALL_ORGS__";

/* -----------------------------------------------------
   HTTP SERVER (health)
----------------------------------------------------- */
const httpServer = http.createServer((req, res) => {
    if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", ts: Date.now() }));
        return;
    }
    res.writeHead(404);
    res.end("Not Found");
});

/* -----------------------------------------------------
   SOCKET.IO
----------------------------------------------------- */
const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"], credentials: true },
    transports: ["websocket", "polling"],
    pingTimeout: 60_000,
    pingInterval: 25_000,
});

/* -----------------------------------------------------
   AUTH (JWT REQUIRED)
----------------------------------------------------- */
io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth?.token;
        if (!token) return next(new Error("Missing token"));

        const payload = await verifyToken(String(token));

        socket.user = {
            organizationId: socket.handshake.auth?.organizationId
                ? String(socket.handshake.auth.organizationId)
                : null,
            employeeId: socket.handshake.auth?.employeeId
                ? String(socket.handshake.auth.employeeId)
                : null,
            role: payload.role || null,
            userId: payload.sub || payload.userId || null,
        };

        return next();
    } catch {
        return next(new Error("Unauthorized"));
    }
});

/* -----------------------------------------------------
   INTERNAL STATE (O(1) PER ORG)
----------------------------------------------------- */
function createWindowState() {
    return {
        headSec: Math.floor(Date.now() / 1000),
        buckets: Array.from({ length: WINDOW_BUCKETS }, () => ({
            sec: 0,
            count: 0,
            errors: 0,
            latencySum: 0,
            latencyHist: new Uint32Array(LAT_BUCKETS),
        })),
    };
}

const windowByOrg = new Map();
const seriesByOrg = new Map();
const lastSeenByOrg = new Map();

/* -----------------------------------------------------
   HELPERS
----------------------------------------------------- */
function minuteBucket(ts) {
    return Math.floor(ts / 60_000) * 60_000;
}

function rollWindow(win) {
    const now = Math.floor(Date.now() / 1000);
    while (win.headSec < now) {
        win.headSec++;
        const b = win.buckets[win.headSec % WINDOW_BUCKETS];
        b.sec = win.headSec;
        b.count = 0;
        b.errors = 0;
        b.latencySum = 0;
        b.latencyHist.fill(0);
    }
}

function ensureOrgState(orgId) {
    let win = windowByOrg.get(orgId);
    if (!win) {
        win = createWindowState();
        windowByOrg.set(orgId, win);
    }

    let smap = seriesByOrg.get(orgId);
    if (!smap) {
        smap = new Map();
        seriesByOrg.set(orgId, smap);
    }

    return { win, smap };
}

/* -----------------------------------------------------
   INGEST EVENTS (O(1))
----------------------------------------------------- */
function ingest(orgId, events) {
    const { win, smap } = ensureOrgState(orgId);
    rollWindow(win);

    for (const e of events) {
        const ts = new Date(e.occurredAt).getTime();
        const sec = Math.floor(ts / 1000);
        if (sec < win.headSec - (WINDOW_BUCKETS - 1)) continue;

        const b = win.buckets[sec % WINDOW_BUCKETS];
        if (b.sec !== sec) {
            b.sec = sec;
            b.count = 0;
            b.errors = 0;
            b.latencySum = 0;
            b.latencyHist.fill(0);
        }

        const latency = Number(e.durationMs) || 0;
        const success = Boolean(e.success);

        b.count++;
        if (!success) b.errors++;
        b.latencySum += latency;

        const li = Math.min(LAT_BUCKETS - 1, Math.floor(latency / LAT_BUCKET_MS));
        b.latencyHist[li]++;

        const mk = minuteBucket(ts);
        const mb = smap.get(mk) || { ts: mk, requests: 0, errors: 0, latencySum: 0 };
        mb.requests++;
        if (!success) mb.errors++;
        mb.latencySum += latency;
        smap.set(mk, mb);
    }

    while (smap.size > MAX_TS_BUCKETS) {
        smap.delete(Math.min(...smap.keys()));
    }
}

/* -----------------------------------------------------
   COMPUTE KPIs
----------------------------------------------------- */
function computeMetrics(win) {
    rollWindow(win);

    let total = 0,
        errors = 0,
        sum = 0;
    const hist = new Uint32Array(LAT_BUCKETS);
    const minSec = win.headSec - (WINDOW_BUCKETS - 1);

    for (const b of win.buckets) {
        if (b.sec < minSec || b.sec > win.headSec) continue;
        total += b.count;
        errors += b.errors;
        sum += b.latencySum;
        for (let i = 0; i < LAT_BUCKETS; i++) hist[i] += b.latencyHist[i];
    }

    if (!total) {
        return { rps: 0, errors: 0, errorRate: 0, avgLatency: 0, p95Latency: 0 };
    }

    let cum = 0,
        p95 = 0;
    for (let i = 0; i < LAT_BUCKETS; i++) {
        cum += hist[i];
        if (cum >= total * 0.95) {
            p95 = (i + 1) * LAT_BUCKET_MS;
            break;
        }
    }

    return {
        rps: Number((total / 60).toFixed(2)),
        errors,
        errorRate: Number(((errors / total) * 100).toFixed(2)),
        avgLatency: Math.round(sum / total),
        p95Latency: p95,
    };
}

function serializeSeries(orgId) {
    const smap = seriesByOrg.get(orgId);
    if (!smap) return [];
    return [...smap.values()]
        .sort((a, b) => a.ts - b.ts)
        .map((b) => ({
            ts: b.ts,
            requests: b.requests,
            errors: b.errors,
            avgLatency: b.requests ? Math.round(b.latencySum / b.requests) : 0,
        }));
}

/* -----------------------------------------------------
   INITIAL SNAPSHOT (LAST 30 MINUTES)
----------------------------------------------------- */
async function warmOrgFromDB(orgId) {
    const now = Date.now();
    const from30m = new Date(now - INITIAL_TS_MINUTES * 60_000);

    const rows = await prisma.organizationUsageEvent.findMany({
        where: {
            organizationId: orgId,
            occurredAt: { gte: from30m },
        },
        // ✅ FIX 1: MUST order by occurredAt to keep lastSeen correct
        orderBy: { occurredAt: "asc" },
        take: 30_000,
    });

    if (!rows.length) return;

    ingest(orgId, rows);
    lastSeenByOrg.set(orgId, rows.at(-1).id);
}

/* -----------------------------------------------------
   SOCKET HANDLING
----------------------------------------------------- */
io.on("connection", async (socket) => {
    const orgId = socket.user.organizationId;

    if (orgId) socket.join(`org:${orgId}`);
    else socket.join(GLOBAL_ROOM);

    socket.emit("connected", {
        ok: true,
        orgId,
        scope: orgId ? "org" : "global",
    });

    // ✅ FIX 2: Always emit a baseline snapshot/metrics (even for global)
    if (!orgId) {
        socket.emit("usage:timeseries", []);
        socket.emit("usage:metrics", {
            ts: Date.now(),
            rps: 0,
            errors: 0,
            errorRate: 0,
            avgLatency: 0,
            p95Latency: 0,
        });
        return;
    }

    try {
        await warmOrgFromDB(orgId);
        const win = windowByOrg.get(orgId);
        socket.emit("usage:timeseries", serializeSeries(orgId));
        socket.emit("usage:metrics", { ts: Date.now(), ...computeMetrics(win) });
    } catch (err) {
        console.error(`❌ warmOrgFromDB failed for ${orgId}`, err);
    }
});

/* -----------------------------------------------------
   POLLER (REALTIME)
----------------------------------------------------- */
setInterval(async () => {
    try {
        const orgIds = new Set();

        for (const room of io.sockets.adapter.rooms.keys()) {
            if (room.startsWith("org:")) orgIds.add(room.slice(4));
        }

        if (io.sockets.adapter.rooms.has(GLOBAL_ROOM)) {
            const recent = await prisma.organizationUsageEvent.findMany({
                select: { organizationId: true },
                distinct: ["organizationId"],
                take: 1000,
            });
            for (const r of recent) orgIds.add(String(r.organizationId));
        }

        for (const orgId of orgIds) {
            const lastId = lastSeenByOrg.get(orgId);

            const events = await prisma.organizationUsageEvent.findMany({
                where: lastId
                    ? { organizationId: orgId, id: { gt: lastId } }
                    : { organizationId: orgId },
                orderBy: { id: "asc" },
                take: 500,
            });

            if (!events.length) continue;

            lastSeenByOrg.set(orgId, events.at(-1).id);
            ingest(orgId, events);

            const metrics = {
                ts: Date.now(),
                ...computeMetrics(windowByOrg.get(orgId)),
            };

            io.to(`org:${orgId}`).emit("usage:metrics", metrics);
            io.to(`org:${orgId}`).emit("usage:timeseries", serializeSeries(orgId));

            // ✅ FIX 3: If global listeners exist, they should also get series + metrics
            io.to(GLOBAL_ROOM).emit("usage:metrics", { orgId, ...metrics });
            io.to(GLOBAL_ROOM).emit("usage:timeseries", serializeSeries(orgId));
        }
    } catch (err) {
        console.error("❌ usage-reporting poller:", err);
    }
}, POLL_MS);

/* -----------------------------------------------------
   START + SHUTDOWN
----------------------------------------------------- */
httpServer.listen(PORT, () => {
    console.log(`✅ Usage Report Realtime running on :${PORT}`);
    console.log(`🔍 Health check at http://localhost:${PORT}/health`);
});

function shutdown(signal) {
    console.log(`📴 ${signal} received`);
    io.close(() => httpServer.close(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", console.error);
process.on("unhandledRejection", console.error);
