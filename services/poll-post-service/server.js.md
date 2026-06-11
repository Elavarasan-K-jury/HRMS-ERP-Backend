# poll-post-service/server.js

## Purpose
gRPC microservice for social-style posts, voting polls, comments, likes, saves, and shares within an organization.

## Key gRPC Handlers

| Method | Description |
|---|---|
| `CreatePostPoll` | Creates a post or voting poll with options |
| `GetPostPoll` | Fetches a single post with all relations |
| `UpdatePostPoll` | Updates post metadata and manages poll options (add/remove/update) |
| `ListPostPolls` | Paginated list with search across title, description, tags |
| `DeletePostPoll` | Soft-deletes a post |
| `TogglePostPollLike` | Toggle like/unlike for an employee |
| `GetPollLikesDetails` | Returns like count + list of likers |
| `AddPollComment` | Adds a comment to a post |
| `GetPollComments` | Lists comments for a post |
| `DeletePollComment` | Soft-deletes a comment |
| `GetPollOptions` | Lists poll options |
| `DeletePollOption` | Soft-deletes a poll option |
| `CastPollVote` | Casts a vote on a poll option (one vote per employee) |
| `GetPollVotesDetails` | Returns vote stats (percentages per option, user's vote) |
| `TogglePostPollSave` | Saves a post for an employee |
| `GetPollSavesDetails` | Returns save count + details |
| `SharePostPoll` | Records a share (idempotent — returns existing if already shared) |
| `GetPostPollShares` | Returns shares with distinct employee count |

## Important Logic

### Voting Poll Validation
Polls require at least 2 non-empty options:

```js
if (data.is_voting_poll) {
    const validOptions = data.options
        .filter(opt => typeof opt.label === 'string' && opt.label.trim().length > 0);
    if (validOptions.length < 2) {
        return callback({
            code: grpc.status.INVALID_ARGUMENT,
            message: 'Voting polls must have at least 2 non-empty options',
        });
    }
}
```

### Transactional Option Updates
`UpdatePostPoll` uses a Prisma transaction to atomically delete removed options, update existing ones, and create new ones:

```js
await prisma.$transaction(async (tx) => {
    await tx.posts.update({ where: { id }, data: updatePayload });
    if (optionsToDelete.length > 0) {
        await tx.pollOptions.deleteMany({ where: { id: { in: optionsToDelete } } });
    }
    for (const opt of updateOptions) {
        await tx.pollOptions.update({ where: { id: opt.id }, data: { label: opt.text } });
    }
    if (newOptions.length > 0) {
        await tx.pollOptions.createMany({ data: newOptions.map(o => ({ postId: id, label: o.text })) });
    }
});
```

### Like/Unlike Toggle
Checks for an existing like record; if found, soft-deletes it (unlike); if not, creates a new one:

```js
if (existing) {
    await prisma.postLikes.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
    return callback(null, { liked: false, success: true, message: "Post unliked successfully" });
}
await prisma.postLikes.create({ data: { postId: post_id, employeeId: employee_id, ... } });
return callback(null, { liked: true, success: true, message: "Post liked successfully" });
```

### Poll Vote Percentage Calculation
Computes percentage per option and identifies the user's selected option:

```js
const optionStats = options.map(opt => {
    const count = votesByOption[opt.id] || 0;
    const pct = totalVotes > 0 ? (count / totalVotes) * 100 : 0;
    return { option_id: opt.id, label: opt.label, votes: count, percentage: Number(pct.toFixed(2)) };
});
```

## Helper Functions

- **`mapPostPoll(poll)`** — Maps a Prisma `posts` record with all related data (options, votes, likes, comments, saves, shares) to the gRPC response shape.
