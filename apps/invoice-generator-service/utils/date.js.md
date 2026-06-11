# utils/date.js

**Purpose:** Provides two small utility functions for date arithmetic used in billing cycle calculations.

## Key Exports

```js
export function addDays(date, days)
export function daysBetween(from, to)
```

## Dependencies

None (pure functions, no imports).

## Important Logic

### `addDays` (lines 1–5)
```js
export function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}
```
Returns a **new** Date object (does not mutate the input) with the specified number of days added.

### `daysBetween` (lines 7–9)
```js
export function daysBetween(from, to) {
    return Math.ceil((to - from) / (1000 * 60 * 60 * 24));
}
```
Calculates the number of whole days between two dates, rounding up via `Math.ceil`.
