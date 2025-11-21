// src/routes/hierarchy.routes.js
import { z } from 'zod';
import { orgClient } from '../grpc/organization.client.js';

export default function registerHierarchyRoutes({ openapi }) {
    /* -------------------------------------------------------
     🧩 Shared Schemas
    ------------------------------------------------------- */

    // ---------- Organization Hierarchy ----------
    const OrgDesignationSchema = z.object({
        id: z.string(),
        name: z.string(),
        department_id: z.string().nullable(),
        description: z.string().nullable(),
    });

    const OrgEmployeeSchema = z.object({
        id: z.string(),
        full_name: z.string(),
        email: z.string().nullable(),
        phone: z.string().nullable(),
        employee_code: z.string().nullable(),
        designation: z.string().nullable(),
        department: z.string().nullable(),
        category: z.string().nullable(),
    });

    const OrgLevelBlockSchema = z.object({
        level: z.string(),           // e.g. "senior_level"
        label: z.string(),           // e.g. "Senior / Specialist Level"
        designation_count: z.number(),
        employee_count: z.number(),
        designations: z.array(OrgDesignationSchema),
        employees: z.array(OrgEmployeeSchema),
    });

    const OrgHierarchyResponseSchema = z.object({
        organization_id: z.string(),
        levels: z.array(OrgLevelBlockSchema),
    });

    // ---------- Department Reporting Hierarchy (Swagger-safe, non-recursive schema) ----------
    // OpenAPI doesn't support infinite recursive schemas, so we keep this shallow for docs.
    const ReportingNodeSchema = z.object({
        id: z.string(),
        full_name: z.string(),
        email: z.string().nullable(),
        phone: z.string().nullable(),
        employee_code: z.string().nullable(),
        designation: z.string().nullable(),
        category: z.string().nullable(),
        // real data is recursive, but for docs we keep this as opaque children:
        reportees: z.array(z.any()),
    });

    const DeptHierarchyResponseSchema = z.object({
        organization_id: z.string(),
        department_id: z.string(),
        hierarchy: ReportingNodeSchema.nullable(),
    });

    /* -------------------------------------------------------
     🟢 Organization Hierarchy (All Levels)
    ------------------------------------------------------- */
    openapi(
        {
            method: 'get',
            path: '/organizations/{organization_id}/hierarchy',
            tags: ['Hierarchy'],
            summary: 'Get organization-wide designation hierarchy',
            description:
                'Returns all employees grouped by designation levels (entry_level → board_level) for a given organization.',
            request: {
                params: z.object({
                    organization_id: z
                        .string({ required_error: 'Organization ID is required' })
                        .describe('Organization ID'),
                }),
            },
            responses: {
                200: {
                    description: 'Organization hierarchy',
                    content: {
                        'application/json': {
                            schema: OrgHierarchyResponseSchema,
                        },
                    },
                },
                400: {
                    description: 'Invalid input',
                    content: {
                        'application/json': {
                            schema: z.object({
                                error: z.string(),
                            }),
                        },
                    },
                },
                500: {
                    description: 'Server error',
                    content: {
                        'application/json': {
                            schema: z.object({
                                error: z.string(),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const { organization_id } = c.req.valid('param');

                const response = await new Promise((resolve, reject) => {
                    orgClient.OrganizationHierarchy(
                        { organization_id },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        },
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                console.error('OrganizationHierarchy error:', error);
                return c.json({ error: error.message || 'Internal error' }, 500);
            }
        },
    );

    /* -------------------------------------------------------
     🟣 Department Reporting Hierarchy
    ------------------------------------------------------- */
    openapi(
        {
            method: 'get',
            path: '/organizations/{organization_id}/departments/{department_id}/hierarchy',
            tags: ['Hierarchy'],
            summary: 'Get reporting hierarchy for a department',
            description:
                'Returns the department head and their recursive reportees as a hierarchy tree.',
            request: {
                params: z.object({
                    organization_id: z
                        .string({ required_error: 'Organization ID is required' }),
                    department_id: z
                        .string({ required_error: 'Department ID is required' }),
                }),
            },
            responses: {
                200: {
                    description: 'Department reporting hierarchy',
                    content: {
                        'application/json': {
                            schema: DeptHierarchyResponseSchema,
                        },
                    },
                },
                400: {
                    description: 'Invalid input',
                    content: {
                        'application/json': {
                            schema: z.object({
                                error: z.string(),
                            }),
                        },
                    },
                },
                500: {
                    description: 'Server error',
                    content: {
                        'application/json': {
                            schema: z.object({
                                error: z.string(),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const { organization_id, department_id } = c.req.valid('param');

                const response = await new Promise((resolve, reject) => {
                    orgClient.DepartmentHierarchy(
                        { organization_id, department_id },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        },
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                console.error('DepartmentHierarchy error:', error);
                return c.json({ error: error.message || 'Internal error' }, 500);
            }
        },
    );
}
