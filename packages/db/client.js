import pkg from '@prisma/client';
const { PrismaClient } = pkg;

export const prisma = new PrismaClient();

/**
 * Call this once on service startup to verify DB connectivity.
 */
export async function checkDbConnection(serviceName = 'unknown-service') {
    try {
        await prisma.$connect(); // forces an actual connection
        console.log(`[${serviceName}] ✅ Database connected`);
    } catch (err) {
        console.error(`[${serviceName}] ❌ Database connection failed:`, err);
        // hard fail so the container/process doesn’t run half-broken
        process.exit(1);
    }
}
