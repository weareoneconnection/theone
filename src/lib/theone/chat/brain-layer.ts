import type { AppRuntimePackage } from '../apps/runtime-packages';
import type { TheOneMode } from '../types';
import type { TheOneChatMessage } from './oneai-workflow-builder';

export type TheOneBrainMode = 'think' | 'assist' | 'act';
export type TheOneBrainConversationKind = 'capability' | 'planning' | 'execution' | 'follow_up';

export type TheOneBrainFrame = {
  version: 'theone.brain.v1';
  mode: TheOneBrainMode;
  conversationKind: TheOneBrainConversationKind;
  objective: string;
  confidence: number;
  selectedApps: Array<{
    key: string;
    title: string;
    route: string;
    purpose: string;
    workerActions: string[];
  }>;
  capabilityRoute: string[];
  reasoning: {
    userIntent: string;
    strategy: string;
    assumptions: string[];
    missingInformation: string[];
  };
  executionDecision: {
    shouldPlan: boolean;
    shouldExecute: boolean;
    approvalExpected: boolean;
    reason: string;
  };
  safety: {
    risk: 'low' | 'medium' | 'high';
    approvalReason: string;
  };
  nextMoves: string[];
  systemPrompt: string;
};

function hasAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function clean(raw: string) {
  return raw.replace(/\s+/g, ' ').trim();
}

function inferBrainMode(mode: TheOneMode, raw: string): TheOneBrainMode {
  if (mode === 'auto') return 'act';
  if (mode === 'manual') return 'think';
  if (/只(分析|策划|想)|不要执行|先别执行|plan only|think only/i.test(raw)) return 'think';
  if (/执行|运行|发布|发帖|创建|调用|操作|run|execute|post|create|send/i.test(raw)) return 'assist';
  return 'assist';
}

function inferKind(raw: string): TheOneBrainConversationKind {
  if (hasAny(raw, [
    /what can you do/i,
    /你能.*做/,
    /能做什么/,
    /能力/,
    /介绍一下/,
    /^hello\b/i,
    /^hi\b/i,
  ])) return 'capability';
  if (hasAny(raw, [/继续|下一步|follow.?up|再/i])) return 'follow_up';
  if (hasAny(raw, [/执行|运行|发布|发帖|创建|调用|操作|run|execute|post|create|send/i])) return 'execution';
  return 'planning';
}

function inferRisk(raw: string): 'low' | 'medium' | 'high' {
  if (hasAny(raw, [/发布|发帖|回复|send|post|delete|删除|payment|transfer|交易|付款|desktop|电脑|click|type|hotkey/i])) {
    return 'high';
  }
  if (hasAny(raw, [/browse|website|github|repo|api|file|网页|网站|仓库|文件|接口/i])) return 'medium';
  return 'low';
}

function inferCapabilityRoute(raw: string) {
  const route = new Set<string>(['think', 'plan', 'govern', 'record']);
  if (hasAny(raw, [/browse|website|web|search|research|网页|网站|搜索|研究/i])) route.add('research');
  if (hasAny(raw, [/post|tweet|x\b|twitter|发布|推文|回复/i])) route.add('communicate');
  if (hasAny(raw, [/github|repo|代码|仓库|ci|pr|issue/i])) route.add('coordinate');
  if (hasAny(raw, [/desktop|computer|chrome|电脑|本地|click|type|hotkey|截图/i])) route.add('operate');
  if (hasAny(raw, [/file|folder|document|report|文件|目录|报告/i])) route.add('create');
  if (hasAny(raw, [/api|webhook|接口|sync|同步/i])) route.add('integrate');
  route.add('remember');
  route.add('learn');
  return Array.from(route);
}

function fallbackApps(appPackages: AppRuntimePackage[], raw: string) {
  const lower = raw.toLowerCase();
  const scored = appPackages.map((pkg) => {
    const score = pkg.intents.filter((intent) => lower.includes(intent.toLowerCase())).length +
      pkg.workerActions.filter((action) => lower.includes(action.toLowerCase())).length +
      (lower.includes(pkg.key) ? 1 : 0);
    return { pkg, score };
  }).sort((a, b) => b.score - a.score);
  const selected = scored.filter((item) => item.score > 0).map((item) => item.pkg);
  return selected.length ? selected : appPackages.slice(0, 4);
}

function missingInformation(raw: string, kind: TheOneBrainConversationKind) {
  const missing: string[] = [];
  if (kind === 'capability') return missing;
  if (/github|repo|仓库|代码库/i.test(raw) && !/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/.test(raw)) {
    missing.push('GitHub owner/repo or repository URL');
  }
  if (/browse|website|网页|网站|分析网站/i.test(raw) && !/(https?:\/\/[^\s)]+|(?:[a-z0-9-]+\.)+[a-z]{2,})/i.test(raw)) {
    missing.push('website URL');
  }
  if (/api|接口|webhook/i.test(raw) && !/https?:\/\/[^\s)]+/i.test(raw)) {
    missing.push('API endpoint URL');
  }
  return missing;
}

function capabilityReply(apps: AppRuntimePackage[]) {
  const appList = apps.slice(0, 8).map((pkg) => `${pkg.title}: ${pkg.purpose}`).join('\n');
  return [
    'I can work as TheOne AI OS: understand your goal, choose the right app, build a workflow with OneAI, check policy, call OneClaw workers, and return proof.',
    '',
    'Main things I can do now:',
    appList,
    '',
    'Give me an outcome, not a worker name. For example: analyze a website, prepare an X post, inspect a GitHub repo, list files, call an API, or use the local desktop bridge.',
  ].join('\n');
}

export function buildTheOneBrainFrame(input: {
  raw: string;
  mode: TheOneMode;
  messages: TheOneChatMessage[];
  appPackages: AppRuntimePackage[];
  selectedAppPackages?: AppRuntimePackage[];
  workerCatalogSummary?: Record<string, unknown>;
}): TheOneBrainFrame {
  const raw = clean(input.raw);
  const conversationKind = inferKind(raw);
  const mode = inferBrainMode(input.mode, raw);
  const risk = inferRisk(raw);
  const selected = input.selectedAppPackages?.length
    ? input.selectedAppPackages
    : fallbackApps(input.appPackages, raw);
  const missing = missingInformation(raw, conversationKind);
  const shouldPlan = conversationKind !== 'capability';
  const shouldExecute = shouldPlan && missing.length === 0 && mode !== 'think';
  const approvalExpected = risk === 'high' || mode === 'think';
  const selectedApps = selected.slice(0, 4).map((pkg) => ({
    key: pkg.key,
    title: pkg.title,
    route: pkg.route,
    purpose: pkg.purpose,
    workerActions: pkg.workerActions,
  }));
  const capabilityRoute = inferCapabilityRoute(raw);

  return {
    version: 'theone.brain.v1',
    mode,
    conversationKind,
    objective: conversationKind === 'capability'
      ? 'Explain TheOne capabilities and help the user choose an outcome.'
      : raw,
    confidence: conversationKind === 'capability' ? 0.94 : missing.length ? 0.72 : 0.88,
    selectedApps,
    capabilityRoute,
    reasoning: {
      userIntent: conversationKind === 'capability'
        ? 'The user is exploring what TheOne can do.'
        : `The user wants TheOne to finish: ${raw}`,
      strategy: conversationKind === 'capability'
        ? 'Answer directly with TheOne capability boundaries and examples; do not create an execution workflow.'
        : 'Use OneAI to structure the workflow, TheOne to validate policy, and OneClaw only for executable worker actions.',
      assumptions: [
        'The user prefers outcome-level conversation instead of worker-level commands.',
        'Read-only work should run automatically when policy and preflight allow it.',
        'External writes, desktop control, publishing, payments, deletion, and high-risk actions must be approval-gated.',
      ],
      missingInformation: missing,
    },
    executionDecision: {
      shouldPlan,
      shouldExecute,
      approvalExpected,
      reason: conversationKind === 'capability'
        ? 'Capability exploration is answered by the brain layer without worker execution.'
        : missing.length
          ? `TheOne needs: ${missing.join(', ')}.`
          : shouldExecute
            ? 'Enough information is present to build and validate a workflow.'
            : 'TheOne should think and plan, but not execute yet.',
    },
    safety: {
      risk,
      approvalReason: approvalExpected
        ? 'The request may touch a high-risk or user-visible action, so TheOne will keep approval gates active.'
        : 'The request appears read-only or reasoning-only and can be auto-cleared after policy validation.',
    },
    nextMoves: conversationKind === 'capability'
      ? [
          'Analyze a website and summarize useful findings.',
          'Prepare a high-signal X post and wait for approval.',
          'Check a GitHub repo and explain what needs attention.',
          'Use the local desktop bridge to inspect Chrome.',
        ]
      : [
          'Build the workflow.',
          'Run allowed read-only workers.',
          'Return proof and a plain-language result.',
          'Offer follow-up actions.',
        ],
    systemPrompt: [
      'You are TheOne Brain, the top reasoning layer of TheOne AI OS.',
      'Think like a Codex-grade super-agent assistant: understand the outcome, choose apps/workers, reason about safety, and explain the path.',
      'Never force capability questions into worker execution.',
      'Keep the user-facing reply direct, useful, and non-technical unless the user asks for system details.',
      `Worker catalog summary: ${JSON.stringify(input.workerCatalogSummary || {})}`,
    ].join('\n'),
  };
}

export function buildBrainOnlyReply(input: {
  brain: TheOneBrainFrame;
  appPackages: AppRuntimePackage[];
}) {
  if (input.brain.conversationKind === 'capability') {
    return capabilityReply(input.appPackages);
  }

  if (input.brain.reasoning.missingInformation.length) {
    return [
      'I understand the outcome, but I need one missing detail before I can route the work safely.',
      '',
      `Missing: ${input.brain.reasoning.missingInformation.join(', ')}`,
      '',
      'Once you provide that, I can build the workflow, check policy, call the right worker, and return proof.',
    ].join('\n');
  }

  return [
    'I understand the outcome and prepared the strategy.',
    '',
    `Route: ${input.brain.capabilityRoute.join(' + ')}`,
    `Mode: ${input.brain.mode}`,
    `Risk: ${input.brain.safety.risk}`,
    '',
    input.brain.executionDecision.reason,
  ].join('\n');
}
