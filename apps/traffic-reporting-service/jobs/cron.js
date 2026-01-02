import cron from "node-cron";
import { runHourlyAggregation } from "./aggregate.hourly.js";
import { runDailyAggregation } from "./aggregate.daily.js";
import { runAnomalyChecks } from "./anomaly.checks.js";
import { runRetentionCleanup } from "./retention.cleanup.js";

const TZ = process.env.CRON_TIMEZONE || "Asia/Kolkata";
const FAST_MODE = process.env.CRON_FAST_MODE === "true";

// in-memory locks (single instance safe)
const locks = new Map();

async function safeRun(name, fn) {
    if (locks.get(name)) {
        console.log(`[cron] skip ${name} (already running)`);
        return;
    }

    locks.set(name, true);
    const started = Date.now();

    try {
        await fn();
        console.log(`[cron] done ${name} in ${Date.now() - started}ms`);
    } catch (err) {
        console.error(`[cron] failed ${name}:`, err?.message || err);
    } finally {
        locks.set(name, false);
    }
}

/* ===========================================================
   FAST MODE (TESTING)
=========================================================== */

if (FAST_MODE) {
    console.log("⚡ CRON FAST MODE ENABLED");

    // Every 30 seconds
    cron.schedule(
        "*/30 * * * * *",
        () => safeRun("hourly_agg", runHourlyAggregation),
        { timezone: TZ }
    );

    // Every 1 minute
    cron.schedule(
        "*/1 * * * *",
        () => safeRun("daily_agg", runDailyAggregation),
        { timezone: TZ }
    );

    // Every 5 seconds
    cron.schedule(
        "*/5 * * * * *",
        () => safeRun("anomaly_checks", runAnomalyChecks),
        { timezone: TZ }
    );

    // Every 30 minutes
    cron.schedule(
        "*/30 * * * *",
        () => safeRun("retention_cleanup", runRetentionCleanup),
        { timezone: TZ }
    );

} else {
    /* ===========================================================
       NORMAL / PRODUCTION MODE
    =========================================================== */

    // Hourly aggregation every 5 minutes
    cron.schedule(
        "*/5 * * * *",
        () => safeRun("hourly_agg", runHourlyAggregation),
        { timezone: TZ }
    );

    // Daily aggregation at 00:20
    cron.schedule(
        "20 0 * * *",
        () => safeRun("daily_agg", runDailyAggregation),
        { timezone: TZ }
    );

    // Anomaly checks every 5 second
    cron.schedule(
        "*/5 * * * * *",
        () => safeRun("anomaly_checks", runAnomalyChecks),
        { timezone: TZ }
    );

    // Retention cleanup
    if (process.env.TRAFFIC_RETENTION_CRON_ENABLED === "true") {
        cron.schedule(
            "30 0 * * *",
            () => safeRun("retention_cleanup", runRetentionCleanup),
            { timezone: TZ }
        );
    } else {
        console.log("[cron] retention cleanup disabled (TTL recommended)");
    }
}
