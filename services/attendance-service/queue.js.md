# Attendance Report Queue

## Purpose
Exports a singleton `p-queue` instance for serial processing of attendance report generation jobs (one at a time with at most 1 job per second).

```js
import PQueue from "p-queue";

export const reportQueue = new PQueue({
    concurrency: 1,
    intervalCap: 1,
    interval: 1000,
});
```
