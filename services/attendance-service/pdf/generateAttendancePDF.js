// services/attendance/pdf/generateAttendancePDF.js

import puppeteer from "puppeteer";
import { renderAttendanceHTML } from "./renderAttendanceHTML.js";

/**
 * Generate Attendance Report PDF (multi-employee)
 * @param {Object} params
 * @param {String} params.reportId
 * @param {Array} params.days
 * @param {Object} params.summary {start, end}
 * @returns {Buffer} PDF Buffer
 */
export async function generateAttendancePDF({ reportId, days, summary }) {
    console.log(`📄 Generating PDF for report: ${reportId}`);

    // 1️⃣ Render full HTML content
    const html = renderAttendanceHTML({ days, summary });

    // 2️⃣ Launch headless browser
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
        ],
    });

    try {
        const page = await browser.newPage();

        // 3️⃣ Set HTML content
        await page.setContent(html, {
            waitUntil: "networkidle0",
        });

        // 4️⃣ Generate PDF buffer
        const pdfBuffer = await page.pdf({
            format: "A4",
            printBackground: true,
            landscape: true,   // 👈 this
            margin: {
                top: "12mm",
                bottom: "12mm",
                left: "10mm",
                right: "10mm",
            },
        });

        console.log(`✅ PDF Generated for report: ${reportId}`);

        return pdfBuffer;

    } finally {
        await browser.close();
    }
}
