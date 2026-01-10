import { generateInvoicePDF } from "../pdf/generateInvoicePDF.js";
import { FileService } from "@jury-hrms/files";

export class InvoicePdfService {
    static async generateAndUpload({ invoice, organization, items, totals, usageSummary }) {
        const { pdfBuffer } = await generateInvoicePDF({
            invoiceNumber: invoice.invoiceNumber,
            invoiceDate: invoice.issuedAt?.toISOString().slice(0, 10) ?? "N/A",
            dueDate: invoice.dueDate?.toISOString?.().slice(0, 10) ?? undefined, // optional

            isDraft: invoice.status === "DRAFT",

            company: {
                name: "Jurysoft Global Pvt Ltd",
                website: "https://jurysoft.com",
            },

            customer: {
                name: organization?.name ?? "N/A",
                address: organization?.address ?? "",
            },

            period: {
                start: invoice.billingPeriodStart?.toISOString().slice(0, 10),
                end: invoice.billingPeriodEnd?.toISOString().slice(0, 10),
            },

            items,
            totals,
            usageSummary,
        });

        const uploaded = await FileService.upload(
            pdfBuffer,
            `invoice-${invoice.invoiceNumber}.pdf`,
            "invoices"
        );

        return uploaded;
    }
}
