import { z, ZodError } from 'zod';
import { probationPolicyClient } from '../grpc/probation_policy.client.js';

// NOTE: Permission enforcement (requirePermission) temporarily disabled for
// probation-policy routes — re-enable later once role/permission wiring lands.

const DURATION_UNITS = ['MONTHS', 'WEEKS', 'DAYS'];
const POLICY_TYPES = ['PROBATION', 'INTERNSHIP', 'TRAINEE', 'CONTRACT'];
const COMPLETION_RULES = ['ALL', 'ANY'];
const EVALUATOR_TYPES = ['EMPLOYEE', 'ROLE'];

const auditMeta = (c) => ({
    admin_id: c.get('adminId'),
    ip_address: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || '',
    user_agent: c.req.header('user-agent') || '',
});

// Shared validation for evaluation milestones (Step 2) nested structure.
const evaluationEvaluatorSchema = z.object({
    evaluator_type: z.enum(EVALUATOR_TYPES),
    evaluator_ref_id: z.string({ required_error: 'evaluator_ref_id is required' }),
    evaluator_name: z.string().optional().nullable(),
});

const evaluationLevelSchema = z.object({
    level_order: z.number().int().min(0),
    completion_rule: z.enum(COMPLETION_RULES).optional().default('ALL'),
    reminder_enabled: z.boolean().optional().default(false),
    reminder_after_days: z.number().int().min(0).optional().nullable(),
    evaluators: z.array(evaluationEvaluatorSchema).optional().default([]),
});

const evaluationMilestoneSchema = z.object({
    name: z.string({ required_error: 'Milestone name is required' }).min(1),
    order: z.number().int().min(0).optional(),
    is_final_milestone: z.boolean().optional().default(false),
    automatic_trigger_enabled: z.boolean().optional().default(false),
    trigger_after_days: z.number().int().min(0).optional().nullable(),
    feedback_form_enabled: z.boolean().optional().default(false),
    levels: z.array(evaluationLevelSchema).optional().default([]),
});

const evaluationMilestoneListSchema = z.array(evaluationMilestoneSchema).optional().default([]);

export default function registerProbationPolicyRoutes({ openapi }) {
    const baseProbationPolicySchema = z.object({
        organization_id: z.string({ required_error: 'Organization ID is required' }),
        name: z.string({ required_error: 'Policy name is required' }).min(2, 'Name must have at least 2 characters'),
        description: z.string().optional().nullable(),
        duration_value: z.number().int().min(1, 'duration_value must be a positive integer'),
        duration_unit: z.enum(DURATION_UNITS),
        max_duration_value: z.number().int().min(0).optional(),
        max_duration_unit: z.enum(DURATION_UNITS).optional(),
        end_date_after_completion: z.boolean().optional(),
        is_active: z.boolean().optional(),
        policy_type: z.enum(POLICY_TYPES).optional(),
        employee_category_ids: z.array(z.string()).optional(),

        evaluation_required: z.boolean().optional(),
        show_feedback_form_in_review: z.boolean().optional(),
        share_feedback_with_employee: z.boolean().optional(),
        employee_response_allowed: z.boolean().optional(),
        reviewer_response_allowed: z.boolean().optional(),
        reviewer_recommendations_allowed: z.boolean().optional(),
        auto_confirm_probation: z.boolean().optional(),
        auto_generate_confirmation_letter: z.boolean().optional(),
        is_default: z.boolean().optional(),
        evaluation_milestones: z.array(evaluationMilestoneSchema).optional(),
    });

    const createProbationPolicySchema = baseProbationPolicySchema
        .extend({
            max_duration_value: z.number().int().min(0).optional().default(0),
            max_duration_unit: z.enum(DURATION_UNITS).optional().default('MONTHS'),
            end_date_after_completion: z.boolean().optional().default(false),
            is_active: z.boolean().optional().default(true),
            evaluation_required: z.boolean().optional().default(false),
            show_feedback_form_in_review: z.boolean().optional().default(false),
            share_feedback_with_employee: z.boolean().optional().default(false),
            employee_response_allowed: z.boolean().optional().default(false),
            reviewer_response_allowed: z.boolean().optional().default(false),
            reviewer_recommendations_allowed: z.boolean().optional().default(false),
            auto_confirm_probation: z.boolean().optional().default(false),
            auto_generate_confirmation_letter: z.boolean().optional().default(false),
            is_default: z.boolean().optional().default(false),
            employee_category_ids: z.array(z.string()).optional().default([]),
            policy_type: z.enum(POLICY_TYPES).optional().default('PROBATION'),
            evaluation_milestones: evaluationMilestoneListSchema,
        })
        .strict()
        .superRefine((data, ctx) => {
            if (data.evaluation_required && (!data.evaluation_milestones || !data.evaluation_milestones.length)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['evaluation_milestones'],
                    message: 'At least one evaluation milestone is required when evaluation is enabled',
                });
            }
        });

    const updateProbationPolicySchema = baseProbationPolicySchema.partial().strict();

    const evaluationLevelResponseSchema = z.object({
        level_order: z.number(),
        completion_rule: z.string(),
        reminder_enabled: z.boolean(),
        reminder_after_days: z.number().optional().nullable(),
        evaluators: z.array(evaluationEvaluatorSchema).optional(),
    });

    const evaluationMilestoneResponseSchema = z.object({
        name: z.string(),
        order: z.number(),
        is_final_milestone: z.boolean(),
        automatic_trigger_enabled: z.boolean(),
        trigger_after_days: z.number().optional().nullable(),
        feedback_form_enabled: z.boolean(),
        levels: z.array(evaluationLevelResponseSchema).optional(),
    });

    const probationPolicyResponseSchema = z.object({
        id: z.string(),
        organization_id: z.string(),
        name: z.string(),
        description: z.string().optional().nullable(),
        duration_value: z.number(),
        duration_unit: z.enum(DURATION_UNITS),
        max_duration_value: z.number(),
        max_duration_unit: z.enum(DURATION_UNITS),
        end_date_after_completion: z.boolean(),
        is_active: z.boolean(),
        policy_type: z.enum(POLICY_TYPES).optional(),
        employee_category_ids: z.array(z.string()).optional(),
        employee_categories: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
        evaluation_required: z.boolean().optional(),
        show_feedback_form_in_review: z.boolean().optional(),
        share_feedback_with_employee: z.boolean().optional(),
        employee_response_allowed: z.boolean().optional(),
        reviewer_response_allowed: z.boolean().optional(),
        reviewer_recommendations_allowed: z.boolean().optional(),
        auto_confirm_probation: z.boolean().optional(),
        auto_generate_confirmation_letter: z.boolean().optional(),
        is_default: z.boolean().optional(),
        employee_count: z.number().optional(),
        evaluation_milestones: z.array(evaluationMilestoneResponseSchema).optional(),
        created_at: z.string().optional(),
        updated_at: z.string().optional(),
        deleted_at: z.string().optional(),
    });

    // ----------------------------------------------------
    // POST /probation-policies  → Create probation policy
    // ----------------------------------------------------
    openapi(
        {
            method: 'post',
            path: '/probation-policies',
            tags: ['Probation Policies'],
            summary: 'Create a new probation policy',
            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: createProbationPolicySchema,
                        },
                    },
                },
            },
            responses: {
                201: {
                    description: 'Probation policy created successfully',
                    content: {
                        'application/json': {
                            schema: probationPolicyResponseSchema,
                        },
                    },
                },
                400: { description: 'Validation error' },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = createProbationPolicySchema.parse(body);

                const payload = { ...parsed, ...auditMeta(c) };

                const response = await new Promise((resolve, reject) => {
                    probationPolicyClient.CreateProbationPolicy(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.policy);
                    });
                });

                return c.json(response, 201);
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
                        400,
                    );
                }
                return c.json({ error: error.message || 'Internal server error' }, 500);
            }
        },
    );

    // ----------------------------------------------------
    // GET /probation-policies/{id}  → Get by ID
    // ----------------------------------------------------
    openapi(
        {
            method: 'get',
            path: '/probation-policies/{id}',
            tags: ['Probation Policies'],
            summary: 'Fetch a probation policy by ID',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Policy ID is required' }),
                }),
                query: z.object({
                    organization_id: z.string().optional(),
                }),
            },
            responses: {
                200: {
                    description: 'Probation policy details',
                    content: {
                        'application/json': {
                            schema: probationPolicyResponseSchema,
                        },
                    },
                },
                404: { description: 'Probation policy not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const { organization_id } = c.req.query();

                const response = await new Promise((resolve, reject) => {
                    probationPolicyClient.GetProbationPolicy({ id, organization_id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.policy);
                    });
                });

                if (!response) {
                    return c.json({ error: 'Probation policy not found' }, 404);
                }

                return c.json(response, 200);
            } catch (error) {
                return c.json({ error: error.message || 'Internal server error' }, 500);
            }
        },
    );

    // ----------------------------------------------------
    // GET /probation-policies  → List by organization
    // ----------------------------------------------------
    openapi(
        {
            method: 'get',
            path: '/probation-policies',
            tags: ['Probation Policies'],
            summary: 'List probation policies for an organization',
            request: {
                query: z.object({
                    organization_id: z.string({ required_error: 'Organization ID is required' }),
                    only_active: z.string().optional().default('false'),
                    policy_type: z.enum(POLICY_TYPES).optional(),
                }),
            },
            responses: {
                200: {
                    description: 'List of probation policies',
                    content: {
                        'application/json': {
                            schema: z.object({
                                policies: z.array(probationPolicyResponseSchema),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const query = c.req.valid('query');

                const onlyActive = query.only_active?.toLowerCase() === 'true' ? true : false;

                const response = await new Promise((resolve, reject) => {
                    probationPolicyClient.ListProbationPolicies(
                        {
                            organization_id: query.organization_id,
                            only_active: onlyActive,
                            policy_type: query.policy_type || '',
                        },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        },
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                return c.json({ error: error.message || 'Internal server error' }, 500);
            }
        },
    );

    // ----------------------------------------------------
    // PUT /probation-policies/{id}  → Update policy
    // ----------------------------------------------------
    openapi(
        {
            method: 'put',
            path: '/probation-policies/{id}',
            tags: ['Probation Policies'],
            summary: 'Update a probation policy',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Policy ID is required' }),
                }),
                body: {
                    content: {
                        'application/json': {
                            schema: updateProbationPolicySchema,
                        },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Probation policy updated successfully',
                    content: {
                        'application/json': {
                            schema: probationPolicyResponseSchema,
                        },
                    },
                },
                400: { description: 'Validation error' },
                404: { description: 'Probation policy not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = updateProbationPolicySchema.parse(await c.req.json());

                const existing = await new Promise((resolve, reject) => {
                    probationPolicyClient.GetProbationPolicy(
                        { id, organization_id: body.organization_id },
                        (err, resp) => (err ? reject(err) : resolve(resp.policy)),
                    );
                });

                if (!existing) {
                    return c.json({ error: 'Probation policy not found' }, 404);
                }

                const payload = {
                    id,
                    organization_id: existing.organization_id,
                    name: body.name ?? existing.name,
                    description: body.description !== undefined ? body.description : existing.description,
                    duration_value: body.duration_value ?? existing.duration_value,
                    duration_unit: body.duration_unit ?? existing.duration_unit,
                    max_duration_value: body.max_duration_value ?? existing.max_duration_value,
                    max_duration_unit: body.max_duration_unit ?? existing.max_duration_unit,
                    end_date_after_completion:
                        body.end_date_after_completion ?? existing.end_date_after_completion,
                    is_active: body.is_active ?? existing.is_active,
                    policy_type: body.policy_type ?? existing.policy_type,
                    employee_category_ids:
                        body.employee_category_ids !== undefined
                            ? body.employee_category_ids
                            : (existing.employee_category_ids || []),
                    evaluation_required:
                        body.evaluation_required ?? existing.evaluation_required,
                    show_feedback_form_in_review:
                        body.show_feedback_form_in_review ?? existing.show_feedback_form_in_review,
                    share_feedback_with_employee:
                        body.share_feedback_with_employee ?? existing.share_feedback_with_employee,
                    employee_response_allowed:
                        body.employee_response_allowed ?? existing.employee_response_allowed,
                    reviewer_response_allowed:
                        body.reviewer_response_allowed ?? existing.reviewer_response_allowed,
                    reviewer_recommendations_allowed:
                        body.reviewer_recommendations_allowed ?? existing.reviewer_recommendations_allowed,
                    auto_confirm_probation:
                        body.auto_confirm_probation ?? existing.auto_confirm_probation,
                    auto_generate_confirmation_letter:
                        body.auto_generate_confirmation_letter ?? existing.auto_generate_confirmation_letter,
                    is_default:
                        body.is_default !== undefined ? body.is_default : (existing.is_default || false),
                    evaluation_milestones:
                        body.evaluation_milestones !== undefined
                            ? body.evaluation_milestones
                            : (existing.evaluation_milestones || []),
                    ...auditMeta(c),
                };

                const response = await new Promise((resolve, reject) => {
                    probationPolicyClient.UpdateProbationPolicy(payload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp.policy);
                    });
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
                        400,
                    );
                }
                return c.json({ error: error.message || 'Internal server error' }, 500);
            }
        },
    );

    // ----------------------------------------------------
    // DELETE /probation-policies/{id} → Soft delete policy
    // ----------------------------------------------------
    openapi(
        {
            method: 'delete',
            path: '/probation-policies/{id}',
            tags: ['Probation Policies'],
            summary: 'Soft delete a probation policy',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Policy ID is required' }),
                }),
                query: z.object({
                    organization_id: z.string().optional(),
                }),
            },
            responses: {
                200: {
                    description: 'Probation policy deleted successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
                404: { description: 'Probation policy not found' },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const { organization_id } = c.req.query();

                const response = await new Promise((resolve, reject) => {
                    probationPolicyClient.DeleteProbationPolicy(
                        { id, organization_id, ...auditMeta(c) },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        },
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                return c.json({ error: error.message || 'Internal server error' }, 500);
            }
        },
    );
}
