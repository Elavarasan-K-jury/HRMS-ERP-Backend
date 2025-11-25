import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

const PORT = process.env.POST_POLL_SERVICE_PORT || 5069;
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
            const newPost = await prisma.posts.create({
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
            if (data.is_voting_poll) {
                const optionsToCreate = (data.options || [])
                    .filter(opt => opt.label && opt.label.trim().length > 0)
                    .map(opt => ({
                        postId: newPost.id,
                        label: opt.label.trim(),
                        votesCount: 0,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        deletedAt: null
                    }));

                if (optionsToCreate.length > 0) {
                    await prisma.pollOptions.createMany({ data: optionsToCreate });
                }
            }


            // Fetch full post with all relations
            const fullPost = await prisma.posts.findUnique({
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
            const model = await prisma.posts.findUnique({
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
            const existingPoll = await prisma.posts.findUnique({
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
                await tx.posts.update({
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
            const updatedPost = await prisma.posts.findUnique({
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
                prisma.posts.count({ where }),
                prisma.posts.findMany({
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
            const existing = await prisma.posts.findUnique({
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
            await prisma.posts.update({
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

            const post = await prisma.posts.findUnique({
                where: { id: post_id }
            });

            if (!post) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: "Post not found",
                });
            }

            const existing = await prisma.postLikes.findFirst({
                where: {
                    postId: post_id,
                    employeeId: employee_id,
                    deletedAt: null
                }
            });

            // 🔹 If exists → Soft UNLIKE
            if (existing) {
                await prisma.postLikes.update({
                    where: { id: existing.id },
                    data: {
                        deletedAt: new Date(),
                        updatedAt: new Date()
                    }
                });

                return callback(null, {
                    liked: false,
                    success: true,
                    message: "Post unliked successfully",
                });
            }

            // 🔹 If not exists → LIKE (create)
            await prisma.postLikes.create({
                data: {
                    postId: post_id,
                    employeeId: employee_id,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null
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
            const { post_id } = call.request;

            if (!post_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "Post ID is required",
                });
            }

            // Check if user liked the post
            const existing = await prisma.postLikes.findFirst({
                where: { postId: post_id }
            });

            const liked = !!existing;

            // Count likes
            const count = await prisma.postLikes.count({
                where: { postId: post_id }
            });

            // List likes with employee info
            const likes = await prisma.postLikes.findMany({
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
                    updated_at: like.updatedAt?.toISOString() || null,
                    deleted_at: like.deletedAt?.toISOString() || null,
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

            const post = await prisma.posts.findUnique({
                where: { id: post_id },
            });

            if (!post) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: "Post not found",
                });
            }

            const newComment = await prisma.postComments.create({
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
            const { post_id, employee_id } = call.request;

            if (!post_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "Post ID is required",
                });
            }


            const post = await prisma.posts.findUnique({
                where: { id: post_id },
            });

            if (!post) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: "Post not found",
                });
            }

            if (employee_id) {
                const employeeExists = await prisma.organizationEmployees.findUnique({
                    where: { id: employee_id }
                });

                if (!employeeExists) {
                    return callback({
                        code: grpc.status.NOT_FOUND,
                        message: "Employee not found",
                    });
                }
            }


            const comments = await prisma.postComments.findMany({
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

            const existing = await prisma.postComments.findUnique({
                where: { id: comment_id },
            });

            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: "Comment not found",
                });
            }
            await prisma.postComments.update({
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

    GetPollOptions: async (call, callback) => {
        try {
            const { post_id } = call.request;

            if (!post_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "Post ID is required",
                });
            }

            const options = await prisma.postOptions.findMany({
                where: { postId: post_id, deletedAt: null },
            });

            return callback(null, {
                options: options.map(o => ({
                    id: o.id,
                    post_id: o.postId,
                    label: o.label,
                    votesCount: o.votesCount,
                    created_at: o.createdAt?.toISOString() || null,
                    updated_at: o.updatedAt?.toISOString() || null,
                    deleted_at: o.deletedAt?.toISOString() || null,
                })),
                success: true,
                message: "Poll options fetched successfully",
            });

        } catch (e) {
            console.error("❌ GetPollOptions Error:", e);
            return callback({
                code: grpc.status.INTERNAL,
                message: "Internal server error",
            });
        }
    },

    DeletePollOption: async (call, callback) => {
        try {
            const { option_id } = call.request;

            if (!option_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "Option ID is required",
                });
            }

            const existing = await prisma.postOptions.findUnique({
                where: {
                    id: option_id,
                    deletedAt: null
                },

            });

            if (!existing) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: "Option not found",
                });
            }

            await prisma.postOptions.update({
                where: { id: option_id },
                data: {
                    deletedAt: new Date(),
                    updatedAt: new Date(),
                }
            });

            return callback(null, {
                success: true,
                message: "Poll option deleted successfully",
            });

        } catch (e) {
            console.error("❌ DeletePollOption Error:", e);
            return callback({
                code: grpc.status.INTERNAL,
                message: "Internal server error",
            });
        }
    },

    CastPollVote: async (call, callback) => {
        try {
            const { post_id, employee_id, option_id } = call.request;

            if (!post_id || !employee_id || !option_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "Post ID, Employee ID, and Option ID are required",
                });
            }

            const post = await prisma.posts.findFirst({
                where: { id: post_id, deletedAt: null },
            });

            if (!post) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: "Post not found",
                });
            }

            const option = await prisma.postOptions.findFirst({
                where: { id: option_id, deletedAt: null },
            });

            if (!option || option.postId !== post_id) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: "Option not found for this post",
                });
            }

            const existingVote = await prisma.postVotes.findFirst({
                where: {
                    postId: post_id,
                    employeeId: employee_id,
                    deletedAt: null
                }
            });

            if (existingVote) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: "Employee has already voted on this poll",
                });
            }

            // Create vote
            const createdVote = await prisma.postVotes.create({
                data: {
                    postId: post_id,
                    employeeId: employee_id,
                    optionId: option_id,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null
                }
            });

            // Map vote for proto
            const voteResponse = {
                id: createdVote.id,
                post_id: createdVote.postId,
                employee_id: createdVote.employeeId,
                option_id: createdVote.optionId,
                created_at: createdVote.createdAt?.toISOString() || null,
                updated_at: createdVote.updatedAt?.toISOString() || null,
                deleted_at: createdVote.deletedAt?.toISOString() || null,
            };

            return callback(null, {
                vote: voteResponse,
                success: true,
                message: "Vote cast successfully"
            });

        } catch (e) {
            console.error("❌ CastPollVote Error:", e);
            return callback({
                code: grpc.status.INTERNAL,
                message: "Internal server error",
            });
        }
    },


    GetPollVotesDetails: async (call, callback) => {
        try {
            const { post_id, employee_id } = call.request;

            if (!post_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "Post ID is required"
                });
            }

            // 1️⃣ Get poll options
            const options = await prisma.postOptions.findMany({
                where: { postId: post_id, deletedAt: null }
            });

            // 2️⃣ Get all active votes
            const votes = await prisma.postVotes.findMany({
                where: { postId: post_id, deletedAt: null }
            });

            const totalVotes = votes.length;

            // 3️⃣ Count votes per option
            const votesByOption = {};
            votes.forEach(v => {
                if (!votesByOption[v.optionId]) votesByOption[v.optionId] = 0;
                votesByOption[v.optionId]++;
            });

            // 4️⃣ Calculate percentages
            const optionStats = options.map(opt => {
                const count = votesByOption[opt.id] || 0;
                const pct = totalVotes > 0 ? (count / totalVotes) * 100 : 0;

                return {
                    option_id: opt.id,
                    label: opt.label,
                    votes: count,
                    percentage: Number(pct.toFixed(2))
                };
            });

            // 5️⃣ Find user vote (optional)
            let userVote = null;
            if (employee_id) {
                const uv = await prisma.postVotes.findFirst({
                    where: { postId: post_id, employeeId: employee_id, deletedAt: null }
                });

                userVote = uv ? uv.optionId : null;
            }

            // 6️⃣ Response
            return callback(null, {
                total_votes: totalVotes,
                options: optionStats,
                votes: votes.map(v => ({
                    id: v.id,
                    post_id: v.postId,
                    employee_id: v.employeeId,
                    option_id: v.optionId,
                    created_at: v.createdAt?.toISOString() || null
                })),
                user_vote_option_id: userVote,
                success: true,
                message: "Poll vote details fetched successfully"
            });

        } catch (e) {
            console.error("❌ GetPollVotesDetails Error:", e);
            return callback({
                code: grpc.status.INTERNAL,
                message: "Internal server error"
            });
        }
    },

    TogglePostPollSave: async (call, callback) => {
        try {
            const { post_id, employee_id } = call.request;

            if (!post_id || !employee_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "Post ID and Employee ID are required",
                });
            }

            // 1️⃣ Check if post exists
            const post = await prisma.posts.findUnique({
                where: { id: post_id }
            });

            if (!post) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: "Post not found",
                });
            }

            // 2️⃣ Check if employee already saved the post
            const existing = await prisma.postSaves.findFirst({
                where: {
                    postId: post_id,
                    employeeId: employee_id,
                    deletedAt: null
                }
            });

            if (existing) {
                return callback({
                    code: grpc.status.ALREADY_EXISTS,
                    message: "Post already saved by this employee",
                });
            }

            // 3️⃣ Create save
            const newSave = await prisma.postSaves.create({
                data: {
                    postId: post_id,
                    employeeId: employee_id,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null
                },
                include: { employee: true }
            });

            return callback(null, {
                save: {
                    id: newSave.id,
                    post_id: newSave.postId,
                    employee_id: newSave.employeeId,
                    created_at: newSave.createdAt.toISOString(),
                    updated_at: newSave.updatedAt.toISOString(),
                    deleted_at: null,
                    employee: {
                        id: newSave.employee.id,
                        organization_id: newSave.employee.organizationId,
                        first_name: newSave.employee.firstName,
                        last_name: newSave.employee.lastName,
                        email: newSave.employee.email,
                    }
                },
                saved: true,
                success: true,
                message: "Post saved successfully",
            });

        } catch (e) {
            console.error("❌ TogglePostPollSave Error:", e);
            return callback({
                code: grpc.status.INTERNAL,
                message: "Internal server error",
            });
        }
    },


    GetPollSavesDetails: async (call, callback) => {
        try {
            const { post_id } = call.request;

            if (!post_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "Post ID is required",
                });
            }

            const saves = await prisma.postSaves.findMany({
                where: {
                    postId: post_id,
                    deletedAt: null
                },
                include: { employee: true }
            });

            const saved = saves.length > 0;

            const mappedSaves = saves.map(s => ({
                id: s.id,
                post_id: s.postId,
                employee_id: s.employeeId,
                created_at: s.createdAt?.toISOString() || null,
                updated_at: s.updatedAt?.toISOString() || null,
                deleted_at: s.deletedAt?.toISOString() || null,
                employee: s.employee ? {
                    id: s.employee.id,
                    organization_id: s.employee.organizationId,
                    first_name: s.employee.firstName,
                    last_name: s.employee.lastName,
                    email: s.employee.email
                } : null
            }));

            return callback(null, {
                saved,
                count: mappedSaves.length,
                saves: mappedSaves,
                success: true,
                message: "Poll save details fetched successfully"
            });

        } catch (e) {
            console.error("❌ GetPollSavesDetails Error:", e);
            return callback({
                code: grpc.status.INTERNAL,
                message: "Internal server error"
            });
        }
    },

    SharePostPoll: async (call, callback) => {
        try {
            const { post_id, employee_id } = call.request;

            if (!post_id || !employee_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "Post ID and Employee ID are required",
                });
            }

            const post = await prisma.posts.findUnique({ where: { id: post_id } });

            if (!post) {
                return callback({
                    code: grpc.status.NOT_FOUND,
                    message: "Post not found",
                });
            }

            // 🔍 Check if already shared
            let existingShare = await prisma.postShares.findFirst({
                where: {
                    postId: post_id,
                    employeeId: employee_id,
                    deletedAt: null
                },
                include: { employee: true }
            });

            // Already shared → return existing (NO ERROR)
            if (existingShare) {
                return callback(null, {
                    share: {
                        id: existingShare.id,
                        post_id: existingShare.postId,
                        employee_id: existingShare.employeeId,
                        created_at: existingShare.createdAt.toISOString(),
                        updated_at: existingShare.updatedAt.toISOString(),
                        deleted_at: existingShare.deletedAt?.toISOString() || null,
                        employee: {
                            id: existingShare.employee.id,
                            organization_id: existingShare.employee.organizationId,
                            first_name: existingShare.employee.firstName,
                            last_name: existingShare.employee.lastName,
                            email: existingShare.employee.email,
                        }
                    },
                    success: true,
                    message: "Post already shared",
                });
            }

            // First share → Create new
            const newShare = await prisma.postShares.create({
                data: {
                    postId: post_id,
                    employeeId: employee_id,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null
                },
                include: { employee: true }
            });

            return callback(null, {
                share: {
                    id: newShare.id,
                    post_id: newShare.postId,
                    employee_id: newShare.employeeId,
                    created_at: newShare.createdAt.toISOString(),
                    updated_at: newShare.updatedAt.toISOString(),
                    deleted_at: null,
                    employee: {
                        id: newShare.employee.id,
                        organization_id: newShare.employee.organizationId,
                        first_name: newShare.employee.firstName,
                        last_name: newShare.employee.lastName,
                        email: newShare.employee.email,
                    }
                },
                success: true,
                message: "Post shared successfully",
            });

        } catch (e) {
            console.error("❌ SharePostPoll Error:", e);
            return callback({
                code: grpc.status.INTERNAL,
                message: "Internal server error",
            });
        }
    },


    GetPostPollShares: async (call, callback) => {
        try {
            const { post_id } = call.request;

            if (!post_id) {
                return callback({
                    code: grpc.status.INVALID_ARGUMENT,
                    message: "Post ID is required",
                });
            }

            const shares = await prisma.postShares.findMany({
                where: {
                    postId: post_id,
                    deletedAt: null
                },
                include: { employee: true }
            });

            const mapped = shares.map(sh => ({
                id: sh.id,
                post_id: sh.postId,
                employee_id: sh.employeeId,
                created_at: sh.createdAt.toISOString(),
                updated_at: sh.updatedAt.toISOString(),
                deleted_at: sh.deletedAt?.toISOString() || null,
                employee: {
                    id: sh.employee.id,
                    organization_id: sh.employee.organizationId,
                    first_name: sh.employee.firstName,
                    last_name: sh.employee.lastName,
                    email: sh.employee.email
                }
            }));

            // ⭐ DISTINCT employee count
            const uniqueCount = new Set(mapped.map(sh => sh.employee_id)).size;

            return callback(null, {
                count: uniqueCount,
                shares: mapped,
                success: true,
                message: "Poll share details fetched successfully"
            });

        } catch (e) {
            console.error("❌ GetPostPollShares Error:", e);
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
            updated_at: v.updatedAt?.toISOString() || null,
            deleted_at: v.deletedAt?.toISOString() || null,
        })),

        likes: (poll.likes || []).map(l => ({
            id: l.id,
            post_id: l.postId,
            employee_id: l.employeeId,
            created_at: l.createdAt?.toISOString() || null,
            updated_at: l.updatedAt?.toISOString() || null,
            deleted_at: l.deletedAt?.toISOString() || null,
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
            updated_at: s.updatedAt?.toISOString() || null,
            deleted_at: s.deletedAt?.toISOString() || null,

            employee: s.employee ? {
                id: s.employee.id,
                organization_id: s.employee.organizationId,
                first_name: s.employee.firstName,
                last_name: s.employee.lastName,
                email: s.employee.email,
            } : null,
        })),
        shares: (poll.shares || []).map(sh => ({
            id: sh.id,
            post_id: sh.postId,
            employee_id: sh.employeeId,
            created_at: sh.createdAt?.toISOString() || null,
            updated_at: sh.updatedAt?.toISOString() || null,
            deleted_at: sh.deletedAt?.toISOString() || null,

            employee: sh.employee
                ? {
                    id: sh.employee.id,
                    organization_id: sh.employee.organizationId,
                    first_name: sh.employee.firstName,
                    last_name: sh.employee.lastName,
                    email: sh.employee.email,
                }
                : null,
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
