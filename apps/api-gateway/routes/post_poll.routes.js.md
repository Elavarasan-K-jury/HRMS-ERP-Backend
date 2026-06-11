# Post/Poll Routes

**Service:** Post Poll gRPC (`postPollClient`)

## Routes

| Method | Path | Summary |
|--------|------|---------|
| POST | `/posts` | Create a new post poll |
| GET | `/posts/{id}` | Get a post poll by ID |
| GET | `/posts` | List all post polls |
| PUT | `/posts/{id}` | Update a post poll |
| DELETE | `/posts/{id}` | Delete a post poll |
| POST | `/posts/{id}/likes` | Toggle like/unlike for a post poll |
| GET | `/posts/{id}/likes/details` | Get complete like details for a post poll |
| POST | `/posts/{id}/comments` | Post a comment for a post poll |
| GET | `/posts/{id}/comments` | Get comments for a post poll |
| DELETE | `/posts/{id}/comments/{comment_id}` | Delete a comment for a post poll |
| GET | `/posts/{id}/options` | Get options for a post poll |
| DELETE | `/posts/{id}/options/{option_id}` | Delete an option for a post poll |
| POST | `/post-polls/{id}/cast-vote` | Cast a vote for a post poll |
| GET | `/posts/{id}/votes` | Get votes for a post poll |
| POST | `/posts/{id}/save` | Save or unsave a post poll |
| GET | `/posts/{id}/saved` | Check if a post poll is saved by user |
| POST | `/posts/{id}/share` | Share a post poll |

## Code Snippet

```js
async (c) => {
    try {
        const body = await c.req.json();
        const parsed = CreatePollPostSchema.parse(body);
        const grpcPayload = {
            organization_id: parsed.organizationId,
            employee_id: parsed.employeeId,
            title: parsed.title,
            ...
            ...(parsed.isVotingPoll && {
                options: parsed.options.map(o => ({ label: o.text.trim() }))
            })
        };
        const response = await new Promise((resolve, reject) => {
            postPollClient.createPostPoll(grpcPayload, (err, response) => { ... });
        });
        return c.json(response, 201);
    } catch (err) { ... }
}
```

## Request/Response Schemas

- **CreatePollPost**: `{ organizationId, employeeId, title, description?, image?, tags?, isVotingPoll?, options? }`
  - Refined: `isVotingPoll` requires `options.length >= 2`.
- **UpdatePostPoll**: Partial create fields.
- **LikeToggle**: `{ employee_id }` → response `{ liked, success, message }`
- **Comment**: `{ employee_id, comment }` → response with nested employee info.

## Unique Logic

- Function parameter is `app` (not `{ openapi }`); calls `app.openapi()`.
- Client-side camelCase (`organizationId`, `employeeId`, `isVotingPoll`) mapped to snake_case for gRPC.
- Voting polls require at least 2 options; `.refine()` enforces this.
- Options are transformed from `{ text }` to `{ label }` for gRPC.
- Post response includes nested arrays for options, votes, likes, comments, saves, shares with full employee details.
