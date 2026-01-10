import { prisma } from "@jury-hrms/db/client.js";

function pad4(n) {
    return String(n).padStart(4, "0");
}

/**
 * Atomic sequential invoice number:
 * JURYHRMS-YYYY-0001
 */
export async function generateInvoiceNumber() {
    const year = new Date().getFullYear();

    // Atomic upsert + increment
    const counter = await prisma.invoiceCounter.upsert({
        where: { year },
        create: { year, seq: 1 },
        update: { seq: { increment: 1 } },
        select: { seq: true },
    });

    return `JURYHRMS-${year}-${pad4(counter.seq)}`;
}
