import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const ipNetworkProto = loadProto('organization_ip_network');
const ORG_IP_NETWORK_SERVICE_ADDR =
    process.env.ORG_IP_NETWORK_SERVICE_ADDR || process.env.ORG_SERVICE_ADDR || '127.0.0.1:50055';

export const organizationIpNetworkClient = new ipNetworkProto.OrganizationIpNetworkService(
    ORG_IP_NETWORK_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
