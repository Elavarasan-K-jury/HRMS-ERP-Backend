import { grpc, loadProto } from '@jury-hrms/proto';
import { prisma, checkDbConnection } from '@jury-hrms/db/client.js';
import dotenv from 'dotenv';
dotenv.config();

import {
    fetchComponentDefinitionsFunc,
    createComponentDefinitionFunc,
    updateComponentDefinitionFunc,
    deleteComponentDefinitionFunc,
} from './handlers/ComponentDefinition.handler.js'
import {
    listSalaryTemplatesFunc,
    getSalaryTemplateBuilderDataFunc,
    deleteSalaryTemplateFunc,
    upsertSalaryTemplateFunc,
} from './handlers/SalaryTemplate.handler.js'
import {
    assignSalaryToEmployeeFunc,
    updateEmployeeSalaryFunc,
    applyTemplateToStructureFunc,
    recalculateStructureFunc,
    getCurrentStructureForEmployeeFunc,
    getSalaryRevisionHistoryFunc,
    overrideComponentFunc,
    bulkRecalculateFunc,
    getStructureByForEmployeeFunc,
    previewTemplateCalculationFunc
} from './handlers/SalaryAssignment.handler.js'

const PORT = process.env.SALARY_PAYROLL_SERVICE_PORT || 5081;
const ComponentDefinitionProto = loadProto('component_definition');
const SalaryTemplateProto = loadProto('salary_template');
const SalaryProto = loadProto('employee_salary');

/* ------------------------------------------------------------------ */
/* 🧩 Implementation                                                  */
/* ------------------------------------------------------------------ */

const ComponentDefinitionImpl = {
    FetchComponentDefinitions: fetchComponentDefinitionsFunc,
    CreateComponentDefinition: createComponentDefinitionFunc,
    UpdateComponentDefinition: updateComponentDefinitionFunc,
    DeleteComponentDefinition: deleteComponentDefinitionFunc,
}
const SalaryTemplateImpl = {
    listSalaryTemplates: listSalaryTemplatesFunc,
    getSalaryTemplateBuilderData: getSalaryTemplateBuilderDataFunc,
    deleteSalaryTemplate: deleteSalaryTemplateFunc,
    upsertSalaryTemplate: upsertSalaryTemplateFunc,
}
const EmployeeSalaryImpl = {
    AssignSalary: assignSalaryToEmployeeFunc,
    UpdateSalary: updateEmployeeSalaryFunc,
    ApplyTemplate: applyTemplateToStructureFunc,
    Recalculate: recalculateStructureFunc,
    GetStructure: getCurrentStructureForEmployeeFunc,
    GetStructureById: getStructureByForEmployeeFunc,
    GetRevisionHistory: getSalaryRevisionHistoryFunc,
    OverrideComponent: overrideComponentFunc,
    BulkRecalculate: bulkRecalculateFunc,
    PreviewTemplateCalculation: previewTemplateCalculationFunc,
}

/* ------------------------------------------------------------------ */
/* 🧩 Graceful Server Setup                                            */
/* ------------------------------------------------------------------ */
async function main() {
    await checkDbConnection('organization-service');
    const server = new grpc.Server();

    server.addService(ComponentDefinitionProto.ComponentDefinitionService.service, ComponentDefinitionImpl);
    server.addService(SalaryTemplateProto.SalaryTemplateService.service, SalaryTemplateImpl);
    server.addService(SalaryProto.SalaryEngineService.service, EmployeeSalaryImpl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[organization-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[organization-service] Received ${signal}, shutting down gracefully...`);

        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[organization-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[organization-service] gRPC server stopped.');
                }
            });

            await prisma.$disconnect();
            console.log('[organization-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[organization-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[organization-service] Fatal error:', err);
    process.exit(1);
});
