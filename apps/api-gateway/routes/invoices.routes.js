import { z, ZodError } from "zod";
import { invoiceClient } from "../grpc/invoice.client.js";

export default function registerInvoiceRoutes({ openapi }) {
    /* ----------------------------------------------------
       🧩 Schemas
    ---------------------------------------------------- */

    const orgParamSchema = z.object({
        organization_id: z.string().optional(),
    });

    const idParamSchema = z.object({
        id: z.string({ required_error: "Invoice id is required" }),
    });

    const listQuerySchema = z.object({
        page: z.coerce.number().int().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        search: z.string().optional(),
        sort_by: z.enum(["createdAt", "issuedAt", "amount"]).optional(),
        sort_order: z.enum(["asc", "desc"]).optional(),
    });

    const markPaidSchema = z
        .object({
            payment_ref: z.string().optional(),
            payment_provider: z.string().optional(),
        })
        .strict();

    /* ----------------------------------------------------
       🟣 LIST INVOICES (ORG OPTIONAL / ADMIN READY)
    ---------------------------------------------------- */
    openapi(
        {
            method: "get",
            path: "/invoices",
            tags: ["Invoices"],
            summary: "List invoices (optionally filtered by organization)",
            request: {
                query: listQuerySchema.merge(orgParamSchema),
            },
            responses: {
                200: { description: "Invoices retrieved successfully" },
            },
        },
        async (c) => {
            try {
                const query = listQuerySchema.parse(c.req.query());
                const { organization_id } = c.req.query();

                const response = await new Promise((resolve, reject) => {
                    invoiceClient.ListInvoices(
                        {
                            organization_id,
                            page: query.page,
                            limit: query.limit,
                            search: query.search,
                            sort_by: query.sort_by,
                            sort_order:
                                query.sort_order === "asc" ? "ASC" : "DESC",
                        },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        }
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json(
                        {
                            error: "Validation failed",
                            details: error.errors,
                        },
                        400
                    );
                }
                return c.json({ error: error.message }, 500);
            }
        }
    );

    /* ----------------------------------------------------
       🔵 GET INVOICE BY ID (ORG SAFE)
    ---------------------------------------------------- */
    openapi(
        {
            method: "get",
            path: "/invoices/{id}",
            tags: ["Invoices"],
            summary: "Get invoice details by ID",
            request: {
                params: idParamSchema,
                query: orgParamSchema,
            },
            responses: {
                200: { description: "Invoice retrieved successfully" },
                404: { description: "Invoice not found" },
            },
        },
        async (c) => {
            try {
                const { id } = c.req.param();
                const { organization_id } = c.req.query();

                const response = await new Promise((resolve, reject) => {
                    invoiceClient.GetInvoice(
                        { id, organization_id },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        }
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    /* ----------------------------------------------------
       🟢 MARK INVOICE AS PAID
    ---------------------------------------------------- */
    openapi(
        {
            method: "post",
            path: "/invoices/{id}/pay",
            tags: ["Invoices"],
            summary: "Mark invoice as paid",
            request: {
                params: idParamSchema,
                body: {
                    content: {
                        "application/json": {
                            schema: markPaidSchema,
                        },
                    },
                },
            },
            responses: {
                200: { description: "Invoice marked as paid" },
                400: { description: "Invalid request" },
                404: { description: "Invoice not found" },
            },
        },
        async (c) => {
            try {
                const { id } = c.req.param();
                const body = await c.req.json();
                const parsed = markPaidSchema.parse(body);

                const response = await new Promise((resolve, reject) => {
                    invoiceClient.MarkInvoicePaid(
                        {
                            id,
                            payment_ref: parsed.payment_ref,
                            payment_provider: parsed.payment_provider,
                        },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        }
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json(
                        {
                            error: "Validation failed",
                            details: error.errors,
                        },
                        400
                    );
                }
                return c.json({ error: error.message }, 500);
            }
        }
    );

    /* ----------------------------------------------------
       🟠 DOWNLOAD INVOICE PDF
    ---------------------------------------------------- */
    openapi(
        {
            method: "get",
            path: "/invoices/{id}/download",
            tags: ["Invoices"],
            summary: "Download invoice PDF",
            request: {
                params: idParamSchema,
                query: orgParamSchema,
            },
            responses: {
                200: { description: "Invoice PDF downloaded" },
                404: { description: "Invoice or file not found" },
            },
        },
        async (c) => {
            try {
                const { id } = c.req.param();
                const { organization_id } = c.req.query();

                const response = await new Promise((resolve, reject) => {
                    invoiceClient.DownloadInvoice(
                        { id, organization_id },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        }
                    );
                });

                const buffer = Buffer.from(response.data);

                c.header("Content-Type", response.mime_type);
                c.header(
                    "Content-Disposition",
                    `attachment; filename="${response.filename}"`
                );

                return c.body(buffer);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    openapi(
        {
            method: "post",
            path: "/invoices/{id}/regenerate-payment-link",
            tags: ["Invoices"],
            summary: "Regenerate invoice payment link",
            request: {
                params: z.object({
                    id: z.string(),
                }),
            },
            responses: {
                200: { description: "Payment link regenerated" },
                400: { description: "Invalid request" },
                404: { description: "Invoice not found" },
            },
        },
        async (c) => {
            try {
                const { id } = c.req.param();

                const response = await new Promise((resolve, reject) => {
                    invoiceClient.RegenerateInvoicePaymentLink(
                        { invoice_id: id },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        }
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );
}
