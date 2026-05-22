import { findAppBundlesByCapabilities } from '../apps/registry';
import { findConnectorsByCapabilities } from '../connectors/registry';
import { findSkillsByCapabilities } from '../skills/registry';
import type {
  CapabilityPrimitive,
  CapabilityRoute,
  ClassifiedIntent,
  SkillDefinition,
} from '../types';

const riskWeight = {
  low: 1,
  medium: 2,
  high: 3,
} as const;

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function inferCapabilities(intent: ClassifiedIntent): CapabilityPrimitive[] {
  const raw = intent.objective.toLowerCase();
  const capabilities: CapabilityPrimitive[] = ['think', 'plan', 'govern', 'record'];

  if (intent.type === 'knowledge' || /research|search|summar|positioning|知识|研究|总结|资料/.test(raw)) {
    capabilities.push('research', 'remember', 'learn');
  }

  if (intent.type === 'growth' || /post|tweet|x |twitter|publish|content|followers|粉丝|发布|内容|增长/.test(raw)) {
    capabilities.push('create', 'communicate', 'remember', 'learn');
  }

  if (intent.type === 'mission' || /mission|task|leaderboard|community|任务|社群|贡献/.test(raw)) {
    capabilities.push('coordinate', 'communicate', 'learn');
  }

  if (intent.type === 'financial' || /trade|money|profit|payment|buy|sell|contract|赚钱|交易|采购|付款|签约/.test(raw)) {
    capabilities.push('research', 'transact', 'monitor');
  }

  if (/browser|file|api|system|integrat|operate|construction|project|rfi|inspection|浏览器|文件|接口|系统|建筑|项目|巡检/.test(raw)) {
    capabilities.push('operate', 'integrate', 'coordinate');
  }

  if (/watch|monitor|alert|status|risk|deadline|提醒|监控|状态|风险/.test(raw)) {
    capabilities.push('monitor');
  }

  return unique(capabilities);
}

function routeRisk(skills: SkillDefinition[], intent: ClassifiedIntent): 'low' | 'medium' | 'high' {
  if (intent.requiresApproval) return 'medium';
  const maxRisk = skills.reduce((max, skill) => Math.max(max, riskWeight[skill.risk]), 1);
  if (maxRisk >= 3) return 'high';
  if (maxRisk >= 2) return 'medium';
  return 'low';
}

export function routeCapabilities(intent: ClassifiedIntent): CapabilityRoute {
  const capabilities = inferCapabilities(intent);
  const skills = findSkillsByCapabilities(capabilities).slice(0, 3);
  const apps = findAppBundlesByCapabilities(capabilities).slice(0, 3);
  const connectors = findConnectorsByCapabilities(capabilities).slice(0, 4);
  const risk = routeRisk(skills, intent);

  return {
    intentType: intent.type,
    objective: intent.objective,
    capabilities,
    skills,
    apps,
    connectors,
    risk,
    summary: `Capability route: ${capabilities.map((capability) => capability).join(' + ')}`,
  };
}
