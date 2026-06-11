# `salaryTemplateV1.ejs` — Payslip Template V1

## Purpose

EJS template that renders a printable/PDF **payslip** for employees. Produces a single-page, two-column layout with earnings and deductions tables, employee info grid, and a net-pay summary bar.

## Layout Structure

```
┌─────────────────────────────────────┐
│  Tricolor bar (saffron/white/green) │
├─────────────────────────────────────┤
│ [Logo]  Company Name  │  PAYSLIP   │
│         Company Info  │  June 2025 │
│                       │  DOC-001   │
├─────────────────────────────────────┤
│ Employee Name │ Emp ID │ Department │
│ Designation   │ PAN    │ Bank Acct  │
│ UAN / PF No   │        │            │
├──────────────────┬──────────────────┤
│  EARNINGS        │  DEDUCTIONS      │
│  Basic     50000 │  PF        6000  │
│  HRA       25000 │  PT         200  │
│  ─────────────── │  ─────────────── │
│  Total     75000 │  Total      6200 │
├──────────────────┴──────────────────┤
│  NET PAY  │  ₹ 68,800               │
│  Rupees … │                         │
├─────────────────────────────────────┤
│  Summary: Gross │ Total Ded │ Net   │
│  Earnings  │     │ Pay       │       │
└─────────────────────────────────────┘
```

## Variables / Data Model

All data is injected at render time as top-level properties:

| Variable | Shape | Description |
|---|---|---|
| `pageTitle` | `string` | HTML `<title>` content |
| `company.logo` | `string` | URL/path to company logo image |
| `company.logoAlt` | `string` | Alt text for the logo |
| `company.name` | `string` | Registered company name |
| `company.details` | `string` | Address / registration info |
| `slip.label` | `string` | Header label (e.g. "PAYSLIP") |
| `slip.month` | `string` | Month label (e.g. "June 2025") |
| `slip.docId` | `string` | Unique document reference |
| `employeeFields` | `Array<{label, value, isMono}>` | Grid of employee details |
| `currency` | `string` | Currency symbol (e.g. "₹", "$") |
| `earnings.title` | `string` | Earnings table heading |
| `earnings.amountTitle` | `string` | Amount column heading |
| `earnings.items` | `Array<{label, amount, note?, isDim?}>` | Earnings line items |
| `earnings.totalLabel` | `string` | Total row label |
| `earnings.totalAmount` | `string` | Total earnings amount |
| `deductions.title` | `string` | Deductions table heading |
| `deductions.amountTitle` | `string` | Amount column heading |
| `deductions.items` | `Array<{label, amount, note?, isDim?}>` | Deductions line items |
| `deductions.totalLabel` | `string` | Total row label |
| `deductions.totalAmount` | `string` | Total deductions amount |
| `netPay.label` | `string` | Net section label |
| `netPay.words` | `string` | Amount in words |
| `netPay.amount` | `string` | Net pay value |

Each earning/deduction item supports optional `note` (small inline text) and `isDim` (dim/faded row styling).

## Styling

- **Fonts**: Google Fonts — Inter (sans-serif) + JetBrains Mono (monospace)
- **Colors**: Dark ink (`#1a1a1a`), saffron (`#e07b10`), green (`#186b36`), accent (`#1a3c6e`)
- **Layout**: 700px fixed-width card, centered on page
- **Earnings header**: `#fff4e6` background with saffron text
- **Deductions header**: `#eaf5ef` background with green text
- **Net pay banner**: Accent (navy) background with white text; large mono font (28px)
- **Summary row**: 5-column grid (Gross Earnings, Total Deductions, Net Pay, etc.)

## Dependencies

- **EJS** as the template engine (server-side rendering)
- **Google Fonts** (Inter, JetBrains Mono) — loaded via `<link>` (requires internet or preloaded fallback)
