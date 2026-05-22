import { getActionRisk } from './approval-policy';
import { listAutomationPolicyRules } from './policy-registry';
import type {
  ExecutionPreflightReport,
  OneClawCapabilityDefinition,
  OneClawConnectorReadiness,
  OneClawTask,
  TheOneMode,
} from '../types';

export type AutomationPolicyEvaluation = {
  decision: 'auto' | 'manual' | 'blocked';
  approvalMode: 'auto' | 'manual';
  canAutoRun: boolean;
  requiresHumanApproval: boolean;
  blocked: boolean;
  risk: 'low' | 'medium' | 'high';
  reasons: string[];
  actions: string[];
  matchedRules: Array<{
    id: string;
    action: string;
    decision: 'auto' | 'manual' | 'blocked';
  }>;
  connectorPermissions: Array<{
    action: string;
    connectorKey?: string;
    connectorStatus?: string;
    liveMode?: string;
    maturity?: string;
    approvalRequired?: boolean;
  }>;
};

const riskRank = { low: 1, medium: 2, high: 3 };

function actionMatches(pattern: string, action: string) {
  return pattern
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .some((part) => {
      if (part === action || part === '*') return true;
      if (part.endsWith('.*')) return action.startsWith(part.slice(0, -1));
      return false;
    });
}

function modeMatches(pattern: string, mode: TheOneMode) {
  return pattern
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .includes(mode);
}

function conditionsMatch(conditions: Record<string, unknown> | undefined, input: Record<string, unknown>) {
  if (!conditions || Object.keys(conditions).length === 0) return true;
  return Object.entries(conditions).every(([key, value]) => input[key] === value);
}

function mergeRisk(current: 'low' | 'medium' | 'high', next: 'low' | 'medium' | 'high') {
  return riskRank[next] > riskRank[current] ? next : current;
}

function escalate(current: AutomationPolicyEvaluation['decision'], next: AutomationPolicyEvaluation['decision']) {
  if (current === 'blocked' || next === 'blocked') return 'blocked';
  if (current === 'manual' || next === 'manual') return 'manual';
  return 'auto';
}

export async function evaluateAutomationPolicy(input: {
  task: OneClawTask | null | undefined;
  mode: TheOneMode;
  preflight: ExecutionPreflightReport;
  capabilities?: OneClawCapabilityDefinition[];
  connectors?: OneClawConnectorReadiness[];
  canSubmitExternalTasks: boolean;
}): Promise<AutomationPolicyEvaluation> {
  const task = input.task;
  const rules = await listAutomationPolicyRules();
  const actions = task?.steps.map((step) => step.action) || [];
  const reasons: string[] = [];
  const matchedRules: AutomationPolicyEvaluation['matchedRules'] = [];
  const connectorPermissions: AutomationPolicyEvaluation['connectorPermissions'] = [];
  let decision: AutomationPolicyEvaluation['decision'] = 'auto';
  let risk: AutomationPolicyEvaluation['risk'] = 'low';

  if (!task || actions.length === 0) {
    return {
      decision: 'auto',
      approvalMode: 'auto',
      canAutoRun: false,
      requiresHumanApproval: false,
      blocked: false,
      risk: 'low',
      reasons: ['No executable OneClaw task was produced.'],
      actions: [],
      matchedRules: [],
      connectorPermissions: [],
    };
  }

  if (input.preflight.status === 'blocked') {
    decision = 'blocked';
    reasons.push('Production preflight blocked this task.');
  } else if (input.preflight.status === 'needs_approval') {
    decision = 'manual';
    reasons.push('Production preflight requires approval.');
  }

  for (const step of task.steps) {
    const capability = input.capabilities?.find((item) => item.action === step.action);
    const connector = capability?.connectorKey
      ? input.connectors?.find((item) => item.key === capability.connectorKey)
      : undefined;
    const actionRisk = capability?.risk || getActionRisk(step.action);
    risk = mergeRisk(risk, actionRisk);

    connectorPermissions.push({
      action: step.action,
      connectorKey: capability?.connectorKey,
      connectorStatus: connector?.status,
      liveMode: capability?.liveMode,
      maturity: capability?.maturity,
      approvalRequired: capability?.approvalRequired,
    });

    if (!capability) {
      decision = escalate(decision, 'manual');
      reasons.push(`${step.action} is not in the live OneClaw manifest; keep it approval-gated.`);
    } else if (capability.liveMode === 'disabled' || capability.maturity === 'stub') {
      decision = escalate(decision, 'blocked');
      reasons.push(`${step.action} is disabled or stubbed in OneClaw.`);
    } else if (capability.approvalRequired || capability.risk === 'high') {
      decision = escalate(decision, 'manual');
      reasons.push(`${step.action} is ${capability.risk} risk and requires governance.`);
    }

    for (const rule of rules) {
      if (!rule.enabled) continue;
      if (!actionMatches(rule.action, step.action)) continue;
      if (!modeMatches(rule.mode, input.mode)) continue;
      if (!conditionsMatch(rule.conditions, step.input || {})) continue;

      matchedRules.push({ id: rule.id, action: rule.action, decision: rule.decision });
      decision = escalate(decision, rule.decision);
      risk = mergeRisk(risk, rule.risk);
      reasons.push(rule.reason);
    }
  }

  if (input.mode === 'manual') {
    decision = escalate(decision, 'manual');
    reasons.push('Manual mode keeps external execution behind approval.');
  }

  const blocked = decision === 'blocked';
  const requiresHumanApproval = decision === 'manual';
  const canAutoRun = decision === 'auto' &&
    input.preflight.status === 'ready' &&
    input.canSubmitExternalTasks;

  if (decision === 'auto' && !canAutoRun) {
    reasons.push('Auto policy matched, but runtime preflight or permission context is not ready.');
  }

  return {
    decision,
    approvalMode: decision === 'auto' ? 'auto' : 'manual',
    canAutoRun,
    requiresHumanApproval,
    blocked,
    risk,
    reasons: Array.from(new Set(reasons)).slice(0, 10),
    actions,
    matchedRules,
    connectorPermissions,
  };
}

export function attachAutomationPolicyToTask(
  task: OneClawTask | null | undefined,
  policy: AutomationPolicyEvaluation
): OneClawTask | null {
  if (!task) return null;
  return {
    ...task,
    approvalMode: policy.approvalMode,
    metadata: {
      ...(task.metadata || {}),
      theoneTask: {
        ...(typeof task.metadata?.theoneTask === 'object' && task.metadata?.theoneTask ? task.metadata.theoneTask : {}),
        automationPolicy: policy,
        risk: {
          level: policy.risk,
          reasons: policy.reasons,
        },
      },
    },
  };
}
