import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Generic proto loader for all services.
 * @param {string} name - Base name of the proto file (without extension)
 * @returns {object} Loaded gRPC package definition
 */
export function loadProto(name) {
    try {
        const PROTO_PATH = path.join(__dirname, `${name}.proto`);

        const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
            keepCase: true, // 👈 This disables automatic camelCase conversion
            longs: String,
            enums: String,
            defaults: true,
            arrays: true
        });

        // The package name inside .proto should match what you access here
        // e.g., package organization; → .organization
        return grpc.loadPackageDefinition(packageDefinition)[name];
    } catch (error) {
        console.log(error);
    }
}

export { grpc };
