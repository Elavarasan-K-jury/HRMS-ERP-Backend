# report-service/server.js

## Purpose
gRPC microservice that generates employee insight reports as HTML templates.

## Key gRPC Handlers

| Method | Description |
|---|---|
| `GenerateEmployeeInsightTemplateReport` | Builds a full employee profile HTML report |

## Important Logic

The sole handler delegates data gathering and HTML rendering to an external handler:

```js
GenerateEmployeeInsightTemplateReport: async (call, callback) => {
    try {
        const { employee_id } = call.request;
        if (!employee_id) {
            return callback({ code: grpc.status.INVALID_ARGUMENT, message: "employee_id are required" });
        }
        const data = await generateEmployeeReportHTML(employee_id);
        return callback(null, { employee_id, html: data });
    } catch (e) {
        callback({ code: grpc.status.INTERNAL, message: e.message });
    }
}
```
