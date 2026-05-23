import type { CapabilityPrimitive, ConnectorDefinition } from '../types';

export const connectorRegistry: ConnectorDefinition[] = [
  {
    key: 'browser_connector',
    title: 'Browser Connector',
    kind: 'browser',
    status: 'available',
    description: 'Open, inspect, extract, and operate web surfaces through governed execution.',
    capabilities: ['operate', 'research', 'integrate', 'record'],
    provider: 'oneclaw',
    actions: ['browser.open', 'browser.extract', 'browser.operate'],
    permissionScopes: ['use_connector', 'submit_external', 'operate_browser'],
    riskProfile: 'medium',
  },
  {
    key: 'file_connector',
    title: 'File Connector',
    kind: 'files',
    status: 'available',
    description: 'Read, prepare, transform, and route files as OS resources.',
    capabilities: ['operate', 'integrate', 'record', 'remember'],
    provider: 'oneclaw',
    actions: ['file.read', 'file.write', 'file.transform'],
    permissionScopes: ['use_connector', 'submit_external', 'read_file', 'write_file'],
    riskProfile: 'medium',
  },
  {
    key: 'messaging_connector',
    title: 'Messaging Connector',
    kind: 'communication',
    status: 'planned',
    description: 'Draft, send, reply, and coordinate messages across communication tools.',
    capabilities: ['communicate', 'coordinate', 'govern', 'record'],
    provider: 'oneclaw',
    actions: ['message.draft', 'message.send', 'message.reply'],
    permissionScopes: ['use_connector', 'submit_external', 'send_message'],
    riskProfile: 'high',
  },
  {
    key: 'oneai_bot_connector',
    title: 'OneAI Bot Connector',
    kind: 'communication',
    status: 'available',
    description: 'Connects TheOne to the existing WAOC OneAI Telegram Bot runtime through a no-code-change bridge contract.',
    capabilities: ['communicate', 'coordinate', 'monitor', 'govern', 'record', 'remember', 'learn'],
    provider: 'theone',
    actions: ['oneai.bot.status', 'oneai.bot.community_context', 'oneai.bot.oneclaw_bridge'],
    permissionScopes: ['use_connector', 'read_context', 'read_memory', 'write_memory', 'submit_external', 'send_message'],
    riskProfile: 'high',
  },
  {
    key: 'knowledge_connector',
    title: 'Knowledge Connector',
    kind: 'knowledge',
    status: 'available',
    description: 'Route research, notes, references, and reusable context into memory.',
    capabilities: ['research', 'remember', 'learn', 'record'],
    provider: 'theone',
    actions: ['knowledge.search', 'knowledge.summarize', 'memory.store'],
    permissionScopes: ['use_connector', 'read_context', 'read_memory', 'write_memory'],
    riskProfile: 'low',
  },
  {
    key: 'commerce_connector',
    title: 'Commerce Connector',
    kind: 'commerce',
    status: 'planned',
    description: 'Prepare procurement, ordering, inventory, checkout, and fulfillment flows.',
    capabilities: ['transact', 'operate', 'monitor', 'govern', 'record'],
    provider: 'oneclaw',
    actions: ['commerce.search', 'commerce.prepare_order', 'commerce.checkout'],
    permissionScopes: ['use_connector', 'submit_external', 'transact'],
    riskProfile: 'high',
  },
  {
    key: 'finance_connector',
    title: 'Finance Connector',
    kind: 'finance',
    status: 'planned',
    description: 'Prepare payment, trading, contract, invoice, and financial approval routes.',
    capabilities: ['transact', 'research', 'monitor', 'govern', 'record'],
    provider: 'oneclaw',
    actions: ['finance.scan', 'finance.prepare_transaction', 'finance.submit'],
    permissionScopes: ['use_connector', 'submit_external', 'transact'],
    riskProfile: 'high',
  },
  {
    key: 'productivity_connector',
    title: 'Productivity Connector',
    kind: 'productivity',
    status: 'available',
    description: 'Create tasks, calendar routes, documents, plans, and operational checklists.',
    capabilities: ['plan', 'coordinate', 'create', 'remember', 'record'],
    provider: 'theone',
    actions: ['task.create', 'document.prepare', 'calendar.plan'],
    permissionScopes: ['use_connector', 'read_context', 'write_memory'],
    riskProfile: 'medium',
  },
  {
    key: 'operations_connector',
    title: 'Operations Connector',
    kind: 'operations',
    status: 'planned',
    description: 'Coordinate real-world operational systems, field work, inspections, and APIs.',
    capabilities: ['operate', 'coordinate', 'monitor', 'integrate', 'record'],
    provider: 'oneclaw',
    actions: ['ops.create_work_order', 'ops.sync_status', 'api.call'],
    permissionScopes: ['use_connector', 'submit_external'],
    riskProfile: 'high',
  },
  {
    key: 'identity_connector',
    title: 'Identity Connector',
    kind: 'identity',
    status: 'planned',
    description: 'Represent people, roles, permissions, profiles, organizations, and consent.',
    capabilities: ['govern', 'coordinate', 'remember', 'record'],
    provider: 'theone',
    actions: ['identity.resolve', 'permission.check', 'consent.record'],
    permissionScopes: ['use_connector', 'read_context', 'admin'],
    riskProfile: 'medium',
  },
];

export function listConnectors() {
  return connectorRegistry;
}

export function findConnectorsByCapabilities(capabilities: CapabilityPrimitive[]) {
  const desired = new Set(capabilities);

  return connectorRegistry
    .map((connector) => ({
      connector,
      score: connector.capabilities.filter((capability) => desired.has(capability)).length,
      extra: connector.capabilities.filter((capability) => !desired.has(capability)).length,
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => (b.score - b.extra * 0.25) - (a.score - a.extra * 0.25))
    .map((item) => item.connector);
}
