import type {
  ApprovalGate,
  ClassifiedIntent,
  ContextBusFrame,
  ContextResource,
  ExecutionPlan,
  ExecutionRecord,
  IntentInput,
  MemoryGraphHit,
  PermissionDecision,
  TheOneMode,
} from '../types';

function resourceRisk(value?: 'low' | 'medium' | 'high') {
  return value || 'low';
}

function permissionSummary(permissions: PermissionDecision[] = []) {
  return {
    allowed: permissions.filter((decision) => decision.status === 'allowed').length,
    requiresApproval: permissions.filter((decision) => decision.status === 'requires_approval').length,
    denied: permissions.filter((decision) => decision.status === 'denied').length,
  };
}

function uniqueResources(resources: ContextResource[]) {
  const seen = new Set<string>();
  return resources.filter((resource) => {
    const key = `${resource.kind}:${resource.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createContextBusFrame(input: {
  runId: string;
  mode: TheOneMode;
  intent: ClassifiedIntent;
  input?: IntentInput;
  plan: ExecutionPlan;
  memoryContext?: MemoryGraphHit[];
  approvals?: ApprovalGate[];
  executions?: ExecutionRecord[];
  permissions?: PermissionDecision[];
}): ContextBusFrame {
  const route = input.plan.capabilityRoute;
  const memoryContext = input.memoryContext || input.plan.memoryContext || [];
  const approvals = input.approvals || [];
  const executions = input.executions || [];
  const permissions = input.permissions || [];

  const resources: ContextResource[] = [
    {
      id: `intent:${input.runId}`,
      kind: 'intent',
      title: input.intent.objective,
      source: 'user',
      risk: input.plan.estimatedRisk,
      metadata: {
        intentType: input.intent.type,
        priority: input.intent.priority,
        confidence: input.intent.confidence,
      },
    },
  ];

  if (input.input?.userId) {
    resources.push({
      id: `user:${input.input.userId}`,
      kind: 'user',
      title: input.input.userId,
      source: 'user',
      risk: 'low',
    });
  }

  if (input.input?.sessionId) {
    resources.push({
      id: `session:${input.input.sessionId}`,
      kind: 'session',
      title: input.input.sessionId,
      source: 'user',
      risk: 'low',
    });
  }

  route?.capabilities.forEach((capability) => {
    resources.push({
      id: `capability:${capability}`,
      kind: 'capability',
      title: capability,
      source: 'theone',
      risk: 'low',
      capabilities: [capability],
    });
  });

  route?.skills.forEach((skill) => {
    resources.push({
      id: `skill:${skill.key}`,
      kind: 'skill',
      title: skill.title,
      source: 'theone',
      risk: skill.risk,
      capabilities: skill.capabilities,
      metadata: {
        providerNeeds: skill.providerNeeds,
        actions: skill.actions,
      },
    });
  });

  route?.apps.forEach((app) => {
    resources.push({
      id: `app:${app.key}`,
      kind: 'app',
      title: app.title,
      source: 'theone',
      risk: app.riskProfile,
      capabilities: app.capabilities,
      metadata: {
        domain: app.domain,
        requiredProviders: app.requiredProviders,
      },
    });
  });

  route?.connectors.forEach((connector) => {
    resources.push({
      id: `connector:${connector.key}`,
      kind: 'connector',
      title: connector.title,
      source: connector.provider,
      risk: connector.riskProfile,
      capabilities: connector.capabilities,
      provider: connector.provider,
      connectorKey: connector.key,
      metadata: {
        kind: connector.kind,
        actions: connector.actions,
        permissionScopes: connector.permissionScopes,
        status: connector.status,
      },
    });
  });

  memoryContext.forEach((memory) => {
    resources.push({
      id: `memory:${memory.id}`,
      kind: 'memory',
      title: memory.title,
      source: 'theone',
      risk: 'low',
      metadata: {
        kind: memory.kind,
        score: memory.score,
        matchedTerms: memory.matchedTerms,
        runId: memory.runId,
      },
    });
  });

  approvals.forEach((approval) => {
    resources.push({
      id: `approval:${approval.id}`,
      kind: 'approval',
      title: approval.action,
      source: 'theone',
      risk: approval.risk,
      metadata: approval,
    });
  });

  executions.forEach((execution) => {
    resources.push({
      id: `execution:${execution.id}`,
      kind: 'execution',
      title: execution.summary,
      source: execution.provider,
      provider: execution.provider,
      risk: resourceRisk(execution.provider === 'oneclaw' ? 'medium' : 'low'),
      metadata: {
        status: execution.status,
        taskName: execution.taskName,
        externalId: execution.externalId,
        receipt: execution.receipt,
      },
    });
  });

  const unique = uniqueResources(resources);

  return {
    id: `context_${input.runId}`,
    runId: input.runId,
    mode: input.mode,
    objective: input.intent.objective,
    createdAt: new Date().toISOString(),
    resources: unique,
    summary: {
      resourceCount: unique.length,
      connectorCount: route?.connectors.length || 0,
      memoryHitCount: memoryContext.length,
      approvalCount: approvals.length,
      executionCount: executions.length,
      permissionSummary: permissionSummary(permissions),
    },
  };
}
