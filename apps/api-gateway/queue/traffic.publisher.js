import { prisma } from "@jury-hrms/db/client.js";

/* ----------------------------------------
   CONFIG
---------------------------------------- */
const FLUSH_INTERVAL_MS = 500;
const MAX_BATCH_SIZE = 300;
const MAX_BUFFER_SIZE = 10000;

const INSTANCE_ID = process.env.INSTANCE_ID || null;

/* ----------------------------------------
   STATE
---------------------------------------- */
let buffer = [];
let flushing = false;
let droppedEvents = 0;

/* ----------------------------------------
   PUBLIC API
---------------------------------------- */
export function publishTrafficEvent(event) {
    if (!event || !event.service || !event.endpoint) return;

    if (buffer.length >= MAX_BUFFER_SIZE) {
        droppedEvents++;
        return;
    }

    buffer.push({
        timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),

        organizationId: event.organizationId ?? null,
        userId: event.userId ?? null,
        role: event.role ?? null,
        requestId: event.requestId ?? null,

        service: event.service,
        module: event.module ?? null,
        endpoint: event.endpoint,
        routeKey: event.routeKey ?? event.endpoint,
        method: event.method ?? "GET",

        statusCode: Number(event.statusCode || 0),
        statusClass: event.statusClass ?? "2xx",
        success: event.success ?? event.statusCode < 400,
        responseTimeMs: Number(event.responseTimeMs || 0),
        errorType: event.errorType ?? null,

        requestSizeBytes: event.requestSizeBytes ?? null,
        responseSizeBytes: event.responseSizeBytes ?? null,

        ip: event.ip ?? null,
        userAgent: event.userAgent ?? null,
        source: event.source ?? "web",
        country: event.country ?? null,

        serverInstance: INSTANCE_ID,
        isSystem: !!event.isSystem,

        createdAt: new Date()
    });
}

/* ----------------------------------------
   FLUSH LOGIC
---------------------------------------- */
async function flush() {
    if (flushing || buffer.length === 0) return;

    flushing = true;
    const batch = buffer.splice(0, MAX_BATCH_SIZE);

    try {
        await prisma.$runCommandRaw({
            insert: "TrafficEvent",
            documents: batch,
            ordered: false
        });
    } catch (err) {
        console.error(
            "[traffic] insertMany failed:",
            err?.message || err
        );

        // Re-queue failed batch (best effort)
        buffer.unshift(...batch.slice(0, MAX_BUFFER_SIZE - buffer.length));
    } finally {
        flushing = false;
    }
}

/* ----------------------------------------
   INTERVAL FLUSH
---------------------------------------- */
setInterval(() => {
    flush().catch(() => { });
}, FLUSH_INTERVAL_MS);

/* ----------------------------------------
   GRACEFUL SHUTDOWN
---------------------------------------- */
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
        console.log(
            `[traffic] shutting down, droppedEvents=${droppedEvents}`
        );
        await shutdownFlush();
        process.exit(0);
    });
}
