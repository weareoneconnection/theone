import { checkOneAIConnection } from './oneai';
import { checkOneClawConnection } from './oneclaw';

export async function checkProviderConnections() {
  const [oneai, oneclaw] = await Promise.all([
    checkOneAIConnection(),
    checkOneClawConnection(),
  ]);

  return {
    ok: oneai.ok && oneclaw.ok,
    checkedAt: new Date().toISOString(),
    providers: [oneai, oneclaw],
  };
}
