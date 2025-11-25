// 🧱 Middleware (or inline in same file)
export const requestLogger = async (c, next) => {
    const start = Date.now();
    const { method, url } = c.req;
    const startedAt = new Date().toISOString();

    console.log(`➡️ [${startedAt}] ${method} ${url}`);

    try {
        await next();
    } finally {
        const ms = Date.now() - start;
        const endedAt = new Date().toISOString();
        const status = c.res.status;

        console.log(
            `⬅️ [${endedAt}] ${method} ${url} -> ${status} (${ms}ms)`
        );
    }
};
