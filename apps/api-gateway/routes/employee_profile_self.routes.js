import { z, ZodError } from 'zod';
import { grpc } from '@jury-hrms/proto';
import { employeeClient } from '../grpc/employee.client.js';

const VALID_RELATIONSHIP_TYPES = ['CHILD', 'FATHER', 'FATHER_IN_LAW', 'MOTHER', 'MOTHER_IN_LAW', 'OTHERS', 'PARTNER', 'SPOUSE', 'SELF', 'SIBLING'];
const VALID_GENDER_TYPES = ['MALE', 'FEMALE', 'OTHER'];

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

function grpcCall(client, method, payload) {
    return new Promise((resolve, reject) => {
        client[method](payload, (err, resp) => {
            if (err) return reject(err);
            resolve(resp);
        });
    });
}

export default function registerEmployeeProfileSelfRoutes({ openapi }) {
    /* ============================ EMPLOYEE SELF-SERVICE PROFILE ============================ */

    // GET /employee-profile/my/about
    // Returns About fields for the authenticated employee only.
    openapi({ method: 'get', path: '/employee-profile/my/about', tags: ['Employee-Profile'], summary: 'Employee self-service: get my About fields', responses: { 200: {}, 401: {}, 403: {} } },
        async (c) => {
            try {
                const employeeId = c.get('employeeId');
                if (!employeeId) return c.json({ error: 'Unauthorized' }, 401);

                const empRes = await grpcCall(employeeClient, 'GetEmployee', { id: employeeId });
                const employee = empRes?.employee;
                if (!employee) {
                    return c.json({ error: 'Employee not found' }, 404);
                }

                return c.json({
                    success: true,
                    about: {
                        about: employee.about || '',
                        what_i_love_about_job: employee.what_i_love_about_job || '',
                        interests_and_hobbies: employee.interests_and_hobbies || '',
                    },
                });
            } catch (e) {
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    // PUT /employee-profile/my/about
    // Updates About fields for the authenticated employee only.
    openapi({ method: 'put', path: '/employee-profile/my/about', tags: ['Employee-Profile'], summary: 'Employee self-service: update my About fields', request: {
        body: { content: { 'application/json': { schema: z.object({
            about: z.string().max(5000).optional().nullable(),
            what_i_love_about_job: z.string().max(2000).optional().nullable(),
            interests_and_hobbies: z.string().max(2000).optional().nullable(),
        }) } } },
    }, responses: { 200: {}, 400: {}, 401: {}, 403: {} } },
        async (c) => {
            try {
                const employeeId = c.get('employeeId');
                if (!employeeId) return c.json({ error: 'Unauthorized' }, 401);

                const empRes = await grpcCall(employeeClient, 'GetEmployee', { id: employeeId });
                const employee = empRes?.employee;
                if (!employee) {
                    return c.json({ error: 'Employee not found' }, 404);
                }

                const body = await c.req.json();
                const parsed = z.object({
                    about: z.string().max(5000).optional().nullable(),
                    what_i_love_about_job: z.string().max(2000).optional().nullable(),
                    interests_and_hobbies: z.string().max(2000).optional().nullable(),
                }).parse(body);

                const grpcPayload = {
                    id: employeeId,
                    about: parsed.about,
                    what_i_love_about_job: parsed.what_i_love_about_job,
                    interests_and_hobbies: parsed.interests_and_hobbies,
                };

                const response = await grpcCall(employeeClient, 'UpdateEmployee', grpcPayload);
                return c.json({
                    success: true,
                    message: 'About fields updated successfully',
                    about: {
                        about: response.employee?.about || '',
                        what_i_love_about_job: response.employee?.what_i_love_about_job || '',
                        interests_and_hobbies: response.employee?.interests_and_hobbies || '',
                    },
                });
            } catch (e) {
                if (e instanceof ZodError) {
                    return c.json({
                        error: 'Validation failed',
                        details: e.errors.map(err => ({ field: err.path.join('.'), message: err.message })),
                    }, 400);
                }
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    /* ============================ EMPLOYEE SELF-SERVICE RELATIONSHIPS ============================ */

    // GET /employee-profile/my/relationships
    // Returns all active relationships for the authenticated employee only.
    openapi({ method: 'get', path: '/employee-profile/my/relationships', tags: ['Employee-Profile'], summary: 'Employee self-service: list my relationships', responses: { 200: {}, 401: {}, 403: {} } },
        async (c) => {
            try {
                const employeeId = c.get('employeeId');
                if (!employeeId) return c.json({ error: 'Unauthorized' }, 401);

                const empRes = await grpcCall(employeeClient, 'GetEmployee', { id: employeeId });
                const employee = empRes?.employee;
                if (!employee || !employee.organization_id) {
                    return c.json({ error: 'Employee organization not found' }, 404);
                }

                const res = await grpcCall(employeeClient, 'ListEmployeeRelationships', {
                    employee_id: employeeId,
                    organization_id: employee.organization_id,
                });

                return c.json(res);
            } catch (e) {
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    // POST /employee-profile/my/relationships
    // Creates a relationship for the authenticated employee only.
    openapi({ method: 'post', path: '/employee-profile/my/relationships', tags: ['Employee-Profile'], summary: 'Employee self-service: create a relationship', request: {
        body: { content: { 'application/json': { schema: z.object({
            relationship: z.enum(VALID_RELATIONSHIP_TYPES),
            first_name: z.string().min(1).max(100),
            last_name: z.string().max(100).optional().nullable(),
            gender: z.enum(VALID_GENDER_TYPES).optional().nullable(),
            email: z.string().email().optional().nullable().or(z.literal('')),
            phone: z.string().max(20).optional().nullable(),
            profession: z.string().max(100).optional().nullable(),
            date_of_birth: z.string().optional().nullable(),
        }) } } },
    }, responses: { 201: {}, 400: {}, 401: {}, 403: {} } },
        async (c) => {
            try {
                const employeeId = c.get('employeeId');
                if (!employeeId) return c.json({ error: 'Unauthorized' }, 401);

                const empRes = await grpcCall(employeeClient, 'GetEmployee', { id: employeeId });
                const employee = empRes?.employee;
                if (!employee || !employee.organization_id) {
                    return c.json({ error: 'Employee organization not found' }, 404);
                }

                const body = await c.req.json();
                const parsed = z.object({
                    relationship: z.enum(VALID_RELATIONSHIP_TYPES),
                    first_name: z.string().min(1).max(100),
                    last_name: z.string().max(100).optional().nullable(),
                    gender: z.enum(VALID_GENDER_TYPES).optional().nullable(),
                    email: z.string().email().optional().nullable().or(z.literal('')),
                    phone: z.string().max(20).optional().nullable(),
                    profession: z.string().max(100).optional().nullable(),
                    date_of_birth: z.string().optional().nullable(),
                }).parse(body);

                const res = await grpcCall(employeeClient, 'CreateEmployeeRelationship', {
                    employee_id: employeeId,
                    organization_id: employee.organization_id,
                    relationship: parsed.relationship,
                    first_name: parsed.first_name,
                    last_name: parsed.last_name,
                    gender: parsed.gender,
                    email: parsed.email,
                    phone: parsed.phone,
                    profession: parsed.profession,
                    date_of_birth: parsed.date_of_birth,
                });

                return c.json(res, 201);
            } catch (e) {
                if (e instanceof ZodError) {
                    return c.json({
                        error: 'Validation failed',
                        details: e.errors.map(err => ({ field: err.path.join('.'), message: err.message })),
                    }, 400);
                }
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    // PUT /employee-profile/my/relationships/:relationshipId
    // Updates a relationship for the authenticated employee only.
    openapi({ method: 'put', path: '/employee-profile/my/relationships/{relationshipId}', tags: ['Employee-Profile'], summary: 'Employee self-service: update a relationship', request: {
        params: z.object({ relationshipId: z.string() }),
        body: { content: { 'application/json': { schema: z.object({
            relationship: z.enum(VALID_RELATIONSHIP_TYPES).optional(),
            first_name: z.string().min(1).max(100).optional(),
            last_name: z.string().max(100).optional().nullable(),
            gender: z.enum(VALID_GENDER_TYPES).optional().nullable(),
            email: z.string().email().optional().nullable().or(z.literal('')),
            phone: z.string().max(20).optional().nullable(),
            profession: z.string().max(100).optional().nullable(),
            date_of_birth: z.string().optional().nullable(),
        }) } } },
    }, responses: { 200: {}, 400: {}, 401: {}, 403: {}, 404: {} } },
        async (c) => {
            try {
                const employeeId = c.get('employeeId');
                if (!employeeId) return c.json({ error: 'Unauthorized' }, 401);

                const { relationshipId } = c.req.valid('param');

                const empRes = await grpcCall(employeeClient, 'GetEmployee', { id: employeeId });
                const employee = empRes?.employee;
                if (!employee || !employee.organization_id) {
                    return c.json({ error: 'Employee organization not found' }, 404);
                }

                const body = await c.req.json();
                const parsed = z.object({
                    relationship: z.enum(VALID_RELATIONSHIP_TYPES).optional(),
                    first_name: z.string().min(1).max(100).optional(),
                    last_name: z.string().max(100).optional().nullable(),
                    gender: z.enum(VALID_GENDER_TYPES).optional().nullable(),
                    email: z.string().email().optional().nullable().or(z.literal('')),
                    phone: z.string().max(20).optional().nullable(),
                    profession: z.string().max(100).optional().nullable(),
                    date_of_birth: z.string().optional().nullable(),
                }).parse(body);

                const res = await grpcCall(employeeClient, 'UpdateEmployeeRelationship', {
                    id: relationshipId,
                    employee_id: employeeId,
                    organization_id: employee.organization_id,
                    ...parsed,
                });

                return c.json(res);
            } catch (e) {
                if (e instanceof ZodError) {
                    return c.json({
                        error: 'Validation failed',
                        details: e.errors.map(err => ({ field: err.path.join('.'), message: err.message })),
                    }, 400);
                }
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });

    // DELETE /employee-profile/my/relationships/:relationshipId
    // Deletes a relationship for the authenticated employee only.
    openapi({ method: 'delete', path: '/employee-profile/my/relationships/{relationshipId}', tags: ['Employee-Profile'], summary: 'Employee self-service: delete a relationship', request: {
        params: z.object({ relationshipId: z.string() }),
    }, responses: { 200: {}, 401: {}, 403: {}, 404: {} } },
        async (c) => {
            try {
                const employeeId = c.get('employeeId');
                if (!employeeId) return c.json({ error: 'Unauthorized' }, 401);

                const { relationshipId } = c.req.valid('param');

                const empRes = await grpcCall(employeeClient, 'GetEmployee', { id: employeeId });
                const employee = empRes?.employee;
                if (!employee || !employee.organization_id) {
                    return c.json({ error: 'Employee organization not found' }, 404);
                }

                const res = await grpcCall(employeeClient, 'DeleteEmployeeRelationship', {
                    id: relationshipId,
                    employee_id: employeeId,
                    organization_id: employee.organization_id,
                });

                return c.json(res);
            } catch (e) {
                return c.json({ error: e.message }, grpcToHttpStatus(e.code));
            }
        });
}
