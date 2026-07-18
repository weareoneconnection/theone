import type { AppRuntimePackage } from '../apps/runtime-packages';
import type { TheOneMode } from '../types';
import type { UniversalWorkerAction } from '../workers/action-catalog';
import type { TheOneChatMessage } from './oneai-workflow-builder';

export type TheOneBrainMode = 'think' | 'assist' | 'act';
export type TheOneBrainConversationKind = 'capability' | 'planning' | 'execution' | 'follow_up';

export type TheOneBrainFrame = {
  version: 'theone.brain.v2';
  mode: TheOneBrainMode;
  conversationKind: TheOneBrainConversationKind;
  objective: string;
  confidence: number;
  brainStack: Array<{
    key: 'theone_control_brain' | 'oneai_planning_brain' | 'oneclaw_worker_runtime';
    title: string;
    role: string;
    authority: 'control' | 'planning' | 'execution';
    status: 'active' | 'available' | 'gated';
  }>;
  contextReadiness: {
    hasUrl: boolean;
    hasRepository: boolean;
    hasApiEndpoint: boolean;
    hasAttachmentContext: boolean;
    hasReadableAttachment: boolean;
    hasStoredAttachmentPath: boolean;
    notes: string[];
  };
  selectedApps: Array<{
    key: string;
    title: string;
    route: string;
    purpose: string;
    workerActions: string[];
  }>;
  workerCapabilityMap: Array<{
    domain: string;
    title: string;
    status: 'live' | 'guarded' | 'prepared' | 'blocked';
    description: string;
    actions: string[];
    liveActions: number;
    preparedActions: number;
    approvalGatedActions: number;
    blockedActions: number;
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
  oneAiBrain: {
    enabled: boolean;
    role: string;
    contract: string;
    expectedOutput: string[];
    forbiddenDecisions: string[];
  };
  safety: {
    risk: 'low' | 'medium' | 'high';
    approvalReason: string;
  };
  nextMoves: string[];
  systemPrompt: string;
};

const domainCopy: Record<string, { title: string; description: string }> = {
  browser: { title: 'Web and Browser', description: 'Open pages, extract website content, scrape pages, click/type in guarded browser flows, and capture screenshots.' },
  api: { title: 'APIs and Webhooks', description: 'Call HTTP APIs, check endpoints, send webhooks, and summarize responses under host policy.' },
  file: { title: 'Files', description: 'List, read, write, append, transform, delete, and produce governed file artifacts.' },
  filesystem: { title: 'Files, Documents, Spreadsheets, and Storage', description: 'Read/write files, parse or generate documents, handle spreadsheets, and store artifacts.' },
  social: { title: 'X / Social Publishing', description: 'Search X, read tweets, prepare posts and replies, and publish only through approval gates.' },
  x: { title: 'X / Twitter', description: 'Search recent tweets, read user timelines, inspect tweets, and route guarded social actions.' },
  telegram: { title: 'Messaging', description: 'Draft, notify, and send messages through configured messaging connectors with approval.' },
  message: { title: 'Messaging', description: 'Draft, notify, and send messages through configured messaging connectors with approval.' },
  human: { title: 'Human Approval', description: 'Request approvals and confirmations from operators.' },
  content: { title: 'Content', description: 'Generate, transform, and compose content from context and worker results.' },
  result: { title: 'Result Composition', description: 'Compose final answers from multiple step outputs.' },
  web3: { title: 'Web3 and Wallets', description: 'Read chain state, balances, transactions, and guarded contract data; writes remain disabled or approval-gated.' },
  chain: { title: 'Chain Data', description: 'Read chain and wallet data through guarded Web3 workers.' },
  wallet: { title: 'Wallet Data', description: 'Read wallet data through guarded Web3 workers.' },
  construction: { title: 'Construction Operations', description: 'Prepare RFIs, inspections, NCRs, approvals, HSE actions, procurement follow-ups, claims, and project records.' },
  shell: { title: 'Shell', description: 'Prepare guarded shell commands; live shell remains high-risk and approval-gated.' },
  email: { title: 'Email', description: 'Draft, search, and prepare email sends through configured connectors.' },
  calendar: { title: 'Calendar', description: 'Check availability and prepare event create/update actions.' },
  document: { title: 'Documents', description: 'Parse, generate, and convert document artifacts.' },
  spreadsheet: { title: 'Spreadsheets', description: 'Read, write, and summarize CSV or spreadsheet data.' },
  database: { title: 'Database', description: 'Inspect schema, run read-only queries, and prepare guarded writes.' },
  search: { title: 'Search', description: 'Search web/news through configured search connectors.' },
  storage: { title: 'Artifact Storage', description: 'Put, get, and sign artifact URLs.' },
  notification: { title: 'Notifications', description: 'Prepare or send cross-channel notifications and broadcasts.' },
  identity: { title: 'Identity and Permissions', description: 'Resolve users, check permissions, and inspect secret configuration without exposing values.' },
  permission: { title: 'Permissions', description: 'Prepare permission checks and policy decisions.' },
  secret: { title: 'Secrets', description: 'Check whether required secrets are configured without revealing them.' },
  crm: { title: 'CRM', description: 'Prepare lead, contact, deal, and activity workflows.' },
  commerce: { title: 'Commerce', description: 'Search products and prepare guarded orders.' },
  payment: { title: 'Payments', description: 'Prepare invoices or charges; transactions remain approval-gated.' },
  git: { title: 'GitHub and Code', description: 'Inspect repos, checks, actions runs, CI status, search repos, prepare issues or PRs, and connect code work to GitHub proof.' },
  code: { title: 'Code Workspace', description: 'Read repositories, understand architecture, plan changes, prepare patch drafts, stage implementation approval, validate builds/tests, and package commits or PRs behind explicit gates.' },
  device: { title: 'Devices', description: 'Read device status and prepare guarded device commands.' },
  iot: { title: 'IoT', description: 'Read sensor status and prepare device-related workflows.' },
  robot: { title: 'Robotics', description: 'Prepare guarded robot tasks for future connected operators.' },
  knowledge: { title: 'Knowledge and Memory', description: 'Prepare knowledge upsert/query and retrieval workflows.' },
  vector: { title: 'Vector Store', description: 'Prepare vector upsert/query workflows for retrieval.' },
  audio: { title: 'Audio', description: 'Prepare transcription and speech synthesis workflows.' },
  voice: { title: 'Voice', description: 'Parse voice commands and route intent.' },
  image: { title: 'Images and OCR', description: 'Analyze images and extract text.' },
  video: { title: 'Video', description: 'Analyze and summarize video artifacts.' },
  camera: { title: 'Camera Streams', description: 'Prepare guarded camera stream inspection.' },
  geo: { title: 'Geospatial', description: 'Prepare geocoding, route planning, and site maps.' },
  desktop: { title: 'Local Desktop Control', description: 'Read app state, take screenshots, click, type, and send hotkeys through the local bridge.' },
  legal: { title: 'Legal', description: 'Prepare contract extraction, risk review, and approval packages.' },
  finance: { title: 'Finance and Accounting', description: 'Parse invoices, reconcile sources, and review budget variance.' },
  simulation: { title: 'Simulation', description: 'Prepare schedule simulations and cost forecasts.' },
  digitalTwin: { title: 'Digital Twin', description: 'Prepare digital twin state sync and project simulation workflows.' },
  example: { title: 'Plugin Examples', description: 'Example extension points for installable worker capabilities.' },
};

function buildWorkerCapabilityMap(actions: UniversalWorkerAction[] = []) {
  const groups = new Map<string, UniversalWorkerAction[]>();
  for (const action of actions) {
    const domain = action.domain || action.connectorKey || action.action.split('.')[0] || 'general';
    groups.set(domain, [...(groups.get(domain) || []), action]);
  }

  return Array.from(groups.entries()).map(([domain, items]) => {
    const liveActions = items.filter((item) => item.liveMode === 'live' && item.automationClass !== 'blocked').length;
    const preparedActions = items.filter((item) => item.automationClass === 'prepared').length;
    const approvalGatedActions = items.filter((item) => item.automationClass === 'approval_gated').length;
    const blockedActions = items.filter((item) => item.automationClass === 'blocked').length;
    const status = liveActions > 0
      ? approvalGatedActions > 0 ? 'guarded' : 'live'
      : preparedActions > 0
        ? 'prepared'
        : blockedActions > 0
          ? 'blocked'
          : 'guarded';
    const copy = domainCopy[domain] || {
      title: domain.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
      description: `OneClaw ${domain} worker capabilities are visible to TheOne and can be routed when connected by policy.`,
    };

    return {
      domain,
      title: copy.title,
      status: status as 'live' | 'guarded' | 'prepared' | 'blocked',
      description: copy.description,
      actions: items.map((item) => item.action).sort(),
      liveActions,
      preparedActions,
      approvalGatedActions,
      blockedActions,
    };
  }).sort((a, b) => {
    const rank = { live: 0, guarded: 1, prepared: 2, blocked: 3 };
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return a.title.localeCompare(b.title);
  });
}

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
  const explicitActionRequest = hasAny(raw, [
    /(?:帮我|请(?:你)?|给我|为我|开始|现在|直接).{0,24}(?:写|编写|开发|实现|修改|修复|重构|测试|运行|执行|发布|创建|调用|操作)/i,
    /(?:write|build|implement|fix|refactor|test|run|execute|post|create|send)\s+(?:me\s+)?(?:a\s+)?/i,
  ]);
  const capabilityQuestion = hasAny(raw, [
    /what can you do/i,
    /can you\s+(?:code|program|develop|write code)/i,
    /你(?:可以|能|会|支持).{0,24}(?:吗|么|？|\?)/i,
    /你(?:会不会|能不能).{0,24}/i,
    /(?:可以|能|会|支持)(?:编程|写代码|开发|代码审查|调试)(?:吗|么|？|\?)/i,
    /你能.*做/,
    /能做什么/,
    /能力/,
    /介绍一下/,
    /^hello\b/i,
    /^hi\b/i,
  ]);

  if (capabilityQuestion && !explicitActionRequest) return 'capability';
  if (hasAny(raw, [
    /what can you do/i,
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
  if (hasAny(raw, [/browse|website|\bgithub\b|\brepo\b|repository|api|file|document|report|网页|网站|仓库|文件|文档|报告|接口/i])) return 'medium';
  return 'low';
}

function inferCapabilityRoute(raw: string) {
  const route = new Set<string>(['think', 'plan', 'govern', 'record']);
  if (hasAny(raw, [/browse|website|web|search|research|网页|网站|搜索|研究/i])) route.add('research');
  if (hasAny(raw, [/post|tweet|x\b|twitter|发布|推文|回复/i])) route.add('communicate');
  if (hasAny(raw, [/\bgithub\b|\brepo\b|repository|仓库|ci|pr|issue/i])) route.add('coordinate');
  if (hasAny(raw, [/code|代码|代码库|patch|diff|补丁|修复|bug|refactor|重构|test|测试|build|构建|component|组件|页面|api route|feature|功能/i])) {
    route.add('research');
    route.add('create');
    route.add('operate');
    route.add('coordinate');
  }
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
  const readiness = buildContextReadiness(raw);
  const isDocumentRequest = /file|document|report|summary|summarize|read this|文件|文档|报告|总结/i.test(raw);
  if ((/\bgithub\b|\brepo\b|repository|仓库|代码库/i.test(raw)) && !isDocumentRequest && !/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/.test(raw)) {
    missing.push('GitHub owner/repo or repository URL');
  }
  if (isDocumentRequest && !readiness.hasAttachmentContext && !/(\/[^\s]+|[A-Za-z]:\\[^\s]+)/.test(raw)) {
    missing.push('attached file or file path');
  }
  if (/browse|website|网页|网站|分析网站/i.test(raw) && !readiness.hasUrl) {
    missing.push('website URL');
  }
  if (/api|接口|webhook/i.test(raw) && !readiness.hasApiEndpoint) {
    missing.push('API endpoint URL');
  }
  return missing;
}

function buildContextReadiness(raw: string): TheOneBrainFrame['contextReadiness'] {
  const hasUrl = /(https?:\/\/[^\s)]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s)]*)?)/i.test(raw);
  const hasRepository = /(?:github\.com\/)?[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/.test(raw);
  const hasApiEndpoint = /https?:\/\/[^\s)]+/i.test(raw) && /api|endpoint|webhook|接口|调用|request/i.test(raw);
  const hasAttachmentContext = /attached file context|attachment:|readable attachment content|stored path|uploaded attachment/i.test(raw);
  const hasReadableAttachment = /readable attachment content|content:\n/i.test(raw);
  const hasStoredAttachmentPath = /stored path:\s*\S+/i.test(raw);
  const notes = [
    hasAttachmentContext ? 'Attachment context is present; file/document requests should not ask for a path.' : '',
    hasReadableAttachment ? 'Readable attachment text is already available to the chat runtime.' : '',
    hasStoredAttachmentPath && !hasReadableAttachment ? 'Attachment has a stored path; route the matching file worker if reading is required.' : '',
    hasUrl ? 'A URL is present; web analysis can route directly to browser/search workers.' : '',
    hasRepository ? 'A repository reference is present; GitHub workers can be considered.' : '',
  ].filter(Boolean);

  return {
    hasUrl,
    hasRepository,
    hasApiEndpoint,
    hasAttachmentContext,
    hasReadableAttachment,
    hasStoredAttachmentPath,
    notes,
  };
}

function capabilityReply(input: {
  apps: AppRuntimePackage[];
  workerCapabilityMap: TheOneBrainFrame['workerCapabilityMap'];
  raw: string;
}) {
  const asksAboutProgramming = /(?:编程|写代码|开发|代码审查|调试|coding|programming|write code|develop)/i.test(input.raw);
  const prefersChinese = /[\u3400-\u9fff]/.test(input.raw);

  if (asksAboutProgramming) {
    return prefersChinese
      ? [
          '可以。',
          '',
          '我可以直接在对话中完成软件工程任务：理解项目和架构、读取与修改代码、排查错误、实现功能、重构、运行构建与测试、生成变更说明，并在需要时准备提交或 PR。',
          '',
          '实际执行时，TheOne 会先规划改动并检查权限，再把文件、代码、测试和 GitHub 操作交给相应 Worker；高风险写入仍会经过审批并保留执行证明。',
          '',
          '告诉我项目或仓库，以及你想实现或修复什么，我就可以开始。',
        ].join('\n')
      : [
          'Yes.',
          '',
          'I can handle software-engineering work in this chat: understand a codebase, read and edit code, diagnose bugs, implement features, refactor, run builds and tests, explain changes, and prepare commits or pull requests.',
          '',
          'For execution, TheOne plans and checks permissions before routing file, code, test, and GitHub operations to the appropriate workers. High-risk writes remain approval-gated and proof-backed.',
          '',
          'Give me the project or repository and the outcome you want, and I can start.',
        ].join('\n');
  }

  const totalActions = input.workerCapabilityMap.reduce((sum, item) => sum + item.actions.length, 0);
  const byDomain = new Map(input.workerCapabilityMap.map((item) => [item.domain, item]));
  const statusRank = (domains: string[]) => {
    const items = domains.map((domain) => byDomain.get(domain)).filter(Boolean) as TheOneBrainFrame['workerCapabilityMap'];
    if (items.some((item) => item.status === 'live' || item.status === 'guarded')) return 'available';
    if (items.some((item) => item.status === 'prepared')) return 'prepared';
    if (items.some((item) => item.status === 'blocked')) return 'blocked';
    return 'planned';
  };
  const actionCount = (domains: string[]) => domains.reduce((sum, domain) => sum + (byDomain.get(domain)?.actions.length || 0), 0);
  const capabilityGroups = [
    {
      title: 'Research and web work',
      domains: ['browser', 'search', 'api'],
      summary: 'Analyze websites, search or inspect public information, call APIs, and turn findings into useful answers.',
    },
    {
      title: 'Content, X, messaging, and approvals',
      domains: ['content', 'result', 'x', 'social', 'telegram', 'message', 'notification', 'human'],
      summary: 'Prepare posts, replies, messages, notifications, approval requests, and final content. Public sends stay approval-gated.',
    },
    {
      title: 'Code, files, documents, and reports',
      domains: ['git', 'file', 'filesystem', 'document', 'spreadsheet', 'storage'],
      summary: 'Inspect GitHub repos and CI, read/write files, parse or generate documents, work with spreadsheets, and store artifacts.',
    },
    {
      title: 'Local computer and browser control',
      domains: ['desktop'],
      summary: 'Use the local OneClaw bridge to inspect apps, capture screenshots, click, type, and send hotkeys when approved.',
    },
    {
      title: 'Data, identity, memory, and policy',
      domains: ['database', 'knowledge', 'vector', 'identity', 'permission', 'secret'],
      summary: 'Query databases, prepare knowledge/vector retrieval, resolve identity, check permissions, and verify secrets without exposing them.',
    },
    {
      title: 'Business operations',
      domains: ['email', 'calendar', 'crm', 'commerce', 'payment', 'finance'],
      summary: 'Prepare email, calendar, CRM, commerce, payment, invoice, reconciliation, and budget workflows. Most writes require approval or connector setup.',
    },
    {
      title: 'Media, voice, and spatial intelligence',
      domains: ['audio', 'voice', 'image', 'video', 'camera', 'geo'],
      summary: 'Prepare transcription, voice intent parsing, image/OCR, video analysis, camera inspection, geocoding, routes, and site maps.',
    },
    {
      title: 'Field systems and real-world operations',
      domains: ['construction', 'device', 'iot', 'robot', 'legal', 'simulation', 'digitalTwin'],
      summary: 'Prepare construction, device, IoT, robot, legal, simulation, and digital-twin workflows for staged connection to real systems.',
    },
    {
      title: 'Finance, Web3, and guarded transactions',
      domains: ['web3', 'chain', 'wallet'],
      summary: 'Read chain, wallet, balance, transaction, and contract state. Transactional writes remain disabled or approval-gated until safely connected.',
    },
    {
      title: 'Extensible worker platform',
      domains: ['shell', 'example'],
      summary: 'Expose guarded shell and plugin extension points for future installable workers and policy packs.',
    },
  ].map((group) => ({
    ...group,
    status: statusRank(group.domains),
    actions: actionCount(group.domains),
  })).filter((group) => group.actions > 0);
  const formatGroup = (group: typeof capabilityGroups[number]) =>
    `${group.title}: ${group.summary} (${group.actions} actions, ${group.status})`;
  const appList = input.apps
    .map((pkg) => `${pkg.title}`)
    .join(', ');
  const available = capabilityGroups.filter((group) => group.status === 'available');
  const prepared = capabilityGroups.filter((group) => group.status === 'prepared' || group.status === 'planned');
  const blocked = capabilityGroups.filter((group) => group.status === 'blocked');

  return [
    'I am TheOne AI OS: you give me an outcome, and I decide how to finish it. I can talk through the goal, choose the right app or worker, ask OneAI to reason or build a workflow, check policy, call OneClaw for real execution, and return proof you can inspect.',
    '',
    `Right now I can see ${input.workerCapabilityMap.length} OneClaw capability domains and ${totalActions} worker actions. I do not need you to name them; I use them behind the scenes.`,
    '',
    'What I can help with:',
    available.map(formatGroup).join('\n'),
    '',
    prepared.length ? 'Prepared or being connected:' : '',
    prepared.length ? prepared.map(formatGroup).join('\n') : '',
    '',
    blocked.length ? 'Not live yet:' : '',
    blocked.length ? blocked.map(formatGroup).join('\n') : '',
    '',
    `Current user-facing apps include: ${appList}. The full worker map is still available to the OS for routing and diagnostics.`,
    '',
    'Try asking me to: analyze a website and write next steps; prepare an X post and wait for approval; inspect a GitHub repo; read files and generate a report; call an API and summarize the result; use the local desktop bridge; or plan how to connect a prepared worker such as CRM, payments, IoT, legal, or digital twin.',
    '',
    'If something is not connected yet, I will say so and can create the connection plan instead of pretending it is already live.',
  ].filter(Boolean).join('\n');
}

export function buildTheOneBrainFrame(input: {
  raw: string;
  mode: TheOneMode;
  messages: TheOneChatMessage[];
  appPackages: AppRuntimePackage[];
  selectedAppPackages?: AppRuntimePackage[];
  workerCatalogSummary?: Record<string, unknown>;
  workerCatalogActions?: UniversalWorkerAction[];
}): TheOneBrainFrame {
  const raw = clean(input.raw);
  const conversationKind = inferKind(raw);
  const mode = inferBrainMode(input.mode, raw);
  const risk = inferRisk(raw);
  const contextReadiness = buildContextReadiness(raw);
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
  const workerCapabilityMap = buildWorkerCapabilityMap(input.workerCatalogActions || []);
  const capabilityRoute = inferCapabilityRoute(raw);

  return {
    version: 'theone.brain.v2',
    mode,
    conversationKind,
    objective: conversationKind === 'capability'
      ? 'Explain TheOne capabilities and help the user choose an outcome.'
      : raw,
    confidence: conversationKind === 'capability' ? 0.94 : missing.length ? 0.72 : 0.88,
    brainStack: [
      {
        key: 'theone_control_brain',
        title: 'TheOne Control Brain',
        role: 'Owns intent, context readiness, policy boundaries, approval gates, proof, and final execution authority.',
        authority: 'control',
        status: 'active',
      },
      {
        key: 'oneai_planning_brain',
        title: 'OneAI Planning Brain',
        role: 'Turns conversation context into natural replies, structured workflow steps, and candidate OneClaw tasks.',
        authority: 'planning',
        status: 'available',
      },
      {
        key: 'oneclaw_worker_runtime',
        title: 'OneClaw Worker Runtime',
        role: 'Executes approved worker tasks and returns receipts; it never owns policy decisions.',
        authority: 'execution',
        status: approvalExpected ? 'gated' : 'available',
      },
    ],
    contextReadiness,
    selectedApps,
    workerCapabilityMap,
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
    oneAiBrain: {
      enabled: true,
      role: 'Semantic planning brain for TheOne Chat Runtime.',
      contract: 'OneAI must produce a natural assistant reply plus a structured workflow candidate. TheOne validates all actions, policy, approvals, and proof before any worker execution.',
      expectedOutput: [
        'assistantReply',
        'intent',
        'workflow.steps',
        'requiredWorkers',
        'oneclawTask',
        'safety',
        'oneAiBrain',
      ],
      forbiddenDecisions: [
        'Do not decide final execution authority.',
        'Do not bypass TheOne policy or approval gates.',
        'Do not invent unavailable worker actions.',
        'Do not ask for a file path when attachment context is already present.',
        'Do not claim external publication, sending, deletion, payment, or desktop action completed without a OneClaw receipt.',
      ],
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
          'Read files and turn them into a report.',
          'Call an API and summarize the response.',
          'Plan a CRM, payment, IoT, legal, or digital-twin connector setup.',
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
      'OneAI is the planning brain, not the final authority. TheOne keeps control of policy, approval, proof, and worker dispatch.',
      'If contextReadiness says an attachment, URL, repository, or endpoint is present, use it instead of asking the user for the same missing detail.',
      `Context readiness: ${JSON.stringify(contextReadiness)}`,
      `Worker catalog summary: ${JSON.stringify(input.workerCatalogSummary || {})}`,
      `Worker capability domains: ${workerCapabilityMap.map((item) => `${item.domain}:${item.status}:${item.actions.slice(0, 8).join('|')}`).join('; ')}`,
    ].join('\n'),
  };
}

export function buildBrainOnlyReply(input: {
  brain: TheOneBrainFrame;
  appPackages: AppRuntimePackage[];
}) {
  if (input.brain.conversationKind === 'capability') {
    return capabilityReply({
      apps: input.appPackages,
      workerCapabilityMap: input.brain.workerCapabilityMap,
      raw: input.brain.reasoning.userIntent,
    });
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
