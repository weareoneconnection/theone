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

function actionFamily(action: string) {
  if (/^browser\./i.test(action)) return 'web_browser';
  if (/^(document|file|spreadsheet|storage)\./i.test(action)) return 'files';
  if (/^(social|x)\./i.test(action)) return 'social';
  if (/^git\./i.test(action)) return 'github';
  if (/^api\./i.test(action)) return 'api';
  if (/^desktop\./i.test(action)) return 'desktop';
  if (/^(database|knowledge|vector)\./i.test(action)) return 'knowledge';
  if (/^(email|message|notification|calendar)\./i.test(action)) return 'communication';
  if (/^(web3|wallet|chain|payment|finance|commerce)\./i.test(action)) return 'transaction';
  return 'general';
}

function actionLabel(action: string) {
  if (/^browser\./i.test(action)) return 'browser extraction';
  if (/^document\.parse$/i.test(action)) return 'document parsing';
  if (/^spreadsheet\.read$/i.test(action)) return 'spreadsheet reading';
  if (/^file\.read$/i.test(action)) return 'file reading';
  if (/^social\.post$/i.test(action)) return 'social publishing';
  if (/^x\./i.test(action)) return 'X reading';
  if (/^git\./i.test(action)) return 'GitHub worker';
  if (/^api\./i.test(action)) return 'API worker';
  if (/^desktop\./i.test(action)) return 'desktop worker';
  return action || 'worker';
}

function looksRetryable(error: string | null, action: string) {
  if (!error) return false;
  if (/requires approval|approval|forbidden|not allowed|permission|denied|blocked/i.test(error)) return false;
  if (/too long|max 280/i.test(error) && action === 'social.post') return false;
  return /timeout|fetch failed|network|rate|temporary|not found|enoent|failed/i.test(error);
}

function readableOutcome(input: {
  action: string;
  status: string;
  error: string | null;
  text: string[];
  artifacts: string[];
}) {
  const label = actionLabel(input.action);
  const failed = Boolean(input.error) || /fail|error|rejected|blocked/i.test(input.status);

  if (failed) {
    return {
      state: 'failed',
      label,
      primaryText: input.error || `${label} failed.`,
      userNextAction: input.action === 'social.post' && /too long|max 280/i.test(input.error || '')
        ? 'Revise the post under the X character limit and retry.'
        : /^browser\./i.test(input.action)
          ? 'Retry the browser worker or use another extraction route.'
          : /^(document|file|spreadsheet)\./i.test(input.action)
            ? 'Attach a readable file again or provide a durable file source.'
            : 'Review the error, then retry or ask TheOne for another route.',
    };
  }

  if (/^browser\./i.test(input.action)) {
    return {
      state: 'succeeded',
      label,
      primaryText: input.text[0] || 'Website content was extracted.',
      userNextAction: 'Use the extracted content, ask a follow-up, or turn it into a report.',
    };
  }

  if (/^(document|file|spreadsheet)\./i.test(input.action)) {
    return {
      state: 'succeeded',
      label,
      primaryText: input.text[0] || 'File content was read.',
      userNextAction: 'Use the file content, ask for a report, or export the result.',
    };
  }

  if (/^social\.post$/i.test(input.action)) {
    return {
      state: 'succeeded',
      label,
      primaryText: input.text[0] || 'Social content was published or prepared.',
      userNextAction: 'Open the run receipt or continue with follow-up distribution.',
    };
  }

  return {
    state: 'succeeded',
    label,
    primaryText: input.text[0] || `${label} completed.`,
    userNextAction: input.artifacts.length
      ? 'Review the generated artifacts or continue with the next step.'
      : 'Use this result, ask a follow-up, or turn it into a report.',
  };
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
  const action = input.action || input.taskName || input.receipt?.operation || 'worker.task';
  const artifacts = Array.from(new Set(extractArtifacts(raw)));
  const outcome = readableOutcome({ action, status, error, text, artifacts });
  const retryable = looksRetryable(error, action);
  const summary = error
    ? `${outcome.label} failed: ${outcome.primaryText}`
    : outcome.primaryText || `${input.provider} worker ${status}.`;

  return {
    schemaVersion: 'theone.normalized_worker_receipt.v1',
    provider: input.provider,
    action,
    actionFamily: actionFamily(action),
    taskName: input.taskName || null,
    status,
    summary: summary.slice(0, 1200),
    evidence: text.slice(0, 8),
    artifacts,
    error,
    retryable,
    outcome: {
      ...outcome,
      retryable,
      evidenceCount: text.length,
      artifactCount: artifacts.length,
      readable: text.length > 0,
    },
    nextActions: error
      ? [outcome.userNextAction, retryable ? 'Retry the worker after fixing the source or connector.' : 'Ask TheOne to revise the route before retrying.']
      : [outcome.userNextAction],
    receiptId: input.receipt?.id || null,
    externalId: input.receipt?.externalId || (isRecord(raw) ? String(raw.id || '') || null : null),
  };
}
