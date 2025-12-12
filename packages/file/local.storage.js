import fs from "fs";
import path from "path";
import { fileConfig } from "./config.js";

const baseDir = fileConfig.local.uploadPath;

export async function saveLocal(fileBuffer, filename) {
    const fullPath = path.join(baseDir, filename);
    if (filename.includes("/")) {
        const dirs = filename.split("/");
        await fs.promises.mkdir(path.join(baseDir, dirs[0]), { recursive: true });
    }

    await fs.promises.mkdir(baseDir, { recursive: true });
    await fs.promises.writeFile(fullPath, fileBuffer);

    return {
        url: `/uploads/${filename}`,
        path: fullPath,
    };
}

export async function deleteLocal(filepath) {
    if (fs.existsSync(filepath)) {
        await fs.promises.unlink(filepath);
    }
}
