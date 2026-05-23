import { checkOneAIBotBridge } from '@/lib/theone/providers/oneai-bot';

export async function GET() {
  return Response.json({
    ok: true,
    bot: await checkOneAIBotBridge(),
  });
}
