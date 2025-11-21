import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';

const PORT = process.env.POST_POLL_SERVICE_PORT || 50069;
const postPollProto = loadProto('poll_post');

const impl = {
    CreatePostPoll: async (call, callback) => {
        try {
            const data = call.request;

            // Required fields
            if (!data.organization_id || !data.employee_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: 'Organization ID and Employee ID are required.',
                });
            }

            // Validate organization & employee
            const [organization, employee] = await Promise.all([
                prisma.organizations.findUnique({ where: { id: data.organization_id } }),
                prisma.organizationEmployees.findUnique({ where: { id: data.employee_id } })
            ]);

            if (!organization) {
                return callback({ code: grpc.status.NOT_FOUND, message: 'Organization not found' });
            }
            if (!employee) {
                return callback({ code: grpc.status.NOT_FOUND, message: 'Employee not found' });
            }

            // Strong validation for voting poll options
            if (data.is_voting_poll) {
                if (!Array.isArray(data.options) || data.options.length === 0) {
                    return callback({
                        code: grpc.status.INVALID_ARGUMENT,
                        message: 'Voting poll must include options',
                    });
                }

                const validOptions = data.options
                    .filter(opt => typeof opt.label === 'string' && opt.label.trim().length > 0);

                if (validOptions.length < 2) {
                    return callback({
                        code: grpc.status.INVALID_ARGUMENT,
                        message: 'Voting polls must have at least 2 non-empty options',
                    });
                }
            }

            // Create main post
            const newPost = await prisma.pollPosts.create({
                data: {
                    organizationId: data.organization_id,
                    employeeId: data.employee_id,
                    title: data.title || null,
                    description: data.description || "",
                    image: data.image || null,
                    tags: data.tags || [],
                    isVotingPoll: data.is_voting_poll || false,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null
                }
            });

            // Create poll options (only if voting poll)
            if (data.is_voting_poll && data.options?.length > 0) {
                const optionsToCreate = data.options
                    .filter(opt => typeof opt.label === 'string' && opt.label.trim().length > 0)
                    .map(opt => ({
                        postId: newPost.id,
                        label: opt.label.trim(),
                        votesCount: 0,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        deletedAt: null
                    }));
                if (optionsToCreate.length > 0) {
                    await prisma.pollOptions.createMany({
                        data: optionsToCreate
                    });
                }
            }

            // Fetch full post with all relations
            const fullPost = await prisma.pollPosts.findUnique({
                where: { id: newPost.id },
                include: {
                    options: true,
                    votes: true,
                    likes: true,
                    comments: true,
                    saves: true,
                    shares: true,
                },
            });

            return callback(null, {
                post: mapPostPoll(fullPost),
                success: true,
                message: 'Poll post created successfully',
            });

        } catch (e) {
            console.error('CreatePostPoll Error:', e);
            return callback({
                code: grpc.status.INTERNAL,
                message: 'Internal server error',
            });
        }
    },

    GetPostPoll: async (call, callback) => {
        try {
            const { id } = call.request;

            // --- Validate ID ---
            if (!id || typeof id !== "string") {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "Post Poll ID is required",
                });
            }

            // Validate ObjectId format (Mongo)
            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "Invalid post poll ID format",
                });
            }

            // --- Fetch poll with all related models ---
            const model = await prisma.pollPosts.findUnique({
                where: { id },
                include: {
                    options: true,
                    votes: true,
                    likes: true,
                    comments: true,
                    saves: true,
                    shares: true,
                },
            });

            if (!model) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: "Post poll not found",
                });
            }

            return callback(null, {
                post: mapPostPoll(model),
                success: true,
                message: "Post poll fetched successfully",
            });

        } catch (e) {
            console.error("❌ GetPostPoll Error:", e);

            return callback({
                code: grpc.status.INTERNAL,
                message: "Internal server error",
            });
        }
    },

    UpdatePostPoll: async (call, callback) => {
        try {
            const req = call.request;
            const { id } = req;

            // --- Validate ID ---
            if (!id || typeof id !== "string") {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "Post Poll ID is required",
                });
            }

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "Invalid post poll ID format",
                });
            }

            // --- Check if poll exists ---
            const existingPoll = await prisma.pollPosts.findUnique({
                where: { id },
                include: { options: true }
            });

            if (!existingPoll) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: "Post poll not found",
                });
            }

            // ----------------------------
            // 🔹 Build update payload safely
            // ----------------------------
            const updatePayload = {
                title: req.title ? req.title : existingPoll.title,
                description: req.description ? req.description : existingPoll.description,
                image: req.image ? req.image : existingPoll.image,
                tags: Array.isArray(req.tags) && req.tags.length > 0 ? req.tags : existingPoll.tags,
                isVotingPoll: typeof req.is_voting_poll === "boolean"
                    ? req.is_voting_poll
                    : existingPoll.isVotingPoll,
                updatedAt: new Date(),
            };

            // ----------------------------
            // 🔹 Option Update Logic
            // ----------------------------
            const incomingOptions = Array.isArray(req.options) ? req.options : [];

            const existingOptionIds = existingPoll.options.map(opt => opt.id);
            const incomingOptionIds = incomingOptions.filter(o => o.id).map(o => o.id);

            // Options to delete
            const optionsToDelete = existingOptionIds.filter(id => !incomingOptionIds.includes(id));

            // Prepare create/update arrays
            const newOptions = incomingOptions.filter(o => !o.id && o.text?.trim());
            const updateOptions = incomingOptions.filter(o => o.id && o.text?.trim());

            // ----------------------------
            // 🔹 Run all updates in a transaction
            // ----------------------------
            await prisma.$transaction(async (tx) => {

                // Update base poll
                await tx.pollPosts.update({
                    where: { id },
                    data: updatePayload
                });

                // Delete removed options
                if (optionsToDelete.length > 0) {
                    await tx.pollOptions.deleteMany({
                        where: { id: { in: optionsToDelete } }
                    });
                }

                // Update existing options
                for (const opt of updateOptions) {
                    await tx.pollOptions.update({
                        where: { id: opt.id },
                        data: { label: opt.text }
                    });
                }

                // Create new options
                if (newOptions.length > 0) {
                    await tx.pollOptions.createMany({
                        data: newOptions.map(o => ({
                            postId: id,
                            label: o.text
                        })),
                    });
                }
            });

            // ----------------------------
            // 🔹 Re-fetch full updated poll
            // ----------------------------
            const updatedPost = await prisma.pollPosts.findUnique({
                where: { id },
                include: {
                    options: true,
                    votes: true,
                    likes: true,
                    comments: true,
                    saves: true,
                    shares: true,
                },
            });

            return callback(null, {
                post: mapPostPoll(updatedPost),
                success: true,
                message: "Post poll updated successfully",
            });

        } catch (e) {
            console.error("❌ UpdatePostPoll Error:", e);

            return callback({
                code: grpc.status.INTERNAL,
                message: "Internal server error",
            });
        }
    },


    ListPostPolls: async (call, callback) => {
        try {
            const {
                organization_id,
                page = 1,
                limit = 10,
                search = "",
                sort_by = "created_at",
                sort_order = "desc",
            } = call.request;

            const skip = (page - 1) * limit;

            const SORT_MAP = {
                created_at: "createdAt",
                updated_at: "updatedAt",
            };

            const prismaSortBy = SORT_MAP[sort_by] || "createdAt";

            const where = {
                organizationId: organization_id,
                deletedAt: null,
                ...(search
                    ? {
                        OR: [
                            { title: { contains: search, mode: 'insensitive' } },
                            { description: { contains: search, mode: 'insensitive' } },
                            { tags: { has: search } },
                        ],
                    }
                    : {}),
            };

            const [totalCount, posts] = await Promise.all([
                prisma.pollPosts.count({ where }),
                prisma.pollPosts.findMany({
                    where,
                    include: {
                        options: true,
                        votes: true,
                        likes: true,
                        comments: true,
                        saves: true,
                        shares: true,
                    },
                    orderBy: {
                        [prismaSortBy]: sort_order === "asc" ? "asc" : "desc",
                    },
                    skip,
                    take: limit,
                }),
            ]);

            return callback(null, {
                posts: posts.map(mapPostPoll),  // Map each post
                total: totalCount,
                page,
                limit,
                total_pages: Math.ceil(totalCount / limit),
                success: true,
                message: "Post polls fetched successfully",
            });

        } catch (e) {
            console.error("❌ ListPostPolls Error:", e);
            return callback({
                code: grpc.status.INTERNAL,
                message: "Internal server error",
            });
        }
    },

    DeletePostPoll: async (call, callback) => {
        try {
            const { id } = call.request;

            // --- Validate ID ---
            if (!id || typeof id !== "string") {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "Post Poll ID is required",
                });
            }

            if (!/^[0-9a-fA-F]{24}$/.test(id)) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "Invalid post poll ID format",
                });
            }

            // --- Check if poll exists ---
            const existing = await prisma.pollPosts.findUnique({
                where: { id },
            });

            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: "Post poll not found",
                });
            }

            // --- If already deleted ---
            if (existing.deletedAt) {
                return callback(null, {
                    success: true,
                    message: "Post poll already deleted",
                });
            }

            // --- Soft delete by setting deletedAt ---
            await prisma.pollPosts.update({
                where: { id },
                data: { deletedAt: new Date() },
            });

            return callback(null, {
                success: true,
                message: "Post poll deleted successfully",
            });

        } catch (e) {
            console.error("❌ DeletePostPoll Error:", e);
            return callback({
                code: grpc.status.INTERNAL,
                message: "Internal server error",
            });
        }
    },

    TogglePostPollLike: async (call, callback) => {
        try {
            const { post_id, employee_id } = call.request;

            if (!post_id || !employee_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "Post ID and Employee ID are required",
                });
            }

            const post = await prisma.pollPosts.findUnique({
                where: { id: post_id }
            });

            if (!post) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: "Post not found",
                });
            }

            // Check if like already exists
            const existing = await prisma.pollLikes.findFirst({
                where: {
                    postId: post_id,
                    employeeId: employee_id
                }
            });

            // 🔹 If exists → UNLIKE (delete)
            if (existing) {
                await prisma.pollLikes.delete({
                    where: { id: existing.id }
                });

                return callback(null, {
                    liked: false,
                    success: true,
                    message: "Post unliked successfully",
                });
            }

            // 🔹 If not exists → LIKE (create)
            await prisma.pollLikes.create({
                data: {
                    postId: post_id,
                    employeeId: employee_id,
                    createdAt: new Date(),
                }
            });

            return callback(null, {
                liked: true,
                success: true,
                message: "Post liked successfully",
            });

        } catch (e) {
            console.error("❌ TogglePostPollLike Error:", e);
            return callback({
                code: grpc.status.INTERNAL,
                message: "Internal server error",
            });
        }
    },

    GetPollLikesDetails: async (call, callback) => {
        try {
            const { post_id, employee_id } = call.request;

            if (!post_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "Post ID is required",
                });
            }

            // Check if user liked the post
            const existing = await prisma.pollLikes.findFirst({
                where: { postId: post_id }
            });

            const liked = !!existing;

            // Count likes
            const count = await prisma.pollLikes.count({
                where: { postId: post_id }
            });

            // List likes with employee info
            const likes = await prisma.pollLikes.findMany({
                where: { postId: post_id },
                include: { employee: true }
            });

            return callback(null, {
                liked,
                count,
                likes: likes.map(like => ({
                    id: like.id,
                    post_id: like.postId,
                    employee_id: like.employeeId,
                    created_at: like.createdAt?.toISOString() || null,
                    employee: like.employee ? {
                        id: like.employee.id,
                        organization_id: like.employee.organizationId,
                        first_name: like.employee.firstName,
                        last_name: like.employee.lastName,
                        email: like.employee.email
                    } : null
                })),
                success: true,
                message: "Poll like details fetched successfully",
            });

        } catch (e) {
            console.error("❌ GetPollLikesDetails Error:", e);
            return callback({
                code: grpc.status.INTERNAL,
                message: "Internal server error",
            });
        }
    },

    AddPollComment: async (call, callback) => {
        try {
            const { post_id, employee_id, comment } = call.request;

            if (!post_id || !employee_id || !comment) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "Post ID, Employee ID, and Comment are required",
                });
            }

            const post = await prisma.pollPosts.findUnique({
                where: { id: post_id },
            });

            if (!post) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: "Post not found",
                });
            }

            const newComment = await prisma.pollComments.create({
                data: {
                    postId: post_id,
                    employeeId: employee_id,
                    comment,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null
                }
            });

            return callback(null, {
                comment: {
                    id: newComment.id,
                    post_id: newComment.postId,
                    employee_id: newComment.employeeId,
                    comment: newComment.comment,
                    created_at: newComment.createdAt.toISOString(),
                    employee: newComment.employee ? {
                        id: newComment.employee.id,
                        organization_id: newComment.employee.organizationId,
                        first_name: newComment.employee.firstName,
                        last_name: newComment.employee.lastName,
                        email: newComment.employee.email,
                    } : null,
                },
                success: true,
                message: "Comment added successfully",
            });

        } catch (e) {
            console.error("❌ AddPollComment Error:", e);
            return callback({
                code: grpc.status.INTERNAL,
                message: "Internal server error",
            });
        }
    },

    GetPollComments: async (call, callback) => {
        try {
            const { post_id } = call.request;

            if (!post_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "Post ID is required",
                });
            }

            const comments = await prisma.pollComments.findMany({
                where: {
                    postId: post_id,
                    deletedAt: null
                },
                include: { employee: true },
                orderBy: { createdAt: 'desc' }
            });
            return callback(null, {
                count: comments.length,
                comments: comments.map(c => ({
                    id: c.id,
                    post_id: c.postId,
                    employee_id: c.employeeId,
                    comment: c.comment,
                    created_at: c.createdAt.toISOString(),
                    employee: c.employee ? {
                        id: c.employee.id,
                        organization_id: c.employee.organizationId,
                        first_name: c.employee.firstName,
                        last_name: c.employee.lastName,
                        email: c.employee.email,
                    } : null
                })),
                success: true,
                message: "Poll comments fetched successfully",
            });

        } catch (e) {
            console.error("❌ GetPollComments Error:", e);
            return callback({
                code: grpc.status.INTERNAL,
                message: "Internal server error",
            });
        }
    },

    DeletePollComment: async (call, callback) => {
        try {
            const { comment_id } = call.request;

            if (!comment_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "Comment ID is required",
                });
            }

            const existing = await prisma.pollComments.findUnique({
                where: { id: comment_id },
            });

            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: "Comment not found",
                });
            }
            await prisma.pollComments.update({
                where: { id: comment_id },
                data: {
                    deletedAt: new Date(),
                    updatedAt: new Date(),
                }
            });

            return callback(null, {
                success: true,
                message: "Comment deleted successfully",
            });

        } catch (e) {
            console.error("❌ DeletePollComment Error:", e);
            return callback({
                code: grpc.status.INTERNAL,
                message: "Internal server error",
            });
        }
    },
};

function mapPostPoll(poll) {
    return {
        id: poll.id,
        organization_id: poll.organizationId,
        employee_id: poll.employeeId,
        title: poll.title || "",
        description: poll.description || "",
        image: poll.image || "",
        tags: poll.tags || [],
        is_voting_poll: poll.isVotingPoll || false,
        created_at: poll.createdAt?.toISOString() || null,
        updated_at: poll.updatedAt?.toISOString() || null,
        deleted_at: poll.deletedAt?.toISOString() || null,

        // Now using label directly — no mapping needed!
        options: (poll.options || []).map(o => ({
            id: o.id,
            post_id: o.postId,
            label: o.label,  // Perfect match
            created_at: o.createdAt?.toISOString() || null,
            updated_at: o.updatedAt?.toISOString() || null,
            deleted_at: o.deletedAt?.toISOString() || null,
        })),

        votes: (poll.votes || []).map(v => ({
            id: v.id,
            post_id: v.postId,
            employee_id: v.employeeId,
            option_id: v.optionId,
            created_at: v.createdAt?.toISOString() || null,
        })),

        likes: (poll.likes || []).map(l => ({
            id: l.id,
            post_id: l.postId,
            employee_id: l.employeeId,
            created_at: l.createdAt?.toISOString() || null,
        })),

        comments: (poll.comments || []).map(c => ({
            id: c.id,
            post_id: c.postId,
            employee_id: c.employeeId,
            comment: c.comment,
            created_at: c.createdAt?.toISOString() || null,
            updated_at: c.updatedAt?.toISOString() || null,
            deleted_at: c.deletedAt?.toISOString() || null,
        })),

        saves: (poll.saves || []).map(s => ({
            id: s.id,
            post_id: s.postId,
            employee_id: s.employeeId,
            created_at: s.createdAt?.toISOString() || null,
        })),

        shares: (poll.shares || []).map(sh => ({
            id: sh.id,
            post_id: sh.postId,
            employee_id: sh.employeeId,
            created_at: sh.createdAt?.toISOString() || null,
        })),
    };
}

async function main() {
    const server = new grpc.Server();

    server.addService(postPollProto.PostPollService.service, impl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[post-poll-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[post-poll-service] Received ${signal}, shutting down gracefully...`);

        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[post-poll-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[post-poll-service] gRPC server stopped.');
                }
            });

            await prisma.$disconnect();
            console.log('[post-poll-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[post-poll-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[post-poll-service] Fatal error:', err);
    process.exit(1);
});
