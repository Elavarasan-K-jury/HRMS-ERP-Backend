# salary-and-payroll-service/server.js

## Purpose
Central gRPC server that bundles 8 sub-services (component definitions, salary templates, salary assignments, finance, salary ranges, payslip templates, expenses, and payroll) into a single running process.

## Registered gRPC Services

| Service | Implementation Object | Proto |
|---|---|---|
| `ComponentDefinitionService` | `ComponentDefinitionImpl` | `component_definition` |
| `SalaryTemplateService` | `SalaryTemplateImpl` | `salary_template` |
| `SalaryEngineService` | `EmployeeSalaryImpl` | `employee_salary` |
| `FinanceService` | `FinanceImpl` | `finance` |
| `SalaryRangeService` | `SalaryRangeImpl` | `salary_range` |
| `PayslipService` | `PayslipImpl` | `payslip` |
| `ExpenseService` | `ExpenseImpl` | `expense` |
| `PayrollService` | `PayrollImpl` | `payroll` |

## Handler Delegation Pattern
Each sub-service implementation object is built by mapping named handler imports to gRPC method names:

```js
const ComponentDefinitionImpl = {
    FetchComponentDefinitions: fetchComponentDefinitionsFunc,
    CreateComponentDefinition: createComponentDefinitionFunc,
    UpdateComponentDefinition: updateComponentDefinitionFunc,
    DeleteComponentDefinition: deleteComponentDefinitionFunc,
};

server.addService(ComponentDefinitionProto.ComponentDefinitionService.service, ComponentDefinitionImpl);
server.addService(SalaryProto.SalaryEngineService.service, EmployeeSalaryImpl);
// ... 6 more services registered
```
