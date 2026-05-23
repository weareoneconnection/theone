import { runTheOne } from '@/lib/theone/orchestrator';
import { saveRunResult } from '@/lib/theone/state/run-store';
import { routeRunToApp, runUnifiedAppRoute } from '@/lib/theone/apps/run-app-router';
import type { TheOneMode } from '@/lib/theone/types';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const raw = String(body.input ?? '');
    const mode = (body.mode || 'assist') as TheOneMode;
    const appRoute = routeRunToApp(raw);

    if (appRoute) {
      const appResult = await runUnifiedAppRoute({
        raw,
        mode,
        route: appRoute,
      });
      const stored = await saveRunResult({
        ...appResult,
        networkSignals: {
          ...(appResult.networkSignals || {}),
          routedBy: 'theone.app_router',
        },
      });

      return Response.json({
        ...stored,
        appRoute,
      }, {
        status: stored.ok ? 200 : 500,
      });
    }

    const result = await runTheOne({
      raw,
      userId: body.userId,
      sessionId: body.sessionId,
      language: body.language || 'en',
      mode,
    });
    const stored = await saveRunResult(result);

    return Response.json(stored, {
      status: stored.ok ? 200 : 500,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'TheOne run failed',
      },
      { status: 500 }
    );
  }
}
