# attendanceLogClient

## Purpose
Attendance log microservice for querying attendance log records.

## Source
```js
// src/grpc/attendance_log.client.js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const attendanceLogProto = loadProto('attendance_log');
// 👆 change string if your proto name is different

const ATTENDANCE_LOG_SERVICE_ADDR =
  process.env.ATTENDANCE_LOG_SERVICE_ADDR || 'localhost:5067';

export const attendanceLogClient = new attendanceLogProto.AttendanceLogService(
  ATTENDANCE_LOG_SERVICE_ADDR,
  grpc.credentials.createInsecure(),
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `ATTENDANCE_LOG_SERVICE_ADDR` | `localhost:5067` |

## Proto Service
- **Proto loaded:** `attendance_log`
- **Exported client:** `attendanceLogClient`
- **Constructor:** `attendanceLogProto.AttendanceLogService`

## gRPC Methods
```
ListAttendanceLogs
```
