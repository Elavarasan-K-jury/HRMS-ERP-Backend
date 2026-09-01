import { z } from 'zod';
import { ZodError } from 'zod';
import { legalEntityClient } from '../grpc/legal_entity.client.js';
import dotenv from 'dotenv';
dotenv.config();

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const callRpc = (client, method, payload) =>
    new Promise((resolve, reject) => {
        client[method](payload, (err, resp) => (err ? reject(err) : resolve(resp)));
    });

const handleError = (c, error) => {
    if (error instanceof ZodError) {
        return c.json({
            error: 'Validation failed',
            details: error.errors.map((e) => ({
                field: e.path.join('.'),
                message: e.message,
            })),
        }, 400);
    }
    const code = error?.code || 'INTERNAL';
    const statusMap = {
        INVALID_ARGUMENT: 400,
        NOT_FOUND: 404,
        ALREADY_EXISTS: 409,
    };
    const status = statusMap[code] || 500;
    return c.json({ error: error?.message || 'Server error' }, status);
};

const entityFields = {
    name: 'name',
    legal_name: 'legal_name',
    country: 'country',
    cin: 'cin',
    incorporation_date: 'incorporation_date',
    business_type: 'business_type',
    sector: 'sector',
    nature_of_business: 'nature_of_business',
    address1: 'address1',
    address2: 'address2',
    city: 'city',
    state: 'state',
    zip: 'zip',
    currency: 'currency',
    financial_year: 'financial_year',
    logo: 'logo',
    logo_file_id: 'logo_file_id',
    is_main: 'is_main',
    is_active: 'is_active',
};

const signatoryFields = {
    full_name: 'full_name',
    email: 'email',
    designation: 'designation',
    father_name: 'father_name',
    address1: 'address1',
    address2: 'address2',
    city: 'city',
    state: 'state',
    zip: 'zip',
    country: 'country',
};

const bankFields = {
    bank_name: 'bank_name',
    account_number: 'account_number',
    ifsc_code: 'ifsc_code',
    branch: 'branch',
    establishment_id: 'establishment_id',
};

const pickFields = (parsed, fields) => {
    const out = {};
    for (const key of Object.keys(fields)) {
        if (parsed[key] !== undefined) out[key] = parsed[key];
    }
    return out;
};

export default function registerLegalEntityRoutes({ openapi }) {

    /* ================================================================
       LEGAL ENTITIES
    ================================================================ */

    /* POST /legal-entities — create */
    const createEntitySchema = z.object({
        organization_id: z.string({ required_error: 'organization_id is required' }),
        name: z.string().min(2, 'Name must have at least 2 characters'),
        ...Object.fromEntries(Object.keys(entityFields).filter((k) => k !== 'name').map((k) => [k, z.string().optional().nullable()])),
    });

    openapi(
        {
            method: 'post',
            path: '/legal-entities',
            tags: ['Legal Entities'],
            summary: 'Create a legal entity',
            request: {
                body: { content: { 'application/json': { schema: createEntitySchema } } },
            },
            responses: {
                201: { description: 'Legal entity created' },
                400: { description: 'Invalid input' },
                500: { description: 'Server error' },
            },
        },
        async (c) => {
            try {
                const body = await c.req.json();
                const parsed = createEntitySchema.parse(body);
                const response = await callRpc(legalEntityClient, 'CreateLegalEntity', parsed);
                return c.json(response, 201);
            } catch (error) {
                return handleError(c, error);
            }
        }
    );

    /* GET /legal-entities — list */
    openapi(
        {
            method: 'get',
            path: '/legal-entities',
            tags: ['Legal Entities'],
            summary: 'List legal entities under an organization',
            request: {
                query: z.object({
                    organization_id: z.string({ required_error: 'organization_id is required' }),
                    page: z.string().optional().default('1').transform((v) => parseInt(v, 10)),
                    limit: z.string().optional().default('10').transform((v) => parseInt(v, 10)),
                    search: z.string().optional(),
                    sort_by: z.enum(['created_at', 'updated_at', 'name']).optional().default('created_at'),
                    sort_order: z.enum(['asc', 'desc']).optional().default('desc'),
                }),
            },
            responses: {
                200: { description: 'List of legal entities' },
                500: { description: 'Server error' },
            },
        },
        async (c) => {
            try {
                const query = c.req.valid('query');
                const response = await callRpc(legalEntityClient, 'ListLegalEntities', {
                    organization_id: query.organization_id,
                    page: query.page,
                    limit: query.limit,
                    search: query.search || '',
                    sort_by: query.sort_by,
                    sort_order: query.sort_order,
                });
                return c.json(response, 200);
            } catch (error) {
                return handleError(c, error);
            }
        }
    );

    /* GET /legal-entities/:id — get one */
    openapi(
        {
            method: 'get',
            path: '/legal-entities/{id}',
            tags: ['Legal Entities'],
            summary: 'Get a legal entity by ID',
            request: {
                params: z.object({ id: z.string().regex(OBJECT_ID, 'Invalid legal entity ID format') }),
            },
            responses: {
                200: { description: 'Legal entity details' },
                404: { description: 'Legal entity not found' },
                500: { description: 'Server error' },
            },
        },
        async (c) => {
            try {
                const { id } = c.req.valid('param');
                const response = await callRpc(legalEntityClient, 'GetLegalEntity', { id });
                return c.json(response, 200);
            } catch (error) {
                return handleError(c, error);
            }
        }
    );

    /* PUT/PATCH /legal-entities/:id — update */
    const updateEntitySchema = z.object(
        Object.fromEntries(Object.keys(entityFields).map((k) => [k, k === 'is_main' || k === 'is_active' ? z.boolean().optional() : z.string().optional().nullable()]))
    );

    const updateEntityHandler = async (c) => {
        try {
            const { id } = c.req.valid('param');
            const body = await c.req.json();
            const parsed = updateEntitySchema.parse(body);
            const response = await callRpc(legalEntityClient, 'UpdateLegalEntity', {
                id,
                ...pickFields(parsed, entityFields),
            });
            return c.json(response, 200);
        } catch (error) {
            return handleError(c, error);
        }
    };

    openapi(
        {
            method: 'put',
            path: '/legal-entities/{id}',
            tags: ['Legal Entities'],
            summary: 'Update a legal entity',
            request: {
                params: z.object({ id: z.string().regex(OBJECT_ID, 'Invalid legal entity ID format') }),
                body: { content: { 'application/json': { schema: updateEntitySchema } } },
            },
            responses: {
                200: { description: 'Legal entity updated' },
                400: { description: 'Invalid input' },
                404: { description: 'Legal entity not found' },
                500: { description: 'Server error' },
            },
        },
        updateEntityHandler
    );

    openapi(
        {
            method: 'patch',
            path: '/legal-entities/{id}',
            tags: ['Legal Entities'],
            summary: 'Partially update a legal entity',
            request: {
                params: z.object({ id: z.string().regex(OBJECT_ID, 'Invalid legal entity ID format') }),
                body: { content: { 'application/json': { schema: updateEntitySchema } } },
            },
            responses: {
                200: { description: 'Legal entity updated' },
                400: { description: 'Invalid input' },
                404: { description: 'Legal entity not found' },
                500: { description: 'Server error' },
            },
        },
        updateEntityHandler
    );

    /* DELETE /legal-entities/:id — soft delete */
    openapi(
        {
            method: 'delete',
            path: '/legal-entities/{id}',
            tags: ['Legal Entities'],
            summary: 'Soft delete a legal entity',
            request: {
                params: z.object({ id: z.string().regex(OBJECT_ID, 'Invalid legal entity ID format') }),
            },
            responses: {
                200: { description: 'Legal entity deleted' },
                404: { description: 'Legal entity not found' },
                500: { description: 'Server error' },
            },
        },
        async (c) => {
            try {
                const { id } = c.req.valid('param');
                const response = await callRpc(legalEntityClient, 'DeleteLegalEntity', { id });
                return c.json(response, 200);
            } catch (error) {
                return handleError(c, error);
            }
        }
    );

    /* ================================================================
       SIGNATORIES
    ================================================================ */

    /* GET /legal-entities/:id/signatories */
    openapi(
        {
            method: 'get',
            path: '/legal-entities/{id}/signatories',
            tags: ['Legal Entity Signatories'],
            summary: 'List signatories of a legal entity',
            request: {
                params: z.object({ id: z.string().regex(OBJECT_ID, 'Invalid legal entity ID format') }),
            },
            responses: {
                200: { description: 'List of signatories' },
                404: { description: 'Legal entity not found' },
                500: { description: 'Server error' },
            },
        },
        async (c) => {
            try {
                const { id } = c.req.valid('param');
                const response = await callRpc(legalEntityClient, 'ListSignatories', { legal_entity_id: id });
                return c.json(response, 200);
            } catch (error) {
                return handleError(c, error);
            }
        }
    );

    /* POST /legal-entities/:id/signatories */
    const createSignatorySchema = z.object({
        full_name: z.string().min(1, 'full_name is required'),
        ...Object.fromEntries(Object.keys(signatoryFields).filter((k) => k !== 'full_name').map((k) => [k, z.string().optional().nullable()])),
    });

    openapi(
        {
            method: 'post',
            path: '/legal-entities/{id}/signatories',
            tags: ['Legal Entity Signatories'],
            summary: 'Add a signatory to a legal entity',
            request: {
                params: z.object({ id: z.string().regex(OBJECT_ID, 'Invalid legal entity ID format') }),
                body: { content: { 'application/json': { schema: createSignatorySchema } } },
            },
            responses: {
                201: { description: 'Signatory added' },
                404: { description: 'Legal entity not found' },
                500: { description: 'Server error' },
            },
        },
        async (c) => {
            try {
                const { id } = c.req.valid('param');
                const body = await c.req.json();
                const parsed = createSignatorySchema.parse(body);
                const response = await callRpc(legalEntityClient, 'CreateSignatory', {
                    legal_entity_id: id,
                    ...parsed,
                });
                return c.json(response, 201);
            } catch (error) {
                return handleError(c, error);
            }
        }
    );

    /* PUT/PATCH /legal-entities/:id/signatories/:signatoryId */
    const updateSignatorySchema = z.object(
        Object.fromEntries(Object.keys(signatoryFields).map((k) => [k, z.string().optional().nullable()]))
    );

    const updateSignatoryHandler = async (c) => {
        try {
            const { id, signatoryId } = c.req.valid('param');
            const body = await c.req.json();
            const parsed = updateSignatorySchema.parse(body);
            const response = await callRpc(legalEntityClient, 'UpdateSignatory', {
                id: signatoryId,
                legal_entity_id: id,
                ...pickFields(parsed, signatoryFields),
            });
            return c.json(response, 200);
        } catch (error) {
            return handleError(c, error);
        }
    };

    openapi(
        {
            method: 'put',
            path: '/legal-entities/{id}/signatories/{signatoryId}',
            tags: ['Legal Entity Signatories'],
            summary: 'Update a signatory',
            request: {
                params: z.object({
                    id: z.string().regex(OBJECT_ID, 'Invalid legal entity ID format'),
                    signatoryId: z.string().regex(OBJECT_ID, 'Invalid signatory ID format'),
                }),
                body: { content: { 'application/json': { schema: updateSignatorySchema } } },
            },
            responses: {
                200: { description: 'Signatory updated' },
                404: { description: 'Signatory not found' },
                500: { description: 'Server error' },
            },
        },
        updateSignatoryHandler
    );

    openapi(
        {
            method: 'patch',
            path: '/legal-entities/{id}/signatories/{signatoryId}',
            tags: ['Legal Entity Signatories'],
            summary: 'Partially update a signatory',
            request: {
                params: z.object({
                    id: z.string().regex(OBJECT_ID, 'Invalid legal entity ID format'),
                    signatoryId: z.string().regex(OBJECT_ID, 'Invalid signatory ID format'),
                }),
                body: { content: { 'application/json': { schema: updateSignatorySchema } } },
            },
            responses: {
                200: { description: 'Signatory updated' },
                404: { description: 'Signatory not found' },
                500: { description: 'Server error' },
            },
        },
        updateSignatoryHandler
    );

    /* DELETE /legal-entities/:id/signatories/:signatoryId */
    openapi(
        {
            method: 'delete',
            path: '/legal-entities/{id}/signatories/{signatoryId}',
            tags: ['Legal Entity Signatories'],
            summary: 'Remove a signatory',
            request: {
                params: z.object({
                    id: z.string().regex(OBJECT_ID, 'Invalid legal entity ID format'),
                    signatoryId: z.string().regex(OBJECT_ID, 'Invalid signatory ID format'),
                }),
            },
            responses: {
                200: { description: 'Signatory removed' },
                404: { description: 'Signatory not found' },
                500: { description: 'Server error' },
            },
        },
        async (c) => {
            try {
                const { id, signatoryId } = c.req.valid('param');
                const response = await callRpc(legalEntityClient, 'DeleteSignatory', {
                    id: signatoryId,
                    legal_entity_id: id,
                });
                return c.json(response, 200);
            } catch (error) {
                return handleError(c, error);
            }
        }
    );

    /* ================================================================
       BANK DETAILS
    ================================================================ */

    /* GET /legal-entities/:id/banks */
    openapi(
        {
            method: 'get',
            path: '/legal-entities/{id}/banks',
            tags: ['Legal Entity Bank Details'],
            summary: 'List bank details of a legal entity',
            request: {
                params: z.object({ id: z.string().regex(OBJECT_ID, 'Invalid legal entity ID format') }),
            },
            responses: {
                200: { description: 'List of bank details' },
                404: { description: 'Legal entity not found' },
                500: { description: 'Server error' },
            },
        },
        async (c) => {
            try {
                const { id } = c.req.valid('param');
                const response = await callRpc(legalEntityClient, 'ListBankDetails', { legal_entity_id: id });
                return c.json(response, 200);
            } catch (error) {
                return handleError(c, error);
            }
        }
    );

    /* POST /legal-entities/:id/banks */
    const createBankSchema = z.object({
        bank_name: z.string().min(1, 'bank_name is required'),
        account_number: z.string().min(1, 'account_number is required'),
        ...Object.fromEntries(Object.keys(bankFields).filter((k) => k !== 'bank_name' && k !== 'account_number').map((k) => [k, z.string().optional().nullable()])),
    });

    openapi(
        {
            method: 'post',
            path: '/legal-entities/{id}/banks',
            tags: ['Legal Entity Bank Details'],
            summary: 'Add a bank detail to a legal entity',
            request: {
                params: z.object({ id: z.string().regex(OBJECT_ID, 'Invalid legal entity ID format') }),
                body: { content: { 'application/json': { schema: createBankSchema } } },
            },
            responses: {
                201: { description: 'Bank detail added' },
                404: { description: 'Legal entity not found' },
                500: { description: 'Server error' },
            },
        },
        async (c) => {
            try {
                const { id } = c.req.valid('param');
                const body = await c.req.json();
                const parsed = createBankSchema.parse(body);
                const response = await callRpc(legalEntityClient, 'CreateBankDetail', {
                    legal_entity_id: id,
                    ...parsed,
                });
                return c.json(response, 201);
            } catch (error) {
                return handleError(c, error);
            }
        }
    );

    /* PUT/PATCH /legal-entities/:id/banks/:bankId */
    const updateBankSchema = z.object(
        Object.fromEntries(Object.keys(bankFields).map((k) => [k, z.string().optional().nullable()]))
    );

    const updateBankHandler = async (c) => {
        try {
            const { id, bankId } = c.req.valid('param');
            const body = await c.req.json();
            const parsed = updateBankSchema.parse(body);
            const response = await callRpc(legalEntityClient, 'UpdateBankDetail', {
                id: bankId,
                legal_entity_id: id,
                ...pickFields(parsed, bankFields),
            });
            return c.json(response, 200);
        } catch (error) {
            return handleError(c, error);
        }
    };

    openapi(
        {
            method: 'put',
            path: '/legal-entities/{id}/banks/{bankId}',
            tags: ['Legal Entity Bank Details'],
            summary: 'Update a bank detail',
            request: {
                params: z.object({
                    id: z.string().regex(OBJECT_ID, 'Invalid legal entity ID format'),
                    bankId: z.string().regex(OBJECT_ID, 'Invalid bank detail ID format'),
                }),
                body: { content: { 'application/json': { schema: updateBankSchema } } },
            },
            responses: {
                200: { description: 'Bank detail updated' },
                404: { description: 'Bank detail not found' },
                500: { description: 'Server error' },
            },
        },
        updateBankHandler
    );

    openapi(
        {
            method: 'patch',
            path: '/legal-entities/{id}/banks/{bankId}',
            tags: ['Legal Entity Bank Details'],
            summary: 'Partially update a bank detail',
            request: {
                params: z.object({
                    id: z.string().regex(OBJECT_ID, 'Invalid legal entity ID format'),
                    bankId: z.string().regex(OBJECT_ID, 'Invalid bank detail ID format'),
                }),
                body: { content: { 'application/json': { schema: updateBankSchema } } },
            },
            responses: {
                200: { description: 'Bank detail updated' },
                404: { description: 'Bank detail not found' },
                500: { description: 'Server error' },
            },
        },
        updateBankHandler
    );

    /* DELETE /legal-entities/:id/banks/:bankId */
    openapi(
        {
            method: 'delete',
            path: '/legal-entities/{id}/banks/{bankId}',
            tags: ['Legal Entity Bank Details'],
            summary: 'Remove a bank detail',
            request: {
                params: z.object({
                    id: z.string().regex(OBJECT_ID, 'Invalid legal entity ID format'),
                    bankId: z.string().regex(OBJECT_ID, 'Invalid bank detail ID format'),
                }),
            },
            responses: {
                200: { description: 'Bank detail removed' },
                404: { description: 'Bank detail not found' },
                500: { description: 'Server error' },
            },
        },
        async (c) => {
            try {
                const { id, bankId } = c.req.valid('param');
                const response = await callRpc(legalEntityClient, 'DeleteBankDetail', {
                    id: bankId,
                    legal_entity_id: id,
                });
                return c.json(response, 200);
            } catch (error) {
                return handleError(c, error);
            }
        }
    );
}