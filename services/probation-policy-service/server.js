import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
import { calculateProbationEndDate } from './dateUtils.js';
dotenv.config();

const PORT = Number(process.env.PROBATION_POLICY_SERVICE_PORT || 50069);
const probationPolicyProto = loadProto('probation_policy');

const DURATION_UNITS = ['MONTHS', 'WEEKS', 'DAYS'];
const POLICY_TYPES = ['PROBATION', 'INTERNSHIP', 'TRAINEE', 'CONTRACT'];

export { calculateProbationEndDate };

function validateDuration({ durationValue, durationUnit, maxDurationValue, maxDurationUnit }) {
    if (!Number.isInteger(durationValue) || durationValue <= 0) {
        throw { code: grpc.status.INVALID_ARGUMENT, message: 'duration_value must be a positive integer' };
    }
    if (!DURATION_UNITS.includes(durationUnit)) {
        throw { code: grpc.status.INVALID_ARGUMENT, message: `duration_unit must be one of ${DURATION_UNITS.join(', ')}` };
    }
    if (maxDurationValue !== undefined && maxDurationValue !== null && (typeof maxDurationValue !== 'number' || maxDurationValue < 0)) {
        throw { code: grpc.status.INVALID_ARGUMENT, message: 'max_duration_value must be a non-negative integer' };
    }
    if (maxDurationUnit && !DURATION_UNITS.includes(maxDurationUnit)) {
        throw { code: grpc.status.INVALID_ARGUMENT, message: `max_duration_unit must be one of ${DURATION_UNITS.join(', ')}` };
    }
}

// Validate that all category ids belong to the organization and are not deleted.
async function validateCategories(organizationId, categoryIds = []) {
    const ids = [...new Set((categoryIds || []).filter(Boolean))];
    if (!ids.length) return [];
    const found = await prisma.employeeCategories.findMany({
        where: {
            id: { in: ids },
            organizationId,
            deletedAt: null,
        },
        select: { id: true, name: true },
    });
    if (found.length !== ids.length) {
        const foundSet = new Set(found.map(c => c.id));
        const missing = ids.filter(id => !foundSet.has(id));
        throw {
            code: grpc.status.INVALID_ARGUMENT,
            message: `Some employee categories do not exist in this organization or are inactive: ${missing.join(', ')}`,
        };
    }
    return found;
}

// Resolve category id+name snapshots for a set of category ids (for the UI).
async function fetchCategorySnapshots(categoryIds = []) {
    const ids = [...new Set((categoryIds || []).filter(Boolean))];
    if (!ids.length) return [];
    return prisma.employeeCategories.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: { id: true, name: true },
    });
}

// Validate evaluation milestone configuration (Step 2).
function validateEvaluationConfig({ evaluationRequired, milestones = [] }) {
    if (!evaluationRequired) return;

    if (!Array.isArray(milestones)) {
        throw {
            code: grpc.status.INVALID_ARGUMENT,
            message: 'evaluation_milestones must be an array when evaluation is required',
        };
    }
    if (!milestones.length) {
        throw {
            code: grpc.status.INVALID_ARGUMENT,
            message: 'At least one evaluation milestone is required when evaluation is enabled',
        };
    }

    milestones.forEach((m, idx) => {
        if (!m.name || !String(m.name).trim()) {
            throw { code: grpc.status.INVALID_ARGUMENT, message: `Milestone #${idx + 1} requires a name` };
        }
        const levels = (m.levels || []).filter(l => l);
        if (!levels.length) {
            throw { code: grpc.status.INVALID_ARGUMENT, message: `Milestone "${m.name}" requires at least one evaluation level` };
        }
        levels.forEach((lvl, lIdx) => {
            if (lvl.completion_rule && !COMPLETION_RULES.includes(lvl.completion_rule)) {
                throw { code: grpc.status.INVALID_ARGUMENT, message: `completion_rule for a level in milestone "${m.name}" must be ${COMPLETION_RULES.join(' or ')}` };
            }
            (lvl.evaluators || []).forEach(ev => {
                if (!EVALUATOR_TYPES.includes(ev.evaluator_type)) {
                    throw { code: grpc.status.INVALID_ARGUMENT, message: `evaluator_type must be ${EVALUATOR_TYPES.join(' or ')}` };
                }
                if (!ev.evaluator_ref_id) {
                    throw { code: grpc.status.INVALID_ARGUMENT, message: `evaluator_ref_id is required in milestone "${m.name}"` };
                }
            });
        });
    });
}

// Build the Prisma nested-create payload for evaluation milestones.
function buildMilestoneCreate(milestones = [], organizationId) {
    const now = new Date();
    return (milestones || []).map((m, idx) => {
        const order = Number.isInteger(m.order) ? m.order : idx;
        return {
            name: String(m.name || '').trim(),
            order,
            organizationId,
            isFinalMilestone: Boolean(m.is_final_milestone),
            automaticTriggerEnabled: Boolean(m.automatic_trigger_enabled),
            triggerAfterDays: Number.isInteger(m.trigger_after_days) ? m.trigger_after_days : null,
            feedbackFormEnabled: Boolean(m.feedback_form_enabled),
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            levels: {
                create: (m.levels || []).map((lvl, lIdx) => {
                    const levelOrder =
                        Number.isInteger(lvl.level_order) ? lvl.level_order : lIdx + 1;
                    return {
                        levelOrder,
                        completionRule: lvl.completion_rule || 'ALL',
                        reminderEnabled: Boolean(lvl.reminder_enabled),
                        reminderAfterDays: Number.isInteger(lvl.reminder_after_days) ? lvl.reminder_after_days : null,
                        createdAt: now,
                        updatedAt: now,
                        deletedAt: null,
                        evaluators: {
                            create: (lvl.evaluators || []).map(ev => ({
                                evaluatorType: ev.evaluator_type,
                                evaluatorRefId: ev.evaluator_ref_id,
                                evaluatorName: ev.evaluator_name || '',
                                createdAt: now,
                                updatedAt: now,
                                deletedAt: null,
                            })),
                        },
                    };
                }),
            },
        };
    });
}

/* ------------------------------------------------------------------ */
/* Mappers                                                             */
/* ------------------------------------------------------------------ */

const COMPLETION_RULES = ['ALL', 'ANY'];
const EVALUATOR_TYPES = ['EMPLOYEE', 'ROLE'];

function mapEvaluationMilestone(m) {
    if (!m) return null;
    const levels = (m.levels || []).map(lvl => ({
        level_order: lvl.levelOrder,
        completion_rule: lvl.completionRule || 'ALL',
        reminder_enabled: lvl.reminderEnabled ?? false,
        reminder_after_days: lvl.reminderAfterDays ?? 0,
        evaluators: (lvl.evaluators || []).map(ev => ({
            evaluator_type: ev.evaluatorType,
            evaluator_ref_id: ev.evaluatorRefId,
            evaluator_name: ev.evaluatorName ?? '',
        })),
    }));
    return {
        name: m.name,
        order: m.order,
        is_final_milestone: m.isFinalMilestone ?? false,
        automatic_trigger_enabled: m.automaticTriggerEnabled ?? false,
        trigger_after_days: m.triggerAfterDays ?? 0,
        feedback_form_enabled: m.feedbackFormEnabled ?? false,
        levels,
    };
}

const evaluationInclude = {
    evaluationMilestones: {
        where: { deletedAt: null },
        orderBy: { order: 'asc' },
        include: {
            levels: {
                where: { deletedAt: null },
                orderBy: { levelOrder: 'asc' },
                include: {
                    evaluators: {
                        where: { deletedAt: null },
                        orderBy: { createdAt: 'asc' },
                    },
                },
            },
        },
    },
};

// Attach category snapshots (id + name) to a loaded policy for the UI. The
// id->name map is resolved from stored categoryIds.
async function attachCategorySnapshots(policies) {
    const list = Array.isArray(policies) ? policies : [policies];
    const ids = [...new Set(list.flatMap(p => (p?.categoryIds || [])))];
    const snapshots = ids.length ? await fetchCategorySnapshots(ids) : [];
    const byId = new Map(snapshots.map(c => [c.id, { id: c.id, name: c.name }]));
    for (const p of list) {
        if (!p) continue;
        const pIds = p.categoryIds || [];
        p.employeeCategories = pIds.map(id => byId.get(id)).filter(Boolean);
    }
    return Array.isArray(policies) ? list : list[0];
}

// Attach active-employee counts for the policies (employees whose
// probation_policy_id points to the policy).
async function attachEmployeeCounts(policies) {
    const list = Array.isArray(policies) ? policies : [policies];
    const ids = list.map(p => p?.id).filter(Boolean);
    if (!ids.length) return Array.isArray(policies) ? list : list[0];

    const groups = await prisma.organizationEmployees.groupBy({
        by: ['probationPolicyId'],
        where: {
            probationPolicyId: { in: ids },
            isActive: true,
            deletedAt: null,
        },
        _count: { _all: true },
    });
    const countByPolicy = new Map(groups.map(g => [g.probationPolicyId, g._count._all]));
    for (const p of list) {
        if (!p) continue;
        p.employeeCount = countByPolicy.get(p.id) || 0;
    }
    return Array.isArray(policies) ? list : list[0];
}

function mapProbationPolicy(policy) {
    if (!policy) return null;
    const cats = policy.employeeCategories || [];
    return {
        id: policy.id,
        organization_id: policy.organizationId,
        name: policy.name,
        description: policy.description ?? '',
        duration_value: policy.durationValue,
        duration_unit: policy.durationUnit,
        max_duration_value: policy.maxDurationValue,
        max_duration_unit: policy.maxDurationUnit,
        end_date_after_completion: policy.endDateAfterCompletion ?? false,
        is_active: policy.isActive ?? true,
        policy_type: policy.policyType ?? 'PROBATION',
        employee_category_ids: cats.map(c => c.id),
        employee_categories: cats.map(c => ({ id: c.id, name: c.name })),

        evaluation_required: policy.evaluationRequired ?? false,
        show_feedback_form_in_review: policy.showFeedbackFormInReview ?? false,
        share_feedback_with_employee: policy.shareFeedbackWithEmployee ?? false,
        employee_response_allowed: policy.employeeResponseAllowed ?? false,
        reviewer_response_allowed: policy.reviewerResponseAllowed ?? false,
        reviewer_recommendations_allowed: policy.reviewerRecommendationsAllowed ?? false,
        auto_confirm_probation: policy.autoConfirmProbation ?? false,
        auto_generate_confirmation_letter: policy.autoGenerateConfirmationLetter ?? false,
        is_default: policy.isDefault ?? false,
        employee_count: policy.employeeCount ?? 0,
        evaluation_milestones: (policy.evaluationMilestones || []).map(mapEvaluationMilestone),

        created_at: policy.createdAt?.toISOString() ?? '',
        updated_at: policy.updatedAt?.toISOString() ?? '',
        deleted_at: policy.deletedAt?.toISOString() ?? '',
    };
}

/* ------------------------------------------------------------------ */
/* Audit                                                               */
/* ------------------------------------------------------------------ */

async function createAuditLog({ adminId, organizationId, action, entityType, entityId, changes, ipAddress, userAgent }) {
    try {
        await prisma.adminAuditLog.create({
            data: {
                adminId: adminId || null,
                organizationId: organizationId || null,
                action,
                entityType,
                entityId: entityId || null,
                changes: changes || {},
                ipAddress: ipAddress || '',
                userAgent: userAgent || '',
                createdAt: new Date(),
                deletedAt: null,
            },
        });
    } catch (e) {
        console.error('[probation-policy] Failed to create audit log:', e.message);
    }
}

/* ------------------------------------------------------------------ */
/* Implementation                                                      */
/* ------------------------------------------------------------------ */

const impl = {
    CreateProbationPolicy: async (call, callback) => {
        try {
            const {
                organization_id,
                name,
                description = '',
                duration_value,
                duration_unit,
                max_duration_value = 0,
                max_duration_unit = 'MONTHS',
                end_date_after_completion = false,
                is_active = true,
                policy_type = 'PROBATION',
                employee_category_ids = [],
                evaluation_required = false,
                show_feedback_form_in_review = false,
                share_feedback_with_employee = false,
                employee_response_allowed = false,
                reviewer_response_allowed = false,
                reviewer_recommendations_allowed = false,
                auto_confirm_probation = false,
                auto_generate_confirmation_letter = false,
                is_default = false,
                evaluation_milestones = [],
                admin_id,
                ip_address,
                user_agent,
            } = call.request;

            const org = await prisma.organizations.findFirst({
                where: { id: organization_id, deletedAt: null },
            });

            if (!org) {
                return callback({ code: grpc.status.NOT_FOUND, message: 'Organization not found' });
            }

            if (!name || !String(name).trim()) {
                return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'name is required' });
            }

            if (!POLICY_TYPES.includes(policy_type)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: `policy_type must be one of ${POLICY_TYPES.join(', ')}`,
                });
            }

            validateDuration({
                durationValue: duration_value,
                durationUnit: duration_unit,
                maxDurationValue: max_duration_value,
                maxDurationUnit: max_duration_unit,
            });

            const dupName = await prisma.probationPolicies.findFirst({
                where: { organizationId: organization_id, name, policyType: policy_type, deletedAt: null },
            });

            if (dupName) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: `A ${policy_type} policy with this name already exists in the organization`,
                });
            }

            await validateCategories(organization_id, employee_category_ids);

            validateEvaluationConfig({
                evaluationRequired: evaluation_required,
                milestones: evaluation_milestones,
            });

            // When the new policy is the default, clear the flag on any existing
            // default policy in the organisation first.
            if (is_default) {
                await prisma.probationPolicies.updateMany({
                    where: {
                        organizationId: organization_id,
                        isDefault: true,
                        deletedAt: null,
                    },
                    data: { isDefault: false, updatedAt: new Date() },
                });
            }

            const now = new Date();
            const policy = await prisma.probationPolicies.create({
                data: {
                    organizationId: organization_id,
                    name,
                    description: description || null,
                    durationValue: duration_value,
                    durationUnit: duration_unit,
                    maxDurationValue: max_duration_value,
                    maxDurationUnit: max_duration_unit,
                    endDateAfterCompletion: end_date_after_completion,
                    isActive: is_active,
                    policyType: policy_type,
                    evaluationRequired: evaluation_required,
                    showFeedbackFormInReview: show_feedback_form_in_review,
                    shareFeedbackWithEmployee: share_feedback_with_employee,
                    employeeResponseAllowed: employee_response_allowed,
                    reviewerResponseAllowed: reviewer_response_allowed,
                    reviewerRecommendationsAllowed: reviewer_recommendations_allowed,
                    autoConfirmProbation: auto_confirm_probation,
                    autoGenerateConfirmationLetter: auto_generate_confirmation_letter,
                    isDefault: is_default,
                    categoryIds: [...new Set((employee_category_ids || []).filter(Boolean))],
                    evaluationMilestones: {
                        create: buildMilestoneCreate(evaluation_milestones, organization_id),
                    },
                    createdAt: now,
                    updatedAt: now,
                    deletedAt: null,
                },
            });

            const saved = await prisma.probationPolicies.findFirst({
                where: { id: policy.id },
                include: evaluationInclude,
            });

            await attachCategorySnapshots(saved);
            await attachEmployeeCounts(saved);

            await createAuditLog({
                adminId: admin_id,
                organizationId: organization_id,
                action: 'CREATE',
                entityType: 'probation_policy',
                entityId: policy.id,
                changes: {
                    name,
                    duration_value,
                    duration_unit,
                    evaluation_required,
                    milestones: (evaluation_milestones || []).length,
                },
                ipAddress: ip_address,
                userAgent: user_agent,
            });

            callback(null, { policy: mapProbationPolicy(saved) });
        } catch (e) {
            console.error('[CreateProbationPolicy Error]', e);
            if (e.code && e.message) return callback(e);
            callback({ code: grpc.status.INTERNAL, message: e.message || 'Internal server error' });
        }
    },

    GetProbationPolicy: async (call, callback) => {
        try {
            const { id, organization_id } = call.request;

            const where = organization_id
                ? { id, organizationId: organization_id, deletedAt: null }
                : { id, deletedAt: null };

            const policy = await prisma.probationPolicies.findFirst({
                where,
                include: evaluationInclude,
            });

            if (!policy) {
                return callback({ code: grpc.status.NOT_FOUND, message: 'Probation policy not found' });
            }

            await attachCategorySnapshots(policy);
            await attachEmployeeCounts(policy);

            callback(null, { policy: mapProbationPolicy(policy) });
        } catch (e) {
            console.error('[GetProbationPolicy Error]', e);
            callback({ code: grpc.status.INTERNAL, message: e.message || 'Internal server error' });
        }
    },

    ListProbationPolicies: async (call, callback) => {
        try {
            const { organization_id, only_active = false, policy_type = '' } = call.request;

            if (policy_type && !POLICY_TYPES.includes(policy_type)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: `policy_type must be one of ${POLICY_TYPES.join(', ')}`,
                });
            }

            const where = {
                organizationId: organization_id,
                deletedAt: null,
                ...(only_active ? { isActive: true } : {}),
                ...(policy_type ? { policyType: policy_type } : {}),
            };

            const policies = await prisma.probationPolicies.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                include: evaluationInclude,
            });

            await attachCategorySnapshots(policies);
            await attachEmployeeCounts(policies);

            callback(null, { policies: policies.map(mapProbationPolicy) });
        } catch (e) {
            console.error('[ListProbationPolicies Error]', e);
            callback({ code: grpc.status.INTERNAL, message: e.message || 'Internal server error' });
        }
    },

    UpdateProbationPolicy: async (call, callback) => {
        try {
            const {
                id,
                organization_id,
                name,
                description,
                duration_value,
                duration_unit,
                max_duration_value,
                max_duration_unit,
                end_date_after_completion,
                is_active,
                policy_type,
                employee_category_ids,
                evaluation_required,
                show_feedback_form_in_review,
                share_feedback_with_employee,
                employee_response_allowed,
                reviewer_response_allowed,
                reviewer_recommendations_allowed,
                auto_confirm_probation,
                auto_generate_confirmation_letter,
                is_default,
                evaluation_milestones,
                admin_id,
                ip_address,
                user_agent,
            } = call.request;

            const where = organization_id
                ? { id, organizationId: organization_id, deletedAt: null }
                : { id, deletedAt: null };

            const existing = await prisma.probationPolicies.findFirst({ where });

            if (!existing) {
                return callback({ code: grpc.status.NOT_FOUND, message: 'Probation policy not found' });
            }

            const merged = {
                name: (name && String(name).trim()) ? name : existing.name,
                description: description !== '' ? description : existing.description,
                durationValue:
                    duration_value > 0 ? duration_value : existing.durationValue,
                durationUnit: duration_unit ? duration_unit : existing.durationUnit,
                maxDurationValue:
                    max_duration_value >= 0 ? max_duration_value : existing.maxDurationValue,
                maxDurationUnit: max_duration_unit ? max_duration_unit : existing.maxDurationUnit,
                endDateAfterCompletion:
                    typeof end_date_after_completion === 'boolean'
                        ? end_date_after_completion
                        : existing.endDateAfterCompletion,
                isActive: typeof is_active === 'boolean' ? is_active : existing.isActive,
                policyType: policy_type ? policy_type : existing.policyType,
                evaluationRequired:
                    typeof evaluation_required === 'boolean'
                        ? evaluation_required
                        : existing.evaluationRequired,
                showFeedbackFormInReview:
                    typeof show_feedback_form_in_review === 'boolean'
                        ? show_feedback_form_in_review
                        : existing.showFeedbackFormInReview,
                shareFeedbackWithEmployee:
                    typeof share_feedback_with_employee === 'boolean'
                        ? share_feedback_with_employee
                        : existing.shareFeedbackWithEmployee,
                employeeResponseAllowed:
                    typeof employee_response_allowed === 'boolean'
                        ? employee_response_allowed
                        : existing.employeeResponseAllowed,
                reviewerResponseAllowed:
                    typeof reviewer_response_allowed === 'boolean'
                        ? reviewer_response_allowed
                        : existing.reviewerResponseAllowed,
                reviewerRecommendationsAllowed:
                    typeof reviewer_recommendations_allowed === 'boolean'
                        ? reviewer_recommendations_allowed
                        : existing.reviewerRecommendationsAllowed,
                autoConfirmProbation:
                    typeof auto_confirm_probation === 'boolean'
                        ? auto_confirm_probation
                        : existing.autoConfirmProbation,
                autoGenerateConfirmationLetter:
                    typeof auto_generate_confirmation_letter === 'boolean'
                        ? auto_generate_confirmation_letter
                        : existing.autoGenerateConfirmationLetter,
                isDefault:
                    typeof is_default === 'boolean'
                        ? is_default
                        : (existing.isDefault ?? false),
            };

            validateDuration({
                durationValue: merged.durationValue,
                durationUnit: merged.durationUnit,
                maxDurationValue: merged.maxDurationValue,
                maxDurationUnit: merged.maxDurationUnit,
            });

            if (!POLICY_TYPES.includes(merged.policyType)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: `policy_type must be one of ${POLICY_TYPES.join(', ')}`,
                });
            }

            if (merged.name !== existing.name) {
                const dupName = await prisma.probationPolicies.findFirst({
                    where: {
                        organizationId: existing.organizationId,
                        name: merged.name,
                        policyType: merged.policyType,
                        deletedAt: null,
                        NOT: { id: existing.id },
                    },
                });

                if (dupName) {
                    return callback({
                        code: grpc.status.ALREADY_EXISTS,
                        message: `A ${merged.policyType} policy with this name already exists in the organization`,
                    });
                }
            }

            const shouldReassignCategories = Array.isArray(employee_category_ids);
            if (shouldReassignCategories) {
                await validateCategories(existing.organizationId, employee_category_ids);
            }

            // Evaluation milestones are replaced wholesale when the array is provided.
            const shouldReplaceMilestones = Array.isArray(evaluation_milestones);
            if (shouldReplaceMilestones) {
                validateEvaluationConfig({
                    evaluationRequired: merged.evaluationRequired,
                    milestones: evaluation_milestones,
                });
            }

            // When this policy becomes the default, ensure no other policy in the
            // organisation remains marked as default.
            if (merged.isDefault) {
                await prisma.probationPolicies.updateMany({
                    where: {
                        organizationId: existing.organizationId,
                        id: { not: id },
                        isDefault: true,
                        deletedAt: null,
                    },
                    data: { isDefault: false, updatedAt: new Date() },
                });
            }

            const updated = await prisma.probationPolicies.update({
                where: { id },
                data: {
                    name: merged.name,
                    description: merged.description,
                    durationValue: merged.durationValue,
                    durationUnit: merged.durationUnit,
                    maxDurationValue: merged.maxDurationValue,
                    maxDurationUnit: merged.maxDurationUnit,
                    endDateAfterCompletion: merged.endDateAfterCompletion,
                    isActive: merged.isActive,
                    policyType: merged.policyType,
                    isDefault: merged.isDefault,
                    evaluationRequired: merged.evaluationRequired,
                    showFeedbackFormInReview: merged.showFeedbackFormInReview,
                    shareFeedbackWithEmployee: merged.shareFeedbackWithEmployee,
                    employeeResponseAllowed: merged.employeeResponseAllowed,
                    reviewerResponseAllowed: merged.reviewerResponseAllowed,
                    reviewerRecommendationsAllowed: merged.reviewerRecommendationsAllowed,
                    autoConfirmProbation: merged.autoConfirmProbation,
                    autoGenerateConfirmationLetter: merged.autoGenerateConfirmationLetter,
                    ...(shouldReassignCategories
                        ? { categoryIds: [...new Set((employee_category_ids || []).filter(Boolean))] }
                        : {}),
                    ...(shouldReplaceMilestones
                        ? {
                              evaluationMilestones: {
                                  deleteMany: {},
                                  create: buildMilestoneCreate(evaluation_milestones, existing.organizationId),
                              },
                          }
                        : {}),
                    updatedAt: new Date(),
                },
            });

            const saved = await prisma.probationPolicies.findFirst({
                where: { id: updated.id },
                include: evaluationInclude,
            });

            await attachCategorySnapshots(saved);
            await attachEmployeeCounts(saved);

            await createAuditLog({
                adminId: admin_id,
                organizationId: existing.organizationId,
                action: 'UPDATE',
                entityType: 'probation_policy',
                entityId: updated.id,
                changes: {
                    name: merged.name,
                    duration_value: merged.durationValue,
                    duration_unit: merged.durationUnit,
                    is_active: merged.isActive,
                    evaluation_required: merged.evaluationRequired,
                    milestones: Array.isArray(evaluation_milestones) ? evaluation_milestones.length : undefined,
                },
                ipAddress: ip_address,
                userAgent: user_agent,
            });

            callback(null, { policy: mapProbationPolicy(saved) });
        } catch (e) {
            console.error('[UpdateProbationPolicy Error]', e);
            if (e.code && e.message) return callback(e);
            callback({ code: grpc.status.INTERNAL, message: e.message || 'Internal server error' });
        }
    },

    DeleteProbationPolicy: async (call, callback) => {
        try {
            const { id, organization_id, admin_id, ip_address, user_agent } = call.request;

            const where = organization_id
                ? { id, organizationId: organization_id, deletedAt: null }
                : { id, deletedAt: null };

            const existing = await prisma.probationPolicies.findFirst({ where });

            if (!existing) {
                return callback({ code: grpc.status.NOT_FOUND, message: 'Probation policy not found' });
            }

            await prisma.probationPolicies.update({
                where: { id },
                data: { deletedAt: new Date(), isActive: false, updatedAt: new Date() },
            });

            await createAuditLog({
                adminId: admin_id,
                organizationId: existing.organizationId,
                action: 'DELETE',
                entityType: 'probation_policy',
                entityId: id,
                changes: { name: existing.name },
                ipAddress: ip_address,
                userAgent: user_agent,
            });

            callback(null, { success: true, message: 'Probation policy deleted successfully' });
        } catch (e) {
            console.error('[DeleteProbationPolicy Error]', e);
            callback({ code: grpc.status.INTERNAL, message: e.message || 'Internal server error' });
        }
    },
};

/* ------------------------------------------------------------------ */
/* Server bootstrap                                                    */
/* ------------------------------------------------------------------ */

async function main() {
    const server = new grpc.Server();

    server.addService(probationPolicyProto.ProbationPolicyService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve()),
        );
    });

    console.log(`[probation-policy-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[probation-policy-service] Received ${signal}, shutting down gracefully...`);

        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[probation-policy-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[probation-policy-service] gRPC server stopped.');
                }
            });

            await prisma.$disconnect();
            console.log('[probation-policy-service] Prisma disconnected.');

            process.exit(0);
        } catch (e) {
            console.error('[probation-policy-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[probation-policy-service] Fatal error:', err);
    process.exit(1);
});
