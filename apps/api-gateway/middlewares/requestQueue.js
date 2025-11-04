import PQueue from 'p-queue';

const concurrency = 10; // how many concurrent gRPC calls to allow
const queueLimit = Number(process.env.REQUEST_QUEUE_LIMIT || 50);

export const queue = new PQueue({
    concurrency,
    timeout: 30000, // 30s max wait per request
});

export async function withQueue(handler) {
    return async (c) => {
        if (queue.size >= queueLimit) {
            return c.json({ error: 'Server is busy. Try again shortly.' }, 429);
        }

        return queue.add(() => handler(c));
    };
}
