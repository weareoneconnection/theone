import type {
  OneAIGenerateResult,
  OneClawTask,
  OneClawTaskRun,
  ProviderReceipt,
} from '../types';

function createReceiptId() {
  return `receipt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function elapsed(startedAt?: number) {
  return startedAt ? Math.max(0, Date.now() - startedAt) : undefined;
}

function oneClawReceiptStatus(run: OneClawTaskRun): ProviderReceipt['status'] {
  if (run.mock) return 'mock';
  const status = run.status.toLowerCase();
  if (['success', 'completed', 'complete'].includes(status)) return 'success';
  if (['failed', 'error'].includes(status)) return 'failed';
  if (status === 'rejected') return 'rejected';
  if (['submitted', 'queued', 'pending'].includes(status)) return 'submitted';
  return 'running';
}

export function createProviderReceipt(input: Omit<ProviderReceipt, 'id' | 'timestamp'> & {
  id?: string;
  timestamp?: string;
}): ProviderReceipt {
  return {
    id: input.id || createReceiptId(),
    timestamp: input.timestamp || new Date().toISOString(),
    ...input,
  };
}

export function receiptFromOneAI(
  result: OneAIGenerateResult<unknown>,
  operation = 'oneai.generate',
  startedAt?: number
) {
  return createProviderReceipt({
    provider: 'oneai',
    operation,
    status: result.mock ? 'mock' : result.success ? 'success' : 'failed',
    mock: Boolean(result.mock),
    latencyMs: elapsed(startedAt),
    raw: result.raw ?? result,
  });
}

export function receiptForOneClawPlan(
  task: OneClawTask | null | undefined,
  status: 'planned' | 'blocked' = task ? 'blocked' : 'planned'
) {
  return createProviderReceipt({
    provider: 'oneclaw',
    operation: 'oneclaw.task.plan',
    status,
    mock: Boolean(task?.metadata?.mock),
    raw: task ?? null,
  });
}

export function receiptFromOneClawRun(
  run: OneClawTaskRun,
  operation = 'oneclaw.task.run',
  startedAt?: number
) {
  return createProviderReceipt({
    provider: 'oneclaw',
    operation,
    status: oneClawReceiptStatus(run),
    externalId: run.id ?? null,
    mock: Boolean(run.mock),
    latencyMs: elapsed(startedAt),
    raw: run.raw ?? run,
  });
}

export function receiptForTheOne(
  operation: string,
  status: ProviderReceipt['status'],
  raw?: unknown
) {
  return createProviderReceipt({
    provider: 'theone',
    operation,
    status,
    raw,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function collectText(value: unknown, fragments: string[] = [], depth = 0) {
  if (depth > 5 || fragments.join('\n').length > 12000) return fragments;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 28) fragments.push(trimmed);
    return fragments;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectText(item, fragments, depth + 1));
    return fragments;
  }
  if (isRecord(value)) {
    for (const key of ['summary', 'text', 'content', 'body', 'markdown', 'title', 'description', 'error', 'message']) {
      collectText(value[key], fragments, depth + 1);
    }
    for (const key of ['output', 'response', 'data', 'result', 'artifact', 'artifacts', 'steps', 'logs']) {
      collectText(value[key], fragments, depth + 1);
    }
  }
  return fragments;
}

function extractArtifacts(value: unknown, artifacts: string[] = [], depth = 0) {
  if (depth > 5 || artifacts.length > 24) return artifacts;
  if (typeof value === 'string' && /^(\/|https?:\/\/).+\.(png|jpg|jpeg|webp|pdf|csv|xlsx|docx|txt|md|json)$/i.test(value.trim())) {
    artifacts.push(value.trim());
    return artifacts;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => extractArtifacts(item, artifacts, depth + 1));
    return artifacts;
  }
  if (isRecord(value)) {
    for (const key of ['artifact', 'artifacts', 'path', 'url', 'file', 'files']) {
      extractArtifacts(value[key], artifacts, depth + 1);
    }
  }
  return artifacts;
}

function extractError(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const direct = value.error || value.message || value.detail;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const steps = Array.isArray(value.steps) ? value.steps : [];
  const failed = steps.find((step) => isRecord(step) && /fail|error|rejected|blocked/i.test(String(step.status || ''))) as Record<string, unknown> | undefined;
  if (failed?.error) return String(failed.error);
  const logs = Array.isArray(value.logs) ? value.logs.map(String) : [];
  return [...logs].reverse().find((line) => /error|failed|blocked|rejected/i.test(line)) || null;
}

export function normalizeWorkerReceipt(input: {
  provider: string;
  action?: string | null;
  taskName?: string | null;
  status?: string | null;
  raw?: unknown;
  receipt?: ProviderReceipt | null;
}) {
  const raw = input.raw ?? input.receipt?.raw ?? null;
  const text = Array.from(new Set(collectText(raw).map((item) => item.replace(/\s+/g, ' ').trim()).filter(Boolean)));
  const error = extractError(raw);
  const status = String(input.status || input.receipt?.status || (error ? 'failed' : 'completed'));
  const artifacts = Array.from(new Set(extractArtifacts(raw)));
  const summary = error
    ? `Worker failed: ${error}`
    : text[0] || `${input.provider} worker ${status}.`;

  return {
    schemaVersion: 'theone.normalized_worker_receipt.v1',
    provider: input.provider,
    action: input.action || input.taskName || input.receipt?.operation || 'worker.task',
    taskName: input.taskName || null,
    status,
    summary: summary.slice(0, 1200),
    evidence: text.slice(0, 8),
    artifacts,
    error,
    nextActions: error
      ? ['Review the mission diagnosis.', 'Retry the worker or ask TheOne for an alternate route.']
      : ['Use this result, ask a follow-up, or turn it into a report.'],
    receiptId: input.receipt?.id || null,
    externalId: input.receipt?.externalId || (isRecord(raw) ? String(raw.id || '') || null : null),
  };
}
