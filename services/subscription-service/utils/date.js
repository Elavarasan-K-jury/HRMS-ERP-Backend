export function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

export function daysBetween(from, to) {
    return Math.ceil((to - from) / (1000 * 60 * 60 * 24));
}
