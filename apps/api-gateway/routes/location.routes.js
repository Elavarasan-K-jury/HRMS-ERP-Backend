import { z } from 'zod';
import { ZodError } from 'zod';
import { locationClient } from '../grpc/location.client.js';
import dotenv from 'dotenv';
dotenv.config();

const locationSchema = z.object({
    entity_type: z.enum(['organization', 'branch']),
    entity_id: z.string().optional().nullable(),
    name: z.string().optional().nullable(),
    is_headquarters: z.boolean().optional().nullable(),
    timezone: z.string().optional().nullable(),
    country: z.string().optional().nullable(),
    state: z.string().optional().nullable(),
    address1: z.string().optional().nullable(),
    address2: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    pincode: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    latitude: z.union([z.number(), z.string(), z.null()]).optional(),
    longitude: z.union([z.number(), z.string(), z.null()]).optional(),
    place_id: z.string().optional().nullable(),
    formatted_address: z.string().optional().nullable(),
});

export default function registerLocationRoutes({ openapi }) {

    /* ──────────────────────────────────────────────────────────
       POST /api/v1/organizations/{organization_id}/locations
       Create location
    ────────────────────────────────────────────────────────── */
    const createLocationSchema = locationSchema.extend({}).strict();

    openapi(
        {
            method: 'post',
            path: '/api/v1/organizations/{organization_id}/locations',
            tags: ['Location'],
            summary: 'Create a location for an organization or branch',
            request: {
                params: z.object({
                    organization_id: z.string({ required_error: 'Organization ID is required' }),
                }),
                body: {
                    content: {
                        'application/json': { schema: createLocationSchema },
                    },
                },
            },
            responses: {
                201: { description: 'Location created successfully' },
                400: { description: 'Invalid input' },
                500: { description: 'Server error' },
            },
        },
        async (c) => {
            try {
                const { organization_id } = c.req.valid('param');
                const body = await c.req.json();
                const parsed = createLocationSchema.parse(body);

                const grpcPayload = {
                    organization_id,
                    entity_type: parsed.entity_type,
                    entity_id: parsed.entity_id || '',
                    name: parsed.name || '',
                    is_headquarters: parsed.is_headquarters || false,
                    timezone: parsed.timezone || '',
                    country: parsed.country || '',
                    state: parsed.state || '',
                    address1: parsed.address1 || '',
                    address2: parsed.address2 || '',
                    city: parsed.city || '',
                    pincode: parsed.pincode || '',
                    description: parsed.description || '',
                    latitude: parsed.latitude === undefined || parsed.latitude === null ? 0 : Number(parsed.latitude),
                    longitude: parsed.longitude === undefined || parsed.longitude === null ? 0 : Number(parsed.longitude),
                    place_id: parsed.place_id || '',
                    formatted_address: parsed.formatted_address || '',
                };

                const response = await new Promise((resolve, reject) => {
                    locationClient.CreateLocation(grpcPayload, (err, resp) => {
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
                            message: e.message,
                        })),
                    }, 400);
                }
                return c.json({ error: error.message }, 500);
            }
        }
    );

    /* ──────────────────────────────────────────────────────────
       GET /api/v1/organizations/{organization_id}/locations
       List locations (paginated)
    ────────────────────────────────────────────────────────── */
    openapi(
        {
            method: 'get',
            path: '/api/v1/organizations/{organization_id}/locations',
            tags: ['Location'],
            summary: 'List locations under an organization',
            request: {
                params: z.object({
                    organization_id: z.string(),
                }),
                query: z.object({
                    page: z
                        .string()
                        .optional()
                        .default('1')
                        .transform((v) => parseInt(v, 10)),
                    limit: z
                        .string()
                        .optional()
                        .default('10')
                        .transform((v) => parseInt(v, 10)),
                    search: z.string().optional(),
                    entity_type: z.string().optional(),
                    entity_id: z.string().optional(),
                }),
            },
            responses: {
                200: { description: 'List of locations' },
                500: { description: 'Server error' },
            },
        },
        async (c) => {
            try {
                const { organization_id } = c.req.valid('param');
                const query = c.req.valid('query');

                const grpcPayload = {
                    organization_id,
                    page: query.page,
                    limit: query.limit,
                    search: query.search || '',
                    entity_type: query.entity_type || '',
                    entity_id: query.entity_id || '',
                };

                const response = await new Promise((resolve, reject) => {
                    locationClient.ListLocations(grpcPayload, (err, resp) => {
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

    /* ──────────────────────────────────────────────────────────
       GET /api/v1/locations/{id}
       Get single location
    ────────────────────────────────────────────────────────── */
    openapi(
        {
            method: 'get',
            path: '/api/v1/locations/{id}',
            tags: ['Location'],
            summary: 'Get a location by ID',
            request: {
                params: z.object({
                    id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid location ID format'),
                }),
            },
            responses: {
                200: { description: 'Location details' },
                404: { description: 'Location not found' },
                500: { description: 'Server error' },
            },
        },
        async (c) => {
            try {
                const { id } = c.req.valid('param');

                const response = await new Promise((resolve, reject) => {
                    locationClient.GetLocation({ id }, (err, resp) => {
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

    /* ──────────────────────────────────────────────────────────
       PUT /api/v1/locations/{id}
       Update location
    ────────────────────────────────────────────────────────── */
    const updateLocationSchema = locationSchema.partial();

    openapi(
        {
            method: 'put',
            path: '/api/v1/locations/{id}',
            tags: ['Location'],
            summary: 'Update a location',
            request: {
                params: z.object({
                    id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid location ID format'),
                }),
                body: {
                    content: { 'application/json': { schema: updateLocationSchema } },
                },
            },
            responses: {
                200: { description: 'Location updated' },
                400: { description: 'Invalid input' },
                404: { description: 'Location not found' },
                500: { description: 'Server error' },
            },
        },
        async (c) => {
            try {
                const { id } = c.req.valid('param');
                const body = await c.req.json();
                const parsed = updateLocationSchema.parse(body);

                const grpcPayload = {
                    id,
                    entity_type: parsed.entity_type || '',
                    entity_id: parsed.entity_id,
                    name: parsed.name,
                    is_headquarters: parsed.is_headquarters,
                    timezone: parsed.timezone,
                    country: parsed.country,
                    state: parsed.state,
                    address1: parsed.address1,
                    address2: parsed.address2,
                    city: parsed.city,
                    pincode: parsed.pincode,
                    description: parsed.description,
                    latitude: parsed.latitude === undefined || parsed.latitude === null ? 0 : Number(parsed.latitude),
                    longitude: parsed.longitude === undefined || parsed.longitude === null ? 0 : Number(parsed.longitude),
                    place_id: parsed.place_id,
                    formatted_address: parsed.formatted_address,
                };

                const response = await new Promise((resolve, reject) => {
                    locationClient.UpdateLocation(grpcPayload, (err, resp) => {
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
                            message: e.message,
                        })),
                    }, 400);
                }
                return c.json({ error: error.message }, 500);
            }
        }
    );

    /* ──────────────────────────────────────────────────────────
       DELETE /api/v1/locations/{id}
       Soft delete location
    ────────────────────────────────────────────────────────── */
    openapi(
        {
            method: 'delete',
            path: '/api/v1/locations/{id}',
            tags: ['Location'],
            summary: 'Soft delete a location',
            request: {
                params: z.object({
                    id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid location ID format'),
                }),
            },
            responses: {
                200: { description: 'Location deleted' },
                404: { description: 'Location not found' },
                500: { description: 'Server error' },
            },
        },
        async (c) => {
            try {
                const { id } = c.req.valid('param');

                const response = await new Promise((resolve, reject) => {
                    locationClient.DeleteLocation({ id }, (err, resp) => {
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
}