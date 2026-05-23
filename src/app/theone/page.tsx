'use client';

import { useEffect, useState } from 'react';
import { TheOneShell } from '@/components/theone/TheOneShell';

export default function TheOnePage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [providerChecks, setProviderChecks] = useState<any[]>([]);
  const [oneClawApprovals, setOneClawApprovals] = useState<any[]>([]);
  const [oneClawTasks, setOneClawTasks] = useState<any[]>([]);
  const [osStatus, setOsStatus] = useState<any>(null);
  const [workerCatalog, setWorkerCatalog] = useState<any[]>([]);
  const [ledger, setLedger] = useState<{ runs: any[]; proof: any[]; memory: any[] }>({
    runs: [],
    proof: [],
    memory: [],
  });

  async function refreshOsStatus() {
    const data = await fetch('/api/theone/status')
      .then((res) => res.json())
      .catch(() => ({ os: null }));
    setOsStatus(data.os || null);
  }

  async function refreshWorkerCatalog() {
    const data = await fetch('/api/theone/workers')
      .then((res) => res.json())
      .catch(() => ({ workers: [] }));
    setWorkerCatalog(data.workers || []);
  }

  async function refreshProviderChecks() {
    const data = await fetch('/api/theone/providers/check')
      .then((res) => res.json())
      .catch(() => ({ providers: [] }));
    setProviderChecks(data.providers || []);
  }

  async function refreshLedger() {
    const [runs, proof, memory] = await Promise.all([
      fetch('/api/theone/runs?limit=20').then((res) => res.json()).catch(() => ({ items: [] })),
      fetch('/api/theone/proof?limit=20').then((res) => res.json()).catch(() => ({ items: [] })),
      fetch('/api/theone/memory?limit=20').then((res) => res.json()).catch(() => ({ items: [] })),
    ]);

    setLedger({
      runs: runs.items || [],
      proof: proof.items || [],
      memory: memory.items || [],
    });
  }

  async function refreshOneClawApprovals() {
    const data = await fetch('/api/theone/oneclaw/approvals')
      .then((res) => res.json())
      .catch((error) => ({
        ok: false,
        approvals: [],
        error: error instanceof Error ? error.message : 'OneClaw approvals unavailable',
      }));

    setOneClawApprovals(data.approvals || []);
  }

  function collectOneClawTaskIds(source: any): string[] {
    const ids = new Set<string>();
    const add = (value: unknown) => {
      if (typeof value === 'string' && value.trim()) ids.add(value.trim());
    };

    (source?.executions || source?.os?.executions || []).forEach((execution: any) => {
      if (execution?.provider === 'oneclaw') add(execution.externalId);
    });
    (source?.oneClawTasks || []).forEach((task: any) => add(task?.id));
    (source?.oneClawActionResult?.result ? [source.oneClawActionResult.result] : []).forEach((task: any) => add(task?.id || task?.task?.id));
    (source?.oneClawApprovalResult?.result?.task ? [source.oneClawApprovalResult.result.task] : []).forEach((task: any) => add(task?.id));
    oneClawApprovals.forEach((approval: any) => add(approval.taskId));

    return Array.from(ids);
  }

  function upsertOneClawTask(task: any) {
    const item = task?.task || task;
    if (!item?.id) return;

    setOneClawTasks((current) => {
      const rest = current.filter((existing) => existing.id !== item.id);
      return [item, ...rest].slice(0, 10);
    });
  }

  async function refreshOneClawTasks(seed?: any) {
    const ids = collectOneClawTaskIds(seed || result);
    if (!ids.length) return;

    const tasks = await Promise.all(ids.map(async (taskId) => {
      const data = await fetch(`/api/theone/oneclaw/tasks/${encodeURIComponent(taskId)}`)
        .then((res) => res.json())
        .catch(() => null);
      return data?.task || null;
    }));

    setOneClawTasks(tasks.filter(Boolean));
  }

  useEffect(() => {
    refreshOsStatus();
    refreshWorkerCatalog();
    refreshLedger();
    refreshProviderChecks();
    refreshOneClawApprovals();
  }, []);

  useEffect(() => {
    refreshOneClawTasks();
  }, [oneClawApprovals]);

  async function handleRun(input: string, mode: string) {
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch('/api/theone/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input,
          mode,
          language: 'en',
        }),
      });

      const json = await res.json();
      setResult(json);
      await refreshOsStatus();
      await refreshWorkerCatalog();
      await refreshLedger();
      await refreshProviderChecks();
      await refreshOneClawApprovals();
      await refreshOneClawTasks(json);
    } catch (error) {
      setResult({
        ok: false,
        error: error instanceof Error ? error.message : 'TheOne run failed',
      });
    } finally {
      setLoading(false);
    }
  }

  async function postRunAction(path: string, body: Record<string, unknown>) {
    if (!result?.runId) return;

    setLoading(true);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          runId: result.runId,
          ...body,
        }),
      });

      const json = await res.json();
      setResult(json);
      await refreshOsStatus();
      await refreshWorkerCatalog();
      await refreshLedger();
      await refreshProviderChecks();
      await refreshOneClawApprovals();
      await refreshOneClawTasks(json);
    } catch (error) {
      setResult({
        ...result,
        ok: false,
        error: error instanceof Error ? error.message : 'TheOne action failed',
      });
    } finally {
      setLoading(false);
    }
  }

  function handleApprove(approvalId?: string, approveAll = false) {
    postRunAction('/api/theone/approvals/approve', { approvalId, approveAll });
  }

  function handleReject(approvalId?: string, rejectAll = false) {
    postRunAction('/api/theone/approvals/reject', { approvalId, rejectAll });
  }

  async function postOneClawApprovalAction(approvalId: string, decision: 'approve' | 'reject') {
    setLoading(true);
    try {
      const res = await fetch(`/api/theone/oneclaw/approvals/${encodeURIComponent(approvalId)}/${decision}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          decidedBy: 'maqing',
          decisionNote: `${decision === 'approve' ? 'Approved' : 'Rejected'} from TheOne control plane.`,
        }),
      });
      const json = await res.json();
      const task = json?.result?.task || json?.result;
      upsertOneClawTask(task);

      if (!res.ok) {
        throw new Error(json.error || `OneClaw ${decision} failed`);
      }

      setResult((current: any) => ({
        ...(current || {}),
        ok: true,
        oneClawApprovalResult: json,
        oneClawTasks: task?.id ? [task] : current?.oneClawTasks,
        proof: [
          {
            type: 'execution',
            title: 'OneClaw approval executed',
            value: `${json?.result?.approval?.action || 'approval'} -> ${task?.status || 'approved'}`,
            timestamp: new Date().toISOString(),
            metadata: {
              provider: 'oneclaw',
              approvalId,
              taskId: task?.id || json?.result?.approval?.taskId || null,
              receipt: task?.steps?.[0]?.output?.receipt || null,
            },
          },
          ...((current?.proof || []).slice(0, 12)),
        ],
      }));
      await refreshOsStatus();
      await refreshWorkerCatalog();
      await refreshOneClawApprovals();
      await refreshOneClawTasks({ oneClawApprovalResult: json });
      await refreshLedger();
      await refreshProviderChecks();
    } catch (error) {
      setResult((current: any) => ({
        ...(current || {}),
        ok: false,
        error: error instanceof Error ? error.message : 'OneClaw approval action failed',
      }));
    } finally {
      setLoading(false);
    }
  }

  function handleApproveOneClaw(approvalId: string) {
    postOneClawApprovalAction(approvalId, 'approve');
  }

  function handleRejectOneClaw(approvalId: string) {
    postOneClawApprovalAction(approvalId, 'reject');
  }

  async function handleRunOneClawAction(payload: {
    action: string;
    input: Record<string, unknown>;
    approvalMode: 'auto' | 'manual';
  }) {
    setLoading(true);
    try {
      const idempotencyKey = `theone-${payload.action}-${Date.now()}`;
      const res = await fetch('/api/theone/oneclaw/actions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...payload,
          idempotencyKey,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || 'OneClaw action failed');
      }

      const task = json?.result?.task || json?.result;
      upsertOneClawTask(task);
      setResult((current: any) => ({
        ...(current || {}),
        ok: true,
        oneClawActionResult: json,
        oneClawTasks: task?.id ? [task, ...(current?.oneClawTasks || [])].slice(0, 10) : current?.oneClawTasks,
        proof: [
          {
            type: 'execution',
            title: 'OneClaw action submitted',
            value: `${payload.action} -> ${task?.status || json?.result?.status || 'submitted'}`,
            timestamp: new Date().toISOString(),
            metadata: {
              provider: 'oneclaw',
              action: payload.action,
              taskId: task?.id || null,
              receipt: task?.steps?.[0]?.output?.receipt || null,
            },
          },
          ...((current?.proof || []).slice(0, 12)),
        ],
      }));
      await refreshOsStatus();
      await refreshWorkerCatalog();
      await refreshOneClawApprovals();
      await refreshOneClawTasks({ oneClawActionResult: json });
    } catch (error) {
      setResult((current: any) => ({
        ...(current || {}),
        ok: false,
        error: error instanceof Error ? error.message : 'OneClaw action failed',
      }));
    } finally {
      setLoading(false);
    }
  }

  async function handleRefreshOneClawTask(taskId?: string) {
    if (!taskId) {
      await refreshOneClawTasks();
      return;
    }

    const data = await fetch(`/api/theone/oneclaw/tasks/${encodeURIComponent(taskId)}`)
      .then((res) => res.json())
      .catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : 'OneClaw task refresh failed',
      }));

    if (data?.task) {
      upsertOneClawTask(data.task);
      setResult((current: any) => ({
        ...(current || {}),
        oneClawTaskResult: data,
        proof: [
          {
            type: 'execution',
            title: 'OneClaw task synced',
            value: `${data.task.id} -> ${data.task.status}`,
            timestamp: new Date().toISOString(),
            metadata: {
              provider: 'oneclaw',
              taskId: data.task.id,
            },
          },
          ...((current?.proof || []).slice(0, 12)),
        ],
      }));
    } else if (data?.error) {
      setResult((current: any) => ({
        ...(current || {}),
        ok: false,
        error: data.error,
      }));
    }
  }

  function handleSync() {
    postRunAction('/api/theone/executions/sync', {});
  }

  async function handleOpenRun(runId: string) {
    setLoading(true);
    try {
      const json = await fetch(`/api/theone/runs/${encodeURIComponent(runId)}`).then((res) => res.json());
      setResult(json);
      await refreshOsStatus();
      await refreshWorkerCatalog();
    } catch (error) {
      setResult({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to open run',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <TheOneShell
      loading={loading}
      result={result}
      osStatus={osStatus}
      workerCatalog={workerCatalog}
      ledger={ledger}
      providerChecks={providerChecks}
      oneClawApprovals={oneClawApprovals}
      oneClawTasks={oneClawTasks}
      onRun={handleRun}
      onApprove={handleApprove}
      onReject={handleReject}
      onApproveOneClaw={handleApproveOneClaw}
      onRejectOneClaw={handleRejectOneClaw}
      onRunOneClawAction={handleRunOneClawAction}
      onRefreshOneClawTask={handleRefreshOneClawTask}
      onSync={handleSync}
      onOpenRun={handleOpenRun}
    />
  );
}
