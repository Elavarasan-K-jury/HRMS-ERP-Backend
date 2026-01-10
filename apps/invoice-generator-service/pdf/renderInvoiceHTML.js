import fs from "fs";
import path from "path";
import Handlebars from "handlebars";

const TEMPLATE_PATH = path.resolve("templates/invoice.html");

// 🔥 Load once at startup
const templateSource = fs.readFileSync(TEMPLATE_PATH, "utf-8");

// 🔥 Compile once
const compiledTemplate = Handlebars.compile(templateSource);

/**
 * Render invoice HTML (FAST)
 */
export function renderInvoiceHTML(data) {
    return compiledTemplate(data);
}
