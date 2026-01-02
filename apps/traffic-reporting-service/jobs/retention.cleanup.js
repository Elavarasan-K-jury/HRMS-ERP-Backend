import { prisma } from "@jury-hrms/db/client.js";

const RETENTION_DAYS = Number(process.env.TRAFFIC_RETENTION_DAYS || 30);
const BATCH_SIZE = 5000;

export async function runRetentionCleanup() {
    const cutoff = new Date(
        Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
    );

    let totalDeleted = 0;

    while (true) {
        // fetch ids first (indexed)
        const oldDocs = await prisma.trafficEvent.findMany({
            where: { timestamp: { lt: cutoff } },
            select: { id: true },
            take: BATCH_SIZE
        });

        if (!oldDocs.length) break;

        const ids = oldDocs.map((d) => d.id);

        const result = await prisma.trafficEvent.deleteMany({
            where: { id: { in: ids } }
        });

        totalDeleted += result.count;

        // yield to event loop (avoid pressure)
        await new Promise((r) => setTimeout(r, 50));
    }

    if (totalDeleted > 0) {
        console.log(
            `[traffic-retention] deleted ${totalDeleted} events older than ${RETENTION_DAYS} days`
        );
    }
}
