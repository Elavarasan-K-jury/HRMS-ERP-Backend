import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true
});

const STREAM = process.env.TRAFFIC_STREAM || "traffic.events";

const FLUSH_INTERVAL_MS = Number(process.env.TRAFFIC_STREAM_FLUSH_MS || 300);
const MAX_BATCH_SIZE = Number(process.env.TRAFFIC_STREAM_BATCH || 200);
const MAX_BUFFER_SIZE = Number(process.env.TRAFFIC_STREAM_BUFFER || 10000);

// cap stream size (approx)
const STREAM_MAXLEN = Number(process.env.TRAFFIC_STREAM_MAXLEN || 200000);
const INSTANCE_ID = process.env.INSTANCE_ID || "";

let buffer = [];
let flushing = false;
let dropped = 0;

function s(v) {
    if (v === undefined || v === null) return "";
    return String(v);
}

export function publishTrafficEvent(event) {
    if (!event || !event.service || !event.endpoint) return;

    if (buffer.length >= MAX_BUFFER_SIZE) {
        dropped++;
        return;
    }

    buffer.push({
        timestamp:
            event.timestamp instanceof Date
                ? event.timestamp
                : new Date(event.timestamp || Date.now()),

        organizationId: event.organizationId ?? null,
        userId: event.userId ?? null,
        role: event.role ?? null,
        requestId: event.requestId ?? null,

        service: event.service,
        module: event.module ?? null,
        endpoint: event.endpoint,
        routeKey: event.routeKey ?? null,
        method: event.method,

        statusCode: Number(event.statusCode || 0),
        statusClass: event.statusClass,
        responseTimeMs: Number(event.responseTimeMs || 0),
        errorType: event.errorType ?? null,

        requestSizeBytes: event.requestSizeBytes ?? null,
        responseSizeBytes: event.responseSizeBytes ?? null,

        ip: event.ip ?? null,
        userAgent: event.userAgent ?? null,
        source: event.source ?? "web",

        isSystem: !!event.isSystem,
        createdAt: new Date()
    });
}

async function flush() {
    if (flushing || buffer.length === 0) return;
    flushing = true;

    const batch = buffer.splice(0, MAX_BATCH_SIZE);

    try {
        const pipeline = redis.pipeline();

        for (const e of batch) {
            pipeline.xadd(
                STREAM,
                "MAXLEN",
                "~",
                STREAM_MAXLEN,
                "*",

                "timestamp", s(e.timestamp),
                "organizationId", s(e.organizationId),
                "userId", s(e.userId),
                "role", s(e.role),
                "requestId", s(e.requestId),

                "service", s(e.service),
                "module", s(e.module),
                "endpoint", s(e.endpoint),
                "routeKey", s(e.routeKey),
                "method", s(e.method),

                "statusCode", s(e.statusCode),
                "statusClass", s(e.statusClass),
                "success", s(e.success),
                "responseTimeMs", s(e.responseTimeMs),
                "errorType", s(e.errorType),

                "requestSizeBytes", s(e.requestSizeBytes),
                "responseSizeBytes", s(e.responseSizeBytes),

                "ip", s(e.ip),
                "userAgent", s(e.userAgent),
                "source", s(e.source),
                "country", s(e.country),

                "serverInstance", s(e.serverInstance),
                "isSystem", s(e.isSystem)
            );
        }

        await pipeline.exec();
    } catch (err) {
        console.error("[traffic] redis stream publish failed:", err?.message || err);

        // best-effort requeue
        buffer = batch.concat(buffer).slice(0, MAX_BUFFER_SIZE);
    } finally {
        flushing = false;
    }
}

setInterval(() => {
    flush().catch(() => { });
}, FLUSH_INTERVAL_MS);

/* Graceful shutdown flush */
async function shutdownFlush() {
    try {
        while (buffer.length > 0) {
            await flush();
        }
    } catch {
        // swallow
    }
}

for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
        console.log(`[traffic] redis publisher shutting down; dropped=${dropped}`);
        await shutdownFlush();
        try {
            await redis.quit();
        } catch { }
        process.exit(0);
    });
}
