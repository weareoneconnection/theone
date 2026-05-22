'use client';

const policyRows = [
  {
    domain: 'Read',
    actions: ['git.repo.get', 'git.repo.search', 'git.actions.runs', 'x.searchRecentTweets', 'knowledge.query'],
    auto: 'auto',
    risk: 'low',
    rule: 'Read-only connector calls can run automatically when credentials and preflight pass.',
  },
  {
    domain: 'Reply',
    actions: ['social.post'],
    auto: 'assist / auto',
    risk: 'medium',
    rule: 'X replies can auto-run only when channel=x, mode=reply_only, strictReply=true, and a numeric reply target exists.',
  },
  {
    domain: 'Publish',
    actions: ['social.post', 'git.issue.create', 'calendar.event.create', 'email.send'],
    auto: 'manual',
    risk: 'high',
    rule: 'External writes that create public or user-visible state require approval unless a narrower policy is added.',
  },
  {
    domain: 'Critical',
    actions: ['payment.*', 'shell.*', 'database.write', 'web3.write'],
    auto: 'blocked',
    risk: 'high',
    rule: 'Money, shell, persistent data writes, and signing stay blocked without explicit high-risk policy.',
  },
];

function getPendingTask(result: any) {
  return result?.pendingOneClawTask
    || result?.oneclawTask
    || result?.execution?.agentResults?.find((item: any) => item?.oneclawTask)?.oneclawTask
    || null;
}

function getLiveTask(result: any, oneClawTasks: any[]) {
  const candidates = [
    ...(oneClawTasks || []),
    result?.oneClawTaskResult?.task,
    result?.oneClawActionResult?.result?.task,
    result?.oneClawActionResult?.result,
    result?.oneClawApprovalResult?.result?.task,
  ].filter(Boolean);

  return candidates
    .slice()
    .reverse()
    .find((task: any) => task?.id || task?.taskName || Array.isArray(task?.steps)) || null;
}

function liveTaskSteps(task: any) {
  return Array.isArray(task?.steps) ? task.steps : [];
}

function stepAction(step: any) {
  return String(step?.action || step?.name || '').trim();
}

function stepInput(step: any) {
  const outputInput = step?.output?.input;
  if (outputInput && typeof outputInput === 'object' && !Array.isArray(outputInput)) return outputInput;
  if (step?.input && typeof step.input === 'object' && !Array.isArray(step.input)) return step.input;
  return {};
}

function isStrictXReplyTask(task: any) {
  return liveTaskSteps(task).some((step: any) => {
    const input = stepInput(step);
    return stepAction(step) === 'social.post'
      && input.channel === 'x'
      && input.mode === 'reply_only'
      && input.strictReply === true
      && typeof input.replyToTweetId === 'string'
      && /^[0-9]{1,19}$/.test(input.replyToTweetId);
  });
}

function inferLiveRisk(task: any) {
  const actions = liveTaskSteps(task).map(stepAction).filter(Boolean);
  if (isStrictXReplyTask(task)) {
    return {
      level: 'medium',
      reasons: ['strict X reply with reply_only and strictReply safeguards'],
    };
  }
  if (actions.some((action: string) => action === 'social.post' || action.endsWith('.send') || action.endsWith('.create') || action.includes('payment.') || action.includes('shell.') || action.includes('database.write'))) {
    return {
      level: 'high',
      reasons: [`${actions[0] || 'external action'} changes an external system`],
    };
  }
  if (actions.some((action: string) => action.endsWith('.get') || action.endsWith('.list') || action.endsWith('.search') || action.includes('.query'))) {
    return {
      level: 'low',
      reasons: [`${actions[0] || 'read action'} is read-only`],
    };
  }
  return {
    level: 'medium',
    reasons: ['live OneClaw task requires policy evaluation'],
  };
}

function currentDecision(result: any, oneClawTasks: any[]) {
  const osTask = getPendingTask(result);
  const liveTask = osTask ? null : getLiveTask(result, oneClawTasks);
  const task = osTask || liveTask;
  const source = osTask ? 'theone' : liveTask ? 'oneclaw_live' : 'none';
  const envelope = task?.metadata?.theoneTask;
  const policy = envelope?.automationPolicy;
  const risk = envelope?.risk || (liveTask ? inferLiveRisk(liveTask) : null);
  const preflight = result?.preflight || result?.os?.preflight || (liveTask ? { status: 'live_queue' } : null);
  const approvals = result?.approvals || result?.os?.approvals || [];
  const pendingApprovals = approvals.filter((item: any) => item.required && item.status === 'pending');
  const lastOneClawExecution = (result?.executions || result?.os?.executions || [])
    .slice()
    .reverse()
    .find((item: any) => item.provider === 'oneclaw');
  const liveStatus = String(liveTask?.status || '').toLowerCase();
  const liveAwaitingApproval = source === 'oneclaw_live' && (
    liveStatus === 'awaiting_approval' ||
    liveStatus === 'needs_approval' ||
    liveTaskSteps(liveTask).some((step: any) => String(step?.status || '').toLowerCase() === 'awaiting_approval')
  );

  if (!task) {
    return {
      title: 'No OneClaw task pending',
      detail: 'Run TheOne to see the automation policy decision for the next execution task.',
      status: 'idle',
      source,
      task,
      policy,
      risk,
      preflight,
      pendingApprovals,
      lastOneClawExecution,
    };
  }

  if (liveAwaitingApproval) {
    return {
      title: 'Waiting for live approval',
      detail: isStrictXReplyTask(liveTask)
        ? 'OneClaw has a strict X reply waiting in the live approval queue.'
        : 'OneClaw has a live external action waiting for approval.',
      status: 'manual',
      source,
      task,
      policy: policy || { approvalMode: 'manual', canAutoRun: false, requiresHumanApproval: true },
      risk,
      preflight,
      pendingApprovals,
      livePendingCount: 1,
      lastOneClawExecution,
    };
  }

  if (lastOneClawExecution?.status === 'submitted' || lastOneClawExecution?.status === 'mock') {
    return {
      title: 'Auto-submitted',
      detail: 'TheOne policy allowed this task to move from OneAI planning into OneClaw execution.',
      status: 'auto',
      source,
      task,
      policy,
      risk,
      preflight,
      pendingApprovals,
      lastOneClawExecution,
    };
  }

  if (preflight?.status === 'blocked') {
    return {
      title: 'Blocked by preflight',
      detail: 'The task did not pass production readiness checks.',
      status: 'blocked',
      source,
      task,
      policy,
      risk,
      preflight,
      pendingApprovals,
      lastOneClawExecution,
    };
  }

  if (pendingApprovals.length > 0 || policy?.requiresHumanApproval) {
    return {
      title: 'Waiting for approval',
      detail: 'TheOne kept this task in the approval lane before OneClaw execution.',
      status: 'manual',
      source,
      task,
      policy,
      risk,
      preflight,
      pendingApprovals,
      lastOneClawExecution,
    };
  }

  return {
    title: policy?.canAutoRun ? 'Eligible for auto-run' : 'Governed',
    detail: policy?.canAutoRun ? 'This task can execute automatically after preflight.' : 'The task is governed by TheOne policy.',
    status: policy?.canAutoRun ? 'auto' : 'manual',
    source,
    task,
    policy,
    risk,
    preflight,
    pendingApprovals,
    lastOneClawExecution,
  };
}

export function AutomationPolicyPanel({ result, oneClawTasks = [] }: { result: any; oneClawTasks?: any[] }) {
  const mode = result?.os?.mode || 'assist';
  const decision = currentDecision(result, oneClawTasks);
  const taskActions = liveTaskSteps(decision.task).map(stepAction).filter(Boolean);
  const pendingValue = String((decision as any).livePendingCount ?? decision.pendingApprovals.length);

  return (
    <section className="panel-card automation-panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Automation Policy</h2>
          <p className="panel-subtitle">TheOne decides what can run automatically, what needs approval, and what stays blocked.</p>
        </div>
        <span className={`status-pill status-${decision.status}`}>{mode}</span>
      </div>

      <div className={`automation-decision decision-${decision.status}`}>
        <div>
          <div className="automation-title">{decision.title}</div>
          <div className="automation-detail">{decision.detail}</div>
        </div>
        <div className="automation-score">
          <span>{decision.risk?.level || 'none'}</span>
          <small>risk</small>
        </div>
      </div>

      <div className="policy-kpis">
        <PolicyKpi label="Mode" value={mode} />
        <PolicyKpi label="Approval" value={decision.policy?.approvalMode || '-'} />
        <PolicyKpi label="Preflight" value={decision.preflight?.status || '-'} />
        <PolicyKpi label="Pending" value={pendingValue} />
      </div>

      {decision.task ? (
        <div className="current-policy-card">
          <div className="mini-heading">{decision.source === 'oneclaw_live' ? 'Live OneClaw Task' : 'Current Task'}</div>
          <div className="feed-title">{decision.task.taskName || decision.task.id || 'oneclaw task'}</div>
          {decision.task.id ? <div className="proof-meta">{decision.task.id} · {decision.task.status || 'tracked'}</div> : null}
          <div className="policy-chip-row">
            {taskActions.map((action: string) => (
              <span key={action} className="capability-chip">{action}</span>
            ))}
          </div>
          {Array.isArray(decision.risk?.reasons) && decision.risk.reasons.length ? (
            <div className="policy-reasons">
              {decision.risk.reasons.slice(0, 3).map((reason: string) => (
                <div key={reason}>{reason}</div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="policy-matrix">
        {policyRows.map((row) => (
          <div key={row.domain} className="policy-row">
            <div className="policy-row-head">
              <div>
                <div className="feed-title">{row.domain}</div>
                <div className="proof-meta">{row.rule}</div>
              </div>
              <span className={`risk-chip risk-${row.risk}`}>{row.auto}</span>
            </div>
            <div className="policy-chip-row">
              {row.actions.map((action) => (
                <span key={action} className="capability-chip">{action}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function PolicyKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="policy-kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
    </div>
  );
}
