'use client';

// TheOne Chat — Claude Code style conversation stream.
// One timeline, three elements: text bubbles, collapsible activity lines,
// a single inline approval point. Governance detail stays available but
// collapsed. The legacy /run dashboard remains untouched.

import { useCallback, useEffect, useRef, useState } from 'react';

type ActivityLine = { tool: string; detail: string; error?: boolean };

type ChatItem =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string; streaming?: boolean }
  | { id: string; kind: 'status'; text: string }
  | { id: string; kind: 'plan'; summary: string; steps: Array<{ title: string; action?: string }> }
  | { id: string; kind: 'activity'; lines: ActivityLine[] }
  | { id: string; kind: 'approval'; runId: string; count: number; actions: string[]; resolved?: 'approved' | 'dismissed' }
  | { id: string; kind: 'diff'; diff: string; diffStat: string; verified: boolean | null; open?: boolean }
  | { id: string; kind: 'worker'; title: string; entries: string[] }
  | { id: string; kind: 'error'; text: string };

type ChatAttachment = Record<string, unknown> & { id?: string; name?: string; error?: string };

type ApiMessage = { role: 'user' | 'assistant'; content: string };

let itemCounter = 0;
function nextId() {
  itemCounter += 1;
  return `item_${Date.now()}_${itemCounter}`;
}

const PATH_PATTERN = /(?:\/app\/workspaces|\/Users\/|\/home\/)[^\s,，。;:"'）)]+/;

// Routing is inverted: everything goes through the full AI OS pipeline by
// default; only clearly conversational turns take the fast token stream.
const ACTION_PATTERN = /分析|检查|研究|调研|准备|生成|创建|发布|发[个一条]|推文|报告|总结|汇总|抓取|爬|读取|读[一下]|查[询一]|搜索|下载|上传|部署|运行|执行|跑|修|改|写[个一]|新增|删除|翻译|整理|监控|提醒|安排|计划|工作流|任务|浏览器|桌面|文件|网站|网页|仓库|测试|workspace|npm|github|repo|worker|url|https?:|post|tweet|analy|research|check|inspect|generate|create|publish|scrape|fetch|search|deploy|run|fix|refactor|implement|write|report|summar|schedule|monitor|browse|code\./i;

function isChitchat(text: string) {
  return !PATH_PATTERN.test(text) && !ACTION_PATTERN.test(text);
}

function extractWorkspacePath(text: string): string | null {
  const match = text.match(PATH_PATTERN);
  return match ? match[0].replace(/[，。;:]+$/, '') : null;
}

function parseTaskLog(line: string): ActivityLine | null {
  const agent = line.match(/\[agent:(\w+)\]\s*([\s\S]*)/);
  if (agent) {
    const type = agent[1];
    const detail = agent[2].trim();
    if (type === 'tool_call') {
      const call = detail.match(/^(\w+)\((.*)\)$/s);
      return { tool: call?.[1] || 'tool', detail: call?.[2]?.slice(0, 160) || detail.slice(0, 160) };
    }
    if (type === 'tool_result' && detail.startsWith('error')) {
      return { tool: 'error', detail: detail.slice(0, 160), error: true };
    }
    if (type === 'compaction') return { tool: 'compact', detail };
    if (type === 'done') return { tool: 'done', detail: detail.slice(0, 160) };
    return null;
  }
  // Generic worker logs: strip the timestamp/step prefix, keep the message
  // so non-code AI OS tasks are visible in the stream too.
  const generic = line.replace(/^[0-9T:.Z-]+\s*(\[[^\]]*\]\s*)?/, '').trim();
  if (!generic || /^ROUTER HIT|^BODY/i.test(generic)) return null;
  return { tool: 'log', detail: generic.slice(0, 160) };
}

async function readSse(
  response: Response,
  onEvent: (event: string, data: unknown) => void,
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('no stream body');
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() || '';
    for (const frame of frames) {
      let event = 'message';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data || data === '[DONE]') continue;
      try {
        onEvent(event, JSON.parse(data));
      } catch {
        // Non-JSON frames are ignored.
      }
    }
  }
}

export default function ChatPage() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [mode, setMode] = useState<'manual' | 'assist' | 'auto'>('assist');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionIdRef = useRef(`chat_${Date.now().toString(36)}`);
  const historyRef = useRef<ApiMessage[]>([]);
  const contextRef = useRef<Record<string, unknown> | null>(null);
  const approvedTasksRef = useRef<Set<string>>(new Set());
  const pollAbortRef = useRef<{ stop: boolean }>({ stop: false });
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items]);

  const patchItem = useCallback((id: string, patch: (item: ChatItem) => ChatItem) => {
    setItems((current) => current.map((item) => (item.id === id ? patch(item) : item)));
  }, []);

  const pushItem = useCallback((item: ChatItem) => {
    setItems((current) => [...current, item]);
    return item.id;
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  // ---- agent run polling (activity lines + diff + verified) ----

  const pollAgentTask = useCallback(async (taskId: string) => {
    const control = { stop: false };
    pollAbortRef.current = control;
    const activityId = pushItem({ id: nextId(), kind: 'activity', lines: [] });
    const seen = new Set<string>();
    let terminal = '';

    for (let round = 0; round < 300 && !control.stop; round += 1) {
      try {
        const response = await fetch(`/api/theone/agent/task/${encodeURIComponent(taskId)}`, { cache: 'no-store' });
        const payload = await response.json();
        if (!payload?.ok) throw new Error(payload?.error || 'poll failed');
        const task = payload.task as { status: string; logs: string[]; steps: Array<{ action: string; status?: string; output: { status: string; verified: boolean; diff: string; diffStat: string; summary: string; mode: string; note?: string } }> };

        const fresh: ActivityLine[] = [];
        for (const raw of task.logs) {
          if (seen.has(raw)) continue;
          seen.add(raw);
          const parsed = parseTaskLog(raw);
          if (parsed) fresh.push(parsed);
        }
        if (fresh.length) {
          patchItem(activityId, (item) => (item.kind === 'activity'
            ? { ...item, lines: [...item.lines, ...fresh] }
            : item));
        }

        // Auto-approve follow-up steps once the user approved the task.
        const pendingApprovals = Array.isArray(payload.approvals) ? payload.approvals : [];
        if (pendingApprovals.length && approvedTasksRef.current.has(taskId)) {
          await fetch(`/api/theone/agent/task/${encodeURIComponent(taskId)}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'approve_all' }),
          }).catch(() => undefined);
        }

        if (['success', 'completed', 'failed', 'error', 'rejected'].includes(task.status)) {
          terminal = task.status;
          const agentStep = task.steps.find((step) => step.output?.mode === 'agent_engine' && step.output?.diff)
            || task.steps.find((step) => step.action === 'code.patch.apply');
          if (agentStep?.output) {
            if (agentStep.output.diff) {
              pushItem({
                id: nextId(),
                kind: 'diff',
                diff: agentStep.output.diff,
                diffStat: agentStep.output.diffStat,
                verified: agentStep.output.verified ?? null,
              });
            }
            if (agentStep.output.summary) {
              pushItem({ id: nextId(), kind: 'assistant', text: agentStep.output.summary });
            }
          }
          // Generic worker summary for every step (X, GitHub, browser, files…).
          const nonCodeSteps = task.steps.filter((step) => step !== agentStep);
          if (nonCodeSteps.length) {
            pushItem({
              id: nextId(),
              kind: 'worker',
              title: `Worker 步骤(${task.steps.length})`,
              entries: nonCodeSteps.map((step) => {
                const detail = step.output?.summary || step.output?.note || '';
                return `${step.action} → ${step.output?.status || step.status}${detail ? `:${detail.slice(0, 120)}` : ''}`;
              }),
            });
          }
          pushItem({
            id: nextId(),
            kind: 'status',
            text: terminal === 'success' || terminal === 'completed'
              ? '任务完成 ✓'
              : `任务结束:${terminal}`,
          });
          break;
        }
      } catch (error) {
        pushItem({ id: nextId(), kind: 'error', text: `进度查询失败:${error instanceof Error ? error.message : String(error)}` });
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }, [patchItem, pushItem]);

  // Approving goes through TheOne (it resolves the gate AND dispatches the
  // prepared task to OneClaw), then we poll the resulting OneClaw task.
  const approveTask = useCallback(async (approvalItemId: string, runId: string) => {
    patchItem(approvalItemId, (item) => (item.kind === 'approval' ? { ...item, resolved: 'approved' } : item));
    pushItem({ id: nextId(), kind: 'status', text: '已批准,正在派发执行…' });
    try {
      const response = await fetch('/api/theone/approvals/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ runId, approveAll: true }),
      });
      const payload = await response.json();
      if (payload?.ok === false) throw new Error(payload?.error || 'approve failed');

      let taskId = String(payload?.networkSignals?.oneClawRunId || '');

      // OneClaw keeps its own approval gate on code.patch.apply. One user
      // approval covers both: find the dispatched task on the bridge and
      // clear its pending approvals too.
      for (let attempt = 0; attempt < 6 && !taskId; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const pending = await fetch('/api/theone/agent/pending', { cache: 'no-store' })
          .then((res) => (res.ok ? res.json() : null))
          .catch(() => null);
        const tasks = Array.isArray(pending?.tasks) ? pending.tasks : [];
        if (tasks.length) taskId = String(tasks[tasks.length - 1].taskId || '');
      }

      if (taskId) {
        approvedTasksRef.current.add(taskId);
        await fetch(`/api/theone/agent/task/${encodeURIComponent(taskId)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'approve_all' }),
        }).catch(() => undefined);
        void pollAgentTask(taskId);
      } else {
        pushItem({ id: nextId(), kind: 'status', text: '已批准。任务已派发,但未拿到执行 id——请稍后在运行记录里查看结果。' });
      }
    } catch (error) {
      pushItem({ id: nextId(), kind: 'error', text: `批准失败:${error instanceof Error ? error.message : String(error)}` });
    }
  }, [patchItem, pollAgentTask, pushItem]);

  // ---- send paths ----

  const runDirectStream = useCallback(async (text: string) => {
    const assistantId = pushItem({ id: nextId(), kind: 'assistant', text: '', streaming: true });
    let collected = '';
    try {
      const response = await fetch('/api/theone/chat/stream-direct', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text, conversation: historyRef.current.slice(-8) }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `HTTP ${response.status}`);
      await readSse(response, (_event, data) => {
        const record = data as { delta?: string; error?: string };
        if (record.delta) {
          collected += record.delta;
          patchItem(assistantId, (item) => (item.kind === 'assistant' ? { ...item, text: collected } : item));
        }
        if (record.error) throw new Error(record.error);
      });
      patchItem(assistantId, (item) => (item.kind === 'assistant' ? { ...item, streaming: false } : item));
      historyRef.current.push({ role: 'assistant', content: collected });
    } catch (error) {
      removeItem(assistantId);
      pushItem({ id: nextId(), kind: 'error', text: `回复失败:${error instanceof Error ? error.message : String(error)}` });
    }
  }, [patchItem, pushItem, removeItem]);

  const runPipelineStream = useCallback(async (text: string) => {
    const statusId = pushItem({ id: nextId(), kind: 'status', text: '正在理解请求…' });
    const assistantId = pushItem({ id: nextId(), kind: 'assistant', text: '', streaming: true });
    let answer = '';
    let taskId = '';
    let runId = '';
    const approvalActions: string[] = [];

    try {
      const outgoingAttachments = attachments.filter((attachment) => !attachment.error);
      const response = await fetch('/api/theone/chat/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: historyRef.current,
          sessionId: sessionIdRef.current,
          mode,
          context: contextRef.current,
          attachments: outgoingAttachments.length ? outgoingAttachments : undefined,
        }),
      });
      if (outgoingAttachments.length) setAttachments([]);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      await readSse(response, (event, data) => {
        const record = data as Record<string, unknown>;
        if (event === 'stage') {
          patchItem(statusId, (item) => (item.kind === 'status' ? { ...item, text: String(record.label || '处理中') + '…' } : item));
        } else if (event === 'plan_created') {
          const steps = Array.isArray(record.steps) ? record.steps : [];
          pushItem({
            id: nextId(),
            kind: 'plan',
            summary: String(record.summary || '已生成执行计划'),
            steps: steps.slice(0, 8).map((step) => {
              const s = step as Record<string, unknown>;
              return { title: String(s.title || s.action || 'step'), action: typeof s.action === 'string' ? s.action : undefined };
            }),
          });
        } else if (event === 'approval_required') {
          if (typeof record.action === 'string') approvalActions.push(record.action);
        } else if (event === 'answer_delta') {
          answer += String(record.text || '');
          patchItem(assistantId, (item) => (item.kind === 'assistant' ? { ...item, text: answer } : item));
        } else if (event === 'result') {
          const result = record as { runId?: string; networkSignals?: { oneClawRunId?: string | null }; chat?: { codeRuntime?: { workspacePath?: string | null } }; codeMission?: unknown; executions?: Array<Record<string, unknown>> };
          taskId = String(result.networkSignals?.oneClawRunId || '');
          runId = String(result.runId || '');
          const resultWorkspace = result.chat?.codeRuntime?.workspacePath;
          if (resultWorkspace) setWorkspace(String(resultWorkspace));
          const executions = Array.isArray(result.executions) ? result.executions : [];
          if (executions.length) {
            pushItem({
              id: nextId(),
              kind: 'worker',
              title: `已执行(${executions.length})`,
              entries: executions.slice(-8).map((execution) => (
                `${String(execution.taskName || execution.action || 'step')} → ${String(execution.status || '')}`
              )),
            });
          }
          contextRef.current = {
            codeMission: (result as Record<string, unknown>).codeMission || null,
            lastAssistant: answer.slice(0, 2400),
          };
        } else if (event === 'error') {
          throw new Error(String(record.error || 'pipeline failed'));
        }
      });

      removeItem(statusId);
      patchItem(assistantId, (item) => (item.kind === 'assistant' ? { ...item, streaming: false } : item));
      if (answer) historyRef.current.push({ role: 'assistant', content: answer });

      if (runId && approvalActions.length) {
        pushItem({
          id: nextId(),
          kind: 'approval',
          runId,
          count: approvalActions.length,
          actions: Array.from(new Set(approvalActions)).slice(0, 8),
        });
      } else if (taskId) {
        approvedTasksRef.current.add(taskId);
        void pollAgentTask(taskId);
      }
    } catch (error) {
      removeItem(statusId);
      patchItem(assistantId, (item) => (item.kind === 'assistant' ? { ...item, streaming: false } : item));
      pushItem({ id: nextId(), kind: 'error', text: `请求失败:${error instanceof Error ? error.message : String(error)}` });
    }
  }, [patchItem, pollAgentTask, pushItem, removeItem]);

  const send = useCallback(async () => {
    const raw = input.trim();
    if (!raw || busy) return;
    setInput('');
    setBusy(true);
    pollAbortRef.current.stop = true;

    // Session continuity: remember the workspace, auto-attach it to
    // follow-up task messages that do not repeat the path.
    const mentionedPath = extractWorkspacePath(raw);
    if (mentionedPath) setWorkspace(mentionedPath);
    const activeWorkspace = mentionedPath || workspace;

    // Inverted routing: the full AI OS pipeline is the default; only clearly
    // conversational turns (no action verbs, no paths, no attachments) take
    // the fast direct token stream.
    const usePipeline = !isChitchat(raw) || attachments.length > 0;
    const outgoing = usePipeline && !mentionedPath && activeWorkspace && /workspace|代码|修|改|测试|npm|repo/i.test(raw)
      ? `workspace 是 ${activeWorkspace}。${raw}`
      : raw;

    pushItem({ id: nextId(), kind: 'user', text: raw });
    historyRef.current.push({ role: 'user', content: outgoing });

    try {
      if (usePipeline) await runPipelineStream(outgoing);
      else await runDirectStream(outgoing);
    } finally {
      setBusy(false);
    }
  }, [attachments.length, busy, input, pushItem, runDirectStream, runPipelineStream, workspace]);

  const uploadFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length || uploading) return;
    setUploading(true);
    try {
      const form = new FormData();
      Array.from(files).slice(0, 8).forEach((file) => form.append('files', file));
      const response = await fetch('/api/theone/chat/upload', { method: 'POST', body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(data?.error || `upload failed (${response.status})`);
      const uploaded = Array.isArray(data.attachments) ? data.attachments as ChatAttachment[] : [];
      setAttachments((current) => [...current, ...uploaded].slice(0, 8));
    } catch (error) {
      pushItem({ id: nextId(), kind: 'error', text: `上传失败:${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [pushItem, uploading]);

  return (
    <div className="tc-root">
      <style>{`
        .tc-root { min-height: 100vh; background: #0b0f0e; color: #e6ece9; display: flex; flex-direction: column; font-family: ui-sans-serif, -apple-system, 'PingFang SC', 'Noto Sans SC', sans-serif; }
        .tc-header { display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-bottom: 1px solid #1c2422; position: sticky; top: 0; background: rgba(11,15,14,0.92); backdrop-filter: blur(8px); z-index: 5; }
        .tc-title { font-size: 14px; font-weight: 600; letter-spacing: 0.08em; color: #7ee2c1; }
        .tc-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; background: #14201c; border: 1px solid #24413a; color: #9fd7c2; border-radius: 999px; padding: 3px 10px; max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tc-chip button { background: none; border: none; color: #6f9c8d; cursor: pointer; font-size: 12px; }
        .tc-scroll { flex: 1; overflow-y: auto; }
        .tc-list { max-width: 860px; margin: 0 auto; padding: 24px 20px 140px; display: flex; flex-direction: column; gap: 14px; }
        .tc-user { align-self: flex-end; max-width: 78%; background: #143028; border: 1px solid #1f4a3c; border-radius: 14px 14px 4px 14px; padding: 10px 14px; white-space: pre-wrap; line-height: 1.6; font-size: 14px; }
        .tc-assistant { align-self: flex-start; max-width: 86%; white-space: pre-wrap; line-height: 1.7; font-size: 14px; color: #dfe8e4; }
        .tc-cursor { display: inline-block; width: 7px; height: 15px; background: #7ee2c1; margin-left: 2px; animation: tcBlink 1s step-start infinite; vertical-align: text-bottom; }
        @keyframes tcBlink { 50% { opacity: 0; } }
        .tc-status { font-size: 12.5px; color: #6f8a81; padding-left: 2px; }
        .tc-error { font-size: 13px; color: #f2a09b; background: #2a1512; border: 1px solid #55231d; border-radius: 8px; padding: 8px 12px; }
        .tc-activity { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; display: flex; flex-direction: column; gap: 3px; border-left: 2px solid #1f3a32; padding-left: 12px; }
        .tc-line { color: #8fb3a6; display: flex; gap: 8px; }
        .tc-line .t { color: #58c99b; min-width: 74px; }
        .tc-line.err, .tc-line.err .t { color: #e08a84; }
        .tc-plan { font-size: 12.5px; color: #93aca3; background: #101917; border: 1px solid #1c2c27; border-radius: 10px; padding: 10px 14px; }
        .tc-plan summary { cursor: pointer; color: #b8d4c9; }
        .tc-plan li { margin: 4px 0 0 16px; }
        .tc-approve { background: #12201c; border: 1px solid #2a5a48; border-radius: 12px; padding: 14px 16px; font-size: 13.5px; }
        .tc-approve .acts { color: #7d9c91; font-size: 12px; margin: 6px 0 10px; font-family: ui-monospace, Menlo, monospace; }
        .tc-btn { background: #1d5c44; color: #eafff5; border: none; border-radius: 8px; padding: 8px 18px; font-size: 13.5px; cursor: pointer; }
        .tc-btn:hover { background: #237253; }
        .tc-btn[disabled] { opacity: 0.5; cursor: default; }
        .tc-approved { color: #58c99b; font-size: 13px; }
        .tc-diff { border: 1px solid #1c2c27; border-radius: 10px; overflow: hidden; font-size: 12.5px; }
        .tc-diff summary { cursor: pointer; padding: 9px 14px; background: #101917; color: #b8d4c9; display: flex; gap: 10px; align-items: center; }
        .tc-verified { font-size: 11px; border-radius: 999px; padding: 2px 8px; }
        .tc-verified.ok { background: #123526; color: #6fdcAb; }
        .tc-verified.warn { background: #33270f; color: #e0b95e; }
        .tc-diff pre { margin: 0; padding: 12px 14px; overflow-x: auto; background: #0d1412; font-family: ui-monospace, Menlo, monospace; font-size: 12px; line-height: 1.55; }
        .tc-diff .add { color: #6fdcab; }
        .tc-diff .del { color: #e08a84; }
        .tc-inputbar { position: fixed; bottom: 0; left: 0; right: 0; background: linear-gradient(transparent, #0b0f0e 30%); padding: 18px 20px 22px; }
        .tc-inputbox { max-width: 860px; margin: 0 auto; display: flex; gap: 10px; background: #111917; border: 1px solid #223330; border-radius: 14px; padding: 10px 12px; }
        .tc-inputbox textarea { flex: 1; background: none; border: none; outline: none; resize: none; color: #e6ece9; font-size: 14px; line-height: 1.5; font-family: inherit; max-height: 160px; }
        .tc-empty { text-align: center; color: #5d7268; margin-top: 18vh; font-size: 14px; line-height: 2; }
        .tc-modes { margin-left: auto; display: inline-flex; gap: 2px; background: #101917; border: 1px solid #1c2c27; border-radius: 999px; padding: 2px; }
        .tc-mode { background: none; border: none; color: #6f8a81; font-size: 11.5px; padding: 3px 10px; border-radius: 999px; cursor: pointer; }
        .tc-mode.on { background: #1d5c44; color: #eafff5; }
        .tc-runlink { color: #6f9c8d; font-size: 12px; text-decoration: none; }
        .tc-attach { background: none; border: none; font-size: 16px; cursor: pointer; color: #6f9c8d; padding: 0 4px; }
        .tc-attachrow { max-width: 860px; margin: 0 auto 8px; display: flex; gap: 8px; flex-wrap: wrap; }
      `}</style>

      <header className="tc-header">
        <span className="tc-title">THEONE · CHAT</span>
        {workspace ? (
          <span className="tc-chip" title={workspace}>
            📁 {workspace}
            <button onClick={() => setWorkspace(null)} title="清除 workspace">✕</button>
          </span>
        ) : null}
        <span className="tc-modes">
          {(['manual', 'assist', 'auto'] as const).map((key) => (
            <button
              key={key}
              className={`tc-mode${mode === key ? ' on' : ''}`}
              onClick={() => setMode(key)}
            >{key}</button>
          ))}
        </span>
        <a className="tc-runlink" href="/run">专业模式 ↗</a>
      </header>

      <div className="tc-scroll">
        <div className="tc-list">
          {items.length === 0 ? (
            <div className="tc-empty">
              直接聊天,或描述一个代码任务。<br />
              任务示例:「帮我修 /app/workspaces/OneClaw/bench/fixtures/timeout-propagation 里 buildRequestOptions 忽略 timeoutMs 的 bug,跑 npm test 验证」<br />
              说过一次 workspace 后,后续任务可以省略路径。
            </div>
          ) : null}

          {items.map((item) => {
            if (item.kind === 'user') return <div key={item.id} className="tc-user">{item.text}</div>;
            if (item.kind === 'assistant') {
              if (!item.text && !item.streaming) return null;
              return (
                <div key={item.id} className="tc-assistant">
                  {item.text}
                  {item.streaming ? <span className="tc-cursor" /> : null}
                </div>
              );
            }
            if (item.kind === 'status') return <div key={item.id} className="tc-status">{item.text}</div>;
            if (item.kind === 'error') return <div key={item.id} className="tc-error">{item.text}</div>;
            if (item.kind === 'plan') {
              return (
                <details key={item.id} className="tc-plan">
                  <summary>▸ 计划:{item.summary}({item.steps.length} 步)</summary>
                  <ul>{item.steps.map((step, index) => <li key={index}>{step.action || step.title}</li>)}</ul>
                </details>
              );
            }
            if (item.kind === 'activity') {
              if (!item.lines.length) return <div key={item.id} className="tc-status">⏺ 引擎启动中…</div>;
              return (
                <div key={item.id} className="tc-activity">
                  {item.lines.map((line, index) => (
                    <div key={index} className={`tc-line${line.error ? ' err' : ''}`}>
                      <span className="t">⏺ {line.tool}</span>
                      <span>{line.detail}</span>
                    </div>
                  ))}
                </div>
              );
            }
            if (item.kind === 'approval') {
              return (
                <div key={item.id} className="tc-approve">
                  <div>这个任务需要修改 workspace 文件,批准后整个任务一次执行完(内部步骤不再逐个确认)。</div>
                  <div className="acts">{item.actions.join(' · ')}</div>
                  {item.resolved === 'approved'
                    ? <span className="tc-approved">✓ 已批准,执行中</span>
                    : <button className="tc-btn" onClick={() => approveTask(item.id, item.runId)}>批准并执行({item.count})</button>}
                </div>
              );
            }
            if (item.kind === 'worker') {
              return (
                <details key={item.id} className="tc-plan">
                  <summary>▸ {item.title}</summary>
                  <ul>{item.entries.map((entry, index) => <li key={index}>{entry}</li>)}</ul>
                </details>
              );
            }
            if (item.kind === 'diff') {
              return (
                <details key={item.id} className="tc-diff">
                  <summary>
                    ▸ 代码变更 {item.diffStat ? `(${item.diffStat.split('\n').pop()?.trim()})` : ''}
                    {item.verified === true ? <span className="tc-verified ok">verified ✓</span> : null}
                    {item.verified === false ? <span className="tc-verified warn">未跑验证</span> : null}
                  </summary>
                  <pre>{item.diff.split('\n').map((line, index) => (
                    <div key={index} className={line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'del' : ''}>{line}</div>
                  ))}</pre>
                </details>
              );
            }
            return null;
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="tc-inputbar">
        {attachments.length ? (
          <div className="tc-attachrow">
            {attachments.map((attachment, index) => (
              <span key={String(attachment.id || index)} className="tc-chip">
                📄 {String(attachment.name || 'file')}
                {attachment.error ? ' ⚠️' : ''}
                <button onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}>✕</button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="tc-inputbox">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(event) => void uploadFiles(event.target.files)}
          />
          <button
            className="tc-attach"
            title="上传文件"
            disabled={busy || uploading}
            onClick={() => fileInputRef.current?.click()}
          >{uploading ? '…' : '📎'}</button>
          <textarea
            rows={2}
            value={input}
            placeholder={busy ? '处理中…' : '输入消息,Enter 发送,Shift+Enter 换行'}
            disabled={busy}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <button className="tc-btn" disabled={busy || !input.trim()} onClick={() => void send()}>发送</button>
        </div>
      </div>
    </div>
  );
}
