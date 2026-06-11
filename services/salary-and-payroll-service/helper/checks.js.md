# salary-and-payroll-service/helper/checks.js

## Purpose
Shared validation utility that checks whether an organization's finance module is fully configured and enabled.

## Exported Function

**`checkFinanceEnabled(organization_id)`** — Returns `true` if the organization has finance enabled with complete statutory details (PF/ESI/PTAX formulas and registration numbers); returns `false` otherwise.

### Logic
1. Validates the organization exists
2. Checks an `orgaizationFinance` record exists
3. Validates that if PF is enabled, all PF fields are filled
4. Validates that if ESI is enabled, all ESI fields are filled
5. Validates that if PTAX is enabled, the PTAX formula is set

```js
if (organizationFinance.enablePf) {
    if (!organizationFinance.pfFormula || !organizationFinance.pfRegisteredOrganizationName || !organizationFinance.pfRegistrationNumber) {
        throw new Error('Organization finance is not setup yet');
    }
}
if (organizationFinance.enableEsi) {
    if (!organizationFinance.esiFormula || !organizationFinance.esiRegisteredOrganizationName || !organizationFinance.esiRegistrationNumber) {
        throw new Error('Organization finance is not setup yet');
    }
}
if (organizationFinance.enablePtax) {
    if (!organizationFinance.ptaxFormula) {
        throw new Error('Organization finance is not setup yet');
    }
}
```
