import { create, all } from "mathjs";

/* ============================================================
    🔐 SECURE MATHJS SANDBOX
============================================================ */
const math = create(all, {});

// Disable potentially dangerous features without breaking the core engine
math.import(
    {
        import: () => { throw new Error("import disabled"); },
        createUnit: () => { throw new Error("unit disabled"); },
    },
    { override: true }
);

/* ============================================================
    HELPERS
============================================================ */
function clamp(val, min, max) {
    let result = val;
    // Only clamp if min/max are explicitly set AND not zero (or if they're meaningful zeroes)
    if (min != null && min > 0 && result < min) result = min;
    if (max != null && max > 0 && result > max) result = max;
    return result;
}

function safeNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function evalFormula(formula, ctx) {
    try {
        if (!formula) return 0;
        const result = math.evaluate(formula, ctx);
        return safeNumber(result);
    } catch (e) {
        console.error("❌ Formula error:", formula, "Context:", ctx, "Error:", e.message);
        return 0;
    }
}

/* ============================================================
    DEPENDENCY EXTRACTION
============================================================ */
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

/* ============================================================
    TOPOLOGICAL SORT
============================================================ */
function topoSort(components, baseKeys) {
    const keyToComp = new Map(components.map(c => [c.componentKey, c]));
    const allKnown = new Set([...baseKeys, ...components.map(c => c.componentKey)]);

    const deps = new Map();
    for (const c of components) {
        // Extract dependencies but EXCLUDE self-references
        const formulaDeps = extractDeps(c.formula).filter(
            d => d !== c.componentKey && allKnown.has(d) && keyToComp.has(d)
        );
        const condDeps = extractDeps(c.condition).filter(
            d => d !== c.componentKey && allKnown.has(d) && keyToComp.has(d)
        );
        deps.set(c.componentKey, [...new Set([...formulaDeps, ...condDeps])]);
    }

    const visited = new Set();
    const inStack = new Set();
    const order = [];

    function visit(key) {
        if (visited.has(key)) return;
        if (inStack.has(key)) {
            console.warn(`⚠️ Circular dependency detected at: ${key}`);
            return;
        }
        inStack.add(key);
        for (const dep of (deps.get(key) || [])) {
            visit(dep);
        }
        inStack.delete(key);
        visited.add(key);
        if (keyToComp.has(key)) order.push(keyToComp.get(key));
    }

    // Default sort by priority so independent items follow user preference
    const prioritySorted = [...components].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

    for (const c of prioritySorted) {
        visit(c.componentKey);
    }

    return order;
}

/* ============================================================
    MAIN CALCULATOR
============================================================ */
export function calculateSalary({ baseInput, components }) {

    // console.log('🔢 Calculator Input:', { baseInput, componentCount: components.length });

    // 1. Initialize Context
    const ctx = {
        ...Object.fromEntries(
            Object.entries(baseInput).map(([k, v]) => [k, safeNumber(v)])
        )
    };

    // 2. Prepare Components
    const valid = components.filter(c => !!c.componentKey);
    const sorted = topoSort(valid, Object.keys(ctx));

    // console.log('📊 Evaluation Order:', sorted.map(c => c.componentKey));

    const result = [];
    let totalEarnings = 0;
    let totalDeductions = 0;
    let totalEmployer = 0;

    // 3. Process each component in topological order
    for (const c of sorted) {
        // Initialize self-reference to 0 if it doesn't exist yet
        // This handles formulas that reference themselves
        if (ctx[c.componentKey] === undefined) {
            ctx[c.componentKey] = 0;
        }

        // Evaluate condition first
        if (c.condition) {
            const ok = !!evalFormula(c.condition, ctx);
            if (!ok) {
                ctx[c.componentKey] = 0;
                console.log(`⏭️  Skipping ${c.componentKey} (condition failed)`);
                continue;
            }
        }

        let value = 0;
        let source = "default";

        // Logic: fixed value has priority over formula
        if (c.value != null && c.value !== 0) {
            value = safeNumber(c.value);
            source = "fixed";
        } else if (c.formula) {
            value = evalFormula(c.formula, ctx);
            source = "formula";
        }

        // Apply Clamping (only if minValue/maxValue are meaningful)
        if (c.minValue != null && c.minValue > 0) {
            const oldValue = value;
            value = Math.max(value, c.minValue);
            if (oldValue !== value) {
                console.log(`⬆️  ${c.componentKey} clamped to min: ${oldValue} → ${value}`);
            }
        }
        if (c.maxValue != null && c.maxValue > 0) {
            const oldValue = value;
            value = Math.min(value, c.maxValue);
            if (oldValue !== value) {
                console.log(`⬇️  ${c.componentKey} clamped to max: ${oldValue} → ${value}`);
            }
        }

        // Update context so the NEXT component can use this value
        ctx[c.componentKey] = value;

        // Normalize kind to uppercase for comparison
        const kind = (c.kind || "earning").toUpperCase();

        // Accumulate Totals based on kind
        if (kind === "EARNING") {
            totalEarnings += value;
        } else if (kind === "EMPLOYEE" || kind === "DEDUCTION") {
            totalDeductions += value;
        } else if (kind === "EMPLOYER" || kind === "BENEFIT") {
            totalEmployer += value;
        }

        console.log(`✅ ${c.componentKey} = ${value} (${source}, kind: ${kind})`);

        result.push({
            componentId: c.componentId,
            componentKey: c.componentKey,
            componentName: c.componentName,
            componentType: c.componentType || kind || "",
            kind: kind,
            value: Math.round(value * 100) / 100,
            formula: c.formula || "",
            priority: c.priority ?? 0,
            source,
            appliedMin: c.minValue ?? null,
            appliedMax: c.maxValue ?? null,
            annualAmount: Math.round(value * 12 * 100) / 100,
            monthlyAmount: Math.round(value * 100) / 100,
            isOverridden: c.isOverridden || false,
            overrideNote: c.overrideNote || ""
        });
    }

    const inHandMonthly = totalEarnings - totalDeductions;
    const ctcMonthly = totalEarnings + totalEmployer;

    const totals = {
        totalEarnings: Math.round(totalEarnings * 100) / 100,
        totalDeductions: Math.round(totalDeductions * 100) / 100,
        totalEmployer: Math.round(totalEmployer * 100) / 100,
        totalBenefits: Math.round(totalEmployer * 100) / 100,
        inHandMonthly: Math.round(inHandMonthly * 100) / 100,
        inHandAnnual: Math.round(inHandMonthly * 12 * 100) / 100,
        ctcMonthly: Math.round(ctcMonthly * 100) / 100,
        grossAnnual: Math.round(totalEarnings * 12 * 100) / 100,
    };

    // console.log('💰 Totals:', totals);

    return {
        inputs: ctx,
        components: result,
        totals
    };
}