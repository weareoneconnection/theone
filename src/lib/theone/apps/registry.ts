import { getSkill } from '../skills/registry';
import type { AppBundleDefinition, CapabilityPrimitive } from '../types';

export const appBundleRegistry: AppBundleDefinition[] = [
  {
    key: 'universal',
    title: 'Universal OS',
    domain: 'general real-world execution',
    status: 'core',
    description: 'The default bundle for generic intent-to-outcome workflows.',
    capabilities: ['think', 'plan', 'govern', 'record', 'remember', 'learn'],
    skills: ['objective_analysis', 'content_prepare', 'status_monitor'],
    requiredProviders: ['theone', 'oneai'],
    riskProfile: 'medium',
  },
  {
    key: 'communications',
    title: 'Communications OS',
    domain: 'messaging, publishing, community, and distribution',
    status: 'installed',
    description: 'Bundles creation, approval, and external communication workflows.',
    capabilities: ['create', 'communicate', 'govern', 'record', 'learn'],
    skills: ['content_prepare', 'external_publish'],
    requiredProviders: ['theone', 'oneai', 'oneclaw'],
    riskProfile: 'high',
  },
  {
    key: 'knowledge',
    title: 'Knowledge OS',
    domain: 'research, knowledge, memory, and intelligence',
    status: 'installed',
    description: 'Bundles research, summarization, proof, and memory workflows.',
    capabilities: ['research', 'record', 'remember', 'learn'],
    skills: ['research_summary'],
    requiredProviders: ['theone', 'oneai'],
    riskProfile: 'medium',
  },
  {
    key: 'coordination',
    title: 'Coordination OS',
    domain: 'tasks, missions, approvals, scheduling, and follow-up',
    status: 'installed',
    description: 'Bundles mission design, task creation, proof rules, and coordination loops.',
    capabilities: ['plan', 'coordinate', 'communicate', 'record', 'learn'],
    skills: ['mission_orchestration'],
    requiredProviders: ['theone'],
    riskProfile: 'medium',
  },
  {
    key: 'oneai_bot',
    title: 'OneAI Bot OS',
    domain: 'telegram community, missions, scoring, and OneClaw execution bridge',
    status: 'installed',
    description: 'Registers the existing WAOC OneAI Telegram Bot as an external community agent runtime without modifying the bot code.',
    capabilities: ['communicate', 'coordinate', 'monitor', 'govern', 'record', 'remember', 'learn'],
    skills: ['status_monitor', 'mission_orchestration', 'external_publish'],
    requiredProviders: ['theone', 'oneai', 'oneclaw'],
    riskProfile: 'high',
  },
  {
    key: 'operations',
    title: 'Operations OS',
    domain: 'browser, files, APIs, enterprise systems, field systems, and tools',
    status: 'planned',
    description: 'Bundles external system operation through guarded execution drivers.',
    capabilities: ['operate', 'integrate', 'coordinate', 'govern', 'record'],
    skills: ['external_operation'],
    requiredProviders: ['theone', 'oneai', 'oneclaw'],
    riskProfile: 'high',
  },
  {
    key: 'transactions',
    title: 'Transaction OS',
    domain: 'payments, purchasing, trading, signing, ordering, and commitments',
    status: 'planned',
    description: 'Bundles high-risk transaction analysis, gates, and receipts.',
    capabilities: ['research', 'think', 'transact', 'monitor', 'govern', 'record'],
    skills: ['transaction_guard'],
    requiredProviders: ['theone', 'oneai', 'oneclaw'],
    riskProfile: 'high',
  },
];

export function listAppBundles() {
  return appBundleRegistry;
}

export function findAppBundlesByCapabilities(capabilities: CapabilityPrimitive[]) {
  const desired = new Set(capabilities);

  function allowedByAnchor(app: AppBundleDefinition) {
    if (app.capabilities.includes('transact') && !desired.has('transact')) return false;
    if (app.capabilities.includes('operate') && !desired.has('operate')) return false;
    if (app.capabilities.includes('communicate') && !desired.has('communicate')) return false;
    if (app.capabilities.includes('coordinate') && !desired.has('coordinate')) return false;
    return true;
  }

  return appBundleRegistry
    .map((app) => ({
      app,
      score: app.capabilities.filter((capability) => desired.has(capability)).length,
      extra: app.capabilities.filter((capability) => !desired.has(capability)).length,
    }))
    .filter((item) => item.score > 0 && allowedByAnchor(item.app))
    .sort((a, b) => (b.score - b.extra * 0.35) - (a.score - a.extra * 0.35))
    .map((item) => item.app);
}

export function getAppBundleSkills(app: AppBundleDefinition) {
  return app.skills.map(getSkill).filter(Boolean);
}
