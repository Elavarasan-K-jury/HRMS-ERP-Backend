/**
 * Migration: Remove Feedback-only fields from ProbationPolicies and ProbationEvaluationMilestones
 *
 * This script removes the following fields from existing MongoDB documents:
 *
 * ProbationPolicies:
 *   - showFeedbackFormInReview
 *   - shareFeedbackWithEmployee
 *   - employeeResponseAllowed
 *   - reviewerResponseAllowed
 *   - reviewerRecommendationsAllowed
 *
 * ProbationEvaluationMilestones:
 *   - feedbackFormEnabled
 *
 * SAFETY:
 *   - Only unsets specified fields; does not delete documents
 *   - Idempotent: running twice has no additional effect
 *   - Preserves all core probation fields
 */

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: ['error'] });

async function main() {
    console.log('=== Feedback Fields Migration ===\n');

    // --- Count affected Milestones ---
    const milestoneCount = await prisma.probationEvaluationMilestones.count({
        where: {
            deletedAt: null,
            feedbackFormEnabled: true,
        },
    });
    console.log(`ProbationEvaluationMilestones with feedbackFormEnabled=true: ${milestoneCount}`);

    // --- Count affected Policies (check each field individually) ---
    const policyFields = [
        { showFeedbackFormInReview: true },
        { shareFeedbackWithEmployee: true },
        { employeeResponseAllowed: true },
        { reviewerResponseAllowed: true },
        { reviewerRecommendationsAllowed: true },
    ];

    let totalPolicyAffected = 0;
    for (const whereClause of policyFields) {
        const count = await prisma.probationPolicies.count({
            where: { deletedAt: null, ...whereClause },
        });
        if (count > 0) {
            totalPolicyAffected += count;
        }
    }
    console.log(`ProbationPolicies with any feedback field=true: ${totalPolicyAffected}`);

    // --- Clean ProbationEvaluationMilestones ---
    if (milestoneCount > 0) {
        console.log('\nCleaning ProbationEvaluationMilestones...');
        const result = await prisma.probationEvaluationMilestones.updateMany({
            where: { deletedAt: null },
            data: { feedbackFormEnabled: false },
        });
        console.log(`ProbationEvaluationMilestones reset: ${result.count} documents`);
    } else {
        console.log('\nNo ProbationEvaluationMilestones to clean.');
    }

    // --- Clean ProbationPolicies ---
    if (totalPolicyAffected > 0) {
        console.log('\nCleaning ProbationPolicies...');
        const result = await prisma.probationPolicies.updateMany({
            where: { deletedAt: null },
            data: {
                showFeedbackFormInReview: false,
                shareFeedbackWithEmployee: false,
                employeeResponseAllowed: false,
                reviewerResponseAllowed: false,
                reviewerRecommendationsAllowed: false,
            },
        });
        console.log(`ProbationPolicies reset: ${result.count} documents`);
    } else {
        console.log('\nNo ProbationPolicies to clean.');
    }

    // --- Verification ---
    console.log('\n=== Verification ===');

    const verifyMilestoneCount = await prisma.probationEvaluationMilestones.count({
        where: {
            deletedAt: null,
            feedbackFormEnabled: true,
        },
    });
    console.log(`ProbationEvaluationMilestones still with feedbackFormEnabled=true: ${verifyMilestoneCount}`);

    const verifyPolicyCount = await prisma.probationPolicies.count({
        where: {
            deletedAt: null,
            OR: [
                { showFeedbackFormInReview: true },
                { shareFeedbackWithEmployee: true },
                { employeeResponseAllowed: true },
                { reviewerResponseAllowed: true },
                { reviewerRecommendationsAllowed: true },
            ],
        },
    });
    console.log(`ProbationPolicies still with any feedback field=true: ${verifyPolicyCount}`);

    // Verify documents still exist
    const totalPolicies = await prisma.probationPolicies.count({
        where: { deletedAt: null },
    });
    console.log(`Total active ProbationPolicies: ${totalPolicies}`);

    const totalMilestones = await prisma.probationEvaluationMilestones.count({
        where: { deletedAt: null },
    });
    console.log(`Total active ProbationEvaluationMilestones: ${totalMilestones}`);

    if (verifyMilestoneCount === 0 && verifyPolicyCount === 0) {
        console.log('\n✅ Migration complete. All feedback fields reset to false.');
    } else {
        console.log('\n⚠️ Some feedback fields may still be true. Manual review recommended.');
    }
}

main()
    .catch(err => {
        console.error('Migration failed:', err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
