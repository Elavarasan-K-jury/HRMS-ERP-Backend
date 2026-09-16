export function otpHtml(otp, ttlMinutes = 5) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <style>
      .body-wrap {
        background-color: #f9fafb;
        padding: 40px 20px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .container {
        max-width: 480px;
        margin: 0 auto;
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 40px;
        text-align: left;
      }
      .label-top {
        color: #6b7280;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 8px;
        display: block;
      }
      .title {
        color: #111827;
        font-size: 22px;
        font-weight: 600;
        margin: 0 0 12px 0;
        letter-spacing: -0.02em;
      }
      .description {
        color: #374151;
        font-size: 15px;
        line-height: 1.5;
        margin-bottom: 32px;
      }
      .otp-container {
        background-color: #f3f4f6;
        border-radius: 8px;
        padding: 24px;
        text-align: center;
        margin-bottom: 32px;
      }
      .otp-code {
        font-family: 'SF Mono', 'Menlo', 'Courier New', monospace;
        font-size: 32px;
        font-weight: 700;
        color: #111827;
        letter-spacing: 4px;
      }
      .footer-text {
        font-size: 13px;
        color: #9ca3af;
        line-height: 1.4;
        border-top: 1px solid #f3f4f6;
        padding-top: 24px;
      }
    </style>
  </head>
  <body>
    <div class="body-wrap">
      <div class="container">
        <span class="label-top">Security Protocol</span>
        <h1 class="title">Verification Code</h1>
        <p class="description">
          Please use the following code to complete your login to <strong>Jury HRMS</strong>. 
          This code is valid for the next ${ttlMinutes} minutes.
        </p>
        
        <div class="otp-container">
          <div class="otp-code">${otp}</div>
        </div>

        <div class="footer-text">
          If you did not attempt to sign in, please ignore this email or contact security if you have concerns.
          <br><br>
          &copy; 2025 Jury HRMS
        </div>
      </div>
    </div>
  </body>
  </html>
  `;
}

export function generateWelcomeEmail({
  employeeName,
  employeeEmail,
  accessLevel = "Standard Employee",
  loginUrl,
  companyName,
  supportEmail = "support@company.com",
  logoUrl = null, // optional: pass custom logo URL
  showQuickTips = false, // toggle the tips section
  customMessage = null // optional: override default greeting message
}) {
  const defaultMessage = `We're absolutely thrilled to have you join the team! Your workspace is all set up and ready to go. Here's everything you need to dive in.`;

  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            padding: 60px 20px;
        }
        .container { 
            max-width: 600px; 
            margin: 0 auto; 
            background: #ffffff; 
            border-radius: 20px; 
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        }
        
        .hero { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 48px 40px;
            position: relative;
            overflow: hidden;
        }
        .hero::before {
            content: '';
            position: absolute;
            top: -50%;
            right: -20%;
            width: 400px;
            height: 400px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 50%;
        }
        .logo { 
            width: 48px; 
            height: 48px; 
            ${logoUrl ? `background-image: url(${logoUrl}); background-size: cover; background-position: center;` : 'background: #ffffff;'}
            border-radius: 12px;
            margin-bottom: 24px;
            position: relative;
            z-index: 1;
        }
        .hero h1 { 
            color: #ffffff; 
            font-size: 32px; 
            font-weight: 700; 
            letter-spacing: -0.03em;
            position: relative;
            z-index: 1;
            line-height: 1.2;
        }
        .hero p {
            color: rgba(255, 255, 255, 0.9);
            font-size: 16px;
            margin-top: 12px;
            position: relative;
            z-index: 1;
        }
        
        .content { 
            padding: 48px 40px;
        }
        .greeting {
            color: #1f2937;
            font-size: 17px;
            line-height: 1.7;
            margin-bottom: 24px;
        }
        
        .credentials-card { 
            background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
            border: 2px solid #e2e8f0;
            border-radius: 16px; 
            padding: 32px;
            margin: 32px 0;
            position: relative;
        }
        .credentials-card::before {
            content: '🔐';
            position: absolute;
            top: -20px;
            right: 32px;
            font-size: 32px;
            background: white;
            width: 56px;
            height: 56px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        
        .cred-item { 
            margin-bottom: 20px;
        }
        .cred-item:last-child { 
            margin-bottom: 0;
        }
        .cred-label { 
            color: #64748b;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            font-weight: 600;
            margin-bottom: 6px;
            display: block;
        }
        .cred-value { 
            color: #0f172a;
            font-size: 16px;
            font-weight: 600;
            font-family: 'SF Mono', 'Menlo', 'Monaco', monospace;
            background: #ffffff;
            padding: 12px 16px;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
            display: inline-block;
        }
        
        .cta-button { 
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #ffffff !important;
            padding: 16px 36px;
            border-radius: 12px;
            text-decoration: none;
            font-weight: 600;
            font-size: 16px;
            margin-top: 8px;
            box-shadow: 0 4px 16px rgba(102, 126, 234, 0.4);
            transition: all 0.3s ease;
            text-align: center;
            display: block;
        }
        
        .quick-tips {
            background: #fef3c7;
            border-left: 4px solid #fbbf24;
            padding: 20px 24px;
            border-radius: 8px;
            margin: 32px 0;
        }
        .quick-tips h3 {
            color: #92400e;
            font-size: 14px;
            font-weight: 700;
            margin-bottom: 12px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .quick-tips ul {
            list-style: none;
            margin: 0;
            padding: 0;
        }
        .quick-tips li {
            color: #78350f;
            font-size: 14px;
            padding: 6px 0;
            padding-left: 24px;
            position: relative;
        }
        .quick-tips li::before {
            content: '✓';
            position: absolute;
            left: 0;
            color: #fbbf24;
            font-weight: bold;
        }
        
        .footer { 
            background: #f8fafc;
            padding: 32px 40px;
            text-align: center;
        }
        .footer-text {
            color: #64748b;
            font-size: 13px;
            line-height: 1.6;
            margin-bottom: 8px;
        }
        .footer-link {
            color: #667eea;
            text-decoration: none;
            font-weight: 600;
        }
        .social-links {
            margin-top: 20px;
        }
        .social-links a {
            display: inline-block;
            width: 36px;
            height: 36px;
            background: #e2e8f0;
            border-radius: 50%;
            margin: 0 6px;
            text-decoration: none;
        }
        
        @media (max-width: 640px) {
            body { padding: 20px 12px; }
            .hero { padding: 32px 24px; }
            .content { padding: 32px 24px; }
            .hero h1 { font-size: 26px; }
            .credentials-card { padding: 24px; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="hero">
            <div class="logo"></div>
            <h1>Welcome aboard! 🚀</h1>
            <p>Your journey starts here</p>
        </div>
        
        <div class="content">
            <div class="greeting">
                <p>Hey <strong>${employeeName}</strong>,</p>
                <p style="margin-top: 16px;">${customMessage || defaultMessage}</p>
            </div>
            
            <div class="credentials-card">
                <div class="cred-item">
                    <span class="cred-label">Your Email</span>
                    <div class="cred-value">${employeeEmail}</div>
                </div>
                <div class="cred-item">
                    <span class="cred-label">Designation</span>
                    <div class="cred-value">${accessLevel}</div>
                </div>
            </div>
            
            <a href="${loginUrl}" class="cta-button">Access Your Workspace →</a>
            
            ${showQuickTips ? `
            <div class="quick-tips">
                <h3>Quick Start Tips</h3>
                <ul>
                    <li>Complete your profile within the first 24 hours</li>
                    <li>Enable two-factor authentication for extra security</li>
                    <li>Check out the getting started guide in the dashboard</li>
                </ul>
            </div>
            ` : ''}
        </div>
        
        <div class="footer">
            <p class="footer-text">Need help getting started? Our support team is here for you.</p>
            <p class="footer-text">Reach out to <a href="mailto:${supportEmail}" class="footer-link">${supportEmail}</a> or reply to this email.</p>
            <div class="social-links">
                <a href="#"></a>
                <a href="#"></a>
                <a href="#"></a>
            </div>
            <p class="footer-text" style="margin-top: 20px; font-size: 12px;">&copy; 2025 ${companyName}. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
  `.trim();
}

// Usage example:
/*
const html = generateWelcomeEmail({
  employeeName: "Sarah Chen",
  employeeEmail: "sarah.chen@company.com",
  accessLevel: "Senior Developer",
  loginUrl: "https://app.company.com/login",
  companyName: "Jury HRMS",
  supportEmail: "support@juryhrms.com",
  showQuickTips: true
});

// Send via your email service
await sendEmail({
  to: "sarah.chen@company.com",
  subject: "Welcome to Jury HRMS! 🎉",
  html: html
});
*/

export function financeEnabledHtml(userName = "there") {
  const year = new Date().getFullYear();

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <style>
      .body-wrap {
        background-color: #f9fafb;
        padding: 40px 20px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .container {
        max-width: 480px;
        margin: 0 auto;
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 40px;
        text-align: left;
      }
      .label-top {
        color: #6b7280;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 8px;
        display: block;
      }
      .title {
        color: #111827;
        font-size: 22px;
        font-weight: 600;
        margin: 0 0 12px 0;
        letter-spacing: -0.02em;
      }
      .description {
        color: #374151;
        font-size: 15px;
        line-height: 1.5;
        margin-bottom: 32px;
      }
      .feature-list {
        background-color: #f3f4f6;
        border-radius: 8px;
        padding: 4px 24px;
        margin-bottom: 32px;
        list-style: none;
      }
      .feature-list li {
        font-size: 14px;
        color: #374151;
        padding: 12px 0;
        border-bottom: 1px solid #e5e7eb;
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .feature-list li:last-child {
        border-bottom: none;
      }
      .check {
        color: #16a34a;
        font-weight: 700;
        font-size: 13px;
        flex-shrink: 0;
      }
      .footer-text {
        font-size: 13px;
        color: #9ca3af;
        line-height: 1.4;
        border-top: 1px solid #f3f4f6;
        padding-top: 24px;
      }
    </style>
  </head>
  <body>
    <div class="body-wrap">
      <div class="container">
        <span class="label-top">Feature Update</span>
        <h1 class="title">Finance Has Been Enabled</h1>
        <p class="description">
          Hi <strong>${userName}</strong>, the Finance module is now active on your
          <strong>Jury HRMS</strong> account. You can start using all finance features right away.
        </p>

        <ul class="feature-list">
          <li><span class="check">✓</span> Payroll processing and salary management</li>
          <li><span class="check">✓</span> Employee expense claims and reimbursements</li>
          <li><span class="check">✓</span> Departmental budget tracking and alerts</li>
          <li><span class="check">✓</span> Financial reports and audit-ready exports</li>
        </ul>

        <div class="footer-text">
          If you did not request this change, please contact your administrator immediately.
          <br><br>
          &copy; ${year} Jury HRMS
        </div>
      </div>
    </div>
  </body>
  </html>
  `;
}

export function expenseRequestHtml(expense) {
  const employee = expense.employee;
  const year = new Date().getFullYear();

  const formatAmount = (amount) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amount);

  const formatDate = (date) =>
    new Date(date).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  const typeLabel = {
    OTHER: "Other",
    TRAVEL: "Travel",
    FOOD: "Food & Beverage",
    ACCOMMODATION: "Accommodation",
    EQUIPMENT: "Equipment",
  }[expense.type] ?? expense.type;

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <style>
      .body-wrap {
        background-color: #f9fafb;
        padding: 40px 20px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .container {
        max-width: 480px;
        margin: 0 auto;
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 40px;
        text-align: left;
      }
      .label-top {
        color: #6b7280;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 8px;
        display: block;
      }
      .title {
        color: #111827;
        font-size: 22px;
        font-weight: 600;
        margin: 0 0 12px 0;
        letter-spacing: -0.02em;
      }
      .description {
        color: #374151;
        font-size: 15px;
        line-height: 1.5;
        margin-bottom: 32px;
      }
      .details-box {
        background-color: #f3f4f6;
        border-radius: 8px;
        padding: 4px 24px;
        margin-bottom: 32px;
        list-style: none;
      }
      .detail-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 0;
        border-bottom: 1px solid #e5e7eb;
        font-size: 14px;
      }
      .detail-row:last-child {
        border-bottom: none;
      }
      .detail-label {
        color: #6b7280;
        font-weight: 500;
      }
      .detail-value {
        color: #111827;
        font-weight: 600;
        text-align: right;
      }
      .amount-value {
        color: #111827;
        font-size: 16px;
        font-weight: 700;
      }
      .status-badge {
        display: inline-block;
        background-color: #fef9c3;
        color: #854d0e;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        padding: 3px 10px;
        border-radius: 20px;
      }
      .footer-text {
        font-size: 13px;
        color: #9ca3af;
        line-height: 1.4;
        border-top: 1px solid #f3f4f6;
        padding-top: 24px;
      }
    </style>
  </head>
  <body>
    <div class="body-wrap">
      <div class="container">
        <span class="label-top">Expense Request</span>
        <h1 class="title">New Expense Raised</h1>
        <p class="description">
          A new expense request has been submitted by <strong>${employee.fullName}</strong> 
          and is awaiting your approval.
        </p>

        <div class="details-box">
          <div class="detail-row">
            <span class="detail-label">Employee</span>
            <span class="detail-value">${employee.fullName} (${employee.employeeCode})</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Category</span>
            <span class="detail-value">${typeLabel}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Amount</span>
            <span class="detail-value amount-value">${formatAmount(expense.amount)}</span>
          </div>
          ${expense.description ? `
          <div class="detail-row">
            <span class="detail-label">Description</span>
            <span class="detail-value">${expense.description}</span>
          </div>` : ""}
          <div class="detail-row">
            <span class="detail-label">Submitted On</span>
            <span class="detail-value">${formatDate(expense.createdAt)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Status</span>
            <span class="detail-value"><span class="status-badge">${expense.status}</span></span>
          </div>
        </div>

        <div class="footer-text">
          Please review and take action on this request at your earliest convenience.
          <br><br>
          &copy; ${year} Jury HRMS
        </div>
      </div>
    </div>
  </body>
  </html>
  `;
}

export function expenseStatusHtml(expense) {
  const employee = expense.employee;
  const approver = expense.approver;
  const isApproved = expense.status === 'APPROVED';
  const year = new Date().getFullYear();

  const formatAmount = (amount) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amount);

  const formatDate = (date) =>
    new Date(date).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  const typeLabel = {
    OTHER: "Other",
    TRAVEL: "Travel",
    FOOD: "Food & Beverage",
    ACCOMMODATION: "Accommodation",
    EQUIPMENT: "Equipment",
  }[expense.type] ?? expense.type;

  const statusBadgeStyle = isApproved
    ? "background-color:#dcfce7;color:#15803d;"
    : "background-color:#fee2e2;color:#b91c1c;";

  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <style>
      .body-wrap {
        background-color: #f9fafb;
        padding: 40px 20px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .container {
        max-width: 480px;
        margin: 0 auto;
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 40px;
        text-align: left;
      }
      .label-top {
        color: #6b7280;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 8px;
        display: block;
      }
      .title {
        color: #111827;
        font-size: 22px;
        font-weight: 600;
        margin: 0 0 12px 0;
        letter-spacing: -0.02em;
      }
      .description {
        color: #374151;
        font-size: 15px;
        line-height: 1.5;
        margin-bottom: 32px;
      }
      .details-box {
        background-color: #f3f4f6;
        border-radius: 8px;
        padding: 4px 24px;
        margin-bottom: 32px;
        list-style: none;
      }
      .detail-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 0;
        border-bottom: 1px solid #e5e7eb;
        font-size: 14px;
      }
      .detail-row:last-child {
        border-bottom: none;
      }
      .detail-label {
        color: #6b7280;
        font-weight: 500;
      }
      .detail-value {
        color: #111827;
        font-weight: 600;
        text-align: right;
      }
      .amount-value {
        font-size: 16px;
        font-weight: 700;
      }
      .status-badge {
        display: inline-block;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        padding: 3px 10px;
        border-radius: 20px;
        ${statusBadgeStyle}
      }
      .footer-text {
        font-size: 13px;
        color: #9ca3af;
        line-height: 1.4;
        border-top: 1px solid #f3f4f6;
        padding-top: 24px;
      }
    </style>
  </head>
  <body>
    <div class="body-wrap">
      <div class="container">
        <span class="label-top">Expense Update</span>
        <h1 class="title">Expense ${isApproved ? 'Approved' : 'Rejected'}</h1>
        <p class="description">
          Hi <strong>${employee.fullName}</strong>, your expense request has been
          <strong>${isApproved ? 'approved' : 'rejected'}</strong>.
          ${isApproved
      ? 'The reimbursement will be processed in your next payroll cycle.'
      : 'Please reach out to your manager or HR if you have any questions.'}
        </p>

        <div class="details-box">
          <div class="detail-row">
            <span class="detail-label">Category</span>
            <span class="detail-value">${typeLabel}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Amount</span>
            <span class="detail-value amount-value">${formatAmount(expense.amount)}</span>
          </div>
          ${expense.description ? `
          <div class="detail-row">
            <span class="detail-label">Description</span>
            <span class="detail-value">${expense.description}</span>
          </div>` : ''}
          <div class="detail-row">
            <span class="detail-label">Submitted On</span>
            <span class="detail-value">${formatDate(expense.createdAt)}</span>
          </div>
          ${expense.approvedAt ? `
          <div class="detail-row">
            <span class="detail-label">${isApproved ? 'Approved' : 'Rejected'} On</span>
            <span class="detail-value">${formatDate(expense.approvedAt)}</span>
          </div>` : ''}
          ${approver ? `
          <div class="detail-row">
            <span class="detail-label">${isApproved ? 'Approved' : 'Rejected'} By</span>
            <span class="detail-value">${approver.fullName}</span>
          </div>` : ''}
          <div class="detail-row">
            <span class="detail-label">Status</span>
            <span class="detail-value">
              <span class="status-badge">${expense.status}</span>
            </span>
          </div>
        </div>

        <div class="footer-text">
          This is an automated notification from Jury HRMS. Please do not reply to this email.
          <br><br>
          &copy; ${year} Jury HRMS
        </div>
      </div>
    </div>
  </body>
  </html>
  `;
}