import type {
  ClassifiedIntent,
  ConnectorDefinition,
  ExecutionPlan,
  IntentInput,
  MemoryGraphHit,
  PermissionDecision,
  PermissionScope,
  TheOneMode,
} from '../types';

function createPermissionId(scope: PermissionScope, resourceId: string) {
  return `perm_${scope}_${resourceId}`.replace(/[^a-zA-Z0-9_:-]/g, '_');
}

function statusFor(input: {
  mode: TheOneMode;
  risk: 'low' | 'medium' | 'high';
  provider: 'theone' | 'oneclaw';
  scope: PermissionScope;
  connectorStatus?: ConnectorDefinition['status'];
}): PermissionDecision['status'] {
  if (input.scope === 'read_context' || input.scope === 'read_memory') return 'allowed';
  if (input.connectorStatus === 'planned' && input.scope === 'submit_external') return 'requires_approval';
  if (input.mode === 'manual') {
    return 'requires_approval';
  }
  if (input.scope === 'admin') return 'requires_approval';
  if (input.scope === 'transact') return input.mode === 'auto' ? 'denied' : 'requires_approval';
  if (input.provider === 'oneclaw' && input.risk === 'high') return 'requires_approval';
  if (input.scope === 'send_message' || input.scope === 'write_file') return 'requires_approval';
  if (input.risk === 'high') return 'requires_approval';
  return 'allowed';
}

function reasonFor(input: {
  scope: PermissionScope;
  status: PermissionDecision['status'];
  mode: TheOneMode;
  risk: 'low' | 'medium' | 'high';
  provider: 'theone' | 'oneclaw';
}) {
  if (input.status === 'denied') {
    return `${input.scope} is denied in ${input.mode} mode for this risk profile.`;
  }

  if (input.status === 'requires_approval') {
    return `${input.scope} requires approval because it is ${input.risk} risk or uses ${input.provider}.`;
  }

  return `${input.scope} is allowed in ${input.mode} mode.`;
}

function decision(input: {
  scope: PermissionScope;
  resourceId: string;
  resourceKind: PermissionDecision['resourceKind'];
  provider: PermissionDecision['provider'];
  action?: string;
  risk: PermissionDecision['risk'];
  mode: TheOneMode;
  connectorStatus?: ConnectorDefinition['status'];
}): PermissionDecision {
  const status = statusFor({
    mode: input.mode,
    risk: input.risk,
    provider: input.provider === 'oneclaw' ? 'oneclaw' : 'theone',
    scope: input.scope,
    connectorStatus: input.connectorStatus,
  });

  return {
    id: createPermissionId(input.scope, input.resourceId),
    scope: input.scope,
    resourceId: input.resourceId,
    resourceKind: input.resourceKind,
    provider: input.provider,
    action: input.action,
    status,
    risk: input.risk,
    mode: input.mode,
    reason: reasonFor({
      scope: input.scope,
      status,
      mode: input.mode,
      risk: input.risk,
      provider: input.provider === 'oneclaw' ? 'oneclaw' : 'theone',
    }),
  };
}

export function evaluatePermissionPolicy(input: {
  mode: TheOneMode;
  intent: ClassifiedIntent;
  rawInput: IntentInput;
  plan: ExecutionPlan;
  memoryContext?: MemoryGraphHit[];
}): PermissionDecision[] {
  const decisions: PermissionDecision[] = [
    decision({
      scope: 'read_context',
      resourceId: `intent:${input.plan.id}`,
      resourceKind: 'intent',
      provider: 'theone',
      risk: input.plan.estimatedRisk,
      mode: input.mode,
    }),
    decision({
      scope: 'write_memory',
      resourceId: `memory:${input.plan.id}`,
      resourceKind: 'memory',
      provider: 'theone',
      risk: 'low',
      mode: input.mode,
    }),
  ];

  if (input.rawInput.userId) {
    decisions.push(decision({
      scope: 'read_context',
      resourceId: `user:${input.rawInput.userId}`,
      resourceKind: 'user',
      provider: 'theone',
      risk: 'low',
      mode: input.mode,
    }));
  }

  for (const memory of input.memoryContext || []) {
    decisions.push(decision({
      scope: 'read_memory',
      resourceId: `memory:${memory.id}`,
      resourceKind: 'memory',
      provider: 'theone',
      risk: 'low',
      mode: input.mode,
    }));
  }

  for (const connector of input.plan.capabilityRoute?.connectors || []) {
    for (const scope of connector.permissionScopes) {
      decisions.push(decision({
        scope,
        resourceId: `connector:${connector.key}`,
        resourceKind: 'connector',
        provider: connector.provider,
        action: connector.actions[0],
        risk: connector.riskProfile,
        mode: input.mode,
        connectorStatus: connector.status,
      }));
    }
  }

  for (const step of input.plan.steps) {
    if (step.action === 'oneclaw.execute') {
      decisions.push(decision({
        scope: 'submit_external',
        resourceId: `step:${step.id}`,
        resourceKind: 'external_action',
        provider: 'oneclaw',
        action: step.action,
        risk: 'high',
        mode: input.mode,
      }));
    }
  }

  return decisions;
}
