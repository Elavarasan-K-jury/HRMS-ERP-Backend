# attendanceClient

## Purpose
Attendance microservice for check-in/out, attendance policies, geo-fencing, and reporting.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const AttendanceProto = loadProto('attendance');

const ATTENDANCE_SERVICE_ADDR =
  process.env.ATTENDANCE_SERVICE_ADDR || 'localhost:50062';

export const attendanceClient = new AttendanceProto.AttendanceService(
  ATTENDANCE_SERVICE_ADDR,
  grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `ATTENDANCE_SERVICE_ADDR` | `localhost:50062` |

## Proto Service
- **Proto loaded:** `attendance`
- **Exported client:** `attendanceClient`
- **Constructor:** `AttendanceProto.AttendanceService`

## gRPC Methods
```
CheckIn
CheckOut
CreateAttendance
RecomputeAttendance
ListAttendance
ListOrganizationAttendanceByMonth
AttendanceReport
GetAttendanceReportResult
ListAttendanceReports
CreateAttendancePolicy
UpdateAttendancePolicy
ListAttendancePolicy
CreateNetworkPolicy
UpdateNetworkPolicy
ListNetworkPolicy
CreateGeoFence
UpdateGeoFence
ListGeoFence
```
