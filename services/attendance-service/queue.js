import PQueue from "p-queue";

export const reportQueue = new PQueue({
    concurrency: 1,      // only 1 report processed at a time
    intervalCap: 1,
    interval: 1000,      // 1 job per second (optional)
});
