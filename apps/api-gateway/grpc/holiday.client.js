import { loadProto, grpc } from '@jury-hrms/proto';

const holidayProto = loadProto('holiday');

const HOLIDAY_SERVICE_ADDR =
    process.env.HOLIDAY_SERVICE_ADDR || 'localhost:5079';

export const holidayClient = new holidayProto.HolidayService(
    HOLIDAY_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
