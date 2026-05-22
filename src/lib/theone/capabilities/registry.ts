import type { CapabilityDefinition, CapabilityPrimitive } from '../types';

export const capabilityRegistry: CapabilityDefinition[] = [
  {
    key: 'think',
    title: 'Think',
    purpose: 'Reason, judge, decide, and evaluate trade-offs.',
    defaultRisk: 'low',
    providerKinds: ['intelligence'],
  },
  {
    key: 'plan',
    title: 'Plan',
    purpose: 'Break objectives into ordered steps, dependencies, and milestones.',
    defaultRisk: 'low',
    providerKinds: ['intelligence', 'system'],
  },
  {
    key: 'create',
    title: 'Create',
    purpose: 'Generate content, files, code, designs, proposals, and artifacts.',
    defaultRisk: 'medium',
    providerKinds: ['intelligence', 'execution'],
  },
  {
    key: 'research',
    title: 'Research',
    purpose: 'Search, read, extract, compare, and summarize external or internal context.',
    defaultRisk: 'medium',
    providerKinds: ['intelligence', 'context', 'execution'],
  },
  {
    key: 'communicate',
    title: 'Communicate',
    purpose: 'Send, draft, publish, notify, schedule, and coordinate human-facing messages.',
    defaultRisk: 'high',
    providerKinds: ['execution'],
  },
  {
    key: 'operate',
    title: 'Operate',
    purpose: 'Control browsers, files, APIs, systems, software, and external tools.',
    defaultRisk: 'medium',
    providerKinds: ['execution'],
  },
  {
    key: 'transact',
    title: 'Transact',
    purpose: 'Handle purchases, payments, trading, orders, signatures, and commitments.',
    defaultRisk: 'high',
    providerKinds: ['execution'],
  },
  {
    key: 'coordinate',
    title: 'Coordinate',
    purpose: 'Assign owners, create tasks, request approvals, schedule, remind, and follow up.',
    defaultRisk: 'medium',
    providerKinds: ['system', 'execution'],
  },
  {
    key: 'monitor',
    title: 'Monitor',
    purpose: 'Watch metrics, risks, status, events, news, deadlines, and external signals.',
    defaultRisk: 'medium',
    providerKinds: ['context', 'execution', 'system'],
  },
  {
    key: 'record',
    title: 'Record',
    purpose: 'Write logs, proof, receipts, versions, evidence, audit trails, and summaries.',
    defaultRisk: 'low',
    providerKinds: ['storage', 'system'],
  },
  {
    key: 'remember',
    title: 'Remember',
    purpose: 'Preserve preferences, relationships, history, knowledge, patterns, and outcomes.',
    defaultRisk: 'low',
    providerKinds: ['storage'],
  },
  {
    key: 'integrate',
    title: 'Integrate',
    purpose: 'Connect databases, APIs, SaaS products, devices, connectors, and workflows.',
    defaultRisk: 'medium',
    providerKinds: ['execution', 'context'],
  },
  {
    key: 'govern',
    title: 'Govern',
    purpose: 'Apply permissions, risk controls, approval gates, policy, compliance, and safety.',
    defaultRisk: 'high',
    providerKinds: ['system'],
  },
  {
    key: 'learn',
    title: 'Learn',
    purpose: 'Update rules, strategies, memory, preferences, and future workflow choices.',
    defaultRisk: 'low',
    providerKinds: ['intelligence', 'storage'],
  },
];

export function listCapabilities() {
  return capabilityRegistry;
}

export function getCapability(key: CapabilityPrimitive) {
  return capabilityRegistry.find((capability) => capability.key === key) || null;
}
