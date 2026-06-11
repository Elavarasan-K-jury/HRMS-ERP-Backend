# subscription-service/utils/invoiceNumber.js

## Purpose
Atomic sequential invoice number generator with yearly reset, using a dedicated `invoiceCounter` table.

## Exported Function

**`generateInvoiceNumber()`** — Returns a string in the format `JURYHRMS-YYYY-XXXX` where XXXX is a zero-padded 4-digit sequence that increments atomically per year.

### Logic

Uses Prisma's `upsert` to atomically increment a per-year counter:

```js
export async function generateInvoiceNumber() {
    const year = new Date().getFullYear();

    const counter = await prisma.invoiceCounter.upsert({
        where: { year },
        create: { year, seq: 1 },
        update: { seq: { increment: 1 } },
        select: { seq: true },
    });

    return `JURYHRMS-${year}-${pad4(counter.seq)}`;
}
```

The `pad4` helper ensures the sequence is always 4 digits:

```js
function pad4(n) {
    return String(n).padStart(4, "0");
}
```
