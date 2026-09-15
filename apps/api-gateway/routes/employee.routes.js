import { z, ZodError } from 'zod';
import { grpc } from '@jury-hrms/proto';
import { getConnInfo } from '@hono/node-server/conninfo';
import { employeeClient } from '../grpc/employee.client.js';

function grpcToHttpStatus(code) {
    switch (code) {
        case grpc.status.INVALID_ARGUMENT: return 400;
        case grpc.status.NOT_FOUND: return 404;
        case grpc.status.ALREADY_EXISTS: return 409;
        case grpc.status.PERMISSION_DENIED: return 403;
        case grpc.status.FAILED_PRECONDITION: return 412;
        case grpc.status.UNAVAILABLE: return 503;
        default: return 500;
    }
}

// 🔎 Pull the client IP from the connection info (falling back to proxy headers).
function clientInfo(c) {
    let ip = '';
    try {
        const info = getConnInfo(c);
        ip = info?.remote?.address || '';
    } catch { /* ignore */ }
    ip = ip || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || '';
    const userAgent = c.req.header('user-agent') || '';
    return { ip_address: ip, user_agent: userAgent };
}

export default function registerEmployeeRoutes(app) {
    const numberSeriesResponse = z.object({
        id: z.string(), organization_id: z.string(), name: z.string(), prefix: z.string(),
        digits: z.number(), suffix: z.string(), next_number: z.number(), is_active: z.boolean(),
        policy_type: z.string().optional(),
        preview: z.string(), created_at: z.string(), updated_at: z.string(),
    });

    app.openapi({
        method: 'get', path: '/organizations/{organization_id}/employee-number-series', tags: ['Employee'],
        summary: 'List employee number series',
        request: { params: z.object({ organization_id: z.string() }) },
        responses: { 200: { content: { 'application/json': { schema: z.object({ series: z.array(numberSeriesResponse), success: z.boolean(), message: z.string() }) } } } },
    }, async (c) => {
        try {
            const { organization_id } = c.req.valid('param');
            const response = await new Promise((resolve, reject) => employeeClient.ListEmployeeNumberSeries({ organization_id }, (err, data) => err ? reject(err) : resolve(data)));
            return c.json(response, 200);
        } catch (error) { return c.json({ error: error.message }, 500); }
    });

    const createNumberSeriesSchema = z.object({
        name: z.string().min(1), prefix: z.string().optional().default(''),
        digits: z.number().int().min(1).max(10), suffix: z.string().optional().default(''),
        next_number: z.number().int().min(1).default(1),
        policy_type: z.enum(['PROBATION', 'INTERNSHIP', 'TRAINEE', 'CONTRACT', 'PERMANENT']).optional().default('PROBATION'),
    });

    app.openapi({
        method: 'post', path: '/organizations/{organization_id}/employee-number-series', tags: ['Employee'],
        summary: 'Create employee number series',
        request: { params: z.object({ organization_id: z.string() }), body: { content: { 'application/json': { schema: createNumberSeriesSchema } } } },
        responses: { 201: { content: { 'application/json': { schema: z.object({ series: numberSeriesResponse, success: z.boolean(), message: z.string() }) } } } },
    }, async (c) => {
        try {
            const { organization_id } = c.req.valid('param');
            const body = createNumberSeriesSchema.parse(await c.req.json());
            const response = await new Promise((resolve, reject) => employeeClient.CreateEmployeeNumberSeries({ organization_id, ...body }, (err, data) => err ? reject(err) : resolve(data)));
            return c.json(response, 201);
        } catch (error) { return c.json({ error: error.message }, error.code === 6 ? 409 : 500); }
    });

    app.openapi({
        method: 'put', path: '/organizations/{organization_id}/employee-number-series/{series_id}', tags: ['Employee'],
        summary: 'Update employee number series',
        request: {
            params: z.object({ organization_id: z.string(), series_id: z.string() }),
            body: { content: { 'application/json': { schema: createNumberSeriesSchema.extend({ is_active: z.boolean().optional() }) } } },
        },
        responses: { 200: { content: { 'application/json': { schema: z.object({ series: numberSeriesResponse, success: z.boolean(), message: z.string() }) } } } },
    }, async (c) => {
        try {
            const { organization_id, series_id } = c.req.valid('param');
            const body = await c.req.json();
            const response = await new Promise((resolve, reject) => employeeClient.UpdateEmployeeNumberSeries({ id: series_id, organization_id, ...body }, (err, data) => err ? reject(err) : resolve(data)));
            return c.json(response, 200);
        } catch (error) { return c.json({ error: error.message }, error.code === 6 ? 409 : 500); }
    });

    // ✅ Schema for creating an employee
    const addressSchema = z.object({
        addressLine1: z.string().max(255).optional().nullable(),
        addressLine2: z.string().max(255).optional().nullable(),
        city: z.string().max(120).optional().nullable(),
        state: z.string().max(120).optional().nullable(),
        country: z.string().max(120).optional().nullable(),
        postalCode: z.string().max(12).optional().nullable()
            .refine(v => v == null || v === '' || /^[a-zA-Z0-9-]{3,12}$/.test(v), 'Postal code must be 3-12 alphanumeric characters'),
    }).optional().nullable();

    const createEmployeeSchema = z.object({
        organizationId: z.string({ required_error: 'Organization ID is required' }),
        categoryId: z.string().optional().nullable(),
        designationId: z.string().optional(),
        managerId: z.string().optional().nullable(),
        branchId: z.string().optional().nullable(),
        locationId: z.string().optional().nullable(),
        firstName: z.string().min(2, 'First name must have at least 2 characters').optional().nullable(),
        lastName: z.string().min(1, 'Last name must have at least 1 characters').optional().nullable(),
        fullName: z.string().optional().nullable(),
        email: z.string().email('Invalid email format').optional().nullable(),
        phone: z.string().regex(/^[0-9]{10}$/, 'Phone number must be 10 digits'),
        altPhone: z.string().optional().nullable()
            .refine(v => v == null || v === '' || /^[0-9]{6,15}$/.test(v), 'Work number must be 6-15 digits'),
        isAdmin: z.boolean().optional(),
        isActive: z.boolean().optional(),
        isPermanent: z.boolean().optional(),
        workerType: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'PERMANENT']).optional().nullable(),
        gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'UNKNOWN']).optional().nullable(),
        dateOfBirth: z.string().refine(v => v === '' || !isNaN(Date.parse(v)), {
            message: 'dateOfBirth must be a valid ISO date',
        }).optional().nullable(),
        joiningDate: z.string().refine(v => v === '' || !isNaN(Date.parse(v)), {
            message: 'joiningDate must be a valid ISO date',
        }).optional().nullable(),
        probationPolicyId: z.string().optional().nullable(),
        probationStartDate: z.string().refine(v => v === '' || !isNaN(Date.parse(v)), {
            message: 'probationStartDate must be a valid ISO date',
        }).optional().nullable(),
        probationEndDate: z.string().refine(v => v === '' || !isNaN(Date.parse(v)), {
            message: 'probationEndDate must be a valid ISO date',
        }).optional().nullable(),
        numberSeriesId: z.string().optional().nullable(),
        employeeCode: z.string().optional().nullable(),
        displayName: z.string().max(120).optional().nullable(),
        maritalStatus: z.string().max(50).optional().nullable(),
        bloodGroup: z.string().max(20).optional().nullable(),
        physicallyHandicapped: z.boolean().optional(),
        nationality: z.string().max(120).optional().nullable(),
        personalEmail: z.string().email('Invalid personal email format').optional().nullable().or(z.literal('')),
        professionalSummary: z.string().max(2000).optional().nullable(),
        about: z.string().max(5000).optional().nullable(),
        whatILoveAboutJob: z.string().max(2000).optional().nullable(),
        interestsAndHobbies: z.string().max(2000).optional().nullable(),
        profileImage: z.string().max(500).optional().nullable(),
        profileImageFileId: z.string().optional().nullable(),
        costCenterId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid cost_center_id').optional().nullable(),
        payGradeId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid pay_grade_id').optional().nullable(),
        bandId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid band_id').optional().nullable(),
        noticePeriodPolicyId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid notice_period_policy_id').optional().nullable(),
        currentAddress: addressSchema,
        permanentAddress: addressSchema,
    });

    // 🟢 Create Employee
    app.openapi(
        {
            method: 'post',
            path: '/employees',
            tags: ['Employee'],
            summary: 'Create a new employee',
            request: {
                body: { content: { 'application/json': { schema: createEmployeeSchema } } },
            },
            responses: {
                201: {
                    description: 'Employee created successfully',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                organization_id: z.string(),
                                category_id: z.string(),
                                designation_id: z.string().optional(),
                                first_name: z.string().optional(),
                                last_name: z.string().optional(),
                                full_name: z.string(),
                                email: z.string().optional(),
                                phone: z.string(),
                                alt_phone: z.string().optional(),
                                gender: z.number(),
                                date_of_birth: z.string(),
                                created_at: z.string(),
                                updated_at: z.string(),
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
                                        message: z.string()
                                    })
                                )
                            })
                        }
                    }
                }
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = createEmployeeSchema.parse(body);
                
                const grpcPayload = {
                    organization_id: parsed.organizationId,
                    category_id: parsed.categoryId || '',
                    designation_id: parsed.designationId ?? null,
                    manager_id: parsed.managerId || '',
                    branch_id: parsed.branchId || '',
                    location_id: parsed.locationId || '',
                    first_name: parsed.firstName ?? null,
                    last_name: parsed.lastName ?? null,
                    full_name: parsed.fullName ?? null,
                    is_admin: parsed.isAdmin ?? null,
                    is_active: parsed.isActive !== undefined ? parsed.isActive : true,
                    is_permanent: parsed.isPermanent ?? false,
                    worker_type: parsed.workerType || '',
                    email: parsed.email ?? null,
                    phone: parsed.phone,
                    alt_phone: parsed.altPhone ?? null,
                    gender: parsed.gender,
                    date_of_birth: parsed.dateOfBirth ?? null,
                    joining_date: parsed.joiningDate || '',
                    probation_policy_id: parsed.probationPolicyId || '',
                    probation_start_date: parsed.probationStartDate || '',
                    probation_end_date: parsed.probationEndDate || '',
                    number_series_id: parsed.numberSeriesId || '',
                    employee_code: parsed.employeeCode || '',
                    display_name: parsed.displayName || '',
                    marital_status: parsed.maritalStatus || '',
                    blood_group: parsed.bloodGroup || '',
                    physically_handicapped: parsed.physicallyHandicapped ?? false,
                    nationality: parsed.nationality || '',
                    personal_email: parsed.personalEmail || '',
                    professional_summary: parsed.professionalSummary || '',
                    about: parsed.about || '',
                    what_i_love_about_job: parsed.whatILoveAboutJob || '',
                    interests_and_hobbies: parsed.interestsAndHobbies || '',
                    current_address: parsed.currentAddress ? JSON.stringify(parsed.currentAddress) : '',
                    permanent_address: parsed.permanentAddress ? JSON.stringify(parsed.permanentAddress) : '',
                    profile_image: parsed.profileImage || '',
                    profile_image_file_id: parsed.profileImageFileId || '',
                    cost_center_id: parsed.costCenterId || '',
                    pay_grade_id: parsed.payGradeId || '',
                    band_id: parsed.bandId || '',
                    notice_period_policy_id: parsed.noticePeriodPolicyId || '',
                };

                const response = await new Promise((resolve, reject) => {
                    employeeClient.CreateEmployee(grpcPayload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 201);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({
                        error: 'Validation failed',
                        details: error.errors.map(e => ({
                            field: e.path.join('.'),
                            message: e.message
                        }))
                    }, 400);
                }
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        },
    );

    // 🟣 Get Employee by ID
    app.openapi(
        {
            method: 'get',
            path: '/employee/{id}',
            tags: ['Employee'],
            summary: 'Fetch employee by ID',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Employee ID is required' })
                })
            },
            responses: {
                200: {
                    description: 'Employee details',
                    content: {
                        'application/json': {
                            schema: z.object({
                                id: z.string(),
                                organization_id: z.string(),
                                category_id: z.string(),
                                designation_id: z.string().optional(),
                                first_name: z.string().optional(),
                                last_name: z.string().optional(),
                                full_name: z.string(),
                                email: z.string().optional(),
                                phone: z.string(),
                                alt_phone: z.string().optional(),
                                gender: z.number(),
                                date_of_birth: z.string(),
                                created_at: z.string(),
                                updated_at: z.string(),
                            })
                        }
                    }
                },
                404: {
                    description: 'Employee not found'
                }
            }
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const response = await new Promise((resolve, reject) => {
                    employeeClient.GetEmployee({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                if (!response) {
                    return c.json({ error: 'Employee not found' }, 404);
                }

                return c.json(response);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    // 🟡 List Employees — Paginated + Search + Sort
    app.openapi(
        {
            method: 'get',
            path: '/employees/all',
            tags: ['Employee'],
            summary: 'List employees for single organization',
            request: {
                query: z.object({
                    organization_id: z.string().optional(),
                    department_id: z.string().optional(),
                    location_id: z.string().optional(),
                    probation_policy_id: z.string().optional(),
                    only_active: z.string().optional(),
                }),
            },
            responses: {
                200: {
                    description: 'Paginated list of employees',
                    content: {
                        'application/json': {
                            schema: z.object({
                                employees: z.array(
                                    z.object({
                                        id: z.string(),
                                        organization_id: z.string(),
                                        category_id: z.string(),
                                        designation_id: z.string().optional(),
                                        first_name: z.string().optional(),
                                        last_name: z.string().optional(),
                                        full_name: z.string(),
                                        email: z.string().optional(),
                                        phone: z.string(),
                                        alt_phone: z.string().optional(),
                                        gender: z.number(),
                                        date_of_birth: z.string(),
                                        created_at: z.string(),
                                        updated_at: z.string(),
                                    })
                                ),
                                total: z.number(),
                                page: z.number(),
                                limit: z.number(),
                                total_pages: z.number(),
                            })
                        }
                    }
                }
            }
        },
        async (c) => {
            try {
                const query = c.req.valid('query');
                const response = await new Promise((resolve, reject) => {
                    employeeClient.ListAllEmployees(
                        {
                            organization_id: query.organization_id,
                            department_id: query.department_id,
                            location_id: query.location_id,
                            probation_policy_id: query.probation_policy_id,
                            only_active: query.only_active?.toLowerCase() === 'true' ? true : false,
                        },
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


    app.openapi(
        {
            method: 'get',
            path: '/employees',
            tags: ['Employee'],
            summary: 'List employees with pagination, search, and sorting',
            request: {
                query: z.object({
                    organization_id: z.string().optional(),
                    category_id: z.string().optional(),
                    designation_id: z.string().optional(),
                    department_id: z.string().optional(),
                    branch_id: z.string().optional(),
                    location_id: z.string().optional(),
                    search: z.string().optional(),
                    sort_by: z.string().optional().default('created_at'),
                    sort_order: z.enum(['asc', 'desc']).optional().default('desc'),
                    limit: z.coerce.number().optional().default(10),
                    page: z.coerce.number().optional().default(1),
                }),
            },
            responses: {
                200: {
                    description: 'Paginated list of employees',
                    content: {
                        'application/json': {
                            schema: z.object({
                                employees: z.array(
                                    z.object({
                                        id: z.string(),
                                        organization_id: z.string(),
                                        category_id: z.string(),
                                        designation_id: z.string().optional(),
                                        first_name: z.string().optional(),
                                        last_name: z.string().optional(),
                                        full_name: z.string(),
                                        email: z.string().optional(),
                                        phone: z.string(),
                                        alt_phone: z.string().optional(),
                                        gender: z.number(),
                                        date_of_birth: z.string(),
                                        created_at: z.string(),
                                        updated_at: z.string(),
                                    })
                                ),
                                total: z.number(),
                                page: z.number(),
                                limit: z.number(),
                                total_pages: z.number(),
                            })
                        }
                    }
                }
            }
        },
        async (c) => {
            try {
                const query = c.req.valid('query');
                const response = await new Promise((resolve, reject) => {
                    employeeClient.ListEmployees(
                        {
                            organization_id: query.organization_id,
                            category_id: query.category_id,
                            designation_id: query.designation_id,
                            department_id: query.department_id,
                            branch_id: query.branch_id,
                            location_id: query.location_id,
                            page: query.page,
                            limit: query.limit,
                            search: query.search,
                            sort_by: query.sort_by,
                            sort_order: query.sort_order
                        },
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

    const updateEmployeeSchema = createEmployeeSchema
        .extend({ id: z.string({ required_error: 'Employee ID is required' }) })
        .partial();

    // 🟠 Update Employee
    app.openapi(
        {
            method: 'put',
            path: '/employees/{id}',
            tags: ['Employee'],
            summary: 'Update employee details',
            request: {
                params: z.object({ id: z.string() }),
                body: {
                    content: {
                        'application/json': { schema: updateEmployeeSchema.omit({ id: true }) },
                    },
                },
            },
            responses: {
                200: {
                    description: 'Employee updated successfully'
                }
            }
        },
        async (c) => {
            try {
                const id = c.req.param('id');
                const body = await c.req.json();
                const parsed = updateEmployeeSchema.parse({ ...body, id });

                const grpcPayload = {
                    id,
                    organization_id: parsed.organizationId,
                    category_id: parsed.categoryId,
                    designation_id: parsed.designationId,
                    manager_id: parsed.managerId || '',
                    branch_id: parsed.branchId || '',
                    location_id: parsed.locationId || '',
                    first_name: parsed.firstName,
                    last_name: parsed.lastName,
                    full_name: parsed.fullName,
                    email: parsed.email,
                    is_admin: parsed.isAdmin,
                    is_active: parsed.isActive !== undefined ? parsed.isActive : undefined,
                    phone: parsed.phone,
                    alt_phone: parsed.altPhone,
                    gender: parsed.gender,
                    date_of_birth: parsed.dateOfBirth,
                    joining_date: parsed.joiningDate === undefined ? undefined : (parsed.joiningDate || ''),
                    probation_policy_id: parsed.probationPolicyId || '',
                    probation_start_date: parsed.probationStartDate === undefined ? undefined : (parsed.probationStartDate || ''),
                    probation_end_date: parsed.probationEndDate === undefined ? undefined : (parsed.probationEndDate || ''),
                    is_permanent: parsed.isPermanent !== undefined ? parsed.isPermanent : undefined,
                    worker_type: parsed.workerType === undefined ? undefined : (parsed.workerType || ''),
                    number_series_id: parsed.numberSeriesId === undefined ? undefined : (parsed.numberSeriesId || ''),
                    employee_code: parsed.employeeCode === undefined ? undefined : (parsed.employeeCode || ''),
                    display_name: parsed.displayName === undefined ? undefined : (parsed.displayName || ''),
                    marital_status: parsed.maritalStatus === undefined ? undefined : (parsed.maritalStatus || ''),
                    blood_group: parsed.bloodGroup === undefined ? undefined : (parsed.bloodGroup || ''),
                    physically_handicapped: parsed.physicallyHandicapped === undefined ? undefined : Boolean(parsed.physicallyHandicapped),
                    nationality: parsed.nationality === undefined ? undefined : (parsed.nationality || ''),
                    personal_email: parsed.personalEmail === undefined ? undefined : (parsed.personalEmail || ''),
                    professional_summary: parsed.professionalSummary === undefined ? undefined : (parsed.professionalSummary || ''),
                    about: parsed.about === undefined ? undefined : (parsed.about || ''),
                    what_i_love_about_job: parsed.whatILoveAboutJob === undefined ? undefined : (parsed.whatILoveAboutJob || ''),
                    interests_and_hobbies: parsed.interestsAndHobbies === undefined ? undefined : (parsed.interestsAndHobbies || ''),
                    profile_image: parsed.profileImage === undefined ? undefined : (parsed.profileImage || ''),
                    profile_image_file_id: parsed.profileImageFileId === undefined ? undefined : (parsed.profileImageFileId || ''),
                    cost_center_id: parsed.costCenterId === undefined ? undefined : (parsed.costCenterId || ''),
                    pay_grade_id: parsed.payGradeId === undefined ? undefined : (parsed.payGradeId || ''),
                    band_id: parsed.bandId === undefined ? undefined : (parsed.bandId || ''),
                    notice_period_policy_id: parsed.noticePeriodPolicyId === undefined ? undefined : (parsed.noticePeriodPolicyId || ''),
                    current_address: parsed.currentAddress === undefined
                        ? undefined
                        : (parsed.currentAddress ? JSON.stringify(parsed.currentAddress) : ''),
                    permanent_address: parsed.permanentAddress === undefined
                        ? undefined
                        : (parsed.permanentAddress ? JSON.stringify(parsed.permanentAddress) : ''),
                };

                const response = await new Promise((resolve, reject) => {
                    employeeClient.UpdateEmployee(grpcPayload, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 200);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({
                        error: 'Validation failed',
                        details: error.errors.map(e => ({
                            field: e.path.join('.'),
                            message: e.message
                        }))
                    }, 400);
                }
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        },
    );

    // 🔴 Delete Employee
    app.openapi(
        {
            method: 'delete',
            path: '/employees/{id}',
            tags: ['Employee'],
            summary: 'Delete an employee',
            request: {
                params: z.object({
                    id: z.string({ required_error: 'Employee ID is required' })
                })
            },
            responses: {
                200: {
                    description: 'Employee deleted successfully'
                }
            }
        },
        async (c) => {
            try {
                const id = c.req.param('id');

                const response = await new Promise((resolve, reject) => {
                    employeeClient.DeleteEmployee({ id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });

                return c.json(response, 200);
            } catch (error) {
                return c.json({ error: error.message }, 500);
            }
        }
    );

    // 🔄 Extend employee probation by N months
    app.openapi({
        method: 'post', path: '/employees/{id}/probation/extend', tags: ['Employee'],
        summary: 'Extend employee probation period',
        request: {
            params: z.object({ id: z.string() }),
            body: {
                content: {
                    'application/json': {
                        schema: z.object({
                            organization_id: z.string().optional(),
                            months: z.number().int().min(1, 'months must be a positive integer'),
                        }),
                    },
                },
            },
        },
        responses: {
            200: { description: 'Probation extended successfully' },
            400: { description: 'Validation error' },
            404: { description: 'Employee not found' },
        },
    }, async (c) => {
        try {
            const id = c.req.param('id');
            const body = await c.req.json();
            const response = await new Promise((resolve, reject) => {
                employeeClient.ExtendProbation({ id, ...body, ...clientInfo(c) }, (err, resp) => {
                    if (err) return reject(err);
                    resolve(resp);
                });
            });
            return c.json(response, 200);
        } catch (error) {
            if (error instanceof ZodError) {
                return c.json({
                    error: 'Validation failed',
                    details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
                }, 400);
            }
            const status = error.code === 5 ? 404 : (error.code === 8 ? 409 : 500);
            return c.json({ error: error.message }, status);
        }
    });

    // 🔁 Change an employee's probation policy
    app.openapi({
        method: 'post', path: '/employees/{id}/probation/policy', tags: ['Employee'],
        summary: 'Change employee probation policy',
        request: {
            params: z.object({ id: z.string() }),
            body: {
                content: {
                    'application/json': {
                        schema: z.object({
                            organization_id: z.string().optional(),
                            probation_policy_id: z.string().optional().nullable(),
                        }),
                    },
                },
            },
        },
        responses: {
            200: { description: 'Probation policy updated successfully' },
            400: { description: 'Validation error' },
            404: { description: 'Employee not found' },
        },
    }, async (c) => {
        try {
            const id = c.req.param('id');
            const body = await c.req.json();
            const response = await new Promise((resolve, reject) => {
                employeeClient.ChangeProbationPolicy({ id, ...body, ...clientInfo(c) }, (err, resp) => {
                    if (err) return reject(err);
                    resolve(resp);
                });
            });
            return c.json(response, 200);
        } catch (error) {
            if (error instanceof ZodError) {
                return c.json({
                    error: 'Validation failed',
                    details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
                }, 400);
            }
            return c.json({ error: error.message }, error.code === 5 ? 404 : 500);
        }
    });

    app.openapi(
        {
            method: 'post',
            path: '/employee/login/request-otp',
            tags: ['Employee'],
            summary: 'Request login OTP (email-only delivery)',
            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                email: z.string().email().optional(),
                                phone: z.string().optional(),
                                purpose: z.string().optional().default('login'),
                            })
                                .refine(b => b.email || b.phone, { message: 'Provide email or phone' })
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: 'OTP sent',
                    content: { 'application/json': { schema: z.object({ message: z.string(), authentication_type: z.enum(['Basic', 'Mobile OTP']) }) } }
                },
                404: { description: 'Admin not found' }
            }
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const resp = await new Promise((resolve, reject) => {
                    employeeClient.RequestLoginOtp({ ...body, ...clientInfo(c) }, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, error.code === 5 ? 404 : 500);
            }
        }
    );

    // ===== Verify Token
    app.openapi({
        method: 'post',
        path: '/employee/auth/verify-token',
        tags: ['Employee'],
        summary: 'Verify a JWT token and return decoded data',
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: z.object({ token: z.string() })
                    }
                }
            }
        },
        responses: {
            200: {
                description: 'Token data',
                content: {
                    'application/json': {
                        schema: z.object({
                            sub: z.string(),
                            user: z.object(),
                            email: z.string().optional(),
                            scope: z.string().optional(),
                            typ: z.string(),
                            iat: z.string(),
                            exp: z.string(),
                            success: z.boolean(),
                            message: z.string(),
                            authentication_type: z.string().optional(),
                        })
                    }
                }
            }
        }
    }, async (c) => {
        try {
            const { token } = await c.req.json();
            const response = await new Promise((resolve, reject) => {
                employeeClient.VerifyToken({ token }, (err, resp) => {
                    if (err) return reject(err);
                    resolve(resp);
                });
            });
            return c.json({
                ...response,
                success: true,
                message: 'Token verified successfully',
                user: response.user
            }, 200);
        } catch (error) {
            return c.json({ error: error.message }, error.code === 5 ? 404 : 500);
        }
    });

    // ===== Verify OTP
    app.openapi(
        {
            method: 'post',
            path: '/employee/login/verify',
            tags: ['Employee'],
            summary: 'Verify OTP and get tokens',
            request: {
                body: {
                    content: {
                        'application/json': {
                            schema: z.object({
                                email: z.string().email().optional(),
                                phone: z.string().optional(),
                                otp: z.string().regex(/^\d{6}$/)
                            }).refine(b => b.email || b.phone, { message: 'Provide email or phone' })
                        }
                    }
                }
            },
            responses: {
                200: {
                    description: 'Tokens', content: {
                        'application/json': {
                            schema: z.object({
                                access_token: z.string(),
                                refresh_token: z.string(),
                                token_type: z.string(),
                                expires_in: z.string(),
                                authentication_type: z.enum(['Basic', 'Mobile OTP']),
                                admin: z.object({
                                    id: z.string(),
                                    email: z.string(),
                                    phone: z.string(),
                                    created_at: z.string().optional(),
                                    updated_at: z.string().optional(),
                                    deleted_at: z.string().optional(),
                                })
                            })
                        }
                    }
                },
                403: { description: 'Invalid/expired OTP' }
            }
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const resp = await new Promise((resolve, reject) => {
                    employeeClient.VerifyLoginOtp({ ...body, ...clientInfo(c) }, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                const code = error.code === 7 ? 403 : (error.code === 5 ? 404 : 500);
                return c.json({ error: error.message }, code);
            }
        }
    );

    // ===== Refresh tokens
    app.openapi(
        {
            method: 'post',
            path: '/employee/token/refresh',
            tags: ['Employee'],
            summary: 'Issue new tokens using refresh token',
            request: {
                body: { content: { 'application/json': { schema: z.object({ refresh_token: z.string() }) } } }
            },
            responses: { 200: { description: 'Tokens' } }
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const resp = await new Promise((resolve, reject) => {
                    employeeClient.RefreshTokens(body, (err, r) => err ? reject(err) : resolve(r));
                });
                return c.json(resp, 200);
            } catch (error) {
                return c.json({ error: error.message }, error.code === 7 ? 403 : 500);
            }
        }
    );

    /* -------------------------------------------------------
     🏢 Org Chart (Reporting Tree)
    ------------------------------------------------------- */
    const OrgChartNodeSchema = z.object({
        id: z.string(),
        full_name: z.string(),
        email: z.string(),
        phone: z.string(),
        employee_code: z.string(),
        designation: z.string(),
        department: z.string(),
        category: z.string(),
        organization_id: z.string(),
        manager_id: z.string(),
        profile_image: z.string(),
        date_of_birth: z.string(),
        gender: z.string(),
        department_head_of: z.array(z.string()),
        reportees: z.array(z.any()),
    });

    const OrgChartResponseSchema = z.object({
        organization_id: z.string(),
        department_id: z.string(),
        roots: z.array(OrgChartNodeSchema),
        success: z.boolean(),
        message: z.string(),
    });

    app.openapi(
        {
            method: 'get',
            path: '/organizations/{organization_id}/org-chart',
            tags: ['Employee'],
            summary: 'Get organization chart as reporting tree',
            description: 'Returns a recursive reporting tree of all employees, optionally filtered by department.',
            request: {
                params: z.object({
                    organization_id: z.string({ required_error: 'Organization ID is required' }),
                }),
                query: z.object({
                    department_id: z.string().optional(),
                    branch_id: z.string().optional(),
                }),
            },
            responses: {
                200: {
                    description: 'Organization chart tree',
                    content: { 'application/json': { schema: OrgChartResponseSchema } },
                },
                400: { description: 'Invalid input' },
                500: { description: 'Server error' },
            },
        },
        async (c) => {
            try {
                const { organization_id } = c.req.valid('param');
                const { department_id, branch_id } = c.req.valid('query');

                const response = await new Promise((resolve, reject) => {
                    employeeClient.GetOrgChart(
                        { organization_id, department_id: department_id || '', branch_id: branch_id || '' },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        },
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                console.error('OrgChart error:', error);
                return c.json({ error: error.message || 'Internal error' }, 500);
            }
        }
    );

    // 🔐 Login Logs (audit trail for employee sign-ins)
    const loginLogSchema = z.object({
        id: z.string(),
        employee_id: z.string(),
        employee_code: z.string(),
        employee_name: z.string(),
        email: z.string(),
        phone: z.string(),
        organization_id: z.string(),
        status: z.string(),
        issue: z.string(),
        authentication_type: z.string(),
        ip_address: z.string(),
        user_agent: z.string(),
        created_at: z.string(),
    });

    app.openapi(
        {
            method: 'get',
            path: '/organizations/{organization_id}/login-logs',
            tags: ['Employee'],
            summary: 'List employee login logs (history & failed attempts)',
            description: 'Returns paginated login attempts for an organization. Filter by status (SUCCESS/FAILED) to separate login history from failed logins.',
            request: {
                params: z.object({
                    organization_id: z.string({ required_error: 'Organization ID is required' }),
                }),
                query: z.object({
                    status: z.enum(['SUCCESS', 'FAILED']).optional(),
                    issue: z.string().optional(),
                    page: z.coerce.number().int().min(1).optional().default(1),
                    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
                }),
            },
            responses: {
                200: {
                    description: 'List of login logs',
                    content: {
                        'application/json': {
                            schema: z.object({
                                logs: z.array(loginLogSchema),
                                total: z.number(),
                                page: z.number(),
                                limit: z.number(),
                                total_pages: z.number(),
                                success: z.boolean(),
                                message: z.string(),
                            }),
                        },
                    },
                },
                500: { description: 'Server error' },
            },
        },
        async (c) => {
            try {
                const { organization_id } = c.req.valid('param');
                const { status, issue, page, limit } = c.req.valid('query');

                const response = await new Promise((resolve, reject) => {
                    employeeClient.ListLoginLogs(
                        { organization_id, status: status || '', issue: issue || '', page, limit },
                        (err, resp) => {
                            if (err) return reject(err);
                            resolve(resp);
                        },
                    );
                });

                return c.json(response, 200);
            } catch (error) {
                console.error('ListLoginLogs error:', error);
                return c.json({ error: error.message || 'Internal error' }, 500);
            }
        }
    );

    /* ============================ EMPLOYEE RELATIONSHIP ROUTES ============================ */

    const VALID_RELATIONSHIP_TYPES = ['CHILD', 'FATHER', 'FATHER_IN_LAW', 'MOTHER', 'MOTHER_IN_LAW', 'OTHERS', 'PARTNER', 'SPOUSE', 'SELF', 'SIBLING'];
    const VALID_GENDER_TYPES = ['MALE', 'FEMALE', 'OTHER'];

    function grpcCall(payload) {
        return new Promise((resolve, reject) => {
            employeeClient.ListEmployeeRelationships(payload, (err, resp) => {
                if (err) return reject(err);
                resolve(resp);
            });
        });
    }

    function grpcCreate(payload) {
        return new Promise((resolve, reject) => {
            employeeClient.CreateEmployeeRelationship(payload, (err, resp) => {
                if (err) return reject(err);
                resolve(resp);
            });
        });
    }

    function grpcUpdate(payload) {
        return new Promise((resolve, reject) => {
            employeeClient.UpdateEmployeeRelationship(payload, (err, resp) => {
                if (err) return reject(err);
                resolve(resp);
            });
        });
    }

    function grpcDelete(payload) {
        return new Promise((resolve, reject) => {
            employeeClient.DeleteEmployeeRelationship(payload, (err, resp) => {
                if (err) return reject(err);
                resolve(resp);
            });
        });
    }

    const relationshipSchema = z.object({
        relationship: z.enum(VALID_RELATIONSHIP_TYPES),
        first_name: z.string().min(1).max(100),
        last_name: z.string().max(100).optional().nullable(),
        gender: z.enum(VALID_GENDER_TYPES).optional().nullable(),
        email: z.string().email().optional().nullable().or(z.literal('')),
        phone: z.string().max(20).optional().nullable(),
        profession: z.string().max(100).optional().nullable(),
        date_of_birth: z.string().optional().nullable(),
    });

    // GET /employees/:employee_id/relationships
    app.openapi(
        {
            method: 'get',
            path: '/employees/{employee_id}/relationships',
            tags: ['Employee Relationship'],
            summary: 'List relationships for an employee',
            request: {
                params: z.object({
                    employee_id: z.string({ required_error: 'Employee ID is required' }),
                }),
            },
            responses: { 200: { description: 'Relationships listed successfully' } },
        },
        async (c) => {
            try {
                const { employee_id } = c.req.valid('param');
                const empRes = await new Promise((resolve, reject) => {
                    employeeClient.GetEmployee({ id: employee_id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });
                const employee = empRes?.employee;
                if (!employee) return c.json({ error: 'Employee not found' }, 404);

                const response = await grpcCall({
                    employee_id,
                    organization_id: employee.organization_id,
                });
                return c.json(response);
            } catch (error) {
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        },
    );

    // POST /employees/:employee_id/relationships
    app.openapi(
        {
            method: 'post',
            path: '/employees/{employee_id}/relationships',
            tags: ['Employee Relationship'],
            summary: 'Create a relationship for an employee',
            request: {
                params: z.object({
                    employee_id: z.string({ required_error: 'Employee ID is required' }),
                }),
                body: { content: { 'application/json': { schema: relationshipSchema } } },
            },
            responses: { 201: { description: 'Relationship created successfully' } },
        },
        async (c) => {
            try {
                const { employee_id } = c.req.valid('param');
                const empRes = await new Promise((resolve, reject) => {
                    employeeClient.GetEmployee({ id: employee_id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });
                const employee = empRes?.employee;
                if (!employee) return c.json({ error: 'Employee not found' }, 404);

                const body = await c.req.json();
                const parsed = relationshipSchema.parse(body);

                const response = await grpcCreate({
                    employee_id,
                    organization_id: employee.organization_id,
                    ...parsed,
                });
                return c.json(response, 201);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({ error: 'Validation failed', details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message })) }, 400);
                }
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        },
    );

    // PUT /employees/:employee_id/relationships/:relationshipId
    app.openapi(
        {
            method: 'put',
            path: '/employees/{employee_id}/relationships/{relationshipId}',
            tags: ['Employee Relationship'],
            summary: 'Update a relationship for an employee',
            request: {
                params: z.object({
                    employee_id: z.string({ required_error: 'Employee ID is required' }),
                    relationshipId: z.string({ required_error: 'Relationship ID is required' }),
                }),
                body: { content: { 'application/json': { schema: relationshipSchema.partial() } } },
            },
            responses: { 200: { description: 'Relationship updated successfully' } },
        },
        async (c) => {
            try {
                const { employee_id, relationshipId } = c.req.valid('param');
                const empRes = await new Promise((resolve, reject) => {
                    employeeClient.GetEmployee({ id: employee_id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });
                const employee = empRes?.employee;
                if (!employee) return c.json({ error: 'Employee not found' }, 404);

                const body = await c.req.json();
                const parsed = relationshipSchema.partial().parse(body);

                const response = await grpcUpdate({
                    id: relationshipId,
                    employee_id,
                    organization_id: employee.organization_id,
                    ...parsed,
                });
                return c.json(response);
            } catch (error) {
                if (error instanceof ZodError) {
                    return c.json({ error: 'Validation failed', details: error.errors.map(e => ({ field: e.path.join('.'), message: e.message })) }, 400);
                }
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        },
    );

    // DELETE /employees/:employee_id/relationships/:relationshipId
    app.openapi(
        {
            method: 'delete',
            path: '/employees/{employee_id}/relationships/{relationshipId}',
            tags: ['Employee Relationship'],
            summary: 'Delete a relationship for an employee',
            request: {
                params: z.object({
                    employee_id: z.string({ required_error: 'Employee ID is required' }),
                    relationshipId: z.string({ required_error: 'Relationship ID is required' }),
                }),
            },
            responses: { 200: { description: 'Relationship deleted successfully' } },
        },
        async (c) => {
            try {
                const { employee_id, relationshipId } = c.req.valid('param');
                const empRes = await new Promise((resolve, reject) => {
                    employeeClient.GetEmployee({ id: employee_id }, (err, resp) => {
                        if (err) return reject(err);
                        resolve(resp);
                    });
                });
                const employee = empRes?.employee;
                if (!employee) return c.json({ error: 'Employee not found' }, 404);

                const response = await grpcDelete({
                    id: relationshipId,
                    employee_id,
                    organization_id: employee.organization_id,
                });
                return c.json(response);
            } catch (error) {
                return c.json({ error: error.message }, grpcToHttpStatus(error.code));
            }
        },
    );
}
