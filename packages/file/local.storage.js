import fs from "fs";
import path from "path";
import { fileConfig } from "./config.js";

const baseDir = fileConfig.local.uploadPath;

export async function saveLocal(fileBuffer, filename) {
    const fullPath = path.join(baseDir, filename);
    if (filename.includes("/")) {
        const dirs = filename.split("/");
        dirs.pop()
        await fs.promises.mkdir(path.join(baseDir, dirs.join('/')), { recursive: true });
    }

    await fs.promises.mkdir(baseDir, { recursive: true });
    await fs.promises.writeFile(fullPath, fileBuffer);

    return {
        url: `/uploads/${filename}`,
        path: fullPath,
    };
}

export async function readLocal(fileKey) {
    const fullPath = path.join(baseDir, fileKey);
    console.log('local.storage.js @ Line  thirty three :', fullPath);

    if (!fs.existsSync(fullPath)) {
        throw new Error(`File not found: ${fileKey}`);
    }

    return fs.promises.readFile(fullPath); // ✅ returns Buffer
}

export async function deleteLocal(filepath) {
    if (fs.existsSync(filepath)) {
        await fs.promises.unlink(filepath);
    }
}
