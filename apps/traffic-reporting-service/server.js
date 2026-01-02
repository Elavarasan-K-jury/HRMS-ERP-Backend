/* ------------------------------------------------------------------ */
/* 🌱 Environment Setup                                                */
/* ------------------------------------------------------------------ */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

/* ------------------------------------------------------------------ */
/* 📦 Imports                                                          */
/* ------------------------------------------------------------------ */
import { OpenAPIHono } from "@hono/zod-openapi";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { swaggerUI } from "@hono/swagger-ui";

import { prisma } from "@jury-hrms/db/client.js";

// start cron jobs
import "./jobs/cron.js";

// routes
import { superAdminReports } from "./routes/superadmin.reports.js";

/* ------------------------------------------------------------------ */
/* 🏗️ App Setup                                                        */
/* ------------------------------------------------------------------ */

const app = new OpenAPIHono({
    defaultHook: (result, c) => {
        if (!result.success) return c.json({ error: result.error }, 400);
    },
});

app.use("*", cors({ origin: "*", allowMethods: ["GET"] }));

app.get("/", (c) =>
    c.json({
        service: "traffic-reporting",
        status: "ok",
        time: new Date().toISOString(),
    })
);

// super admin APIs
app.route("/", superAdminReports);

/* ------------------------------------------------------------------ */
/* 📜 OpenAPI / Swagger                                                */
/* ------------------------------------------------------------------ */

app.doc("/doc", {
    openapi: "3.1.0",
    info: {
        title: "Jury HRMS – Traffic Reporting Service",
        version: "1.0.0",
        description:
            "Super admin traffic analytics, aggregation, and anomaly detection APIs",
    },
});

app.get("/swagger", swaggerUI({ url: "/doc" }));

/* ------------------------------------------------------------------ */
/* 🚀 Server Start                                                     */
/* ------------------------------------------------------------------ */

const PORT = Number(process.env.TRAFFIC_REPORTING_PORT || 5088);

async function start() {
    try {
        // Mongo-safe health check
        await prisma.$connect();

        console.log("✅ MongoDB connected");

        serve({
            fetch: app.fetch,
            port: PORT,
            hostname: "0.0.0.0",
        });

        console.log(`🚦 Traffic Reporting running on :${PORT}`);
        console.log(`📘 Swagger → http://localhost:${PORT}/swagger`);
    } catch (err) {
        console.error("❌ Failed to start traffic-reporting", err);
        process.exit(1);
    }
}

start();

/* ------------------------------------------------------------------ */
/* 🧹 Graceful Shutdown                                                */
/* ------------------------------------------------------------------ */

for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
        console.log("[traffic-reporting] shutting down...");
        await prisma.$disconnect();
        process.exit(0);
    });
}
