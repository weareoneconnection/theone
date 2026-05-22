function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function unwrapRaw(value: any): any {
  if (!isRecord(value)) return value;
  if (isRecord(value.raw) && (value.receipt || value.raw.raw || value.raw.status || value.raw.steps)) {
    return unwrapRaw(value.raw);
  }
  return value;
}

export function executionDiagnostic(execution: any) {
  const raw = unwrapRaw(execution?.raw);
  const receiptRaw = unwrapRaw(execution?.receipt?.raw);
  const source = isRecord(raw) ? raw : isRecord(receiptRaw) ? receiptRaw : {};
  const failedStep = Array.isArray(source.steps)
    ? source.steps.find((step: any) => ['failed', 'error', 'rejected'].includes(String(step?.status || '').toLowerCase()))
    : null;
  const logs = Array.isArray(source.logs) ? source.logs.map((item: unknown) => String(item)) : [];
  const lastErrorLog = [...logs].reverse().find((line) => /error|failed|credential|missing|unsupported/i.test(line));

  return text(execution?.error) ||
    text(source.error) ||
    text(source.message) ||
    text(source.reason) ||
    text(source.detail) ||
    text(source.details) ||
    text(failedStep?.error) ||
    text(lastErrorLog);
}

export function derivedRunStatus(result: any) {
  if (!result) return 'idle';
  const liveTask = result?.oneClawTaskResult?.task || result?.oneClawActionResult?.result?.task || result?.oneClawActionResult?.result || result?.oneClawApprovalResult?.result?.task;
  const liveStatus = String(liveTask?.status || '').toLowerCase();
  if (['success', 'completed', 'complete'].includes(liveStatus)) return 'completed';
  if (['failed', 'error'].includes(liveStatus)) return 'failed';
  if (['awaiting_approval', 'queued', 'pending', 'running', 'submitted'].includes(liveStatus)) return liveStatus;
  const executions = result?.executions || result?.os?.executions || [];
  if (executions.some((execution: any) => execution.status === 'failed')) return 'failed';
  if (executions.some((execution: any) => execution.status === 'rejected')) return 'rejected';
  const workflowStatus = result?.os?.workflow?.status;
  if (workflowStatus && workflowStatus !== 'idle') return workflowStatus;
  return result.ok ? 'completed' : 'failed';
}
