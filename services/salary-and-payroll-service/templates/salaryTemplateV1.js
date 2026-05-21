export default {
  pageTitle: "Salary Slip – April 2026",
  currency: "₹",

  company: {
    logo: "https://jury-blogs.jurysoftprojects.com/site-logo-white-2.png",
    logoAlt: "Logo",
    name: "TechNova Solutions Pvt. Ltd.",
    details: "CIN: U72900KA2018PTC123456 · 12, Outer Ring Road, Bengaluru – 560 103"
  },

  slip: {
    label: "Salary Slip",
    month: "April 2026",
    docId: "SS/2026-04/00218"
  },

  employeeFields: [
    { label: "Employee Name", value: "Priya Venkataraman" },
    { label: "Employee ID", value: "TNS-00218" },
    { label: "Designation", value: "Sr. Software Engineer" },
    { label: "Department", value: "Engineering" },
    { label: "Date of Joining", value: "02 Aug 2022" },
    { label: "Pay Period", value: "01 – 30 Apr 2026" },
    { label: "PAN", value: "BVKPV4321N", isMono: true },
    { label: "UAN (PF)", value: "100912345678", isMono: true },
    { label: "Bank A/C", value: "HDFC ···· ···· 3390", isMono: true },
    { label: "PF Account No.", value: "KN/BN/123456/0218", isMono: true },
    { label: "Tax Regime", value: "New Regime (FY 26)" },
    { label: "Payment Date", value: "30 Apr 2026" }
  ],

  earnings: {
    title: "Earnings",
    amountTitle: "Amount (₹)",
    totalLabel: "Gross Pay",
    totalAmount: "81,883",
    items: [
      { label: "Basic Salary", amount: "40,000" },
      { label: "HRA", note: "40%", amount: "16,000" },
      { label: "Special Allowance", amount: "14,200" },
      { label: "Conveyance Allowance", amount: "1,600", isDim: true },
      { label: "Medical Allowance", amount: "1,250", isDim: true },
      { label: "LTA", amount: "3,333", isDim: true },
      { label: "Performance Bonus", amount: "5,000", isDim: true },
      { label: "Internet Allowance", amount: "500", isDim: true }
    ]
  },

  deductions: {
    title: "Deductions",
    amountTitle: "Amount (₹)",
    totalLabel: "Total Deductions",
    totalAmount: "15,997",
    items: [
      { label: "TDS / Income Tax", amount: "8,240" },
      { label: "PF – Employee", note: "12%", amount: "4,800" },
      { label: "ESI – Employee", note: "N/A", amount: "—", isDim: true },
      { label: "Professional Tax", amount: "200" },
      { label: "Gratuity", note: "4.81%", amount: "1,924", isDim: true },
      { label: "Group Health Insurance", amount: "833", isDim: true },
      { label: "Advance Recovery", amount: "0", isDim: true },
      { label: "Other Deductions", amount: "0", isDim: true }
    ]
  },

  netPay: {
    label: "Net Pay · Take Home",
    words: "Rupees Sixty-Five Thousand Eight Hundred Eighty-Six Only",
    amount: "65,886"
  },
}