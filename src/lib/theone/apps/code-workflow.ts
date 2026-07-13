import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createAppMemoryPack } from './app-memory';
import { getTheOneKernelStatus } from '../kernel/status';
import { getOneClawBridgeStatus, getOneClawCapabilityManifest } from '../providers/oneclaw';
import { extractOneAIData, runOneAI } from '../providers/oneai';
import { createRunId, createPlanId } from '../runtime';
import { createExecutionRecord, createWorkflowTrace } from '../runtime/workflow-runtime';
import type {
  ClassifiedIntent,
  ExecutionPlan,
  ApprovalGate,
  PlanStep,
  ProofRecord,
  TheOneMode,
  TheOneRunResult,
} from '../types';

export type CodeWorkflowInput = {
  workspacePath?: string;
  objective: string;
  focus?: string;
  mode?: TheOneMode;
  language?: string;
};

type CodeFileProfile = {
  path: string;
  kind: string;
  bytes: number;
  lines: number;
  score: number;
  snippet?: string;
};

type RepoProfile = {
  root: string;
  projectName: string;
  framework: string;
  techStack: string[];
  scripts: Record<string, string>;
  scannedFiles: number;
  readableFiles: number;
  importantFiles: string[];
  relevantFiles: CodeFileProfile[];
};

type PatchDraft = {
  file: string;
  intent: string;
  patchType: 'proposed_patch' | 'read_only_recommendation';
  suggestedChanges: string[];
  risk: 'low' | 'medium' | 'high';
  validation: string[];
};

type CodeImplementationPackage = {
  status: 'approval_required';
  approvalBoundary: 'file_write';
  filesToChange: string[];
  changeIntents: string[];
  applyInstructions: string[];
  reviewChecklist: string[];
  rollbackPlan: string[];
};

type CodeValidationCommand = {
  command: string;
  reason: string;
  approvalMode: 'manual';
  risk: 'medium' | 'high';
};

type CodeValidationPlan = {
  status: 'approval_required';
  approvalBoundary: 'shell_validation';
  commands: CodeValidationCommand[];
  expectedEvidence: string[];
  fallback: string[];
};

type CodeDeliveryPackage = {
  status: 'approval_required';
  approvalBoundary: 'git_delivery';
  branchName: string;
  commitMessage: string;
  prTitle: string;
  prBodyOutline: string[];
  releaseNotes: string[];
  proofRequired: string[];
};

const MAX_FILES = 360;
const MAX_RELEVANT = 12;
const MAX_FILE_BYTES = 50000;
const ignoredDirectories = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vercel',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'artifacts',
  '.cache',
]);
const readableExtensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.css',
  '.scss',
  '.md',
  '.mdx',
  '.yml',
  '.yaml',
  '.toml',
  '.prisma',
  '.sql',
  '.html',
]);
const importantNames = new Set([
  'package.json',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'tsconfig.json',
  'README.md',
  'tailwind.config.ts',
  'postcss.config.mjs',
]);

function compact(value: string, max = 9000) {
  const text = value.trim();
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function expandHome(value: string) {
  if (!value.startsWith('~')) return value;
  return path.join(process.env.HOME || '', value.slice(1));
}

function configuredRoots() {
  return [
    process.cwd(),
    ...(process.env.THEONE_CODE_WORKSPACE_ROOTS || '').split(','),
  ]
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(expandHome(item)));
}

function resolveWorkspace(value?: string) {
  const requested = path.resolve(expandHome(value?.trim() || process.cwd()));
  const roots = configuredRoots();
  const allowed = roots.some((root) => requested === root || requested.startsWith(`${root}${path.sep}`));
  if (!allowed) {
    throw new Error(`Workspace is outside the configured code roots. Allowed root: ${roots[0] || process.cwd()}`);
  }
  return requested;
}

async function pathExists(value: string) {
  try {
    await fs.access(value);
    return true;
  } catch {
    return false;
  }
}

function fileKind(filePath: string) {
  const base = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (base === 'package.json') return 'package_manifest';
  if (base.includes('config')) return 'config';
  if (filePath.includes(`${path.sep}api${path.sep}`) || filePath.endsWith('route.ts')) return 'api_route';
  if (filePath.includes(`${path.sep}app${path.sep}`) || filePath.endsWith('.tsx')) return 'ui_or_page';
  if (ext === '.css' || ext === '.scss') return 'style';
  if (ext === '.md' || ext === '.mdx') return 'docs';
  return 'source';
}

async function walkWorkspace(root: string) {
  const files: string[] = [];

  async function walk(current: string) {
    if (files.length >= MAX_FILES) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= MAX_FILES) break;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (readableExtensions.has(ext) || importantNames.has(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  await walk(root);
  return files;
}

function scoreFile(relativePath: string, text: string, objective: string) {
  const haystack = `${relativePath}\n${text}`.toLowerCase();
  const terms = Array.from(new Set(
    objective
      .toLowerCase()
      .match(/[\p{L}\p{N}_-]+/gu)
      ?.filter((term) => term.length > 2)
      .slice(0, 28) || []
  ));
  const direct = terms.reduce((score, term) => score + (haystack.includes(term) ? 4 : 0), 0);
  const pathBoost = /src\/app|src\/lib|api|route|page|component|chat|run|upload|worker|package\.json/.test(relativePath) ? 8 : 0;
  const importantBoost = importantNames.has(path.basename(relativePath)) ? 10 : 0;
  return direct + pathBoost + importantBoost;
}

async function readProfiles(root: string, files: string[], objective: string) {
  const profiles: CodeFileProfile[] = [];
  const importantFiles: string[] = [];
  let readableFiles = 0;

  for (const file of files) {
    const stat = await fs.stat(file);
    const relativePath = path.relative(root, file);
    if (importantNames.has(path.basename(file))) importantFiles.push(relativePath);
    if (stat.size > MAX_FILE_BYTES) {
      profiles.push({
        path: relativePath,
        kind: fileKind(relativePath),
        bytes: stat.size,
        lines: 0,
        score: scoreFile(relativePath, '', objective),
      });
      continue;
    }

    const text = await fs.readFile(file, 'utf8').catch(() => '');
    if (!text) continue;
    readableFiles += 1;
    profiles.push({
      path: relativePath,
      kind: fileKind(relativePath),
      bytes: stat.size,
      lines: text.split('\n').length,
      score: scoreFile(relativePath, text, objective),
      snippet: compact(text.replace(/\s+/g, ' '), 900),
    });
  }

  return {
    importantFiles,
    readableFiles,
    relevantFiles: profiles
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RELEVANT),
  };
}

async function buildRepoProfile(root: string, objective: string): Promise<RepoProfile> {
  const files = await walkWorkspace(root);
  const packagePath = path.join(root, 'package.json');
  const packageJson = await pathExists(packagePath)
    ? safeJsonParse<Record<string, any>>(await fs.readFile(packagePath, 'utf8'), {})
    : {};
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  const techStack = Object.keys(dependencies || {})
    .filter((name) => /next|react|typescript|tailwind|prisma|playwright|vitest|jest|xlsx|pdf|openai/i.test(name))
    .slice(0, 18);
  const framework = dependencies?.next ? 'Next.js' : dependencies?.react ? 'React' : packageJson.name ? 'Node.js' : 'Unknown';
  const fileProfiles = await readProfiles(root, files, objective);

  return {
    root,
    projectName: String(packageJson.name || path.basename(root)),
    framework,
    techStack,
    scripts: packageJson.scripts || {},
    scannedFiles: files.length,
    readableFiles: fileProfiles.readableFiles,
    importantFiles: fileProfiles.importantFiles,
    relevantFiles: fileProfiles.relevantFiles,
  };
}

function buildLocalPlan(input: CodeWorkflowInput, repo: RepoProfile) {
  const objective = input.objective.trim();
  const focus = input.focus || 'Prepare patch';
  return [
    `Read the ${repo.projectName} workspace and identify the files most relevant to: ${objective}`,
    `Explain the current architecture and risk surface before making changes.`,
    `Prepare a scoped implementation plan for ${focus}, with no file writes in this stage.`,
    'Draft patch-level instructions for the likely files, then ask for approval before applying code.',
    'Validate with the repository scripts after implementation is approved.',
  ];
}

function inferPatchDrafts(input: CodeWorkflowInput, repo: RepoProfile): PatchDraft[] {
  const objective = input.objective.toLowerCase();
  const selected = repo.relevantFiles.slice(0, 5);
  const drafts = selected.map((file): PatchDraft => {
    const isUi = file.kind === 'ui_or_page' || /page|component|css/.test(file.path);
    const isApi = file.kind === 'api_route';
    const validation = ['Run the project build after applying the patch.'];
    if (Object.keys(repo.scripts).includes('lint')) validation.push('Run lint to catch type and style regressions.');
    if (Object.keys(repo.scripts).includes('test')) validation.push('Run the test suite or the focused test for this area.');

    return {
      file: file.path,
      intent: isApi
        ? 'Adjust server route behavior and keep the response contract stable.'
        : isUi
          ? 'Improve the user-facing flow while preserving existing routes and API contracts.'
          : 'Update supporting logic with a narrow, reviewable change.',
      patchType: 'proposed_patch',
      suggestedChanges: [
        objective.includes('mobile') || objective.includes('手机') ? 'Tighten responsive layout and reduce mobile overflow.' : 'Keep the edit scoped to the requested behavior.',
        isApi ? 'Add defensive validation and clearer structured errors.' : 'Preserve existing props, state shape, and public links.',
        'Record the reason for the change in the run proof so it can be reviewed later.',
      ],
      risk: isApi ? 'medium' : 'low',
      validation,
    };
  });

  if (drafts.length > 0) return drafts;
  return [{
    file: 'workspace',
    intent: 'No high-confidence file target was found during the bounded scan.',
    patchType: 'read_only_recommendation',
    suggestedChanges: ['Open the relevant feature area first, then rerun the code workflow with a narrower objective.'],
    risk: 'low',
    validation: ['No code should be changed until a target file is identified.'],
  }];
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'code-change';
}

function buildImplementationPackage(patches: PatchDraft[]): CodeImplementationPackage {
  const filesToChange = patches
    .filter((patch) => patch.patchType === 'proposed_patch')
    .map((patch) => patch.file);

  return {
    status: 'approval_required',
    approvalBoundary: 'file_write',
    filesToChange,
    changeIntents: patches.map((patch) => `${patch.file}: ${patch.intent}`),
    applyInstructions: [
      'Convert the patch draft into an exact diff before writing files.',
      'Apply the smallest coherent change first, then re-read the touched files.',
      'Preserve existing API routes, public links, environment contracts, and data shapes unless the user explicitly approves a contract change.',
      'Do not commit, push, deploy, or open a PR until validation has completed.',
    ],
    reviewChecklist: [
      'The change matches the user objective.',
      'Touched files are limited to the planned targets or clearly justified additions.',
      'No unrelated refactor, formatting churn, or generated artifact noise is included.',
      'Rollback instructions are available before writes happen.',
    ],
    rollbackPlan: [
      'Capture the pre-change file list and the exact files touched by the patch.',
      'If validation fails, revert only the files changed by this approved implementation package.',
      'Keep the run proof with the failed command, error summary, and recovery recommendation.',
    ],
  };
}

function buildValidationPlan(repo: RepoProfile): CodeValidationPlan {
  const scripts = repo.scripts || {};
  const commands: CodeValidationCommand[] = [];
  if (scripts.lint) {
    commands.push({
      command: 'npm run lint',
      reason: 'Catch syntax, style, and framework-specific regressions.',
      approvalMode: 'manual',
      risk: 'medium',
    });
  }
  if (scripts.typecheck) {
    commands.push({
      command: 'npm run typecheck',
      reason: 'Verify TypeScript contracts after the patch.',
      approvalMode: 'manual',
      risk: 'medium',
    });
  }
  if (scripts.test) {
    commands.push({
      command: 'npm test',
      reason: 'Run the repository test suite or focused tests.',
      approvalMode: 'manual',
      risk: 'medium',
    });
  }
  if (scripts.build) {
    commands.push({
      command: 'npm run build',
      reason: 'Confirm the application still compiles for production.',
      approvalMode: 'manual',
      risk: 'medium',
    });
  }
  if (commands.length === 0) {
    commands.push({
      command: 'npm run',
      reason: 'Inspect available scripts before choosing a validation command.',
      approvalMode: 'manual',
      risk: 'medium',
    });
  }

  return {
    status: 'approval_required',
    approvalBoundary: 'shell_validation',
    commands,
    expectedEvidence: [
      'Command name, exit status, and concise output summary.',
      'Any failed check mapped back to the touched file or planned change.',
      'Final recommendation: ship, revise, or roll back.',
    ],
    fallback: [
      'If no automated tests exist, run a production build and a focused manual smoke checklist.',
      'If validation fails, stop before delivery and prepare a revise plan.',
    ],
  };
}

function buildDeliveryPackage(input: CodeWorkflowInput, repo: RepoProfile, patches: PatchDraft[]): CodeDeliveryPackage {
  const slug = slugify(input.objective);
  const primaryArea = patches[0]?.file || repo.projectName;

  return {
    status: 'approval_required',
    approvalBoundary: 'git_delivery',
    branchName: `theone/${slug}`,
    commitMessage: `Update ${primaryArea} for ${input.focus || 'code workflow'}`,
    prTitle: `TheOne code update: ${input.objective.trim().slice(0, 80)}`,
    prBodyOutline: [
      'Summary of the user objective and implemented change.',
      'Files changed and why each change was necessary.',
      'Validation commands, results, and remaining risk.',
      'Rollback notes and proof record links.',
    ],
    releaseNotes: [
      `Prepared a scoped code change plan for ${repo.projectName}.`,
      'Implementation, validation, commit, push, and PR creation remain approval-gated.',
    ],
    proofRequired: [
      'Patch diff or file write receipt.',
      'Validation command receipt.',
      'Git commit or PR receipt if delivery is approved.',
    ],
  };
}

function buildCodeApprovals(runId: string, mode: TheOneMode): ApprovalGate[] {
  return [
    {
      id: `${runId}_code_apply`,
      stepId: 'code_apply_gate',
      action: 'code.patch.apply',
      risk: 'high',
      required: true,
      status: 'pending',
      mode,
      reason: 'Applying the prepared patch writes repository files and requires explicit approval.',
    },
    {
      id: `${runId}_code_validate`,
      stepId: 'code_validate_gate',
      action: 'code.test.run',
      risk: 'medium',
      required: true,
      status: 'pending',
      mode,
      reason: 'Running validation commands can execute project scripts and requires approval.',
    },
    {
      id: `${runId}_code_delivery`,
      stepId: 'code_delivery_gate',
      action: 'code.pr.create',
      risk: 'high',
      required: true,
      status: 'pending',
      mode,
      reason: 'Creating commits, pushes, or PRs changes external Git state and requires approval.',
    },
  ];
}

function oneAiText(value: unknown) {
  const record = value && typeof value === 'object' ? value as Record<string, any> : {};
  return String(record.summary || record.reply || record.answer || record.text || '').trim();
}

async function summarizeCodePlan(input: CodeWorkflowInput, repo: RepoProfile, plan: string[], patches: PatchDraft[]) {
  const fallback = [
    `Code workspace ready: ${repo.projectName} (${repo.framework}).`,
    `Scanned ${repo.scannedFiles} files and selected ${repo.relevantFiles.length} likely targets.`,
    `Stages 1-3 read, plan, and draft. Stages 4-5 prepare approval-gated implementation, validation, and delivery. No files are modified yet.`,
  ].join(' ');

  try {
    const result = await runOneAI({
      type: 'theone_code_workflow',
      input: {
        objective: input.objective,
        focus: input.focus,
        language: input.language || 'en',
        repoProfile: {
          projectName: repo.projectName,
          framework: repo.framework,
          techStack: repo.techStack,
          scripts: repo.scripts,
          importantFiles: repo.importantFiles,
          relevantFiles: repo.relevantFiles.map((file) => ({
            path: file.path,
            kind: file.kind,
            lines: file.lines,
            snippet: file.snippet,
          })),
        },
        plannedStages: plan,
        patchDrafts: patches,
        instruction: 'Return a concise senior-engineer brief: current architecture, implementation plan, patch targets, implementation gates, validation, and delivery. Do not claim files were changed.',
      },
    });
    return oneAiText(extractOneAIData(result)) || fallback;
  } catch (error) {
    return `${fallback} OneAI code-brain note: ${error instanceof Error ? error.message : 'unavailable'}.`;
  }
}

export async function runCodeWorkflowApp(input: CodeWorkflowInput): Promise<TheOneRunResult & {
  appResult: {
    app: 'code';
    status: string;
    workspacePath: string;
    projectName: string;
    framework: string;
    techStack: string[];
    scannedFiles: number;
    relevantFiles: CodeFileProfile[];
    implementationPlan: string[];
    patchDrafts: PatchDraft[];
    implementationPackage: CodeImplementationPackage;
    validationPlan: CodeValidationPlan;
    deliveryPackage: CodeDeliveryPackage;
    approvalGates: ApprovalGate[];
    summary: string;
  };
}> {
  const objective = input.objective.trim();
  if (!objective) throw new Error('Code objective is required.');

  const workspacePath = resolveWorkspace(input.workspacePath);
  const mode = input.mode || 'assist';
  const runId = createRunId();
  const startedAt = new Date().toISOString();
  const [oneClawManifest, oneClawBridge] = await Promise.all([
    getOneClawCapabilityManifest(),
    getOneClawBridgeStatus(),
  ]);
  const kernel = getTheOneKernelStatus(mode, oneClawManifest, oneClawBridge);
  const repo = await buildRepoProfile(workspacePath, objective);
  const implementationPlan = buildLocalPlan(input, repo);
  const patchDrafts = inferPatchDrafts(input, repo);
  const implementationPackage = buildImplementationPackage(patchDrafts);
  const validationPlan = buildValidationPlan(repo);
  const deliveryPackage = buildDeliveryPackage(input, repo, patchDrafts);
  const approvals = buildCodeApprovals(runId, mode);
  const summary = await summarizeCodePlan(input, repo, implementationPlan, patchDrafts);

  const intent: ClassifiedIntent = {
    type: 'automation',
    objective: `Prepare code workflow: ${objective}`,
    entities: [repo.projectName, workspacePath],
    constraints: ['read-only repository scan', 'prepare patch drafts only', 'do not mutate files without approval', 'validation and PR delivery remain approval-gated'],
    priority: 'normal',
    confidence: 0.93,
    requiresApproval: true,
  };
  const steps: PlanStep[] = [
    {
      id: 'code_read',
      title: 'Read code workspace',
      action: 'custom',
      status: 'completed',
      output: { workspacePath, scannedFiles: repo.scannedFiles, readableFiles: repo.readableFiles },
      capability: 'research',
    },
    {
      id: 'code_profile',
      title: 'Build architecture profile',
      action: 'custom',
      status: 'completed',
      output: { framework: repo.framework, techStack: repo.techStack, importantFiles: repo.importantFiles },
      dependsOn: ['code_read'],
      capability: 'think',
    },
    {
      id: 'code_plan',
      title: 'Plan code change',
      action: 'oneai.generate',
      status: 'completed',
      output: { implementationPlan },
      dependsOn: ['code_profile'],
      capability: 'plan',
    },
    {
      id: 'code_patch_draft',
      title: 'Prepare patch draft',
      action: 'custom',
      status: 'completed',
      output: { patchDrafts },
      dependsOn: ['code_plan'],
      capability: 'create',
    },
    {
      id: 'code_apply_gate',
      title: 'Prepare implementation package',
      action: 'code.patch.apply',
      status: 'blocked',
      output: { implementationPackage },
      requiresApproval: true,
      dependsOn: ['code_patch_draft'],
      capability: 'govern',
    },
    {
      id: 'code_validate_gate',
      title: 'Prepare validation runbook',
      action: 'code.test.run',
      status: 'blocked',
      output: { validationPlan },
      requiresApproval: true,
      dependsOn: ['code_apply_gate'],
      capability: 'operate',
    },
    {
      id: 'code_verify',
      title: 'Verify workspace state',
      action: 'code.verify',
      status: 'pending',
      dependsOn: ['code_validate_gate'],
      capability: 'govern',
    },
    {
      id: 'code_commit_package',
      title: 'Prepare commit package',
      action: 'code.commit.prepare',
      status: 'pending',
      output: { branchName: deliveryPackage.branchName, commitMessage: deliveryPackage.commitMessage },
      dependsOn: ['code_verify'],
      capability: 'coordinate',
    },
    {
      id: 'code_delivery_gate',
      title: 'Prepare PR delivery package',
      action: 'code.pr.create',
      status: 'blocked',
      output: { deliveryPackage },
      requiresApproval: true,
      dependsOn: ['code_commit_package'],
      capability: 'coordinate',
    },
    {
      id: 'code_proof',
      title: 'Record code workflow proof',
      action: 'proof.write',
      status: 'completed',
      dependsOn: ['code_patch_draft'],
      capability: 'record',
    },
  ];
  const plan: ExecutionPlan = {
    id: createPlanId(),
    intent,
    summary: `Read ${repo.projectName}, plan the change, prepare patch drafts, and stage approval-gated implementation, validation, and delivery.`,
    steps,
    estimatedRisk: 'medium',
    capabilityRoute: {
      intentType: 'automation',
      objective: intent.objective,
      capabilities: ['research', 'think', 'plan', 'create', 'operate', 'coordinate', 'govern', 'record', 'learn'],
      skills: [],
      apps: [],
      connectors: [],
      risk: 'medium',
      summary: 'Code OS routed the request through workspace scanning, OneAI planning, patch preparation, approval-gated implementation, validation, and delivery packaging.',
    },
  };
  const executions = [
    createExecutionRecord({
      provider: 'theone',
      status: 'success',
      summary: `Scanned ${repo.scannedFiles} files in ${repo.projectName}.`,
      taskName: 'code.workspace.scan',
      raw: repo,
    }),
    createExecutionRecord({
      provider: 'oneai',
      status: 'success',
      summary: 'Prepared code implementation plan and patch strategy.',
      taskName: 'theone.code.agent',
      raw: { implementationPlan, patchDrafts, summary },
    }),
    createExecutionRecord({
      provider: 'theone',
      status: 'blocked',
      summary: 'Implementation package is ready and waiting for file-write approval.',
      taskName: 'code.patch.apply',
      raw: implementationPackage,
    }),
    createExecutionRecord({
      provider: 'theone',
      status: 'planned',
      summary: 'Validation and PR delivery package prepared for post-approval execution.',
      taskName: 'code.validate.delivery',
      raw: { validationPlan, deliveryPackage },
    }),
  ];
  const proof: ProofRecord[] = [
    {
      type: 'system',
      title: 'Code workflow prepared',
      value: summary.slice(0, 900),
      timestamp: startedAt,
      metadata: {
        app: 'code',
        workspacePath,
        projectName: repo.projectName,
        framework: repo.framework,
        scannedFiles: repo.scannedFiles,
        patchDraftCount: patchDrafts.length,
        approvalGates: approvals.map((approval) => approval.action),
        validationCommands: validationPlan.commands.map((command) => command.command),
        writeApplied: false,
      },
    },
  ];
  const workflow = createWorkflowTrace({ runId, mode, plan, approvals });
  const appMemoryPack = createAppMemoryPack({
    app: 'code',
    title: `Code workflow: ${repo.projectName}`,
    summary: summary.slice(0, 600),
    facts: [
      `Framework: ${repo.framework}`,
      `Scanned files: ${repo.scannedFiles}`,
      `Patch drafts: ${patchDrafts.length}`,
      'No files were modified in this stage',
    ],
    nextActions: ['Review the patch draft', 'Approve implementation stage', 'Run build and tests after applying changes'],
    sourceRunId: runId,
  });

  return {
    ok: true,
    runId,
    summary,
    intent,
    plan,
    execution: {
      completedSteps: steps.filter((step) => step.status === 'completed').length,
      failedSteps: 0,
      agentResults: [],
    },
    proof,
    approvals,
    executions,
    pendingOneClawTask: null,
    networkSignals: {
      appRoute: 'code',
      stagedCapability: 'read_plan_patch_apply_validate_pr',
      writeApplied: false,
      implementationGated: true,
    },
    os: {
      ...kernel,
      workflow,
      approvals,
      executions,
    },
    appMemoryPack,
    appResult: {
      app: 'code',
      status: 'completed',
      workspacePath,
      projectName: repo.projectName,
      framework: repo.framework,
      techStack: repo.techStack,
      scannedFiles: repo.scannedFiles,
      relevantFiles: repo.relevantFiles,
      implementationPlan,
      patchDrafts,
      implementationPackage,
      validationPlan,
      deliveryPackage,
      approvalGates: approvals,
      summary,
    },
  };
}
