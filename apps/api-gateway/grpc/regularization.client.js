import { loadProto, grpc } from "@jury-hrms/proto";

const regularisationProto = loadProto("attendance_regularisation");
const REGULARISATION_SERVICE_ADDR =
  process.env.REGULARIZATION_SERVICE_ADDR || "localhost:50065";

export const regularisationClient = new regularisationProto.regularisationProto(
  REGULARISATION_SERVICE_ADDR,
  grpc.credentials.createInsecure()
);
