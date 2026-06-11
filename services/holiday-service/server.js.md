# Holiday Service

## Purpose
Manages holidays (individual date entries) and provides a monthly calendar view showing which days are holidays.

## Key gRPC Methods
- **CreateHoliday** - Creates a holiday with date, name, region, type (PUBLIC/other), linked to a policy. Checks for duplicate holiday names within the organization.
- **UpdateHoliday** - Updates holiday fields with duplicate name check excluding the current holiday.
- **DeleteHoliday** - Hard-deletes a holiday record.
- **GetHoliday** - Fetches a single holiday by ID.
- **ListHolidays** - Lists holidays with filters (year, type, region, policy_id) and `total_count`.
- **GetHolidayCalendar** - Returns a day-by-day calendar for a given month (YYYY-MM), marking each day with `is_holiday`, `name`, and `type` if it matches a holiday record.

```js
// Calendar generation: iterate every day in the month
for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const hl = holidays.find((h) => h.date.toISOString().split('T')[0] === dateStr);
    result.push({
        date: dateStr,
        is_holiday: !!hl,
        name: hl?.name || '',
        type: hl?.type || '',
    });
}
```

## Helpers and Mappers

| Helper | Purpose |
|--------|---------|
| `toApiHoliday(h)` | Maps holiday to API format with ISO date string (YYYY-MM-DD), policy_id, name, region, type |

**Server port:** `process.env.HOLIDAY_SERVICE_PORT || 5079`
