import cron from "node-cron";
import { prisma } from "@jury-hrms/db/client.js";

/**
 * ⏳ Auto-mark expired payment links
 * Runs every 5 minutes
 */
cron.schedule("*/5 * * * *", async () => {
    const now = new Date();

    try {
        const result = await prisma.invoices.updateMany({
            where: {
                status: "ISSUED",
                paymentStatus: "PENDING",
                paymentLinkExpiredBy: {
                    not: null,
                    lt: now,
                },
            },
            data: {
                paymentStatus: "FAILED",
                updatedAt: now,
            },
        });

        if (result.count > 0) {
            console.log(
                `[CRON] Marked ${result.count} invoice payment links as expired`
            );
        }
    } catch (error) {
        console.error("[CRON] ExpirePaymentLinks error:", error);
    }
});
