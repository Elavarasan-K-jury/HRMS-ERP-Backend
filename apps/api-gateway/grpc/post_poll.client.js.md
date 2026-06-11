# postPollClient

## Purpose
Post/Poll microservice for social feed posts, polls, comments, likes, and votes.

## Source
```js
import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const PostPollProto = loadProto('poll_post');
const POST_POLL_SERVICE_ADDR = process.env.POST_POLL_SERVICE_ADDR || 'localhost:50069';

export const postPollClient = new PostPollProto.PostPollService(
    POST_POLL_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);
```

## Configuration
| Env Variable | Default |
|---|---|
| `POST_POLL_SERVICE_ADDR` | `localhost:50069` |

## Proto Service
- **Proto loaded:** `poll_post`
- **Exported client:** `postPollClient`
- **Constructor:** `PostPollProto.PostPollService`

## gRPC Methods
```
CreatePostPoll
GetPostPoll
ListPostPolls
UpdatePostPoll
DeletePostPoll
TogglePostPollLike
GetPollLikesDetails
AddPollComment
GetPollComments
DeletePollComment
GetPollOptions
DeletePollOption
CastPollVote
GetPollVotesDetails
TogglePostPollSave
GetPollSavesDetails
SharePostPoll
GetPostPollShares
```
