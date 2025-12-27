import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import { generateEmployeeReportHTML } from './handlers/employeeReportData.js';
import dotenv from 'dotenv';
dotenv.config();

const PORT = process.env.REPORT_SERVICE_PORT || 5082;
const reportProto = loadProto('reports');

/* ------------------------------------------------------------------ */
/* 🧩 Implementation                                                  */
/* ------------------------------------------------------------------ */
const impl = {
    /* ------------------------------------------------------------------ */
    /* 🟣 Render Template by ID + Employee                                 */
    /* ------------------------------------------------------------------ */
    GenerateEmployeeInsightTemplateReport: async (call, callback) => {
        try {
            const { employee_id } = call.request;

            if (!employee_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "employee_id are required"
                });
            }

            // 1️⃣ Build data
            const data = await generateEmployeeReportHTML(employee_id);

            return callback(null, {
                employee_id,
                html: data
            });

        } catch (e) {
            console.error("GenerateEmployeeTemplateReport Error:", e);
            callback({
                code: grpc.status.INTERNAL,
                message: e.message
            });
        }
    }
};


/* ------------------------------------------------------------------ */
/* 🧩 Graceful Server Setup                                            */
/* ------------------------------------------------------------------ */
async function main() {
    await checkDbConnection('report-service');
    const server = new grpc.Server();

    server.addService(reportProto.ReportService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[report-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[report-service] Received ${signal}, shutting down gracefully...`);

        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[report-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[report-service] gRPC server stopped.');
                }
            });

            await prisma.$disconnect();
            console.log('[report-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[report-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[report-service] Fatal error:', err);
    process.exit(1);
});