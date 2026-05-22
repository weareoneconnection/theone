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
