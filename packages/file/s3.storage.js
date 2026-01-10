import AWS from "aws-sdk";
import { fileConfig } from "./config.js";

AWS.config.update({
    accessKeyId: fileConfig.s3.accessKeyId,
    secretAccessKey: fileConfig.s3.secretAccessKey,
    region: fileConfig.s3.region
});

const s3 = new AWS.S3();

export function uploadToS3(buffer, filename, mime) {
    return s3.upload({
        Bucket: fileConfig.s3.bucket,
        Key: filename,
        Body: buffer,
        ContentType: mime,
        ACL: "public-read"
    }).promise();
}


export async function readFromS3(key) {
    const data = await s3
        .getObject({
            Bucket: fileConfig.s3.bucket,
            Key: key,
        })
        .promise();

    return data.Body; // ✅ Buffer
}


export function deleteFromS3(key) {
    return s3.deleteObject({
        Bucket: fileConfig.s3.bucket,
        Key: key,
    }).promise();
}
