function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
}

function addCalendarMonths(date, months) {
    const d = new Date(date.getTime());
    const day = d.getDate();
    const totalMonths = d.getMonth() + months;
    const targetYear = d.getFullYear() + Math.floor(totalMonths / 12);
    const targetMonth = ((totalMonths % 12) + 12) % 12;
    d.setFullYear(targetYear, targetMonth, 1);
    d.setDate(Math.min(day, daysInMonth(targetYear, targetMonth)));
    return d;
}

function addCalendarDays(date, days) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + days);
    return d;
}

/**
 * Calculates the probation end date.
 *
 * Rules:
 *  - end_date_after_completion = true  → start + duration (day after duration completes)
 *  - end_date_after_completion = false → start + duration - 1 day (last day of duration)
 *
 * Month arithmetic is calendar-aware (e.g. Jan 31 + 1 month → Feb 28/29).
 */
export function calculateProbationEndDate(startDate, durationValue, durationUnit, endDateAfterCompletion) {
    const start = new Date(startDate);

    let base;
    switch (durationUnit) {
        case 'MONTHS':
            base = addCalendarMonths(start, durationValue);
            break;
        case 'WEEKS':
            base = addCalendarDays(start, durationValue * 7);
            break;
        case 'DAYS':
            base = addCalendarDays(start, durationValue);
            break;
        default:
            throw new Error(`Invalid duration_unit: ${durationUnit}`);
    }

    const end = endDateAfterCompletion ? base : addCalendarDays(base, -1);
    return end;
}
