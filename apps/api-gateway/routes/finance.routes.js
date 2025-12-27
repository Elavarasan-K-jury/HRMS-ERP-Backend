import { z } from 'zod'
import { financeClient } from '../grpc/finance.client.js'

export default function registerFinanceRoutes({ openapi }) {

    /* =====================================================
       🧩 SHARED SCHEMAS
    ===================================================== */

    const GenericSuccessSchema = z.object({
        success: z.boolean(),
        message: z.string(),
    })

    const FinanceEnabledResponseSchema = z.object({
        success: z.boolean(),
        message: z.string(),
        enabledFinance: z.boolean(),
    })

    const FinanceDetailsSchema = z.object({
        enable_pf: z.boolean(),
        enable_esi: z.boolean(),
        enable_ptax: z.boolean(),

        pf_formula: z.string(),
        pf_registration_number: z.string(),
        pf_registered_organization_name: z.string(),

        esi_formula: z.string(),
        esi_registration_number: z.string(),
        esi_registered_organization_name: z.string(),

        ptax_formula: z.string(),
        ptax_registration_number: z.string(),
        ptax_registered_organization_name: z.string(),
    })

    /* =====================================================
       🟢 CHECK FINANCE ENABLED
    ===================================================== */
    openapi(
        {
            method: 'get',
            path: '/finance/enabled/{organizationId}',
            tags: ['Finance'],
            summary: 'Check if finance module is enabled',

            request: {
                params: z.object({
                    organizationId: z.string(),
                }),
            },

            responses: {
                200: {
                    description: 'Finance enabled status',
                    content: {
                        'application/json': { schema: FinanceEnabledResponseSchema },
                    },
                },
            },
        },

        async (c) => {
            try {
                const { organizationId } = c.req.valid('param')

                const result = await new Promise((resolve, reject) => {
                    financeClient.CheckIfFinanceEnabledOrNot(
                        { organization_id: organizationId },
                        (err, res) => (err ? reject(err) : resolve(res))
                    )
                })

                return c.json(result, 200)
            } catch (error) {
                console.error('❌ Check Finance Enabled Error:', error)
                return c.json({ message: error.message }, 500)
            }
        }
    )

    /* =====================================================
       🟢 ENABLE & SAVE PF DETAILS
    ===================================================== */
    openapi(
        {
            method: 'post',
            path: '/finance/pf',
            tags: ['Finance'],
            summary: 'Enable and save PF configuration',

            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                organization_id: z.string(),
                                pf_formula: z.string(),
                                pf_registration_number: z.string(),
                                pf_registered_organization_name: z.string(),
                            }),
                        },
                    },
                },
            },

            responses: {
                200: {
                    description: 'PF enabled successfully',
                    content: {
                        'application/json': { schema: GenericSuccessSchema },
                    },
                },
            },
        },

        async (c) => {
            try {
                const body = c.req.valid('json')

                const result = await new Promise((resolve, reject) => {
                    financeClient.EnableAndSavePfDetails(body, (err, res) =>
                        err ? reject(err) : resolve(res)
                    )
                })

                return c.json(result, 200)
            } catch (error) {
                console.error('❌ Enable PF Error:', error)
                return c.json({ message: error.message }, 500)
            }
        }
    )

    /* =====================================================
       🟢 ENABLE & SAVE ESI DETAILS
    ===================================================== */
    openapi(
        {
            method: 'post',
            path: '/finance/esi',
            tags: ['Finance'],
            summary: 'Enable and save ESI configuration',

            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                organization_id: z.string(),
                                esi_formula: z.string(),
                                esi_registration_number: z.string(),
                                esi_registered_organization_name: z.string(),
                            }),
                        },
                    },
                },
            },

            responses: {
                200: {
                    description: 'ESI enabled successfully',
                    content: {
                        'application/json': { schema: GenericSuccessSchema },
                    },
                },
            },
        },

        async (c) => {
            try {
                const body = c.req.valid('json')

                const result = await new Promise((resolve, reject) => {
                    financeClient.EnableAndSaveEsiDetails(body, (err, res) =>
                        err ? reject(err) : resolve(res)
                    )
                })

                return c.json(result, 200)
            } catch (error) {
                console.error('❌ Enable ESI Error:', error)
                return c.json({ message: error.message }, 500)
            }
        }
    )
    openapi(
        {
            method: 'put',
            path: '/finance/esi/activity',
            tags: ['Finance'],
            summary: 'Enable and disable ESI configuration',

            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                organization_id: z.string(),
                                activity: z.boolean()
                            }),
                        },
                    },
                },
            },

            responses: {
                200: {
                    description: 'ESI enabled successfully',
                    content: {
                        'application/json': { schema: GenericSuccessSchema },
                    },
                },
            },
        },

        async (c) => {
            try {
                const body = c.req.valid('json')

                const result = await new Promise((resolve, reject) => {
                    financeClient.EnableDisableEsiDetails(body, (err, res) =>
                        err ? reject(err) : resolve(res)
                    )
                })

                return c.json(result, 200)
            } catch (error) {
                console.error('❌ Enable ESI Error:', error)
                return c.json({ message: error.message }, 500)
            }
        }
    )
    openapi(
        {
            method: 'put',
            path: '/finance/pf/activity',
            tags: ['Finance'],
            summary: 'Enable and disable PF configuration',

            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                organization_id: z.string(),
                                activity: z.boolean()
                            }),
                        },
                    },
                },
            },

            responses: {
                200: {
                    description: 'PF enabled successfully',
                    content: {
                        'application/json': { schema: GenericSuccessSchema },
                    },
                },
            },
        },

        async (c) => {
            try {
                const body = c.req.valid('json')

                const result = await new Promise((resolve, reject) => {
                    financeClient.EnableDisablePfDetails(body, (err, res) =>
                        err ? reject(err) : resolve(res)
                    )
                })

                return c.json(result, 200)
            } catch (error) {
                console.error('❌ Enable PF Error:', error)
                return c.json({ message: error.message }, 500)
            }
        }
    )
    openapi(
        {
            method: 'put',
            path: '/finance/ptax/activity',
            tags: ['Finance'],
            summary: 'Enable and disable PTAX configuration',

            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                organization_id: z.string(),
                                activity: z.boolean()
                            }),
                        },
                    },
                },
            },

            responses: {
                200: {
                    description: 'PTAX enabled successfully',
                    content: {
                        'application/json': { schema: GenericSuccessSchema },
                    },
                },
            },
        },

        async (c) => {
            try {
                const body = c.req.valid('json')

                const result = await new Promise((resolve, reject) => {
                    financeClient.EnableDisablePtaxDetails(body, (err, res) =>
                        err ? reject(err) : resolve(res)
                    )
                })

                return c.json(result, 200)
            } catch (error) {
                console.error('❌ Enable PTAX Error:', error)
                return c.json({ message: error.message }, 500)
            }
        }
    )

    /* =====================================================
       🟢 ENABLE & SAVE PTAX DETAILS
    ===================================================== */
    openapi(
        {
            method: 'post',
            path: '/finance/ptax',
            tags: ['Finance'],
            summary: 'Enable and save PTAX configuration',

            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                organization_id: z.string(),
                                ptax_formula: z.string(),
                                ptax_registration_number: z.string(),
                                ptax_registered_organization_name: z.string(),
                            }),
                        },
                    },
                },
            },

            responses: {
                200: {
                    description: 'PTAX enabled successfully',
                    content: {
                        'application/json': { schema: GenericSuccessSchema },
                    },
                },
            },
        },

        async (c) => {
            try {
                const body = c.req.valid('json')

                const result = await new Promise((resolve, reject) => {
                    financeClient.EnableAndSavePtaxDetails(body, (err, res) =>
                        err ? reject(err) : resolve(res)
                    )
                })

                return c.json(result, 200)
            } catch (error) {
                console.error('❌ Enable PTAX Error:', error)
                return c.json({ message: error.message }, 500)
            }
        }
    )

    /* =====================================================
       🟢 GET FINANCE DETAILS
    ===================================================== */
    openapi(
        {
            method: 'get',
            path: '/finance/details/{organizationId}',
            tags: ['Finance'],
            summary: 'Fetch organization finance configuration',

            request: {
                params: z.object({
                    organizationId: z.string(),
                }),
            },

            responses: {
                200: {
                    description: 'Finance configuration',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                                financeEnabled: z.boolean(),
                                finance: FinanceDetailsSchema.nullable(),
                            }),
                        },
                    },
                },
            },
        },

        async (c) => {
            try {
                const { organizationId } = c.req.valid('param')

                const result = await new Promise((resolve, reject) => {
                    financeClient.GetOrganizationFinanceDetails(
                        { organization_id: organizationId },
                        (err, res) => (err ? reject(err) : resolve(res))
                    )
                })

                return c.json(result, 200)
            } catch (error) {
                console.error('❌ Get Finance Details Error:', error)
                return c.json({ message: error.message }, 500)
            }
        }
    )
}
