import type { OneClawCapabilityDefinition, OneClawConnectorReadiness } from '../types';

export type UniversalWorkerAction = {
  action: string;
  workerKey: string;
  domain: string;
  connectorKey: string;
  risk: OneClawCapabilityDefinition['risk'];
  approvalRequired: boolean;
  liveMode?: string;
  maturity: OneClawCapabilityDefinition['maturity'];
  inputRequired: string[];
  automationClass: 'read_auto' | 'approval_gated' | 'prepared' | 'blocked';
};

function automationClass(capability: OneClawCapabilityDefinition): UniversalWorkerAction['automationClass'] {
  if (capability.liveMode === 'disabled' || capability.maturity === 'stub') return 'blocked';
  if (capability.liveMode === 'prepared' || capability.maturity === 'planned') return 'prepared';
  if (capability.approvalRequired || capability.risk === 'high') return 'approval_gated';
  return 'read_auto';
}

export function buildUniversalWorkerCatalog(input: {
  capabilities: OneClawCapabilityDefinition[];
  connectors: OneClawConnectorReadiness[];
}) {
  const connectorByKey = new Map(input.connectors.map((connector) => [connector.key, connector]));
  const actions: UniversalWorkerAction[] = input.capabilities.map((capability) => {
    const connectorKey = capability.connectorKey || capability.domain || 'general';
    return {
      action: capability.action,
      workerKey: `${connectorKey}_worker`,
      domain: capability.domain || connectorByKey.get(connectorKey)?.domain || connectorKey,
      connectorKey,
      risk: capability.risk,
      approvalRequired: capability.approvalRequired,
      liveMode: capability.liveMode,
      maturity: capability.maturity,
      inputRequired: capability.inputRequired || [],
      automationClass: automationClass(capability),
    };
  });

  const workers = Array.from(actions.reduce((map, action) => {
    const existing = map.get(action.workerKey) || {
      key: action.workerKey,
      domain: action.domain,
      connectorKey: action.connectorKey,
      actions: [] as string[],
      readAuto: 0,
      approvalGated: 0,
      prepared: 0,
      blocked: 0,
    };
    existing.actions.push(action.action);
    if (action.automationClass === 'read_auto') existing.readAuto += 1;
    if (action.automationClass === 'approval_gated') existing.approvalGated += 1;
    if (action.automationClass === 'prepared') existing.prepared += 1;
    if (action.automationClass === 'blocked') existing.blocked += 1;
    map.set(action.workerKey, existing);
    return map;
  }, new Map<string, {
    key: string;
    domain: string;
    connectorKey: string;
    actions: string[];
    readAuto: number;
    approvalGated: number;
    prepared: number;
    blocked: number;
  }>()).values()).sort((a, b) => a.key.localeCompare(b.key));

  return {
    actions,
    workers,
    summary: {
      workers: workers.length,
      actions: actions.length,
      readAuto: actions.filter((action) => action.automationClass === 'read_auto').length,
      approvalGated: actions.filter((action) => action.automationClass === 'approval_gated').length,
      prepared: actions.filter((action) => action.automationClass === 'prepared').length,
      blocked: actions.filter((action) => action.automationClass === 'blocked').length,
    },
  };
}

