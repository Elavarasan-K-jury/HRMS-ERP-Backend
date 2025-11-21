import { z, ZodError } from 'zod';
import { postPollClient } from '../grpc/post_poll.client.js';
import { tr } from 'zod/locales';

export default function registerPostPollRoutes(app) {

    const CreatePollPostSchema = z.object({
        organizationId: z.string().min(1),
        employeeId: z.string().min(1),
        title: z.string().min(1).max(255),
        description: z.string().optional(),
        image: z.string().url().nullable().optional(),
        tags: z.array(z.string()).optional(),
        isVotingPoll: z.boolean().optional().default(false),

        options: z.array(
            z.object({
                text: z.string().min(1, "Option text cannot be empty")
            })
        ).optional()
    }).refine(
        (data) => {
            if (data.isVotingPoll) {
                return data.options && data.options.length >= 2;
            }
            return true;
        },
        {
            message: "A voting poll must have at least 2 options",
            path: ["options"]
        }
    );

    // 🟢 Create Poll Post
    app.openapi(
        {
            method: 'post',
            path: '/post-polls',
            tags: ['Post Polls'],
            summary: 'Create a new post poll',
            request: {
                body: {
                    content: {
                        'application/json': { schema: CreatePollPostSchema },
                    },
                },
            },
            responses: {
                201: {
                    description: 'Poll post created successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                post: z.object({
                                    id: z.string(),
                                    organization_id: z.string(),
                                    employee_id: z.string(),
                                    title: z.string().nullable(),
                                    description: z.string(),
                                    image: z.string().nullable(),
                                    tags: z.array(z.string()),
                                    is_voting_poll: z.boolean(),
                                    created_at: z.string().nullable(),
                                    updated_at: z.string().nullable(),
                                    deleted_at: z.string().nullable(),

                                    options: z.array(
                                        z.object({
                                            id: z.string(),
                                            post_id: z.string(),
                                            label: z.string(),
                                        })
                                    ),

                                    votes: z.array(
                                        z.object({
                                            id: z.string(),
                                            post_id: z.string(),
                                            employee_id: z.string(),
                                            option_id: z.string(),
                                            created_at: z.string().nullable(),
                                        })
                                    ),

                                    likes: z.array(
                                        z.object({
                                            id: z.string(),
                                            post_id: z.string(),
                                            employee_id: z.string(),
                                            created_at: z.string().nullable(),
                                        })
                                    ),

                                    comments: z.array(
                                        z.object({
                                            id: z.string(),
                                            post_id: z.string(),
                                            employee_id: z.string(),
                                            comment: z.string(),
                                            created_at: z.string().nullable(),
                                        })
                                    ),

                                    saves: z.array(
                                        z.object({
                                            id: z.string(),
                                            post_id: z.string(),
                                            employee_id: z.string(),
                                            created_at: z.string().nullable(),
                                        })
                                    ),

                                    shares: z.array(
                                        z.object({
                                            id: z.string(),
                                            post_id: z.string(),
                                            employee_id: z.string(),
                                            created_at: z.string().nullable(),
                                        })
                                    ),
                                }),

                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },

                400: {
                    description: 'Validation error',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                            }),
                        },
                    },
                },

                500: {
                    description: 'Server error',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = CreatePollPostSchema.parse(body);

                // Transform client-side options → proto options format
                const grpcPayload = {
                    organization_id: parsed.organizationId,
                    employee_id: parsed.employeeId,
                    title: parsed.title,
                    description: parsed.description || "",
                    image: parsed.image ?? null,
                    tags: parsed.tags || [],
                    is_voting_poll: parsed.isVotingPoll,

                    ...(parsed.isVotingPoll && {
                        options: parsed.options.map(o => ({
                            label: o.text.trim()
                        }))
                    })
                };


                const response = await new Promise((resolve, reject) => {
                    postPollClient.createPostPoll(grpcPayload, (err, response) => {
                        if (err) reject(err);
                        else resolve(response);
                    });
                });

                return c.json(response, 201);
            } catch (err) {
                if (err instanceof ZodError) {
                    return c.json({ message: err.message }, 400);
                }

                return c.json({ message: err.message }, 500);
            }
        }
    );

    // 🟢 Get Poll Posts By ID
    app.openapi(
        {
            method: 'get',
            path: '/post-polls/{id}',
            tags: ['Post Polls'],
            summary: 'Get a post poll by ID',
            request: {
                params: z.object({
                    id: z.string().min(1),
                }),
            },
            responses: {
                200: {
                    description: 'Post poll found',
                    content: {
                        'application/json': {
                            schema: z.object({
                                post: z.object({
                                    id: z.string(),
                                    organization_id: z.string(),
                                    employee_id: z.string(),
                                    title: z.string().nullable(),
                                    description: z.string(),
                                    image: z.string().nullable(),
                                    tags: z.array(z.string()),
                                    is_voting_poll: z.boolean(),
                                    created_at: z.string().nullable(),
                                    updated_at: z.string().nullable(),
                                    deleted_at: z.string().nullable(),

                                    options: z.array(z.object({
                                        id: z.string(),
                                        post_id: z.string(),
                                        label: z.string(),
                                    })),

                                    votes: z.array(z.object({ /* ... */ })),
                                    likes: z.array(z.object({ /* ... */ })),
                                    comments: z.array(z.object({ /* ... */ })),
                                    saves: z.array(z.object({ /* ... */ })),
                                    shares: z.array(z.object({ /* ... */ })),
                                }),
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
                404: {
                    description: 'Post poll not found',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                            }),
                        },
                    },
                },
                500: {
                    description: 'Server error',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const id = c.req.param('id');

                const response = await new Promise((resolve, reject) => {
                    postPollClient.getPostPoll({ id }, (err, response) => {
                        if (err) reject(err);
                        else resolve(response);
                    });
                });

                return c.json(response, 200);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({ message: error.message }, 400);
                }
                return c.json({ message: error.message }, 500);
            }
        }
    );

    //List All Posted Polls By Organization ID
    app.openapi(
        {
            method: 'get',
            path: '/post-polls',
            tags: ['Post Polls'],
            summary: 'List all post polls',
            request: {
                query: z.object({
                    organization_id: z.string({ required_error: 'Organization ID is required' }),
                    search: z.string().optional(),
                    page: z.coerce.number().optional().default(1),
                    limit: z.coerce.number().optional().default(10),
                    sort_by: z.string().optional().default('created_at'),
                    sort_order: z.enum(['asc', 'desc']).optional().default('desc'),
                }),
            },
            responses: {
                200: {
                    description: 'List of post polls',
                    content: {
                        'application/json': {
                            schema: z.object({
                                posts: z.array(z.object({
                                    id: z.string(),
                                    organization_id: z.string(),
                                    employee_id: z.string(),
                                    title: z.string().nullable(),
                                    description: z.string(),
                                    image: z.string().nullable(),
                                    tags: z.array(z.string()),
                                    is_voting_poll: z.boolean(),
                                    created_at: z.string().nullable(),
                                    updated_at: z.string().nullable(),
                                    deleted_at: z.string().nullable(),
                                })),
                                total: z.number(),
                                page: z.number(),
                                limit: z.number(),
                                total_pages: z.number(),
                                message: z.string(),
                                success: z.boolean(),
                            }),
                        },
                    },
                },
                400: {
                    description: 'Validation error',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                            }),
                        },
                    },
                },  
                500: {
                    description: 'Server error',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const query = c.req.valid('query');

                const response = await new Promise((resolve, reject) => {
                    postPollClient.listPostPolls(query, (err, response) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(response);
                        }
                    });
                });

                return c.json(response, 200);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({ message: error.message }, 400);
                }
                return c.json({ message: error.message }, 500);
            }
        }
    );

    const UpdatePostPollSchema = z.object({
        title: z.string().optional(),
        description: z.string().optional(),
        image: z.string().url().nullable().optional(),
        tags: z.array(z.string()).optional(),

        isVotingPoll: z.boolean().optional(),

        options: z.array(
            z.object({
                id: z.string().optional(),
                text: z.string().min(1)
            })
        ).optional()
    });

    //Update Posted poll By ID
    app.openapi(
        {
            method: 'put',
            path: '/post-polls/{id}',
            tags: ['Post Polls'],
            summary: 'Update a post poll',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Post Poll ID is required' }),
                }),
                body: {
                    content: {
                        'application/json': { schema: UpdatePostPollSchema },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Post poll updated successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                post: z.object({
                                    id: z.string(),
                                    organization_id: z.string(),
                                    employee_id: z.string(),
                                    title: z.string().nullable(),
                                    description: z.string(),
                                    image: z.string().nullable(),
                                    tags: z.array(z.string()),
                                    is_voting_poll: z.boolean(),
                                    created_at: z.string().nullable(),
                                    updated_at: z.string().nullable(),
                                    deleted_at: z.string().nullable(),
                                }),
                                message: z.string(),
                                success: z.boolean(),
                            }),
                        },
                    },
                },
                400: {
                    description: 'Validation error',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                            }),
                        },
                    },
                },
                500: {
                    description: 'Server error',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const id = c.req.param("id");
                const body = await c.req.json();
                const parsed = UpdatePostPollSchema.parse(body);

                const grpcPayload = {
                    id,
                    title: parsed.title,
                    description: parsed.description,
                    image: parsed.image,
                    tags: parsed.tags,
                    is_voting_poll: parsed.isVotingPoll,
                    options: parsed.options?.map(o => ({
                        id: o.id,
                        label: o.text
                    }))
                };


                const response = await new Promise((resolve, reject) => {
                    postPollClient.updatePostPoll(grpcPayload, (err, response) => {
                        if (err) reject(err);
                        resolve(response);
                    });
                });

                return c.json(response, 200);

            } catch (err) {
                if (err instanceof ZodError) {
                    return c.json({ message: err.message }, 400);
                }
                return c.json({ message: err.message }, 500);
            }
        });
    
    //Delete Posted Poll By ID
    app.openapi(
        {
            method: 'delete',
            path: '/post-polls/{id}',
            tags: ['Post Polls'],
            summary: 'Delete a post poll',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Post Poll ID is required' }),
                }),
            },
            responses: {
                200: {
                    description: 'Post poll deleted successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                                success: z.boolean(),
                            }),
                        },
                    },
                },
                400: {
                    description: 'Validation error',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                            }),
                        },
                    },
                },
                500: {
                    description: 'Server error',
                    content: {
                        'application/json': {
                            schema: z.object({
                                message: z.string(),
                            }),
                        },  
                    },
                },
            },
        },
        async (c) => {
            try {
                const id = c.req.param("id");

                const response = await new Promise((resolve, reject) => {
                    postPollClient.deletePostPoll({ id }, (err, response) => {
                        if (err) reject(err);
                        resolve(response);
                    });
                });

                return c.json(response, 200);

            } catch (err) {
                if (err instanceof ZodError) {
                    return c.json({ message: err.message }, 400);
                }
                return c.json({ message: err.message }, 500);
            }
        });
    
    // ⭐ Toggle Like / Unlike a Post Poll
    app.openapi(
        {
            method: "post",
            path: "/post-polls/{id}/likes",
            tags: ["Post Polls"],
            summary: "Toggle like/unlike for a post poll",
            request: {
                params: z.object({
                    id: z.string({ required_error: "Post Poll ID is required" }),
                }),
                body: {
                    content: {
                        "application/json": {
                            schema: z.object({
                                employee_id: z.string({ required_error: "Employee ID is required" }),
                            })
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Like/Unlike action executed",
                    content: {
                        "application/json": {
                            schema: z.object({
                                liked: z.boolean(),
                                success: z.boolean(),
                                message: z.string(),
                            })
                        }
                    }
                },
                400: {
                    description: "Validation error",
                    content: {
                        "application/json": {
                            schema: z.object({ message: z.string() })
                        }
                    }
                },
                500: {
                    description: "Server error",
                    content: {
                        "application/json": {
                            schema: z.object({ message: z.string() })
                        }
                    }
                }
            }
        },

        // 🔥 Handler
        async (c) => {
            try {
                const id = c.req.param("id");
                const body = await c.req.json();

                const employee_id = body.employee_id;

                const response = await new Promise((resolve, reject) => {
                    postPollClient.togglePostPollLike(
                        { post_id: id, employee_id },
                        (err, response) => {
                            if (err) reject(err);
                            else resolve(response);
                        }
                    );
                });

                return c.json(response, 200);

            } catch (err) {
                return c.json({ message: err.message }, 500);
            }
        }
    );

    // GET Poll Like Details
    app.openapi(
        {
            method: 'get',
            path: '/post-polls/{id}/likes/details',
            tags: ['Post Polls'],
            summary: 'Get complete like details for a post poll',
            request: {
                params: z.object({
                    id: z.string(),
                }),
                query: z.object({
                    employee_id: z.string().optional(),
                })
            },
            responses: {
                200: {
                    description: 'Likes details fetched successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                liked: z.boolean(),
                                count: z.number(),
                                likes: z.array(
                                    z.object({
                                        id: z.string(),
                                        post_id: z.string(),
                                        employee_id: z.string(),
                                        created_at: z.string().nullable(),
                                        employee: z.object({
                                            id: z.string(),
                                            organization_id: z.string(),
                                            first_name: z.string(),
                                            last_name: z.string(),
                                            email: z.string()
                                        }).nullable(),
                                    })
                                ),
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const id = c.req.param("id");
                const { employee_id } = c.req.valid("query");

                const response = await new Promise((resolve, reject) => {
                    postPollClient.getPollLikesDetails(
                        { post_id: id, employee_id },
                        (err, response) => {
                            if (err) reject(err);
                            else resolve(response);
                        }
                    );
                });

                return c.json(response, 200);
            } catch (err) {
                return c.json({ message: err.message }, 500);
            }
        }
    );
    
    //Post Comments 
    app.openapi(
        {
            method: 'post',
            path: '/post-polls/{id}/comments',
            tags: ['Post Polls'],
            summary: 'Post a comment for a post poll',
            request: {
                params: z.object({
                    id: z.string({ required_error: "Post Poll ID is required" }),
                }),
                body: {
                    content: {
                        "application/json": {
                            schema: z.object({
                                employee_id: z.string({ required_error: "Employee ID is required" }),
                                comment: z.string({ required_error: "Comment is required" }),
                            })
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: "Comment added successfully",
                    content: {
                        "application/json": {
                            schema: z.object({
                                comment: z.object({
                                    id: z.string(),
                                    post_id: z.string(),
                                    employee_id: z.string(),
                                    comment: z.string(),
                                    created_at: z.string().nullable(),
                                    employee: z.object({
                                        id: z.string(),
                                        organization_id: z.string(),
                                        first_name: z.string(),
                                        last_name: z.string(),
                                        email: z.string()
                                    }).nullable(),
                                }),
                                success: z.boolean(),
                                message: z.string(),
                            })
                        }
                    }
                },
                400: {
                    description: "Validation error",
                    content: {
                        "application/json": {
                            schema: z.object({ message: z.string() })
                        }
                    }
                },
                500: {
                    description: "Server error",
                    content: {
                        "application/json": {
                            schema: z.object({ message: z.string() })
                        }
                    }
                }
            }
        },
        async (c) => {
            try {
                const id = c.req.param("id");
                const body = await c.req.json();

                const employee_id = body.employee_id;
                const comment = body.comment;

                const response = await new Promise((resolve, reject) => {
                    postPollClient.addPollComment(
                        { post_id: id, employee_id, comment },
                        (err, response) => {
                            if (err) reject(err);
                            else resolve(response);
                        }
                    );
                });

                return c.json(response, 200);
            } catch (err) {
                return c.json({ message: err.message }, 500);
            }
        }
    );

    //Get poll Comments with Counts
    app.openapi(
        {
            method: 'get',
            path: '/post-polls/{id}/comments',
            tags: ['Post Polls'],
            summary: 'Get comments for a post poll',
            request: {
                params: z.object({
                    id: z.string(),
                }),
                query: z.object({
                    employee_id: z.string().optional(),
                })
            },
            responses: {
                200: {
                    description: 'Comments fetched successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                comments: z.array(
                                    z.object({
                                        id: z.string(),
                                        post_id: z.string(),
                                        employee_id: z.string(),
                                        comment: z.string(),
                                        created_at: z.string().nullable(),
                                        employee: z.object({
                                            id: z.string(),
                                            organization_id: z.string(),
                                            first_name: z.string(),
                                            last_name: z.string(),
                                            email: z.string()
                                        }).nullable(),
                                    })
                                ),
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const id = c.req.param("id");
                const { employee_id } = c.req.valid("query");

                const response = await new Promise((resolve, reject) => {
                    postPollClient.getPollComments(
                        { post_id: id, employee_id },
                        (err, response) => {
                            if (err) reject(err);
                            else resolve(response);
                        }
                    );
                });

                return c.json(response, 200);
            } catch (err) {
                return c.json({ message: err.message }, 500);
            }
        }
    );

    //Delete poll Comment By ID
    app.openapi(
        {
            method: 'delete',
            path: '/post-polls/{id}/comments/{comment_id}',
            tags: ['Post Polls'],
            summary: 'Delete a comment for a post poll',
            request: {
                params: z.object({
                    id: z.string({ required_error: "Post Poll ID is required" }),
                    comment_id: z.string({ required_error: "Comment ID is required" }),
                }),
            },
            responses: {
                200: {
                    description: 'Comment deleted successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
            },
        },
        async (c) => {
            try {
                const id = c.req.param("id");
                const comment_id = c.req.param("comment_id");

                const response = await new Promise((resolve, reject) => {
                    postPollClient.deletePollComment(
                        { comment_id },
                        (err, response) => {
                            if (err) reject(err);
                            else resolve(response);
                        }
                    );
                });

                return c.json(response, 200);
            } catch (err) {
                return c.json({ message: err.message }, 500);
            }
        }
    );  

}