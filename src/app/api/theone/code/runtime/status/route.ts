import {
  getCodeSandboxProfile,
  resolveCodeRuntimeRoute,
} from '@/lib/theone/code/code-task-contract';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspacePath = url.searchParams.get('workspacePath') || undefined;
  const requestedTarget = url.searchParams.get('target') || undefined;
  const route = resolveCodeRuntimeRoute({ workspacePath, requestedTarget });

  return Response.json({
    ok: route.configured,
    schemaVersion: 'theone.code_runtime_status.v1',
    route: {
      target: route.target,
      status: route.status,
      configured: route.configured,
      requested: route.requested,
      reason: 'reason' in route ? route.reason : null,
    },
    sandbox: getCodeSandboxProfile('code.diff.prepare'),
    writeSandbox: getCodeSandboxProfile('code.patch.apply'),
    testSandbox: getCodeSandboxProfile('code.test.run'),
    lifecycle: [
      'code.workspace.status',
      'code.diff.prepare',
      'code.patch.apply',
      'code.test.run',
      'code.verify',
      'code.commit.prepare',
      'code.pr.create',
      'code.patch.rollback',
    ],
  }, {
    status: route.configured ? 200 : 503,
  });
}
