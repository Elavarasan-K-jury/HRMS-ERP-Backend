import puppeteer from "puppeteer";
import { renderInvoiceHTML } from "./renderInvoiceHTML.js";

/**
 * Generate Invoice PDF
 * @param {Object} invoiceData
 * @returns {Buffer}
 */
export async function generateInvoicePDF(invoiceData) {
    console.trace("⚠️ generateInvoicePDF called");
    console.log(`📄 Generating Invoice PDF: ${invoiceData.invoiceNumber}`);

    /**
     * ✅ CLONE INPUT (never mutate original)
     */
    const data = structuredClone(invoiceData);

    /**
     * ✅ SAFELY FORMAT ADDRESS
     */
    if (data.customer?.address && typeof data.customer.address === "object") {
        const a = data.customer.address;

        data.customer.address = [
            a.streetNumber,
            a.streetName,
            a.area,
            a.locality,
            a.city,
            a.state,
            a.postalCode,
            a.country,
        ].filter(Boolean).join(", ");
    }

    /**
     * ✅ Render HTML
     */
    const html = renderInvoiceHTML(data);

    /**
     * ⚠️ NOTE:
     * You should eventually switch this to a singleton browser
     * (we discussed earlier), but keeping minimal change now
     */
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--single-process",
        ],
    });

    try {
        const page = await browser.newPage();

        await page.setContent(html, {
            waitUntil: "domcontentloaded",
        });

        const pdfBuffer = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: {
                top: "12mm",
                bottom: "12mm",
                left: "10mm",
                right: "10mm",
            },
        });

        console.log(`✅ Invoice PDF generated: ${data.invoiceNumber}`);
        return { pdfBuffer, buffer: Buffer.from(pdfBuffer) };

    } finally {
        await browser.close();
    }
}
