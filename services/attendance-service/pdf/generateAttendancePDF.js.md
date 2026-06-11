# Generate Attendance PDF

## Purpose
Uses Puppeteer (headless Chrome) to render the attendance report HTML into a landscape A4 PDF buffer.

```js
export async function generateAttendancePDF({ reportId, days, summary }) {
    const html = renderAttendanceHTML({ reportId, days, summary });
    const browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--single-process"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        landscape: true,
        margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
    });
    await browser.close();
    return pdfBuffer;
}
```
