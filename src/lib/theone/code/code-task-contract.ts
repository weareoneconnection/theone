import path from 'node:path';
import type { OneClawTask } from '../types';

export const CODE_TASK_SCHEMA_VERSION = 'theone.code_task.v1' as const;

export type CanonicalCodeAction =
  | 'code.workspace.status'
  | 'code.diff.prepare'
  | 'code.patch.apply'
  | 'code.test.run'
  | 'code.verify'
  | 'code.patch.rollback'
  | 'code.commit.prepare'
  | 'code.pr.create';

export type CodeRuntimeTarget = 'local_bridge' | 'cloud_sandbox' | 'unavailable';

const actionAliases: Record<string, CanonicalCodeAction> = {
  'code.workspace.scan': 'code.workspace.status',
  'code.workspace.status': 'code.workspace.status',
  'code.patch.prepare': 'code.diff.prepare',
  'code.diff.prepare': 'code.diff.prepare',
  'code.patch.apply': 'code.patch.apply',
  'code.test.run': 'code.test.run',
  'code.verify': 'code.verify',
  'code.patch.rollback': 'code.patch.rollback',
  'code.commit.prepare': 'code.commit.prepare',
  'code.pr.create': 'code.pr.create',
};

function cleanBaseUrl(value: string | undefined) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function splitList(value: string | undefined) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isLocalUrl(value: string) {
  try {
    const hostname = new URL(value).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

export function canonicalCodeAction(action: string): CanonicalCodeAction | null {
  return actionAliases[action] || null;
}

export function isCodeAction(action: string) {
  return action.startsWith('code.');
}

export function isCodeWriteAction(action: string) {
  return [
    'code.patch.apply',
    'code.test.run',
    'code.patch.rollback',
    'code.pr.create',
  ].includes(canonicalCodeAction(action) || '');
}

export function getCodeSandboxProfile(action: string) {
  const write = isCodeWriteAction(action);
  const commandExecution = canonicalCodeAction(action) === 'code.test.run'
    ? 'approved_package_scripts_only'
    : 'disabled';
  return {
    id: 'theone.code_sandbox.v1',
    isolation: 'workspace_scoped' as const,
    workspaceRoots: splitList(
      process.env.THEONE_CODE_WORKSPACE_ROOTS || process.env.ONECLAW_CODE_WORKSPACE_ALLOWLIST
    ).map((item) => path.resolve(item)),
    filesystem: write ? 'read_write_approved' : 'read_only',
    networkEgress: 'none' as const,
    credentialAccess: 'none' as const,
    commandExecution,
    maxFiles: positiveNumber(process.env.THEONE_CODE_MAX_FILES, 40),
    maxFileBytes: positiveNumber(process.env.THEONE_CODE_MAX_FILE_BYTES, 512_000),
    maxTotalBytes: positiveNumber(process.env.THEONE_CODE_MAX_TOTAL_BYTES, 4_000_000),
    timeoutMs: positiveNumber(process.env.THEONE_CODE_TIMEOUT_MS, 60_000),
    rollbackRequired: write,
  };
}

export function resolveCodeRuntimeRoute(input: {
  workspacePath?: string;
  requestedTarget?: string;
}) {
  const requested = String(input.requestedTarget || process.env.THEONE_CODE_RUNTIME_TARGET || 'auto').trim();
  const defaultBaseUrl = cleanBaseUrl(
    process.env.ONECLAW_BASE_URL || process.env.ONECLAW_API_BASE_URL
  );
  const localBaseUrl = cleanBaseUrl(
    process.env.THEONE_CODE_LOCAL_BRIDGE_URL ||
    process.env.ONECLAW_LOCAL_BRIDGE_URL ||
    (isLocalUrl(defaultBaseUrl) ? defaultBaseUrl : '')
  );
  const cloudBaseUrl = cleanBaseUrl(
    process.env.THEONE_CODE_CLOUD_SANDBOX_URL || process.env.ONECLAW_CODE_SANDBOX_URL
  );

  const local = () => localBaseUrl
    ? { target: 'local_bridge' as const, status: 'ready' as const, configured: true, baseUrl: localBaseUrl }
    : { target: 'unavailable' as const, status: 'blocked' as const, configured: false, baseUrl: '' };
  const cloud = () => cloudBaseUrl
    ? { target: 'cloud_sandbox' as const, status: 'ready' as const, configured: true, baseUrl: cloudBaseUrl }
    : { target: 'unavailable' as const, status: 'blocked' as const, configured: false, baseUrl: '' };

  if (requested === 'local_bridge') return { ...local(), requested };
  if (requested === 'cloud_sandbox') return { ...cloud(), requested };
  if (input.workspacePath && localBaseUrl) return { ...local(), requested: 'auto' };
  if (!input.workspacePath && cloudBaseUrl) return { ...cloud(), requested: 'auto' };
  if (localBaseUrl) return { ...local(), requested: 'auto' };
  if (cloudBaseUrl) return { ...cloud(), requested: 'auto' };

  return {
    target: 'unavailable' as const,
    status: 'blocked' as const,
    configured: false,
    baseUrl: '',
    requested: requested || 'auto',
    reason: input.workspacePath
      ? 'A local workspace requires THEONE_CODE_LOCAL_BRIDGE_URL or a localhost ONECLAW_BASE_URL.'
      : 'Configure THEONE_CODE_CLOUD_SANDBOX_URL or THEONE_CODE_LOCAL_BRIDGE_URL.',
  };
}

export function normalizeCodeTaskContract(task: OneClawTask): OneClawTask {
  const metadata = task.metadata && typeof task.metadata === 'object' ? task.metadata : {};
  const existingCodeTask = metadata.codeTask && typeof metadata.codeTask === 'object'
    ? metadata.codeTask as Record<string, unknown>
    : {};
  const repairs: string[] = [];
  const steps = task.steps.map((step) => {
    const canonical = canonicalCodeAction(step.action);
    if (!canonical) return step;
    if (canonical !== step.action) repairs.push(`${step.action}->${canonical}`);
    return { ...step, action: canonical };
  });
  const codeSteps = steps.filter((step) => isCodeAction(step.action));
  if (!codeSteps.length) return task;

  const firstInput = codeSteps[0]?.input || {};
  const workspacePath = String(
    firstInput.workspacePath || existingCodeTask.workspacePath || metadata.workspacePath || ''
  ).trim();
  const requestedTarget = String(
    (existingCodeTask.runtime as Record<string, unknown> | undefined)?.target ||
    existingCodeTask.runtimeTarget ||
    ''
  );
  const runtime = resolveCodeRuntimeRoute({ workspacePath, requestedTarget });
  const write = codeSteps.some((step) => isCodeWriteAction(step.action));
  const sandboxAction = codeSteps.find((step) => step.action === 'code.test.run')?.action ||
    codeSteps.find((step) => isCodeWriteAction(step.action))?.action ||
    codeSteps[0].action;

  return {
    ...task,
    approvalMode: write ? 'manual' : task.approvalMode,
    steps,
    metadata: {
      ...metadata,
      codeTask: {
        ...existingCodeTask,
        schemaVersion: CODE_TASK_SCHEMA_VERSION,
        kind: 'software_engineering',
        workspacePath: workspacePath || null,
        canonicalActions: codeSteps.map((step) => step.action),
        aliasRepairs: repairs,
        runtime: {
          target: runtime.target,
          status: runtime.status,
          configured: runtime.configured,
          requested: runtime.requested,
          reason: 'reason' in runtime ? runtime.reason : null,
        },
        sandbox: getCodeSandboxProfile(sandboxAction),
      },
    },
  };
}

export function codeTaskMetadata(task: OneClawTask | null | undefined) {
  const metadata = task?.metadata && typeof task.metadata === 'object' ? task.metadata : {};
  return metadata.codeTask && typeof metadata.codeTask === 'object'
    ? metadata.codeTask as Record<string, unknown>
    : null;
}
