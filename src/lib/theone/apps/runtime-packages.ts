import { listAppBundles } from './registry';
import { packageRegistrySummary } from '../packages/package-registry';
import type { CapabilityPrimitive } from '../types';

export type AppRuntimePackage = {
  key: string;
  title: string;
  route: string;
  stage: 'core' | 'installed' | 'planned';
  purpose: string;
  intents: string[];
  workerActions: string[];
  capabilities: CapabilityPrimitive[];
  policy: {
    read: 'auto' | 'assist' | 'manual';
    write: 'auto' | 'assist' | 'manual';
    approval: string;
  };
  proof: string[];
  memory: string[];
};

const packages: AppRuntimePackage[] = [
  {
    key: 'web',
    title: 'Web Analysis App',
    route: '/apps/web',
    stage: 'installed',
    purpose: 'Read websites, extract useful findings, and turn them into summaries or reports.',
    intents: ['browse website', 'analyze URL', 'summarize useful findings', 'SEO snapshot', 'risk check'],
    workerActions: ['browser.extract', 'browser.scrape', 'browser.open'],
    capabilities: ['research', 'operate', 'record', 'remember'],
    policy: { read: 'auto', write: 'manual', approval: 'Read-only extraction can auto-run after host preflight.' },
    proof: ['url', 'extracted text', 'worker receipt', 'final summary'],
    memory: ['site findings', 'positioning', 'risk notes'],
  },
  {
    key: 'x',
    title: 'X Growth App',
    route: '/apps/x',
    stage: 'installed',
    purpose: 'Prepare X posts, search X, and run guarded growth workflows.',
    intents: ['prepare X post', 'search tweets', 'reply to tweet', 'growth content'],
    workerActions: ['x.searchRecentTweets', 'x.getTweet', 'social.post'],
    capabilities: ['create', 'communicate', 'research', 'govern', 'record'],
    policy: { read: 'auto', write: 'manual', approval: 'Public posting and sends remain approval-gated.' },
    proof: ['draft', 'approval', 'post receipt'],
    memory: ['content angles', 'blocked reply targets', 'post history'],
  },
  {
    key: 'github',
    title: 'GitHub Workflow App',
    route: '/apps/github',
    stage: 'installed',
    purpose: 'Inspect repos, checks, CI runs, and create approved GitHub work items.',
    intents: ['check repo', 'review CI', 'what needs attention', 'create issue', 'prepare PR'],
    workerActions: ['git.repo.get', 'git.actions.runs', 'git.checks.list', 'git.issue.create', 'git.pr.create'],
    capabilities: ['research', 'monitor', 'coordinate', 'govern', 'record'],
    policy: { read: 'auto', write: 'manual', approval: 'Repo reads can auto-run; issues and PRs require approval.' },
    proof: ['repo metadata', 'CI status', 'issue or PR receipt'],
    memory: ['repo risks', 'open follow-ups', 'release health'],
  },
  {
    key: 'desktop',
    title: 'Local Desktop App',
    route: '/apps/desktop',
    stage: 'installed',
    purpose: 'Operate the local computer through the OneClaw Local Desktop Bridge.',
    intents: ['inspect Chrome', 'screenshot app', 'click desktop', 'type locally', 'hotkey'],
    workerActions: ['desktop.app.state', 'desktop.screenshot', 'desktop.click', 'desktop.type', 'desktop.hotkey'],
    capabilities: ['operate', 'govern', 'record'],
    policy: { read: 'manual', write: 'manual', approval: 'Desktop control requires local bridge and explicit approval.' },
    proof: ['screenshot', 'app state', 'desktop receipt'],
    memory: ['allowed apps', 'bridge status', 'desktop action history'],
  },
  {
    key: 'files',
    title: 'Files App',
    route: '/apps/files',
    stage: 'installed',
    purpose: 'Read, list, prepare, transform, or write files under governed policy.',
    intents: ['list files', 'read file', 'write file', 'transform document'],
    workerActions: ['file.list', 'file.read', 'file.write', 'document.generate', 'spreadsheet.write'],
    capabilities: ['operate', 'integrate', 'record', 'remember'],
    policy: { read: 'auto', write: 'manual', approval: 'Reads can auto-run in allowed scope; writes require approval.' },
    proof: ['file path', 'artifact', 'write receipt'],
    memory: ['important paths', 'artifact summaries'],
  },
  {
    key: 'api',
    title: 'API App',
    route: '/apps/api',
    stage: 'installed',
    purpose: 'Call APIs, webhooks, and integration endpoints with host policy.',
    intents: ['call API', 'check health endpoint', 'webhook', 'sync systems'],
    workerActions: ['api.request', 'api.webhook'],
    capabilities: ['integrate', 'operate', 'record'],
    policy: { read: 'auto', write: 'manual', approval: 'GET can auto-run after preflight; mutation calls require policy review.' },
    proof: ['endpoint', 'status', 'response receipt'],
    memory: ['integration health', 'API findings'],
  },
  {
    key: 'report',
    title: 'Report App',
    route: '/apps/report',
    stage: 'installed',
    purpose: 'Turn research, proof, and worker output into usable reports.',
    intents: ['create report', 'summarize proof', 'write memo', 'make brief'],
    workerActions: ['document.generate', 'file.write', 'oneai.generate'],
    capabilities: ['create', 'think', 'record', 'remember'],
    policy: { read: 'auto', write: 'manual', approval: 'Report drafting is auto; artifact writes are approval-gated when external.' },
    proof: ['source proof', 'report draft', 'artifact receipt'],
    memory: ['report summaries', 'source decisions'],
  },
  {
    key: 'bot',
    title: 'OneAI Bot App',
    route: '/apps/bot',
    stage: 'installed',
    purpose: 'Bridge the existing OneAI Bot into TheOne without modifying bot code.',
    intents: ['check bot bridge', 'community context', 'bot status', 'telegram community'],
    workerActions: ['oneai.bot.status', 'oneai.bot.community_context', 'oneai.bot.oneclaw_bridge'],
    capabilities: ['communicate', 'coordinate', 'monitor', 'remember', 'govern'],
    policy: { read: 'auto', write: 'manual', approval: 'Bot readiness checks can auto-run; community sends and OneClaw execution stay gated.' },
    proof: ['bridge status', 'bot context', 'handoff receipt'],
    memory: ['community state', 'mission context'],
  },
];

export function listAppRuntimePackages() {
  const bundleKeys = new Set(listAppBundles().map((bundle) => bundle.key));
  return packages.map((item) => ({
    ...item,
    bundleBacked: bundleKeys.has(item.key) || item.key === 'web' || item.key === 'github' || item.key === 'x',
  }));
}

export function selectAppRuntimePackages(message: string) {
  const lower = message.toLowerCase();
  return listAppRuntimePackages()
    .map((pkg) => ({
      pkg,
      score: pkg.intents.filter((intent) => lower.includes(intent.toLowerCase())).length +
        pkg.workerActions.filter((action) => lower.includes(action.toLowerCase())).length,
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.pkg);
}

export async function listEnabledAppRuntimePackages() {
  try {
    const registry = await packageRegistrySummary();
    const packageByName = new Map(
      (registry.packages || [])
        .filter((item: any) => item.kind === 'app')
        .map((item: any) => [item.name, item])
    );

    return listAppRuntimePackages().filter((item) => {
      const registered = packageByName.get(item.key) as any;
      if (!registered) return true;
      return registered.enabled !== false && registered.status !== 'disabled';
    });
  } catch {
    return listAppRuntimePackages();
  }
}

export function selectAppRuntimePackagesFromCatalog(message: string, catalog: Array<AppRuntimePackage & { bundleBacked?: boolean }>) {
  const lower = message.toLowerCase();
  return catalog
    .map((pkg) => ({
      pkg,
      score: pkg.intents.filter((intent) => lower.includes(intent.toLowerCase())).length +
        pkg.workerActions.filter((action) => lower.includes(action.toLowerCase())).length,
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.pkg);
}
