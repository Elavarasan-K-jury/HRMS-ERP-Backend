# `salaryTemplateV2.ejs` — Payslip Template V2

## Purpose

EJS template that renders a **premium, design-forward payslip** for PDF/print. Features a dark header, elegant serif typography, a subtle "PAID" watermark, and responsive layout. Intended as a modern alternative to V1.

## Layout Structure

```
┌─────────────────────────────────────────────┐
│  Accent gradient bar (purple → gold)        │
├─────────────────────────────────────────────┤
│ DARK HEADER                                 │
│ [Logo]  Company Name   │  Payslip           │
│         Address/Reg     │  JUNE 2025         │
│                         │  DOC-001           │
├─────────────────────────────────────────────┤
│ EMPLOYEE DETAILS  (warm paper background)   │
│  Name     │ Emp ID   │ Department           │
│  Design.. │ PAN      │ Bank Account         │
├──────────────────────┬──────────────────────┤
│  EARNINGS            │  DEDUCTIONS          │
│  Basic     50,000    │  PF         6,000    │
│  HRA       25,000    │  PT           200    │
│  ─────────────────── │  ─────────────────── │
│ [green bar] 75,000   │ [red bar]   6,200    │
├──────────────────────┴──────────────────────┤
│ NET PAY  (dark accent background)           │
│ NET PAY                                     │
│ Seventy-five thousand only                   │
│                            ₹ 68,800          │
├─────────────────────────────────────────────┤
│ FOOTER                                      │
│ Notes  │  Signature  │  Contact             │
│        │   ───────   │  Email / Phone       │
│        │  Auth. Sig. │                      │
└─────────────────────────────────────────────┘
│  "PAID" watermark (large rotated, faint)    │
└─────────────────────────────────────────────┘
```

## Variables / Data Model

All data is injected at render time as top-level properties — **identical shape to V1** for backward compatibility:

| Variable | Shape | Description |
|---|---|---|
| `pageTitle` | `string` | HTML `<title>` content |
| `company.logo` | `string` | URL/path to company logo (hidden on load error via `onerror`) |
| `company.logoAlt` | `string` | Alt text for the logo |
| `company.name` | `string` | Registered company name |
| `company.details` | `string` | Address / registration info |
| `slip.label` | `string` | Header label (e.g. "Payslip") |
| `slip.month` | `string` | Month label (e.g. "June 2025") |
| `slip.docId` | `string` | Unique document reference |
| `employeeFields` | `Array<{label, value, isMono}>` | Grid of employee details |
| `currency` | `string` | Currency symbol (e.g. "₹", "$") |
| `earnings.title` | `string` | Earnings column heading |
| `earnings.amountTitle` | `string` | Amount sub-heading |
| `earnings.items` | `Array<{label, amount, note?, isDim?}>` | Earnings line items |
| `earnings.totalLabel` | `string` | Total label |
| `earnings.totalAmount` | `string` | Total earnings amount |
| `deductions.title` | `string` | Deductions column heading |
| `deductions.amountTitle` | `string` | Amount sub-heading |
| `deductions.items` | `Array<{label, amount, note?, isDim?}>` | Deductions line items |
| `deductions.totalLabel` | `string` | Total label |
| `deductions.totalAmount` | `string` | Total deductions amount |
| `netPay.label` | `string` | Net section label |
| `netPay.words` | `string` | Amount in words |
| `netPay.amount` | `string` | Net pay value |

## Key Differences from V1

| Aspect | V1 | V2 |
|---|---|---|
| **Width** | 700px fixed | 860px max-width, responsive |
| **Header** | Light background, logo in navy box | Full dark (`#1a1a2e`) background, white text |
| **Typography** | Inter (sans) + JetBrains Mono | Playfair Display (serif) + DM Sans + DM Mono |
| **Color palette** | Saffron/green/navy | Purple accent (`#2d2a7a`), gold, green/red totals |
| **Earnings/Deductions** | Side-by-side tables with `thead` | Side-by-side sections, total bars with tinted backgrounds |
| **Net pay** | Small navy bar (28px font) | Large navy banner (36px serif) |
| **Footer** | Minimal (border-top only) | 3-column grid: notes / signature / contact |
| **Watermark** | None | Faint "PAID" diagonally across slip |
| **Employee section** | Grid inside `.body` | Section with `.section-label` header, warm paper background |
| **Print styles** | None | `@media print` removes shadows/backgrounds |
| **Responsive** | No | `@media (max-width: 700px)` stacks columns vertically |

## Styling

- **Fonts**: Google Fonts — Playfair Display (serif headings), DM Sans (body), DM Mono (mono numbers)
- **Colors**: Deep ink (`#1a1a2e`), purple accent (`#2d2a7a`), gold (`#b8860b`), green (`#0a6e4f`), red (`#7a1a2e`)
- **Background**: Warm paper (`#fdfcfa`) with darker warm section (`#f7f4ee`)
- **Watermark**: Large rotated "PAID" at `2.2%` opacity, `pointer-events: none`
- **Totals**: Green-tinted bar for earnings total, red-tinted bar for deductions total
- **Logo**: Filtered to white via `brightness(0) invert(1)` in header; hidden gracefully on load error
- **Print**: Shadowless, full-width layout when printed

## Dependencies

- **EJS** as the template engine (server-side rendering)
- **Google Fonts** (Playfair Display, DM Sans, DM Mono) — loaded via `<link>` (requires internet or preloaded fallback)
