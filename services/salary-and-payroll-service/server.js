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
    // getSalaryTemplateBuilderDataFunc,
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
import {
    checkIfFinanceEnabledOrNot,
    enableAndSaveEsiDetails,
    enableAndSavePfDetails,
    enableAndSavePtaxDetails,
    getOrganizationFinanceDetails,
    enableDisableEsiDetails,
    enableDisablePfDetails,
    enableDisablePtaxDetails
} from './handlers/finance.handler.js'
import {
    CreateRange,
    UpdateRange,
    DeleteRange,
    ListRanges,
    SaveRangeComponents,
    GetRangeComponents,
    PreviewSalaryForEmployee,
} from './handlers/SalaryRange.handler.js'
import {
    getEjsTemplateContent,
    saveEjsTemplate,
    renderEjsTemplate
} from './handlers/PaySlipTemplate.handler.js'

import {
    registerExpense,
    getMyExpenses,
    updateExpense,
    deleteExpense,
    getAllExpenses,
    updateExpenseStatus,
    getExpenseDetails,
    adminDeleteExpense,
} from './handlers/expense.handler.js'

import {
    GetSystemPayroll,
    CalculatePayroll,
} from './handlers/Payroll.handler.js'

const PORT = process.env.SALARY_PAYROLL_SERVICE_PORT || 5081;
const ComponentDefinitionProto = loadProto('component_definition');
const SalaryTemplateProto = loadProto('salary_template');
const SalaryProto = loadProto('employee_salary');
const FinanceProto = loadProto('finance');
const SalaryRangeProto = loadProto('salary_range');
const payslipProto = loadProto('payslip');
const expenseProto = loadProto('expense');
const payrollProto = loadProto('payroll');


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
    // getSalaryTemplateBuilderData: getSalaryTemplateBuilderDataFunc,
    deleteSalaryTemplate: deleteSalaryTemplateFunc,
    upsertSalaryTemplate: upsertSalaryTemplateFunc,
}
const FinanceImpl = {
    checkIfFinanceEnabledOrNot: checkIfFinanceEnabledOrNot,
    enableAndSaveEsiDetails: enableAndSaveEsiDetails,
    enableAndSavePfDetails: enableAndSavePfDetails,
    enableAndSavePtaxDetails: enableAndSavePtaxDetails,
    EnableDisablePfDetails: enableDisablePfDetails,
    EnableDisableEsiDetails: enableDisableEsiDetails,
    EnableDisablePtaxDetails: enableDisablePtaxDetails,
    getOrganizationFinanceDetails: getOrganizationFinanceDetails,
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
const SalaryRangeImpl = {
    CreateRange: CreateRange,
    UpdateRange: UpdateRange,
    DeleteRange: DeleteRange,
    ListRanges: ListRanges,
    SaveRangeComponents: SaveRangeComponents,
    GetRangeComponents: GetRangeComponents,
    PreviewSalaryForEmployee: PreviewSalaryForEmployee,
}

const PayslipImpl = {
    GetEjsTemplate: getEjsTemplateContent,
    SaveEjsTemplate: saveEjsTemplate,
    RenderEjsTemplate: renderEjsTemplate,
}

const ExpenseImpl = {
    RegisterExpense: registerExpense,
    GetMyExpenses: getMyExpenses,
    UpdateExpense: updateExpense,
    DeleteExpense: deleteExpense,
    GetAllExpenses: getAllExpenses,
    UpdateExpenseStatus: updateExpenseStatus,
    GetExpenseDetails: getExpenseDetails,
    AdminDeleteExpense: adminDeleteExpense,
}

const PayrollImpl = {
    GetSystemPayroll,
    CalculatePayroll,
}


/* ------------------------------------------------------------------ */
/* 🧩 Graceful Server Setup                                            */
/* ------------------------------------------------------------------ */
async function main() {
    await checkDbConnection('salary-payroll-service');
    const server = new grpc.Server();

    server.addService(ComponentDefinitionProto.ComponentDefinitionService.service, ComponentDefinitionImpl);
    server.addService(SalaryTemplateProto.SalaryTemplateService.service, SalaryTemplateImpl);
    server.addService(SalaryProto.SalaryEngineService.service, EmployeeSalaryImpl);
    server.addService(FinanceProto.FinanceService.service, FinanceImpl);
    server.addService(SalaryRangeProto.SalaryRangeService.service, SalaryRangeImpl);
    server.addService(payslipProto.PayslipService.service, PayslipImpl);
    server.addService(expenseProto.ExpenseService.service, ExpenseImpl);
    server.addService(payrollProto.PayrollService.service, PayrollImpl);

    await new Promise((resolve, reject) => {
        server.bindAsync(
            `0.0.0.0:${PORT}`,
            grpc.ServerCredentials.createInsecure(),
            (err) => (err ? reject(err) : resolve())
        );
    });

    console.log(`[salary-payroll-service] gRPC running on :${PORT}`);

    const shutdown = async (signal) => {
        console.log(`\n[salary-payroll-service] Received ${signal}, shutting down gracefully...`);

        try {
            server.tryShutdown((err) => {
                if (err) {
                    console.error('[salary-payroll-service] Force closing due to error:', err);
                    server.forceShutdown();
                } else {
                    console.log('[salary-payroll-service] gRPC server stopped.');
                }
            });

            await prisma.$disconnect();
            console.log('[salary-payroll-service] Prisma disconnected.');
            process.exit(0);
        } catch (e) {
            console.error('[salary-payroll-service] Error during shutdown:', e);
            process.exit(1);
        }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
    console.error('[salary-payroll-service] Fatal error:', err);
    process.exit(1);
});
