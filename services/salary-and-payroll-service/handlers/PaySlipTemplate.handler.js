import { prisma } from '@jury-hrms/db/client.js';
import { grpc } from '@jury-hrms/proto';
import fs from 'fs/promises';
import path from 'path';
import ejs from 'ejs';
import { pathToFileURL } from 'url';
import beautify from 'js-beautify';

const EJS_TEMPLATE_DIR = path.join(process.cwd(), 'services/salary-and-payroll-service/templates');

function toLabel(key) {
    return key
        .replace(/\?/g, '')
        .replace(/\./g, ' ')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
}

function detectValueType(key, value) {
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object' && value !== null) return 'object';

    const lowerKey = key.toLowerCase();

    if (
        lowerKey.includes('amount') ||
        lowerKey.includes('salary') ||
        lowerKey.includes('pay') ||
        lowerKey.includes('deduction') ||
        lowerKey.includes('gross') ||
        lowerKey.includes('total')
    ) return 'number';

    if (
        lowerKey.includes('date') ||
        lowerKey.includes('month') ||
        lowerKey.includes('period')
    ) return 'date';

    if (
        lowerKey.includes('logo') ||
        lowerKey.includes('image') ||
        lowerKey.includes('url')
    ) return 'url';

    return 'string';
}


function flattenDataToVariables(data, parentKey = '') {
    let variables = [];

    Object.entries(data || {}).forEach(([key, value]) => {
        const fullKey = parentKey ? `${parentKey}.${key}` : key;

        if (Array.isArray(value)) {
            variables.push({
                name: toLabel(fullKey),
                key: fullKey,
                value: JSON.stringify(value),
                type: 'array',
            });

            return;
        }

        if (typeof value === 'object' && value !== null) {
            variables = variables.concat(flattenDataToVariables(value, fullKey));
            return;
        }

        variables.push({
            name: toLabel(fullKey),
            key: fullKey,
            value: value === undefined || value === null ? '' : String(value),
            type: detectValueType(fullKey, value),
        });
    });

    return variables;
}

async function extractEjsVariables(filePath) {
    const dataFilePath = filePath.replace('.ejs', '.js');

    try {
        const module = await import(`${pathToFileURL(dataFilePath).href}?t=${Date.now()}`);

        const data = module.default || {};

        return flattenDataToVariables(data);
    } catch (e) {
        console.warn(
            `No corresponding JS data file found for ${filePath}, proceeding without variable metadata.`
        );

        return [];
    }
}

async function listEjsTemplates() {
    const files = await fs.readdir(EJS_TEMPLATE_DIR);

    return files
        .filter(file => file.endsWith('.ejs'))
        .map(file => ({
            name: path.parse(file).name,
            path: path.join(EJS_TEMPLATE_DIR, file)
        }));
}

function validateTemplatePath(templatePath) {
    const resolvedPath = path.resolve(templatePath);
    const resolvedBaseDir = path.resolve(EJS_TEMPLATE_DIR);

    if (!resolvedPath.startsWith(resolvedBaseDir)) {
        throw {
            code: grpc.status.INVALID_ARGUMENT,
            message: 'Invalid template path',
        };
    }

    if (!resolvedPath.endsWith('.ejs')) {
        throw {
            code: grpc.status.INVALID_ARGUMENT,
            message: 'Only .ejs files are allowed',
        };
    }

    return resolvedPath;
}

export const getEjsTemplateContent = async (call, callback) => {
    try {
        const { template_path } = call.request;

        if (!template_path) {
            const templates = await listEjsTemplates();

            return callback(null, {
                success: true,
                message: 'Templates fetched successfully',
                templates,
                ejs_content: '',
                variables: []
            });
        }

        const filePath = validateTemplatePath(template_path);

        const ejsContent = await fs.readFile(filePath, 'utf-8');

        const variables = await extractEjsVariables(filePath);

        return callback(null, {
            success: true,
            message: 'EJS template fetched successfully',
            template: {
                name: path.parse(filePath).name,
                path: filePath
            },
            ejs_content: ejsContent,
            variables,
            templates: []
        });

    } catch (e) {
        console.error('Get EJS Template Error:', e);

        if (e.code === 'ENOENT') {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: 'EJS template not found',
            });
        }

        return callback(e.code ? e : {
            code: grpc.status.INTERNAL,
            message: e.message,
        });
    }
};

async function validateOrganization(organization_id) {
    if (!organization_id) {
        throw {
            code: grpc.status.INVALID_ARGUMENT,
            message: 'organization_id is required',
        };
    }

    const organization = await prisma.organizations.findFirst({
        where: { id: organization_id },
    });

    if (!organization) {
        throw {
            code: grpc.status.INVALID_ARGUMENT,
            message: 'Organization not found',
        };
    }

    return organization;
}

function setNestedValue(obj, path, value) {
    const keys = path.split('.');
    let current = obj;

    keys.forEach((key, index) => {
        if (index === keys.length - 1) {
            current[key] = value;
        } else {
            current[key] = current[key] || {};
            current = current[key];
        }
    });
}

export const saveEjsTemplate = async (call, callback) => {
    try {
        const {
            organization_id,
            name,
            template_path,
            ejs_content,
            variables,
        } = call.request;

        await validateOrganization(organization_id);

        if (!name) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'name is required',
            });
        }

        if (!ejs_content) {
            return callback({
                code: grpc.status.INVALID_ARGUMENT,
                message: 'ejs_content is required',
            });
        }

        const availableTemplate = await prisma.PayslipTemplates.findFirst({
            where: {
                organizationId: organization_id,
                deletedAt: null,
            },
        });

        if (availableTemplate) {
            await prisma.PayslipTemplates.update({
                where: { id: availableTemplate.id },
                data: {
                    name,
                    templatePath: template_path || null,
                    ejsContent: ejs_content,
                    variables: variables || [],
                    isActive: true,
                    updatedAt: new Date(),
                },
            });

            return callback(null, {
                success: true,
                message: 'EJS template updated successfully',
                template_id: availableTemplate.id,
            });
        }

        const savedTemplate = await prisma.PayslipTemplates.create({
            data: {
                organizationId: organization_id,
                name,
                templatePath: template_path || null,
                ejsContent: ejs_content,
                variables: variables || [],
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date(),
                deletedAt: null,
            },
        });

        return callback(null, {
            success: true,
            message: 'EJS template saved successfully',
            template_id: savedTemplate.id,
        });

    } catch (e) {
        console.error('Save EJS Template Error:', e);

        return callback(e.code ? e : {
            code: grpc.status.INTERNAL,
            message: e.message,
        });
    }
};

export const renderEjsTemplate = async (call, callback) => {
    try {
        const { organization_id } = call.request;

        const organization = await validateOrganization(organization_id);

        if (!organization) {
            return callback({
                code: grpc.status.NOT_FOUND,
                message: 'Organization not found',
            });
        }

        let template = await prisma.PayslipTemplates.findFirst({
            where: {
                organizationId: organization_id,
                deletedAt: null,
            },
        });

        if (!template) {
            const templates = await listEjsTemplates();
            const defaultTemplatePath = templates.length > 0 ? templates[0].path : null;
            const defaultEjsContent = templates.length > 0 ? await fs.readFile(templates[0].path, 'utf-8') : '';
            const defaultVariables = templates.length > 0 ? await extractEjsVariables(defaultTemplatePath) : [];
            await prisma.PayslipTemplates.create({
                data: {
                    organizationId: organization_id,
                    name: templates.length > 0 ? templates[0].name : 'Default Payslip Template',
                    templatePath: templates.length > 0 ? templates[0].path : null,
                    ejsContent: defaultEjsContent,
                    variables: defaultVariables,
                    isActive: true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    deletedAt: null,
                },
            });
            template = await prisma.PayslipTemplates.findFirst({
                where: {
                    organizationId: organization_id,
                    deletedAt: null,
                },
            });
        }

        const renderData = {};

        const variables = Array.isArray(template.variables) && template.variables.length > 0
            ? template.variables
            : await extractEjsVariables(template.templatePath);


        for (const variable of variables) {
            let value = variable.value || '';
            if (value.includes('{') && value.includes('}')) {
                try {
                    value = JSON.parse(value);
                } catch (e) {
                    console.warn(`Failed to parse variable ${variable.key} as JSON, using raw string value.`);
                }
            }
            if (value.includes('[') && value.includes(']')) {
                try {
                    value = JSON.parse(value);
                } catch (e) {
                    console.warn(`Failed to parse variable ${variable.key} as JSON array, using raw string value.`);
                }
            }

            setNestedValue(renderData, variable.key, value);
        }
        const htmlContent = ejs.render(template.ejsContent, renderData);

        return callback(null, {
            success: true,
            message: 'Template rendered successfully',
            template_path: template.templatePath,
            template_name: template.name,
            html_content: htmlContent,
            variables
        });

    } catch (e) {
        console.error('Render EJS Template Error:', e);

        return callback(e.code ? e : {
            code: grpc.status.INTERNAL,
            message: e.message,
        });
    }
};