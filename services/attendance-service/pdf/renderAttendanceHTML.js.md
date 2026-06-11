# Render Attendance HTML

## Purpose
Generates a fully-styled HTML document for the attendance report, designed for PDF conversion with print media queries and responsive layout.

## Key Functions

| Helper | Purpose |
|--------|---------|
| `escapeHtml(str)` | Sanitizes strings for safe HTML embedding |
| `formatHours(value)` | Formats hours as `X.XX hrs` |
| `formatMinutes(value)` | Formats minutes as `X min` |
| `formatDateLabel(dateStr)` | Returns `YYYY-MM-DD (Weekday)` format |
| `formatTime(ts)` | Returns HH:mm 24-hour format |
| `parseSource(sourceRaw)` | Parses JSON source data (browser, OS) |
| `statusClass(status)` | Returns CSS class string for status pill coloring |

## HTML Structure
The rendered HTML includes:
- **Header**: Organization logo (initials), name, report title, date range
- **Summary Cards**: Report statistics (present, half-day, absent counts, gross/effective hours) and employee list
- **Day Sections**: Per-day attendance grouped by employee, with check-in/out times, hours, status pills, and detailed log tables

The page uses CSS custom properties for theming (Teal primary color), with dedicated `@media print` and landscape `@page` rules for PDF output.
