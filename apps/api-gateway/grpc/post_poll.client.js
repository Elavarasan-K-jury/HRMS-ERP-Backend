import { loadProto, grpc } from '@jury-hrms/proto';
import dotenv from 'dotenv';
dotenv.config();

const PostPollProto = loadProto('poll_post');
const POST_POLL_SERVICE_ADDR = process.env.POST_POLL_SERVICE_ADDR || 'localhost:50069';

export const postPollClient = new PostPollProto.PostPollService(
    POST_POLL_SERVICE_ADDR,
    grpc.credentials.createInsecure()
);