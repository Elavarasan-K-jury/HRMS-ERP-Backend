import { z, ZodError } from 'zod';
import { payslipClient } from '../grpc/payslip.client.js';

export default function registerPayslipRoutes({ openapi }) {
    /* ----------------------------------------------------
     🧩 Shared schemas
    ---------------------------------------------------- */
    const ejsTemplateSchema = z.object({
        name: z.string(),
        path: z.string(),
    });

    const ejsVariableSchema = z.object({
        name: z.string(),
        key: z.string(),
        value: z.string(),
        type: z.string(),
    });

    const dynamicFieldSchema = z.object({
        name: z.string(),
        key: z.string(),
        value: z.string().optional().default(''),
        type: z.string(),
        is_dynamic: z.boolean().optional().default(false),
    });

    const saveTemplateSchema = z.object({
        organization_id: z.string(),
        name: z.string(),
        template_path: z.string().optional().default(''),
        ejs_content: z.string(),
        variables: z.array(dynamicFieldSchema).optional().default([]),
    });

    /* ----------------------------------------------------
     🟡 Get EJS Templates / Read Single Template
    ---------------------------------------------------- */
    openapi(
        {
            method: 'get',
            path: '/payslip-templates',
            tags: ['Payslip Template'],
            summary: 'List Payslip templates or read single payslip template by path',
            request: {
                query: z.object({
                    template_path: z.string().optional().default(''),
                }),
            },
            responses: {
                200: {
                    description: 'Payslip template data fetched successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),

                                template: ejsTemplateSchema.optional(),
                                templates: z.array(ejsTemplateSchema).optional(),

                                ejs_content: z.string().optional(),
                                variables: z.array(ejsVariableSchema).optional(),
                            }),
                        },
                    },
                },
                400: {
                    description: 'Validation error',
                    content: {
                        'application/json': {
                            schema: z.object({
                                error: z.string(),
                                details: z.array(
                                    z.object({
                                        field: z.string(),
                                        message: z.string(),
                                    })
                                ).optional(),
                            }),
                        },
                    },
                },
                404: {
                    description: 'Template not found',
                },
            },
        },
        async (c) => {
            try {
                const query = c.req.valid('query');

                const response = await new Promise((resolve, reject) => {
                    payslipClient.GetEjsTemplate(
                        {
                            template_path: query.template_path || '',
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
                            error: 'Validation failed',
                            details: error.errors.map((e) => ({
                                field: e.path.join('.'),
                                message: e.message,
                            })),
                        },
                        400
                    );
                }

                return c.json(
                    {
                        error: error.message,
                    },
                    error.code === 5 ? 404 : 500
                );
            }
        }
    );

    openapi(
        {
            method: 'post',
            path: '/payslip-templates/save',
            tags: ['Payslip Template'],
            summary: 'Save customized Payslip template with dynamic variables',
            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: saveTemplateSchema,
                        },
                    },
                },
            },
            responses: {
                201: {
                    description: 'Template saved successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                                template_id: z.string(),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = saveTemplateSchema.parse(body);

                const response = await new Promise((resolve, reject) => {
                    payslipClient.SaveEjsTemplate(parsed, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 201);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({
                        error: 'Validation failed',
                        details: error.errors.map((e) => ({
                            field: e.path.join('.'),
                            message: e.message,
                        })),
                    }, 400);
                }

                return c.json({ error: error.message }, 500);
            }
        }
    );

    const renderTemplateSchema = z.object({
        organization_id: z.string(),
    });

    openapi(
        {
            method: 'post',
            path: '/payslip-templates/render',
            tags: ['Payslip Template'],
            summary: 'Render saved Payslip template using organization dynamic data',
            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: renderTemplateSchema,
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Template rendered successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                                html_content: z.string(),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = renderTemplateSchema.parse(body);

                const response = await new Promise((resolve, reject) => {
                    payslipClient.RenderEjsTemplate(parsed, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 200);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({
                        error: 'Validation failed',
                        details: error.errors.map((e) => ({
                            field: e.path.join('.'),
                            message: e.message,
                        })),
                    }, 400);
                }

                return c.json({ error: error.message }, 500);
            }
        }
    );
}