import type { CapabilityPrimitive, SkillDefinition, SkillIOSchema } from '../types';

const universalInputSchema: SkillIOSchema = {
  required: ['objective', 'intentType', 'capabilities', 'mode'],
  properties: {
    objective: 'string',
    intentType: 'string',
    capabilities: 'array',
    mode: 'string',
    stepInput: 'object',
  },
};

export const skillRegistry: SkillDefinition[] = [
  {
    key: 'objective_analysis',
    title: 'Objective Analysis',
    description: 'Understand the user objective, constraints, risk, and success criteria.',
    capabilities: ['think', 'plan', 'govern'],
    actions: ['oneai.generate'],
    providerNeeds: ['theone', 'oneai'],
    risk: 'low',
    proofType: 'system',
    memoryPolicy: 'summary',
    inputSchema: universalInputSchema,
    outputSchema: {
      required: ['oneAiMode'],
      properties: {
        oneAiMode: 'string',
      },
    },
  },
  {
    key: 'research_summary',
    title: 'Research Summary',
    description: 'Retrieve, compare, summarize, and store knowledge for later use.',
    capabilities: ['research', 'record', 'remember'],
    actions: ['oneai.generate', 'memory.store', 'network.update'],
    providerNeeds: ['oneai', 'theone'],
    risk: 'medium',
    proofType: 'execution',
    memoryPolicy: 'full',
    inputSchema: universalInputSchema,
    outputSchema: {
      required: ['oneAiMode'],
      properties: {
        oneAiMode: 'string',
        data: 'unknown',
      },
    },
  },
  {
    key: 'content_prepare',
    title: 'Content Preparation',
    description: 'Create usable drafts, narratives, posts, reports, and creative artifacts.',
    capabilities: ['create', 'think', 'record'],
    actions: ['oneai.generate', 'proof.write'],
    providerNeeds: ['oneai', 'theone'],
    risk: 'medium',
    proofType: 'system',
    memoryPolicy: 'summary',
    inputSchema: universalInputSchema,
    outputSchema: {
      required: ['oneAiMode'],
      properties: {
        oneAiMode: 'string',
        data: 'unknown',
      },
    },
  },
  {
    key: 'external_publish',
    title: 'External Publish',
    description: 'Prepare and submit external publishing or messaging tasks after approval.',
    capabilities: ['communicate', 'govern', 'record'],
    actions: ['oneai.generate', 'oneclaw.execute', 'proof.write'],
    providerNeeds: ['oneai', 'oneclaw', 'theone'],
    risk: 'high',
    proofType: 'social',
    memoryPolicy: 'full',
    inputSchema: universalInputSchema,
    outputSchema: {
      properties: {
        reply: 'string',
        oneclawTask: 'unknown',
      },
    },
  },
  {
    key: 'mission_orchestration',
    title: 'Mission Orchestration',
    description: 'Create tasks, missions, contribution loops, proof requirements, and rewards.',
    capabilities: ['plan', 'coordinate', 'communicate', 'record', 'learn'],
    actions: ['mission.create', 'proof.write', 'memory.store'],
    providerNeeds: ['theone'],
    risk: 'medium',
    proofType: 'mission',
    memoryPolicy: 'full',
    inputSchema: universalInputSchema,
    outputSchema: {
      required: ['missionDraft', 'capabilities'],
      properties: {
        missionDraft: 'boolean',
        capabilities: 'array',
      },
    },
  },
  {
    key: 'external_operation',
    title: 'External Operation',
    description: 'Operate browsers, files, APIs, and external systems through execution drivers.',
    capabilities: ['operate', 'integrate', 'govern', 'record'],
    actions: ['oneai.generate', 'oneclaw.execute', 'proof.write'],
    providerNeeds: ['oneai', 'oneclaw', 'theone'],
    risk: 'high',
    proofType: 'execution',
    memoryPolicy: 'full',
    inputSchema: universalInputSchema,
    outputSchema: {
      properties: {
        oneclawTask: 'unknown',
      },
    },
  },
  {
    key: 'transaction_guard',
    title: 'Transaction Guard',
    description: 'Analyze, gate, and prepare high-risk transactions without live execution by default.',
    capabilities: ['research', 'think', 'transact', 'monitor', 'govern', 'record'],
    actions: ['trading.scan', 'oneai.generate', 'oneclaw.execute', 'proof.write'],
    providerNeeds: ['oneai', 'oneclaw', 'theone'],
    risk: 'high',
    proofType: 'trade',
    memoryPolicy: 'full',
    inputSchema: universalInputSchema,
    outputSchema: {
      required: ['guard', 'oneAiMode'],
      properties: {
        guard: 'string',
        oneAiMode: 'string',
      },
    },
  },
  {
    key: 'status_monitor',
    title: 'Status Monitor',
    description: 'Track status, risks, external signals, and execution updates.',
    capabilities: ['monitor', 'record', 'learn'],
    actions: ['oneai.generate', 'memory.store', 'network.update'],
    providerNeeds: ['oneai', 'theone'],
    risk: 'medium',
    proofType: 'system',
    memoryPolicy: 'summary',
    inputSchema: universalInputSchema,
    outputSchema: {
      required: ['oneAiMode'],
      properties: {
        oneAiMode: 'string',
      },
    },
  },
];

export function listSkills() {
  return skillRegistry;
}

export function getSkill(key: string) {
  return skillRegistry.find((skill) => skill.key === key) || null;
}

export function findSkillsByCapabilities(capabilities: CapabilityPrimitive[]) {
  const desired = new Set(capabilities);

  function allowedByAnchor(skill: SkillDefinition) {
    if (skill.capabilities.includes('transact') && !desired.has('transact')) return false;
    if (skill.capabilities.includes('operate') && !desired.has('operate')) return false;
    if (skill.capabilities.includes('communicate') && !desired.has('communicate')) return false;
    if (skill.capabilities.includes('coordinate') && !desired.has('coordinate')) return false;
    return true;
  }

  return skillRegistry
    .map((skill) => ({
      skill,
      score: skill.capabilities.filter((capability) => desired.has(capability)).length,
      extra: skill.capabilities.filter((capability) => !desired.has(capability)).length,
    }))
    .filter((item) => item.score > 0 && allowedByAnchor(item.skill))
    .sort((a, b) => (b.score - b.extra * 0.35) - (a.score - a.extra * 0.35))
    .map((item) => item.skill);
}
