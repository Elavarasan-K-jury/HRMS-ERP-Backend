import { create, all } from "mathjs";

/* ============================================================
   🔐 SAFE MATHJS SANDBOX
============================================================ */
const math = create(all, {});
math.import(
    {
        import: () => { throw new Error("import disabled"); },
        createUnit: () => { throw new Error("unit disabled"); },
        evaluate: () => { throw new Error("evaluate disabled"); }
    },
    { override: true }
);

/* ============================================================
   HELPERS
============================================================ */
function clamp(val, min, max) {
    if (min != null && val < min) return min;
    if (max != null && val > max) return max;
    return val;
}

function safeNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function evalFormula(formula, ctx) {
    try {
        if (!formula) return 0;
        return safeNumber(math.evaluate(formula, ctx));
    } catch (e) {
        console.error("❌ Formula error:", formula, ctx);
        return 0;
    }
}

/* ============================================================
   MAIN CALCULATOR
============================================================ */
export function calculateSalary({ baseInput, components }) {

    /* ---------------- INITIAL CONTEXT ---------------- */
    const ctx = {
        ...Object.fromEntries(
            Object.entries(baseInput).map(([k, v]) => [k, safeNumber(v)])
        )
    };

    /* ---------------- SORT BY PRIORITY ---------------- */
    const sorted = [...components].sort(
        (a, b) => (a.priority ?? 0) - (b.priority ?? 0)
    );

    const result = [];
    let totalEarnings = 0;
    let totalDeductions = 0;
    let totalEmployer = 0;

    const processed = new Set();

    /* ---------------- PROCESS COMPONENTS ---------------- */
    for (const c of sorted) {

        if (!c.componentKey) continue;
        if (processed.has(c.componentKey)) continue;

        /* ---- CONDITION ---- */
        if (c.condition) {
            const ok = !!evalFormula(c.condition, ctx);
            if (!ok) continue;
        }

        let value = 0;
        let source = "default";

        /* ---- VALUE PRIORITY ---- */
        if (c.value != null && c.value !== 0) {
            value = safeNumber(c.value);
            source = "fixed";
        } else if (c.formula) {
            value = evalFormula(c.formula, ctx);
            source = "formula";
        }

        /* ---- MIN / MAX ---- */
        value = clamp(value, c.minValue ?? null, c.maxValue ?? null);

        /* ---- UPDATE CONTEXT ---- */
        ctx[c.componentKey] = value;

        /* ---- TOTALS ---- */
        if (c.kind === "EARNING") totalEarnings += value;
        if (c.kind === "EMPLOYEE") totalDeductions += value;
        if (c.kind === "EMPLOYER") totalEmployer += value;

        /* ---- RESULT TRACE ---- */
        result.push({
            componentId: c.componentId,
            componentKey: c.componentKey,
            componentName: c.componentName,
            kind: c.kind,
            value,
            formula: c.formula || "",
            priority: c.priority ?? 0,
            source,
            appliedMin: c.minValue ?? null,
            appliedMax: c.maxValue ?? null,
        });

        processed.add(c.componentKey);
    }

    /* ---------------- FINAL TOTALS ---------------- */
    return {
        inputs: ctx,
        components: result,
        totals: {
            totalEarnings,
            totalDeductions,
            totalEmployer,
            inHandMonthly: totalEarnings - totalDeductions,
            ctcMonthly: totalEarnings + totalEmployer,
        }
    };
}
