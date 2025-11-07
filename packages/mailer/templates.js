export function otpHtml(otp, ttlMinutes = 5) {
    return `
  <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color:#0b1220;">
    <h2 style="margin:0 0 8px">Your Jury HRMS OTP</h2>
    <p style="margin:0 0 12px">Use this code to log in. It expires in ${ttlMinutes} minutes.</p>
    <div style="display:inline-block;background:#0b1220;color:#fff;padding:10px 18px;border-radius:10px;
                font-weight:700;letter-spacing:2px;font-size:20px;">
      ${otp}
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#5b6476">If you didn’t request this, you can ignore this email.</p>
  </div>
  `;
}
