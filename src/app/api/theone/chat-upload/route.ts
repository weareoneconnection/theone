import { POST as uploadChatAttachment } from '../chat/upload/route';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: Request) {
  return uploadChatAttachment(req);
}
