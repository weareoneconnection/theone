import { checkOneAIConnection } from './oneai';
import { checkOneAIBotBridge } from './oneai-bot';
import { checkOneClawConnection } from './oneclaw';

export async function checkProviderConnections() {
  const [oneai, oneclaw, oneaiBot] = await Promise.all([
    checkOneAIConnection(),
    checkOneClawConnection(),
    checkOneAIBotBridge(),
  ]);

  return {
    ok: oneai.ok && oneclaw.ok,
    checkedAt: new Date().toISOString(),
    providers: [oneai, oneclaw, oneaiBot],
  };
}
