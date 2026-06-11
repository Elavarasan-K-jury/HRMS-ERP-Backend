# holidayClient

## Purpose
Holiday microservice for managing holiday definitions and calendars.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';

const holidayProto = loadProto('holiday');

const HOLIDAY_SERVICE_ADDR =
    process.env.HOLIDAY_SERVICE_ADDR || 'localhost:5079';

export const holidayClient = new holidayProto.HolidayService(
    HOLIDAY_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `HOLIDAY_SERVICE_ADDR` | `localhost:5079` |

## Proto Service
- **Proto loaded:** `holiday`
- **Exported client:** `holidayClient`
- **Constructor:** `holidayProto.HolidayService`

## gRPC Methods
```
CreateHoliday
UpdateHoliday
DeleteHoliday
GetHoliday
ListHolidays
GetHolidayCalendar
```
