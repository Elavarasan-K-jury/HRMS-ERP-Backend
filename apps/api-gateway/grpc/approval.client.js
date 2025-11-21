// src/grpc/approval.client.js
import { grpc, loadProto } from '@jury-hrms/proto';

const approvalProto = loadProto('approval');

export const approvalFlowClient = new approvalProto.ApprovalFlowService(
  process.env.APPROVAL_SERVICE_ADDR,
  grpc.credentials.createInsecure()
);

export const approvalInstanceClient = new approvalProto.ApprovalInstanceService(
  process.env.APPROVAL_SERVICE_ADDR,
  grpc.credentials.createInsecure()
);
