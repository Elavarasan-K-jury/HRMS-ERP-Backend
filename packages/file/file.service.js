// src/services/file.service.js
import { v4 as uuid } from "uuid";
import mime from "mime-types";
import { fileConfig } from "./config.js";
import { saveLocal, deleteLocal } from "./local.storage.js";
import { uploadToS3, deleteFromS3 } from "./s3.storage.js";

export class FileService {
    static async upload(fileBuffer, originalName, storePath = '') {
        const lookupMime = mime.lookup(originalName) || "application/octet-stream";
        const ext = mime.extension(lookupMime) || "bin";
        const filename = `${storePath + '/' || ""}${uuid()}${new Date().getTime()}${originalName.split(".")[0]}.${ext}`;

        if (fileConfig.storage === "local") {
            return saveLocal(fileBuffer, filename);
        }

        if (fileConfig.storage === "s3") {
            const uploaded = await uploadToS3(fileBuffer, filename, lookupMime);
            return { url: uploaded.Location, key: uploaded.Key };
        }

        throw new Error("Invalid storage type");
    }

    static async delete(filePathOrKey) {
        if (fileConfig.storage === "local") {
            return deleteLocal(filePathOrKey);
        }
        if (fileConfig.storage === "s3") {
            return deleteFromS3(filePathOrKey);
        }
    }
}
