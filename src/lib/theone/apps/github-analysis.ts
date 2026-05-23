import { createAppMemoryPack } from './app-memory';
import { getTheOneKernelStatus } from '../kernel/status';
import { getOneClawBridgeStatus, getOneClawCapabilityManifest, runOneClawAction } from '../providers/oneclaw';
import { extractOneAIData, runOneAI } from '../providers/oneai';
import { createRunId, createPlanId } from '../runtime';
import { createExecutionRecord, createWorkflowTrace } from '../runtime/workflow-runtime';
import type { ClassifiedIntent, ExecutionPlan, PlanStep, ProofRecord, TheOneMode, TheOneRunResult } from '../types';

export type GitHubAnalysisInput = {
  repo: string;
  branch?: string;
  focus: string;
  mode?: TheOneMode;
  language?: string;
};

type SafeActionResult = {
  ok: boolean;
  action: string;
  result: any;
  error: string | null;
};

function compact(value: string, max = 8000) {
  const text = value.trim().replace(/\s+/g, ' ');
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function normalizeRepo(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
}

function taskStatus(value: unknown) {
  const root = value as any;
  return String(root?.status || root?.task?.status || root?.steps?.[0]?.status || '').toLowerCase();
}

function taskId(value: unknown) {
  const root = value as any;
  return root?.id || root?.task?.id || root?.steps?.[0]?.taskId || null;
}

function firstStepOutput(value: unknown) {
  const root = value as any;
  return root?.steps?.[0]?.output || root?.task?.steps?.[0]?.output || root?.output || root?.raw || null;
}

function githubResponse(value: unknown) {
  const output = firstStepOutput(value) as any;
  return output?.response || output || null;
}

async function safeOneClawAction(input: {
  action: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<SafeActionResult> {
  try {
    const result = await runOneClawAction<any>({
      action: input.action,
      input: input.payload,
      approvalMode: 'auto',
      idempotencyKey: input.idempotencyKey,
    });
    const status = taskStatus(result);
    const failed = /failed|error|rejected/.test(status);
    return {
      ok: !failed,
      action: input.action,
      result,
      error: failed ? String(result?.steps?.[0]?.error || result?.error || `${input.action} failed`) : null,
    };
  } catch (error) {
    return {
      ok: false,
      action: input.action,
      result: null,
      error: error instanceof Error ? error.message : `${input.action} failed`,
    };
  }
}

function workflowRuns(value: unknown) {
  const response = githubResponse(value) as any;
  const runs = response?.workflow_runs;
  return Array.isArray(runs) ? runs : [];
}

function localSummary(input: {
  repo: string;
  branch: string;
  focus: string;
  repoData: any;
  runs: any[];
  checksError?: string | null;
}) {
  const repoData = input.repoData || {};
  const latestRuns = input.runs.slice(0, 5).map((run) => {
    const name = run.name || run.display_title || run.workflow_id || 'workflow';
    const status = [run.status, run.conclusion].filter(Boolean).join('/');
    return `- ${name}: ${status || 'unknown'}${run.html_url ? ` (${run.html_url})` : ''}`;
  });

  return [
    `Repository: ${repoData.full_name || input.repo}`,
    `Branch: ${input.branch}`,
    `Focus: ${input.focus}`,
    '',
    `Visibility: ${repoData.private ? 'private' : repoData.visibility || 'unknown'}`,
    `Default branch: ${repoData.default_branch || 'unknown'}`,
    `Last push: ${repoData.pushed_at || 'unknown'}`,
    `Open issues: ${repoData.open_issues_count ?? 'unknown'}`,
    '',
    latestRuns.length ? `Recent workflow runs:\n${latestRuns.join('\n')}` : 'Recent workflow runs: none returned.',
    input.checksError ? `\nChecks note: ${input.checksError}` : '',
    '',
    'Next action: review any failed or missing workflow runs before creating a follow-up issue.',
  ].filter(Boolean).join('\n');
}

function oneAiText(data: unknown) {
  const record = data && typeof data === 'object' ? data as any : {};
  return String(record.reply || record.summary || record.answer || record.text || '').trim();
}

async function summarizeWithOneAI(input: {
  repo: string;
  branch: string;
  focus: string;
  repoData: any;
  runs: any[];
  checksError?: string | null;
  language: string;
}) {
  const fallback = localSummary(input);

  try {
    const result = await runOneAI({
      type: 'agent_plan',
      input: {
        goal: [
          'Analyze this GitHub repository status for a normal product/operator user.',
          `Repository: ${input.repo}`,
          `Branch: ${input.branch}`,
          `Focus: ${input.focus}`,
          `Language: ${input.language}`,
          '',
          'Return a concise operational brief with:',
          '- repository health',
          '- CI/workflow status',
          '- risks or blocked signals',
          '- one practical next action',
          '',
          `Repository metadata:\n${compact(JSON.stringify(input.repoData || {}, null, 2), 5000)}`,
          '',
          `Recent workflow runs:\n${compact(JSON.stringify(input.runs.slice(0, 8), null, 2), 7000)}`,
          input.checksError ? `\nChecks error:\n${input.checksError}` : '',
        ].join('\n'),
        brand: 'TheOne GitHub Workflow App',
        chain: 'github_workflow',
        audience: 'normal users, founders, and operators',
        tone: 'clear, practical, concise',
      },
    });
    const data = extractOneAIData(result);
    return oneAiText(data) || fallback;
  } catch (error) {
    return `${fallback}\n\nOneAI summary note: ${error instanceof Error ? error.message : 'OneAI summary unavailable.'}`;
  }
}

export async function runGitHubAnalysisApp(input: GitHubAnalysisInput): Promise<TheOneRunResult & {
  appResult: {
    app: 'github';
    repo: string;
    branch: string;
    focus: string;
    status: string;
    summary: string;
    repoPrivate: boolean | null;
    defaultBranch: string | null;
    actionsRunCount: number;
    oneClawTaskIds: Record<string, string | null>;
    degraded: boolean;
  };
}> {
  const repo = normalizeRepo(input.repo);
  if (!repo || !repo.includes('/')) throw new Error('GitHub repository must look like owner/repo.');

  const branch = (input.branch || 'main').trim() || 'main';
  const focus = input.focus || 'CI health';
  const mode = input.mode || 'assist';
  const runId = createRunId();
  const startedAt = new Date().toISOString();
  const [oneClawManifest, oneClawBridge] = await Promise.all([
    getOneClawCapabilityManifest(),
    getOneClawBridgeStatus(),
  ]);
  const kernel = getTheOneKernelStatus(mode, oneClawManifest, oneClawBridge);

  const repoResult = await safeOneClawAction({
    action: 'git.repo.get',
    payload: { repo },
    idempotencyKey: `github-repo-${runId}`,
  });
  const runsResult = await safeOneClawAction({
    action: 'git.actions.runs',
    payload: { repo, branch },
    idempotencyKey: `github-runs-${runId}`,
  });
  const checksResult = await safeOneClawAction({
    action: 'git.checks.list',
    payload: { repo, ref: branch },
    idempotencyKey: `github-checks-${runId}`,
  });

  const repoData = githubResponse(repoResult.result) || {};
  const runs = workflowRuns(runsResult.result);
  const degraded = !repoResult.ok || !runsResult.ok || !checksResult.ok;
  const summary = await summarizeWithOneAI({
    repo,
    branch,
    focus,
    repoData,
    runs,
    checksError: checksResult.error,
    language: input.language || 'en',
  });

  const intent: ClassifiedIntent = {
    type: 'automation',
    objective: `Analyze GitHub repository ${repo}: ${focus}`,
    entities: [repo, branch],
    constraints: ['read-only GitHub inspection', 'record proof', 'do not create issues without approval'],
    priority: 'normal',
    confidence: 0.95,
    requiresApproval: false,
  };
  const repoStatus = repoResult.ok ? 'completed' : 'failed';
  const runsStatus = runsResult.ok ? 'completed' : 'blocked';
  const checksStatus = checksResult.ok ? 'completed' : 'skipped';
  const steps: PlanStep[] = [
    {
      id: 'github_brief',
      title: 'Receive repository brief',
      action: 'custom',
      status: 'completed',
      output: { repo, branch, focus },
      capability: 'plan',
    },
    {
      id: 'github_repo',
      title: 'Read repository metadata',
      action: 'oneclaw.execute',
      status: repoStatus,
      input: { action: 'git.repo.get', repo },
      output: { taskId: taskId(repoResult.result), status: taskStatus(repoResult.result), error: repoResult.error },
      dependsOn: ['github_brief'],
      capability: 'research',
    },
    {
      id: 'github_runs',
      title: 'Read workflow runs',
      action: 'oneclaw.execute',
      status: runsStatus,
      input: { action: 'git.actions.runs', repo, branch },
      output: { taskId: taskId(runsResult.result), count: runs.length, status: taskStatus(runsResult.result), error: runsResult.error },
      dependsOn: ['github_repo'],
      capability: 'monitor',
    },
    {
      id: 'github_checks',
      title: 'Read check runs when token allows it',
      action: 'oneclaw.execute',
      status: checksStatus,
      input: { action: 'git.checks.list', repo, ref: branch },
      output: { taskId: taskId(checksResult.result), status: taskStatus(checksResult.result), error: checksResult.error },
      dependsOn: ['github_repo'],
      capability: 'monitor',
    },
    {
      id: 'github_summarize',
      title: 'Summarize repository health',
      action: 'oneai.generate',
      status: summary ? 'completed' : 'pending',
      output: { summary },
      dependsOn: ['github_repo', 'github_runs'],
      capability: 'think',
    },
    {
      id: 'github_proof',
      title: 'Record GitHub proof',
      action: 'proof.write',
      status: summary ? 'completed' : 'pending',
      dependsOn: ['github_summarize'],
      capability: 'record',
    },
  ];
  const plan: ExecutionPlan = {
    id: createPlanId(),
    intent,
    summary: `Inspect ${repo} and produce a ${focus} brief.`,
    steps,
    estimatedRisk: 'medium',
    capabilityRoute: {
      intentType: 'automation',
      objective: intent.objective,
      capabilities: ['research', 'monitor', 'think', 'govern', 'record', 'coordinate'],
      skills: [],
      apps: [],
      connectors: [],
      risk: 'medium',
      summary: 'GitHub App routed repository inspection through OneClaw GitHub reads and OneAI summarization.',
    },
  };
  const executions = [
    createExecutionRecord({
      provider: 'oneclaw',
      status: repoResult.ok ? 'success' : 'failed',
      summary: `Read GitHub repository metadata for ${repo}`,
      externalId: taskId(repoResult.result),
      taskName: 'action:git.repo.get',
      raw: repoResult.result || { error: repoResult.error },
    }),
    createExecutionRecord({
      provider: 'oneclaw',
      status: runsResult.ok ? 'success' : 'blocked',
      summary: `Read GitHub Actions runs for ${repo}`,
      externalId: taskId(runsResult.result),
      taskName: 'action:git.actions.runs',
      raw: runsResult.result || { error: runsResult.error },
    }),
    createExecutionRecord({
      provider: 'oneclaw',
      status: checksResult.ok ? 'success' : 'blocked',
      summary: checksResult.ok ? `Read GitHub checks for ${repo}` : 'GitHub checks unavailable with current token scope.',
      externalId: taskId(checksResult.result),
      taskName: 'action:git.checks.list',
      raw: checksResult.result || { error: checksResult.error },
    }),
    createExecutionRecord({
      provider: 'oneai',
      status: summary ? 'success' : 'mock',
      summary: 'GitHub workflow brief summarized.',
      raw: { summary },
    }),
  ];
  const proof: ProofRecord[] = [
    {
      type: 'execution',
      title: 'GitHub workflow inspected',
      value: summary.slice(0, 900),
      timestamp: startedAt,
      metadata: {
        app: 'github',
        repo,
        branch,
        focus,
        degraded,
        repoTaskId: taskId(repoResult.result),
        runsTaskId: taskId(runsResult.result),
        checksTaskId: taskId(checksResult.result),
        actionsRunCount: runs.length,
      },
    },
  ];
  const workflow = createWorkflowTrace({ runId, mode, plan, approvals: [] });
  const appMemoryPack = createAppMemoryPack({
    app: 'github',
    title: `GitHub workflow: ${repo}`,
    summary: summary.slice(0, 600),
    facts: [`Repo: ${repo}`, `Branch: ${branch}`, `${runs.length} workflow runs returned`, checksResult.error ? 'Checks require additional token scope or were unavailable' : 'Checks query completed'],
    nextActions: ['Review failed workflow runs', 'Prepare an approved issue for follow-up', 'Re-check before release'],
    sourceRunId: runId,
  });

  return {
    ok: repoResult.ok || runsResult.ok || Boolean(summary),
    runId,
    summary,
    intent,
    plan,
    execution: {
      completedSteps: steps.filter((step) => step.status === 'completed').length,
      failedSteps: steps.filter((step) => step.status === 'failed').length,
      agentResults: [],
    },
    proof,
    approvals: [],
    executions,
    pendingOneClawTask: null,
    networkSignals: {
      appRoute: 'github',
      oneClawActions: ['git.repo.get', 'git.actions.runs', 'git.checks.list'],
      repo,
      branch,
    },
    os: {
      ...kernel,
      workflow,
      approvals: [],
      executions,
    },
    appMemoryPack,
    appResult: {
      app: 'github',
      repo,
      branch,
      focus,
      status: degraded ? 'degraded' : 'completed',
      summary,
      repoPrivate: typeof repoData.private === 'boolean' ? repoData.private : null,
      defaultBranch: repoData.default_branch ? String(repoData.default_branch) : null,
      actionsRunCount: runs.length,
      oneClawTaskIds: {
        repo: taskId(repoResult.result),
        runs: taskId(runsResult.result),
        checks: taskId(checksResult.result),
      },
      degraded,
    },
  };
}
