# salary-and-payroll-service/helper/calculator.js

## Purpose
The mathematical salary calculation engine — evaluates component formulas with topological dependency sorting, supports conditional evaluation, clamping, and produces totals for earnings, deductions, and employer contributions.

## Important Logic

### Secure math.js Sandbox
Creates a sandboxed math.js instance with dangerous features disabled:

```js
const math = create(all, {});
math.import({
    import: () => { throw new Error("import disabled"); },
    createUnit: () => { throw new Error("unit disabled"); },
}, { override: true });
```

### Dependency Extraction
Parses a formula string to extract variable names (excluding math.js builtins):

```js
const MATHJS_BUILTINS = new Set([
    "sqrt", "abs", "ceil", "floor", "round", "min", "max",
    "log", "exp", "pow", "sin", "cos", "tan", "pi", "e", "mod",
    "if", "and", "or", "not", "true", "false",
]);

function extractDeps(formula) {
    if (!formula || typeof formula !== 'string') return [];
    const tokens = formula.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
    return tokens.filter(t => !MATHJS_BUILTINS.has(t));
}
```

### Topological Sort (Dependency Ordering)
Components are sorted so that a component is only evaluated after all of its dependencies have been computed. Circular dependencies are detected and warned about:

```js
function topoSort(components, baseKeys) {
    const keyToComp = new Map(components.map(c => [c.componentKey, c]));
    const deps = new Map();
    for (const c of components) {
        const formulaDeps = extractDeps(c.formula).filter(d => d !== c.componentKey && allKnown.has(d) && keyToComp.has(d));
        deps.set(c.componentKey, [...new Set([...formulaDeps, ...condDeps])]);
    }

    function visit(key) {
        if (visited.has(key)) return;
        if (inStack.has(key)) { console.warn(`⚠️ Circular dependency at: ${key}`); return; }
        inStack.add(key);
        for (const dep of (deps.get(key) || [])) visit(dep);
        inStack.delete(key);
        visited.add(key);
        if (keyToComp.has(key)) order.push(keyToComp.get(key));
    }
    // ...
}
```

### Evaluation Pipeline
Each component is processed in topological order:
1. **Condition check** — if a condition formula exists and evaluates to falsy, the component is skipped (value = 0)
2. **Value resolution** — fixed value takes priority over formula
3. **Clamping** — min/max bounds are applied
4. **Context update** — the computed value is stored in `ctx` for downstream components
5. **Totals accumulation** — based on `kind` (EARNING, EMPLOYEE/DEDUCTION, EMPLOYER/BENEFIT)

```js
for (const c of sorted) {
    if (c.condition) {
        const ok = !!evalFormula(c.condition, ctx);
        if (!ok) { ctx[c.componentKey] = 0; continue; }
    }

    let value = 0;
    if (c.value != null && c.value !== 0) value = safeNumber(c.value);
    else if (c.formula) value = evalFormula(c.formula, ctx);

    // Clamping
    if (c.minValue != null && c.minValue > 0) value = Math.max(value, c.minValue);
    if (c.maxValue != null && c.maxValue > 0) value = Math.min(value, c.maxValue);

    ctx[c.componentKey] = value;

    const kind = (c.kind || "earning").toUpperCase();
    if (kind === "EARNING") totalEarnings += value;
    else if (kind === "EMPLOYEE" || kind === "DEDUCTION") totalDeductions += value;
    else if (kind === "EMPLOYER" || kind === "BENEFIT") totalEmployer += value;
}
```

### Totals Calculation
```js
const inHandMonthly = totalEarnings - totalDeductions;
const ctcMonthly = totalEarnings + totalEmployer;

const totals = {
    totalEarnings, totalDeductions, totalEmployer,
    totalBenefits: totalEmployer,
    inHandMonthly, inHandAnnual: inHandMonthly * 12,
    ctcMonthly, grossAnnual: totalEarnings * 12,
};
```

## Helper Functions

- **`clamp(val, min, max)`** — Bounds a value (only if min/max > 0).
- **`safeNumber(v)`** — Returns 0 for NaN/Infinity values.
- **`evalFormula(formula, ctx)`** — Evaluates a mathjs formula string against the context safely.
- **`extractDeps(formula)`** — Extracts variable references from a formula.
- **`topoSort(components, baseKeys)`** — Sorts components in dependency order with cycle detection.
