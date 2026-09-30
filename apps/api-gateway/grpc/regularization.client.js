import { loadProto, grpc } from "@jury-hrms/proto";
import dotenv from 'dotenv';
dotenv.config();

const regularisationProto = loadProto("attendance_regularisation");
const REGULARISATION_SERVICE_ADDR =
  process.env.REGULARISATION_SERVICE_ADDR || "localhost:5073";

export const regularisationClient = new regularisationProto.RegularisationService(
  REGULARISATION_SERVICE_ADDR,
  grpc.credentials.createInsecure()
);
