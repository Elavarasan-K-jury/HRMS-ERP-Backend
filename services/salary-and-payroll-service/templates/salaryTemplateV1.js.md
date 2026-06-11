# salary-and-payroll-service/templates/salaryTemplateV1.js

## Purpose
Sample salary slip data template for EJS rendering — provides demo variable data for payslip template design and testing.

## Structure

The default export is a plain object with the following top-level keys:

| Key | Description |
|---|---|
| `pageTitle` | Document title string |
| `currency` | Currency symbol |
| `company` | Company info: logo URL, name, address/details |
| `slip` | Slip metadata: label, month, document ID |
| `employeeFields` | Array of `{ label, value, isMono? }` for employee details |
| `earnings` | Earnings table: title, items array with label/amount/note/isDim |
| `deductions` | Deductions table: same structure as earnings |
| `netPay` | Net pay summary: label, words (amount in words), amount |

```js
export default {
  pageTitle: "Salary Slip – April 2026",
  currency: "₹",
  company: {
    logo: "https://jury-blogs.jurysoftprojects.com/site-logo-white-2.png",
    name: "TechNova Solutions Pvt. Ltd.",
  },
  earnings: {
    totalLabel: "Gross Pay",
    totalAmount: "81,883",
    items: [
      { label: "Basic Salary", amount: "40,000" },
      { label: "HRA", note: "40%", amount: "16,000" },
    ],
  },
  deductions: {
    totalLabel: "Total Deductions",
    totalAmount: "15,997",
    items: [
      { label: "TDS / Income Tax", amount: "8,240" },
      { label: "PF – Employee", note: "12%", amount: "4,800" },
    ],
  },
  netPay: {
    label: "Net Pay · Take Home",
    words: "Rupees Sixty-Five Thousand Eight Hundred Eighty-Six Only",
    amount: "65,886",
  },
};
```
