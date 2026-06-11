# utils/invoiceNumber.js

**Purpose:** Generates atomic sequential invoice numbers in the format `JURYHRMS-YYYY-0001` using a MongoDB counter document with an atomic upsert.

## Key Exports

```js
export async function generateInvoiceNumber()
```

Returns a string like `JURYHRMS-2026-0042`.

## Dependencies

| Package | Purpose |
|---|---|
| `@jury-hrms/db/client.js` | Prisma client |

## Important Logic

### Atomic counter (lines 14–22)
```js
const counter = await prisma.invoiceCounter.upsert({
    where: { year },
    create: { year, seq: 1 },
    update: { seq: { increment: 1 } },
    select: { seq: true },
});
return `JURYHRMS-${year}-${pad4(counter.seq)}`;
```
Uses Prisma's `upsert` to atomically increment the `seq` field for the current year. If no counter exists for the year, it creates one starting at 1. The counter is a separate collection (`invoiceCounter`) keyed by year.

### Zero-padded sequence (lines 3–5)
```js
function pad4(n) { return String(n).padStart(4, "0"); }
```
Pads the sequence number to 4 digits (e.g., `1` → `0001`).
