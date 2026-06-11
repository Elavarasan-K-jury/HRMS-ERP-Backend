# salary-and-payroll-service/templates/salaryTemplateV2.js

## Purpose
Identical structure to `salaryTemplateV1.js` — provides a second sample salary slip dataset (same demo data) for EJS template testing and design iteration.

## Structure

The default export uses the same shape as V1:

```js
export default {
  pageTitle: "Salary Slip – April 2026",
  currency: "₹",
  company: {
    logo: "https://jury-blogs.jurysoftprojects.com/site-logo-white-2.png",
    name: "TechNova Solutions Pvt. Ltd.",
  },
  // employeeFields, earnings, deductions, netPay — same structure as V1
};
```

The data is currently identical to V1 (both representing the same employee "Priya Venkataraman" for April 2026). The separation into V1 and V2 allows for future template versioning or A/B testing of different payslip designs.
