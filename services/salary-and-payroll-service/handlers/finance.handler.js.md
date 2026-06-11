# salary-and-payroll-service/handlers/finance.handler.js

## Purpose
gRPC handlers for enabling and configuring statutory finance modules — PF (Provident Fund), ESI (Employee State Insurance), and Professional Tax (PTAX).

## Key gRPC Handlers

| Method | Description |
|---|---|
| `checkIfFinanceEnabledOrNot` | Returns whether finance is fully configured for the org |
| `enableAndSavePfDetails` | Enables PF with registration number, org name, and formula |
| `enableDisablePfDetails` | Toggles PF on/off |
| `enableAndSaveEsiDetails` | Enables ESI with registration details and formula |
| `enableDisableEsiDetails` | Toggles ESI on/off |
| `enableAndSavePtaxDetails` | Enables Professional Tax with details |
| `enableDisablePtaxDetails` | Toggles PTAX on/off |
| `getOrganizationFinanceDetails` | Returns the full finance configuration for an org |

## Important Logic

### First-Time Default Component Creation
When finance is enabled for the first time, a default "Other Allowance" earning component is automatically created:

```js
async function enabledForTheFirstTime(organization_id) {
    const createdDefaultComponent = await prisma.componentDefinition.findFirst({
        where: { deletedAt: null, isDefault: true, isDeletable: false },
    });
    if (createdDefaultComponent) return;
    await prisma.componentDefinition.create({
        data: {
            organizationId: organization_id,
            key: 'other_allowance',
            name: 'Other Allowance',
            type: 'earning',
            category: 'recurring',
            defaultFormula: null,
            isDefault: true,
            isDeletable: false,
            // ...
        },
    });
    sendFinanceEnabledEmail();
}
```

### Upsert Pattern for Finance Config
All enable-and-save handlers use `prisma.upsert` so they work whether or not a finance record already exists:

```js
await prisma.orgaizationFinance.upsert({
    where: { organizationId: organization_id },
    update: { enablePf: true, pfFormula: pf_formula, pfRegistrationNumber: pf_registration_number, ... },
    create: { organizationId: organization_id, enablePf: true, ... },
});
```

## Helper Functions

- **`validateOrganization(organization_id)`** — Validates that the org exists; throws a structured gRPC error if not.
- **`enabledForTheFirstTime(organization_id)`** — Creates the default "Other Allowance" component and sends a finance-enabled notification email.
- **`checkFinanceEnabled(organization_id)`** — Imported from `../helper/checks.js`.
