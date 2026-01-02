import pkg from "@prisma/client";
const { PrismaClient } = pkg;

const globalForPrisma = globalThis;

/**
 * Single Prisma client across the entire process
 */
export const prisma =
    globalForPrisma.prisma ??
    new PrismaClient({
        log: ["error"]
    });

if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma;
}

/**
 * Optional health check (SAFE)
 */
export async function checkDbConnection(serviceName = "unknown-service") {
    try {
        // light ping instead of forcing a new connection
        await prisma.$runCommandRaw({ ping: 1 });
        console.log(`[${serviceName}] ✅ Database reachable`);
    } catch (err) {
        console.error(`[${serviceName}] ❌ Database check failed`, err);
        process.exit(1);
    }
}
