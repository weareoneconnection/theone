import { POST as uploadChatAttachment } from '../chat/upload/route';

export async function POST(req: Request) {
  return uploadChatAttachment(req);
}
