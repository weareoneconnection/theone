import { executeAutomationJob, listAutomationJobs, listAutomationRuns, upsertAutomationJob, type AutomationJob } from '../automation/scheduler';
import { packageRegistrySummary } from '../packages/package-registry';
import { listMemory, listProof } from '../state/run-store';

export type AutonomousWorkspaceTemplate = {
  key: string;
  title: string;
  app: string;
  purpose: string;
  command: string;
  cadenceMinutes: number;
  maxRunsPerDay: number;
  risk: 'low' | 'medium' | 'high';
  mode: 'manual' | 'assist' | 'auto';
  controls: string[];
};

export type AutonomousWorkspace = AutonomousWorkspaceTemplate & {
  jobId: string | null;
  status: 'active' | 'paused' | 'available';
  failureStreak: number;
  circuitOpen: boolean;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
};

export const workspaceTemplates: AutonomousWorkspaceTemplate[] = [
  {
    key: 'web_watch',
    title: 'Website Watch',
    app: 'web',
    purpose: 'Regularly analyze a website and remember useful changes.',
    command: 'Analyze website weareoneconnection.org, summarize useful changes, record proof, and store reusable web memory.',
    cadenceMinutes: 720,
    maxRunsPerDay: 2,
    risk: 'medium',
    mode: 'assist',
    controls: ['public website only', 'proof required', 'memory pack required'],
  },
  {
    key: 'x_growth_guarded',
    title: 'Guarded X Growth',
    app: 'x',
    purpose: 'Prepare X content and reply candidates without automatic publishing.',
    command: 'Prepare X growth content for AI agents workflow. Search context, draft safe content, never publish automatically, and keep public posting approval-gated.',
    cadenceMinutes: 240,
    maxRunsPerDay: 3,
    risk: 'high',
    mode: 'assist',
    controls: ['no auto publish', 'reply_only only', '2-failure circuit breaker'],
  },
  {
    key: 'github_ci_watch',
    title: 'GitHub CI Watch',
    app: 'github',
    purpose: 'Inspect repository workflow health and prepare follow-up when needed.',
    command: 'Check GitHub repo weareoneconnection/theone main branch, summarize CI health, record proof, and prepare a follow-up issue only if approval is needed.',
    cadenceMinutes: 180,
    maxRunsPerDay: 6,
    risk: 'medium',
    mode: 'assist',
    controls: ['read-only by default', 'issue creation approval-gated', 'proof required'],
  },
  {
    key: 'report_digest',
    title: 'Daily Report Digest',
    app: 'report',
    purpose: 'Turn recent proof and memory into a concise operator report.',
    command: 'Create a report from recent TheOne proof and app memory. Summarize progress, risks, and next actions.',
    cadenceMinutes: 1440,
    maxRunsPerDay: 1,
    risk: 'low',
    mode: 'assist',
    controls: ['uses stored proof', 'memory pack required', 'no external write'],
  },
  {
    key: 'desktop_bridge_check',
    title: 'Local Desktop Bridge Check',
    app: 'desktop',
    purpose: 'Check whether the local desktop bridge is ready before computer-control tasks.',
    command: 'Use the local desktop bridge to inspect Chrome app state only. Do not click, type, or capture screenshots unless separately approved.',
    cadenceMinutes: 360,
    maxRunsPerDay: 4,
    risk: 'high',
    mode: 'assist',
    controls: ['manual approval for control', 'local bridge required', 'allowed apps only'],
  },
];

function jobForTemplate(jobs: AutomationJob[], template: AutonomousWorkspaceTemplate) {
  return jobs.find((job) => job.id === `workspace_${template.key}`);
}

function toWorkspace(template: AutonomousWorkspaceTemplate, job?: AutomationJob): AutonomousWorkspace {
  return {
    ...template,
    jobId: job?.id || null,
    status: job ? job.status : 'available',
    failureStreak: job?.failureStreak || 0,
    circuitOpen: Boolean(job?.circuitOpen),
    lastRunAt: job?.lastRunAt,
    nextRunAt: job?.nextRunAt,
  };
}

export async function listAutonomousWorkspaces() {
  const jobs = await listAutomationJobs();
  const workspaces = workspaceTemplates.map((template) => toWorkspace(template, jobForTemplate(jobs, template)));
  const jobIds = workspaces.map((workspace) => workspace.jobId).filter(Boolean) as string[];
  const runs = jobIds.length ? await listAutomationRuns({ jobIds, limit: 40 }) : [];
  return {
    ok: true,
    level: 'L26',
    workspaces,
    runs,
    active: workspaces.filter((item) => item.status === 'active').length,
    available: workspaces.length,
    circuitOpen: workspaces.filter((item) => item.circuitOpen).length,
  };
}

export async function getAutonomousWorkspaceDetail(input: { key: string }) {
  const template = workspaceTemplates.find((item) => item.key === input.key);
  if (!template) throw new Error('Unknown workspace template.');

  const jobs = await listAutomationJobs();
  const job = jobForTemplate(jobs, template);
  const runs = job ? await listAutomationRuns({ jobIds: [job.id], limit: 30 }) : [];
  const runIds = new Set(runs.map((run) => run.runId).filter(Boolean));
  const [proof, memory, packages] = await Promise.all([
    listProof(120),
    listMemory(120),
    packageRegistrySummary(),
  ]);
  const relatedProof = proof.filter((item: any) => item.runId && runIds.has(item.runId)).slice(0, 20);
  const relatedMemory = memory.filter((item: any) => {
    if (item.runId && runIds.has(item.runId)) return true;
    const content = (item.content || {}) as any;
    const mission = content.mission || {};
    return String(item.kind || '').includes(`app.${template.app}`)
      || String(item.kind || '').includes(template.app)
      || String(item.kind || '').includes(template.key)
      || mission.primaryApp?.key === template.app
      || String(mission.workspace?.key || '').includes(template.app)
      || String(mission.workspace?.key || '').includes(template.key)
      || String(content.summary || item.summary || item.title || '').toLowerCase().includes(template.app);
  }).slice(0, 20);
  const appPackages = packages.packages.filter((item: any) => (
    item.name === template.app
    || item.id.includes(`.${template.app}`)
    || (item.dependencies || []).some((dependency: string) => dependency.includes(template.app))
  ));
  const failures = runs.filter((run) => run.status === 'failed');
  const latestMemory = relatedMemory[0] as any;

  return {
    ok: true,
    level: 'L26',
    workspace: toWorkspace(template, job),
    job,
    runs,
    proof: relatedProof,
    memory: relatedMemory,
    memoryGraph: {
      schemaVersion: 'theone.workspace_memory_graph.v1',
      totalMemory: memory.length,
      linkedMemory: relatedMemory.length,
      linkedProof: relatedProof.length,
      linkedRuns: runs.length,
      queryTerms: [template.key, template.app, template.title],
      latestMemory: latestMemory ? {
        id: latestMemory.id,
        kind: latestMemory.kind,
        title: latestMemory.title || latestMemory.summary || latestMemory.content?.mission?.title || 'Memory',
        summary: latestMemory.summary || latestMemory.content?.summary || latestMemory.content?.mission?.objective || '',
        createdAt: latestMemory.createdAt,
      } : null,
      recallPolicy: 'Use linked workspace memory as context for future runs, but keep external actions governed by policy.',
    },
    packages: appPackages,
    policy: {
      mode: template.mode,
      risk: template.risk,
      cadenceMinutes: template.cadenceMinutes,
      maxRunsPerDay: template.maxRunsPerDay,
      controls: template.controls,
      circuitBreaker: 'open after 2 consecutive failures',
    },
    diagnostics: {
      status: job?.circuitOpen ? 'blocked' : failures.length ? 'watch' : 'ready',
      failureCount: failures.length,
      latestFailure: failures[0]?.summary || null,
      nextAction: job?.circuitOpen
        ? 'Review failures and pause or reset the workspace before running again.'
        : job
          ? 'Workspace is installed. Use Run now or keep the schedule active.'
          : 'Activate this workspace to create its durable automation job.',
    },
  };
}

export async function activateAutonomousWorkspace(input: { key: string; status?: 'active' | 'paused' }) {
  const template = workspaceTemplates.find((item) => item.key === input.key);
  if (!template) throw new Error('Unknown workspace template.');

  const job = await upsertAutomationJob({
    id: `workspace_${template.key}`,
    name: template.title,
    triggerType: 'interval',
    trigger: {
      source: `workspace.${template.app}`,
      workspaceKey: template.key,
      intervalMinutes: template.cadenceMinutes,
      controls: template.controls,
    },
    command: template.command,
    mode: template.mode,
    status: input.status || 'active',
    maxRunsPerDay: template.maxRunsPerDay,
    cooldownMinutes: template.cadenceMinutes,
    failureStreak: 0,
    circuitOpen: false,
  });

  return {
    ok: true,
    workspace: toWorkspace(template, job),
  };
}

export async function runAutonomousWorkspaceNow(input: { key: string }) {
  const template = workspaceTemplates.find((item) => item.key === input.key);
  if (!template) throw new Error('Unknown workspace template.');

  const jobs = await listAutomationJobs();
  const existing = jobForTemplate(jobs, template);
  const job = existing || await upsertAutomationJob({
    id: `workspace_${template.key}`,
    name: template.title,
    triggerType: 'manual',
    trigger: {
      source: `workspace.${template.app}`,
      workspaceKey: template.key,
      manualRun: true,
      controls: template.controls,
    },
    command: template.command,
    mode: template.mode,
    status: 'paused',
    maxRunsPerDay: template.maxRunsPerDay,
    cooldownMinutes: template.cadenceMinutes,
    failureStreak: 0,
    circuitOpen: false,
  });

  const result = await executeAutomationJob(job);
  return {
    ok: result.status !== 'failed',
    workspace: toWorkspace(template, job),
    result,
  };
}
