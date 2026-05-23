import { ensureTheOneDatabase, prisma } from '../db/prisma';
import { recordTheOneEvent } from '../events/event-ledger';
import { computeExecutionStats } from '../metrics';
import { canSubmitExternalTasks } from '../policy/approval-policy';
import { getOneClawTask, runOneClawTask } from '../providers/oneclaw';
import { receiptForTheOne, receiptFromOneClawRun } from '../providers/receipts';
import { createExecutionRecord, createWorkflowTrace, markApprovalBlockedSteps } from '../runtime/workflow-runtime';
import type {
  ApprovalGate,
  ExecutionPlan,
  ExecutionRecord,
  MemoryGraphHit,
  OneClawTask,
  OneClawTaskRun,
  PlanStep,
  ProofRecord,
  TheOneRunResult,
} from '../types';

type StoredRun = {
  result: TheOneRunResult;
  oneclawTask: OneClawTask | null;
};

type OfflineProofRow = {
  id: string;
  runId: string;
  type: ProofRecord['type'];
  title: string;
  value: string | null;
  metadata: Record<string, unknown> | null;
  timestamp: string;
  run: {
    id: string;
    intentType: string;
    objective: string;
  };
};

type OfflineMemoryRow = {
  id: string;
  runId?: string | null;
  kind: string;
  title: string;
  summary: string;
  content: Record<string, unknown> | null;
  createdAt: string;
  run: {
    id: string;
    intentType: string;
    objective: string;
  } | null;
};

const offlineRuns = new Map<string, StoredRun>();
const offlineProof: OfflineProofRow[] = [];
const offlineMemory: OfflineMemoryRow[] = [];

function now() {
  return new Date().toISOString();
}

function createLedgerId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function shortHash(value: unknown) {
  let hash = 5381;
  const input = safeStringify(value);
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function safeStringify(value: unknown) {
  return JSON.stringify(value ?? null);
}

function safeParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function uniqueById<T extends { id: string }>(items: T[] = []) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function tokenizeMemoryQuery(input: string, extras: string[] = []) {
  return Array.from(new Set(
    `${input} ${extras.join(' ')}`
      .toLowerCase()
      .match(/[\p{L}\p{N}_]+/gu)
      ?.filter((term) => term.length > 1)
      .slice(0, 24) || []
  ));
}

function scoreMemoryText(haystack: string, terms: string[]) {
  if (terms.length === 0) return 1;
  return terms.reduce((score, term) => (
    haystack.includes(term) ? score + Math.min(6, term.length) : score
  ), 0);
}

function serializeExecutionPayload(execution: ExecutionRecord) {
  if (execution.raw === undefined && !execution.receipt) return null;
  return safeStringify({
    raw: execution.raw ?? null,
    receipt: execution.receipt ?? null,
  });
}

function cloneResult(result: TheOneRunResult): TheOneRunResult {
  return structuredClone(result);
}

function rememberOfflineRun(result: TheOneRunResult, oneclawTask: OneClawTask | null) {
  offlineRuns.set(result.runId, {
    result: cloneResult(result),
    oneclawTask: oneclawTask ? structuredClone(oneclawTask) : null,
  });

  const run = {
    id: result.runId,
    intentType: result.intent.type,
    objective: result.intent.objective,
  };

  for (const proof of result.proof || []) {
    offlineProof.unshift({
      id: `offline_proof_${result.runId}_${shortHash(proof)}`,
      runId: result.runId,
      type: proof.type,
      title: proof.title,
      value: proof.value ?? null,
      metadata: proof.metadata || null,
      timestamp: proof.timestamp,
      run,
    });
  }
}

function rememberOfflineMemory(input: {
  runId?: string;
  kind: string;
  title: string;
  summary: string;
  content?: unknown;
}) {
  const stored = input.runId ? offlineRuns.get(input.runId) : null;
  offlineMemory.unshift({
    id: createLedgerId('offline_mem'),
    runId: input.runId || null,
    kind: input.kind,
    title: input.title,
    summary: input.summary,
    content: input.content === undefined ? null : JSON.parse(safeStringify(input.content)),
    createdAt: now(),
    run: stored ? {
      id: stored.result.runId,
      intentType: stored.result.intent.type,
      objective: stored.result.intent.objective,
    } : null,
  });
}

function databaseWarning(error: unknown) {
  return error instanceof Error ? error.message : 'TheOne database is unavailable.';
}

function allApprovalsResolved(approvals: ApprovalGate[]) {
  return approvals.every((approval) => !approval.required || approval.status === 'approved');
}

function hasRejectedApproval(approvals: ApprovalGate[]) {
  return approvals.some((approval) => approval.status === 'rejected');
}

function getPrimaryOneClawExecution(executions: ExecutionRecord[]) {
  return [...executions].reverse().find((execution) => execution.provider === 'oneclaw');
}

function mapOneClawStatusToStepStatus(status: string): PlanStep['status'] {
  const normalized = status.toLowerCase();
  if (['success', 'completed', 'complete', 'mock'].includes(normalized)) return 'completed';
  if (['failed', 'error', 'rejected'].includes(normalized)) return 'failed';
  if (['submitted', 'queued', 'running', 'pending', 'awaiting_approval'].includes(normalized)) return 'running';
  return 'running';
}

function mapOneClawStatusToExecutionStatus(status: string): ExecutionRecord['status'] {
  const normalized = status.toLowerCase();
  if (['success', 'completed', 'complete'].includes(normalized)) return 'success';
  if (['failed', 'error'].includes(normalized)) return 'failed';
  if (normalized === 'rejected') return 'rejected';
  if (['submitted', 'queued', 'pending', 'running', 'awaiting_approval'].includes(normalized)) return 'running';
  return 'running';
}

function oneClawFailureDetail(latest: Record<string, unknown>) {
  const steps = Array.isArray(latest.steps) ? latest.steps : [];
  const failedStep = steps.find((step) => {
    if (!step || typeof step !== 'object') return false;
    return ['failed', 'error', 'rejected'].includes(String((step as Record<string, unknown>).status || '').toLowerCase());
  }) as Record<string, unknown> | undefined;
  const logs = Array.isArray(latest.logs) ? latest.logs.map((item) => String(item)) : [];
  const lastErrorLog = [...logs].reverse().find((line) => /error|failed|credential|missing|unsupported/i.test(line));

  return String(
    latest.error ||
    latest.message ||
    latest.reason ||
    latest.detail ||
    failedStep?.error ||
    lastErrorLog ||
    ''
  ).trim();
}

function updatePlanForApprovals(plan: ExecutionPlan, approvals: ApprovalGate[]) {
  if (hasRejectedApproval(approvals)) {
    return {
      ...plan,
      steps: plan.steps.map((step) => {
        if (step.action !== 'oneclaw.execute') return step;
        return { ...step, status: 'failed' as const, error: 'Execution rejected by approval policy.' };
      }),
    };
  }

  return markApprovalBlockedSteps(plan, approvals);
}

function setOneClawPlanStatus(plan: ExecutionPlan, status: PlanStep['status']) {
  return {
    ...plan,
    steps: plan.steps.map((step) => (
      step.action === 'oneclaw.execute' ? { ...step, status } : step
    )),
  };
}

function completeReadySystemSteps(plan: ExecutionPlan): ExecutionPlan {
  let steps = plan.steps;
  let changed = true;

  while (changed) {
    changed = false;
    const completed = new Set(
      steps
        .filter((step) => step.status === 'completed' || step.status === 'skipped')
        .map((step) => step.id)
    );

    steps = steps.map((step) => {
      if (step.action !== 'memory.store' && step.action !== 'proof.write') return step;
      if (step.status === 'completed') return step;
      const dependenciesDone = (step.dependsOn || []).every((dependencyId) => completed.has(dependencyId));
      if (!dependenciesDone) return step;
      changed = true;
      return {
        ...step,
        status: 'completed' as const,
        attempts: Math.max(step.attempts || 0, 1),
        output: {
          ...(step.output || {}),
          completedBy: 'execution.sync',
        },
      };
    });
  }

  return {
    ...plan,
    steps,
  };
}

function appendProof(result: TheOneRunResult, proof: ProofRecord) {
  result.proof = [
    ...result.proof,
    {
      ...proof,
      metadata: {
        ...(proof.metadata || {}),
        storedBy: 'TheOne',
      },
    },
  ];
}

function refreshResult(result: TheOneRunResult) {
  const approvals = result.approvals || [];
  let plan = updatePlanForApprovals(result.plan, approvals);
  const oneclawExecution = getPrimaryOneClawExecution(result.executions || []);

  if (oneclawExecution?.status && !hasRejectedApproval(approvals)) {
    plan = setOneClawPlanStatus(plan, mapOneClawStatusToStepStatus(oneclawExecution.status));
    plan = completeReadySystemSteps(plan);
  }

  const stats = computeExecutionStats(plan.steps);
  const workflow = createWorkflowTrace({
    runId: result.runId,
    mode: result.os?.mode || 'assist',
    plan,
    approvals,
  });

  result.plan = plan;
  result.execution = {
    ...result.execution,
    completedSteps: stats.completedSteps,
    failedSteps: stats.failedSteps,
  };
  result.os = result.os
    ? {
      ...result.os,
      workflow,
      approvals,
      executions: result.executions || [],
    }
    : result.os;
}

async function persistRunSnapshot(result: TheOneRunResult, oneclawTask: OneClawTask | null) {
  await ensureTheOneDatabase();
  const intent = result.intent;

  await prisma.theOneRun.upsert({
    where: { id: result.runId },
    create: {
      id: result.runId,
      ok: result.ok,
      mode: result.os?.mode || 'assist',
      intentType: intent.type,
      objective: intent.objective,
      planJson: safeStringify(result.plan),
      resultJson: safeStringify(result),
      pendingOneClawTaskJson: oneclawTask ? safeStringify(oneclawTask) : null,
    },
    update: {
      ok: result.ok,
      mode: result.os?.mode || 'assist',
      intentType: intent.type,
      objective: intent.objective,
      planJson: safeStringify(result.plan),
      resultJson: safeStringify(result),
      pendingOneClawTaskJson: oneclawTask ? safeStringify(oneclawTask) : null,
    },
  });

  await prisma.theOneApproval.deleteMany({ where: { runId: result.runId } });
  const approvals = uniqueById(result.approvals || []);
  if (approvals.length) {
    await prisma.theOneApproval.createMany({
      data: approvals.map((approval) => ({
        id: approval.id,
        runId: result.runId,
        stepId: approval.stepId,
        action: approval.action,
        risk: approval.risk,
        required: approval.required,
        status: approval.status,
        mode: approval.mode,
        reason: approval.reason,
        gateJson: safeStringify(approval),
      })),
      skipDuplicates: true,
    });
  }

  await prisma.theOneExecution.deleteMany({ where: { runId: result.runId } });
  const executions = uniqueById(result.executions || []);
  if (executions.length) {
    await prisma.theOneExecution.createMany({
      data: executions.map((execution) => ({
        id: execution.id,
        runId: result.runId,
        provider: execution.provider,
        status: execution.status,
        summary: execution.summary,
        externalId: execution.externalId ?? null,
        taskName: execution.taskName ?? null,
        rawJson: serializeExecutionPayload(execution),
      })),
      skipDuplicates: true,
    });
  }

  await prisma.theOneProof.deleteMany({ where: { runId: result.runId } });
  if (result.proof?.length) {
    await prisma.theOneProof.createMany({
      data: result.proof.map((proof, index) => ({
        id: `proof_${result.runId}_${index}_${shortHash(proof)}`,
        runId: result.runId,
        type: proof.type,
        title: proof.title,
        value: proof.value ?? null,
        metadataJson: proof.metadata ? safeStringify(proof.metadata) : null,
        timestamp: new Date(proof.timestamp),
      })),
      skipDuplicates: true,
    });
  }
}

async function createMemory(input: {
  runId?: string;
  kind: string;
  title: string;
  summary: string;
  content?: unknown;
}) {
  try {
    await ensureTheOneDatabase();
    await prisma.theOneMemory.create({
      data: {
        id: createLedgerId('mem'),
        runId: input.runId,
        kind: input.kind,
        title: input.title,
        summary: input.summary,
        contentJson: input.content === undefined ? null : safeStringify(input.content),
      },
    });
  } catch (error) {
    rememberOfflineMemory(input);
    console.warn('[theone] memory stored in offline ledger:', databaseWarning(error));
  }
}

async function readStoredRun(runId: string): Promise<StoredRun | null> {
  try {
    await ensureTheOneDatabase();
    const row = await prisma.theOneRun.findUnique({ where: { id: runId } });
    if (!row) return offlineRuns.get(runId) || null;

    return {
      result: safeParse<TheOneRunResult>(row.resultJson, null as unknown as TheOneRunResult),
      oneclawTask: safeParse<OneClawTask | null>(row.pendingOneClawTaskJson, null),
    };
  } catch (error) {
    console.warn('[theone] reading run from offline ledger:', databaseWarning(error));
    return offlineRuns.get(runId) || null;
  }
}

export async function saveRunResult(result: TheOneRunResult) {
  const saved = cloneResult(result);
  const oneclawTask = saved.pendingOneClawTask ?? null;
  refreshResult(saved);
  try {
    await persistRunSnapshot(saved, oneclawTask);
  } catch (error) {
    rememberOfflineRun(saved, oneclawTask);
    appendProof(saved, {
      type: 'system',
      title: 'Database offline fallback',
      value: 'TheOne continued this run with an in-memory ledger because the database was unreachable.',
      timestamp: now(),
      metadata: {
        provider: 'theone',
        warning: databaseWarning(error),
      },
    });
    console.warn('[theone] run stored in offline ledger:', databaseWarning(error));
  }
  await createMemory({
    runId: saved.runId,
    kind: 'run.created',
    title: `Run created: ${saved.intent.type}`,
    summary: saved.intent.objective,
    content: {
      intent: saved.intent,
      plan: saved.plan,
      approvals: saved.approvals,
      executions: saved.executions,
      contextFrame: saved.contextFrame,
      permissions: saved.permissions,
    },
  });
  try {
    await recordTheOneEvent({
      runId: saved.runId,
      type: 'run.created',
      provider: 'theone',
      status: saved.ok ? 'success' : 'failed',
      summary: saved.intent.objective,
      payload: {
        intent: saved.intent,
        mode: saved.os?.mode,
        approvals: saved.approvals?.length || 0,
        executions: saved.executions?.length || 0,
      },
    });
  } catch (error) {
    console.warn('[theone] event ledger skipped:', databaseWarning(error));
  }

  return cloneResult(saved);
}

export async function getStoredRun(runId: string) {
  const stored = await readStoredRun(runId);
  if (!stored?.result) return null;
  refreshResult(stored.result);
  return cloneResult(stored.result);
}

async function updateStoredRun(runId: string, update: (stored: StoredRun) => Promise<void> | void) {
  const stored = await readStoredRun(runId);
  if (!stored?.result) throw new Error('TheOne run not found. Run the workflow again.');

  await update(stored);
  refreshResult(stored.result);
  await persistRunSnapshot(stored.result, stored.oneclawTask);
  return cloneResult(stored.result);
}

export async function approveRun(input: { runId: string; approvalId?: string; approveAll?: boolean }) {
  return updateStoredRun(input.runId, async (stored) => {
    const approvals = stored.result.approvals || [];
    stored.result.approvals = approvals.map((approval) => {
      const shouldApprove = input.approveAll || approval.id === input.approvalId;
      if (!shouldApprove || approval.status !== 'pending') return approval;
      return {
        ...approval,
        status: 'approved',
        reason: `${approval.reason} Approved by TheOne operator.`,
      };
    });

    if (stored.result.os) {
      stored.result.os.approvals = stored.result.approvals;
    }

    if (
      stored.oneclawTask &&
      canSubmitExternalTasks(stored.result.approvals) &&
      allApprovalsResolved(stored.result.approvals) &&
      !getPrimaryOneClawExecution(stored.result.executions || [])?.externalId
    ) {
      const startedAt = Date.now();
      const oneclawRun = await runOneClawTask<OneClawTaskRun>(stored.oneclawTask);
      const receipt = receiptFromOneClawRun(oneclawRun, 'oneclaw.task.run', startedAt);
      const status = oneclawRun.status === 'mock' ? 'mock' : 'submitted';
      const execution = createExecutionRecord({
        provider: 'oneclaw',
        status,
        summary: oneclawRun.mock ? 'Mock OneClaw task completed.' : 'OneClaw task submitted after approval.',
        externalId: oneclawRun.id ?? null,
        taskName: stored.oneclawTask.taskName,
        raw: oneclawRun,
        receipt,
      });

      stored.result.executions = [
        ...(stored.result.executions || []).filter((item) => !(item.provider === 'oneclaw' && item.status === 'blocked')),
        execution,
      ];

      appendProof(stored.result, {
        type: 'execution',
        title: 'OneClaw task submitted after approval',
        value: oneclawRun.id ? `Task ${oneclawRun.id} is ${oneclawRun.status}.` : `Task status: ${oneclawRun.status}.`,
        timestamp: now(),
        metadata: {
          provider: 'oneclaw',
          oneclawTaskId: oneclawRun.id ?? null,
          taskName: stored.oneclawTask.taskName,
          receipt,
        },
      });

      await createMemory({
        runId: stored.result.runId,
        kind: 'execution.submitted',
        title: 'OneClaw task submitted',
        summary: `${stored.oneclawTask.taskName} submitted after approval.`,
        content: { oneclawRun, oneclawTask: stored.oneclawTask, receipt },
      });
      await recordTheOneEvent({
        runId: stored.result.runId,
        type: 'execution.submitted',
        provider: 'oneclaw',
        status,
        summary: `${stored.oneclawTask.taskName} submitted after approval.`,
        payload: { oneclawRun, receipt },
      });
    }
  });
}

export async function rejectRun(input: { runId: string; approvalId?: string; rejectAll?: boolean }) {
  return updateStoredRun(input.runId, async (stored) => {
    const approvals = stored.result.approvals || [];
    stored.result.approvals = approvals.map((approval) => {
      const shouldReject = input.rejectAll || approval.id === input.approvalId;
      if (!shouldReject || approval.status !== 'pending') return approval;
      return {
        ...approval,
        status: 'rejected',
        reason: `${approval.reason} Rejected by TheOne operator.`,
      };
    });

    stored.result.executions = [
      ...(stored.result.executions || []),
      createExecutionRecord({
        provider: 'theone',
        status: 'rejected',
        summary: 'External execution rejected by approval gate.',
        receipt: receiptForTheOne('approval.reject', 'rejected', {
          runId: input.runId,
          approvalId: input.approvalId ?? null,
        }),
      }),
    ];

    appendProof(stored.result, {
      type: 'execution',
      title: 'Execution rejected',
      value: 'Approval gate rejected. No OneClaw task was submitted.',
      timestamp: now(),
      metadata: {
        provider: 'theone',
        runId: input.runId,
      },
    });

    await createMemory({
      runId: stored.result.runId,
      kind: 'approval.rejected',
      title: 'Execution rejected',
      summary: 'The operator rejected an approval gate.',
      content: { approvals: stored.result.approvals },
    });
    await recordTheOneEvent({
      runId: stored.result.runId,
      type: 'approval.rejected',
      provider: 'theone',
      status: 'rejected',
      summary: 'External execution rejected by approval gate.',
      payload: { approvals: stored.result.approvals },
    });
  });
}

export async function syncRunExecution(input: { runId: string }) {
  return updateStoredRun(input.runId, async (stored) => {
    const oneclawExecution = getPrimaryOneClawExecution(stored.result.executions || []);

    if (!oneclawExecution?.externalId) {
      throw new Error('No OneClaw task id is available for this run.');
    }

    const latest = await getOneClawTask<Record<string, unknown>>(oneclawExecution.externalId);
    const status = String(latest.status || latest.state || 'unknown');
    const failureDetail = oneClawFailureDetail(latest);
    const latestReceipt = receiptFromOneClawRun({
      id: oneclawExecution.externalId,
      status,
      taskName: oneclawExecution.taskName,
      mock: Boolean(latest.mock),
      raw: latest,
    }, 'oneclaw.task.get');

    stored.result.executions = (stored.result.executions || []).map((execution) => {
      if (execution.id !== oneclawExecution.id) return execution;
      return {
        ...execution,
        status: status === 'mock' ? 'mock' : mapOneClawStatusToExecutionStatus(status),
        summary: failureDetail
          ? `OneClaw task ${oneclawExecution.externalId} is ${status}: ${failureDetail}`
          : `OneClaw task ${oneclawExecution.externalId} is ${status}.`,
        raw: latest,
        receipt: latestReceipt,
      };
    });

    appendProof(stored.result, {
      type: 'execution',
      title: 'OneClaw task synced',
      value: failureDetail
        ? `Task ${oneclawExecution.externalId} is ${status}: ${failureDetail}`
        : `Task ${oneclawExecution.externalId} is ${status}.`,
      timestamp: now(),
      metadata: {
        provider: 'oneclaw',
        oneclawTaskId: oneclawExecution.externalId,
        receipt: latestReceipt,
      },
    });

    await createMemory({
      runId: stored.result.runId,
      kind: 'execution.synced',
      title: 'OneClaw task synced',
      summary: failureDetail
        ? `Task ${oneclawExecution.externalId} is ${status}: ${failureDetail}`
        : `Task ${oneclawExecution.externalId} is ${status}.`,
      content: { latest, receipt: latestReceipt },
    });
    await recordTheOneEvent({
      runId: stored.result.runId,
      type: 'execution.synced',
      provider: 'oneclaw',
      status: mapOneClawStatusToExecutionStatus(status),
      summary: failureDetail
        ? `Task ${oneclawExecution.externalId} is ${status}: ${failureDetail}`
        : `Task ${oneclawExecution.externalId} is ${status}.`,
      payload: { latest, receipt: latestReceipt },
    });
  });
}

export async function getRunReplayInput(runId: string) {
  const run = await getStoredRun(runId);
  if (!run) return null;
  return {
    raw: run.intent.objective,
    mode: run.os?.mode || 'assist',
  };
}

export async function resumeRun(input: { runId: string }) {
  const run = await getStoredRun(input.runId);
  if (!run) throw new Error('TheOne run not found.');

  const hasOneClawExecution = (run.executions || []).some((execution) => execution.provider === 'oneclaw' && execution.externalId);
  if (hasOneClawExecution) {
    return syncRunExecution({ runId: input.runId });
  }

  const pending = (run.approvals || []).some((approval) => approval.required && approval.status === 'pending');
  if (pending) {
    return approveRun({ runId: input.runId, approveAll: true });
  }

  return run;
}

export async function listRuns(limit = 20) {
  try {
    await ensureTheOneDatabase();
    const rows = await prisma.theOneRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(limit, 100)),
      include: {
        approvals: true,
        executions: true,
        _count: {
          select: {
            proof: true,
            memories: true,
          },
        },
      },
    });

    return rows.map((row) => {
      const result = safeParse<TheOneRunResult | null>(row.resultJson, null);
      const pendingApprovals = row.approvals.filter((approval) => approval.required && approval.status === 'pending').length;
      const latestExecution = [...row.executions].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];

      return {
        runId: row.id,
        ok: row.ok,
        mode: row.mode,
        intentType: row.intentType,
        objective: row.objective,
        workflowStatus: result?.os?.workflow?.status || 'idle',
        pendingApprovals,
        latestExecutionStatus: latestExecution?.status || null,
        proofCount: row._count.proof,
        memoryCount: row._count.memories,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  } catch (error) {
    console.warn('[theone] listing runs from offline ledger:', databaseWarning(error));
    return Array.from(offlineRuns.values()).slice(0, Math.max(1, Math.min(limit, 100))).map((stored) => ({
      runId: stored.result.runId,
      ok: stored.result.ok,
      mode: stored.result.os?.mode || 'assist',
      intentType: stored.result.intent.type,
      objective: stored.result.intent.objective,
      workflowStatus: stored.result.os?.workflow?.status || 'idle',
      pendingApprovals: (stored.result.approvals || []).filter((approval) => approval.required && approval.status === 'pending').length,
      latestExecutionStatus: stored.result.executions?.[0]?.status || null,
      proofCount: stored.result.proof?.length || 0,
      memoryCount: offlineMemory.filter((memory) => memory.runId === stored.result.runId).length,
      createdAt: stored.result.proof?.[0]?.timestamp || now(),
      updatedAt: now(),
    }));
  }
}

export async function listProof(limit = 50) {
  try {
    await ensureTheOneDatabase();
    const rows = await prisma.theOneProof.findMany({
      orderBy: { timestamp: 'desc' },
      take: Math.max(1, Math.min(limit, 200)),
      include: {
        run: {
          select: {
            id: true,
            intentType: true,
            objective: true,
          },
        },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      runId: row.runId,
      type: row.type,
      title: row.title,
      value: row.value,
      metadata: safeParse<Record<string, unknown> | null>(row.metadataJson, null),
      timestamp: row.timestamp.toISOString(),
      run: row.run,
    }));
  } catch (error) {
    console.warn('[theone] listing proof from offline ledger:', databaseWarning(error));
    return offlineProof.slice(0, Math.max(1, Math.min(limit, 200)));
  }
}

export async function listMemory(limit = 50) {
  try {
    await ensureTheOneDatabase();
    const rows = await prisma.theOneMemory.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(limit, 200)),
      include: {
        run: {
          select: {
            id: true,
            intentType: true,
            objective: true,
          },
        },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      runId: row.runId,
      kind: row.kind,
      title: row.title,
      summary: row.summary,
      content: safeParse<Record<string, unknown> | null>(row.contentJson, null),
      createdAt: row.createdAt.toISOString(),
      run: row.run,
    }));
  } catch (error) {
    console.warn('[theone] listing memory from offline ledger:', databaseWarning(error));
    return offlineMemory.slice(0, Math.max(1, Math.min(limit, 200)));
  }
}

export async function queryMemoryGraph(input: {
  query: string;
  intentType?: string;
  capabilities?: string[];
  limit?: number;
}): Promise<MemoryGraphHit[]> {
  const limit = Math.max(1, Math.min(input.limit || 5, 20));
  const terms = tokenizeMemoryQuery(input.query, [
    input.intentType || '',
    ...(input.capabilities || []),
  ]);

  try {
    await ensureTheOneDatabase();
    const rows = await prisma.theOneMemory.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        run: {
          select: {
            id: true,
            intentType: true,
            objective: true,
          },
        },
      },
    });

    return rows
      .map((row) => {
        const content = safeParse<Record<string, unknown> | null>(row.contentJson, null);
        const haystack = [
          row.kind,
          row.title,
          row.summary,
          row.run?.intentType,
          row.run?.objective,
          content ? JSON.stringify(content) : '',
        ].filter(Boolean).join(' ').toLowerCase();
        const score = scoreMemoryText(haystack, terms)
          + (input.intentType && row.run?.intentType === input.intentType ? 4 : 0);
        const matchedTerms = terms.filter((term) => haystack.includes(term));

        return {
          id: row.id,
          runId: row.runId,
          kind: row.kind,
          title: row.title,
          summary: row.summary,
          score,
          matchedTerms,
          createdAt: row.createdAt.toISOString(),
          run: row.run,
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  } catch (error) {
    console.warn('[theone] memory graph using offline ledger:', databaseWarning(error));
    return offlineMemory
      .map((row) => {
        const haystack = [
          row.kind,
          row.title,
          row.summary,
          row.run?.intentType,
          row.run?.objective,
          row.content ? JSON.stringify(row.content) : '',
        ].filter(Boolean).join(' ').toLowerCase();
        const score = scoreMemoryText(haystack, terms)
          + (input.intentType && row.run?.intentType === input.intentType ? 4 : 0);
        const matchedTerms = terms.filter((term) => haystack.includes(term));

        return {
          id: row.id,
          runId: row.runId || null,
          kind: row.kind,
          title: row.title,
          summary: row.summary,
          score,
          matchedTerms,
          createdAt: row.createdAt,
          run: row.run,
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
}
