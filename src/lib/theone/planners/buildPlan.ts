import { createPlanId } from '../runtime';
import { routeCapabilities } from '../capabilities/router';
import { selectExecutionTemplate } from '../execution/templates';
import type {
  CapabilityPrimitive,
  ClassifiedIntent,
  ExecutionPlan,
  PlanStep,
  PlanStepAction,
  SkillDefinition,
} from '../types';

function step(
  id: string,
  title: string,
  action: PlanStepAction,
  input?: Record<string, unknown>,
  requiresApproval = false,
  skill?: SkillDefinition,
  capability?: CapabilityPrimitive,
  dependsOn: string[] = []
): PlanStep {
  return {
    id,
    title,
    action,
    status: 'pending',
    input,
    requiresApproval,
    skillKey: skill?.key,
    capability,
    dependsOn,
    attempts: 0,
  };
}

function primaryCapability(skill: SkillDefinition) {
  return skill.capabilities[0];
}

function buildSkillStep(
  index: number,
  skill: SkillDefinition,
  intent: ClassifiedIntent,
  connectors: string[],
  dependsOn: string[]
): PlanStep {
  const action =
    skill.actions.find((candidate) => candidate === 'oneclaw.execute') ||
    skill.actions.find((candidate) => candidate === 'mission.create') ||
    skill.actions.find((candidate) => candidate === 'trading.scan') ||
    skill.actions.find((candidate) => candidate !== 'proof.write' && candidate !== 'memory.store') ||
    'custom';
  const requiresApproval = skill.risk === 'high' || action === 'oneclaw.execute';

  return step(
    `s${index}`,
    skill.title,
    action,
    {
      skillKey: skill.key,
      capabilities: skill.capabilities,
      objective: intent.objective,
      providerNeeds: skill.providerNeeds,
      connectors,
    },
    requiresApproval,
    skill,
    primaryCapability(skill),
    dependsOn
  );
}

export function buildPlan(intent: ClassifiedIntent): ExecutionPlan {
  const capabilityRoute = routeCapabilities(intent);
  const executionTemplate = selectExecutionTemplate(intent);
  const steps: PlanStep[] = [
    step(
      's1',
      'Analyze objective and route capabilities',
      'oneai.generate',
      {
        task: 'objective_analysis',
        objective: intent.objective,
        capabilities: capabilityRoute.capabilities,
        apps: capabilityRoute.apps.map((app) => app.key),
        connectors: capabilityRoute.connectors.map((connector) => connector.key),
        executionTemplate: executionTemplate?.key || null,
      },
      false,
      capabilityRoute.skills.find((skill) => skill.key === 'objective_analysis'),
      'think'
    ),
  ];

  const workflowSkills = capabilityRoute.skills.filter((skill) => skill.key !== 'objective_analysis');
  const connectorKeys = capabilityRoute.connectors.map((connector) => connector.key);
  for (const skill of workflowSkills.slice(0, 3)) {
    const nextStep = buildSkillStep(steps.length + 1, skill, intent, connectorKeys, ['s1']);
    steps.push({
      ...nextStep,
      input: {
        ...(nextStep.input || {}),
        executionTemplate: executionTemplate?.key || null,
      },
    });
  }

  if (!steps.some((item) => item.action === 'memory.store')) {
    const memoryDependsOn = steps.map((item) => item.id);
    steps.push(step(`s${steps.length + 1}`, 'Store memory', 'memory.store', {
      capabilities: capabilityRoute.capabilities,
      skills: capabilityRoute.skills.map((skill) => skill.key),
      connectors: capabilityRoute.connectors.map((connector) => connector.key),
    }, false, undefined, 'remember', memoryDependsOn));
  }

  const proofDependsOn = [steps[steps.length - 1]?.id].filter(Boolean);
  steps.push(step(`s${steps.length + 1}`, 'Record proof', 'proof.write', {
    capabilities: capabilityRoute.capabilities,
    apps: capabilityRoute.apps.map((app) => app.key),
    connectors: capabilityRoute.connectors.map((connector) => connector.key),
  }, false, undefined, 'record', proofDependsOn));

  return {
    id: createPlanId(),
    intent,
    summary: capabilityRoute.summary,
    steps,
    estimatedRisk: capabilityRoute.risk,
    estimatedValue: capabilityRoute.capabilities.join(', '),
    capabilityRoute,
  };
}
