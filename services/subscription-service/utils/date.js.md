# subscription-service/utils/date.js

## Purpose
Lightweight date utility functions for subscription and invoice date calculations.

## Exported Functions

### `addDays(date, days)`
Returns a new Date with the given number of days added:

```js
export function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}
```

### `daysBetween(from, to)`
Returns the number of days between two dates (rounded up):

```js
export function daysBetween(from, to) {
    return Math.ceil((to - from) / (1000 * 60 * 60 * 24));
}
```
