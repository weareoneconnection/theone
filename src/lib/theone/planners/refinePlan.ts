import { THEONE_CONFIG } from '../config';
import { listOneClawCapabilities } from '../execution/oneclaw-capabilities';
import { extractOneAIData, runOneAI } from '../providers/oneai';
import type { ClassifiedIntent, ExecutionPlan, PlanStep } from '../types';
import { validatePlan } from './validatePlan';

export type PlanRefinement = {
  plan: ExecutionPlan;
  refined: boolean;
  reason: string | null;
};

type ProposedStep = {
  id?: unknown;
  title?: unknown;
  action?: unknown;
  dependsOn?: unknown;
};

// Actions the LLM may use: every OneClaw registry action plus whatever the
// rule-based plan already contains (covers internal actions like oneai.generate).
function allowedActions(plan: ExecutionPlan): Set<string> {
  const allowed = new Set<string>(plan.steps.map((step) => step.action));
  for (const capability of listOneClawCapabilities()) {
    if (capability.maturity !== 'stub' && capability.liveMode !== 'disabled') {
      allowed.add(capability.action);
    }
  }
  return allowed;
}

function normalizeProposedSteps(raw: unknown, plan: ExecutionPlan): PlanStep[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > THEONE_CONFIG.maxSteps) return null;
  const allowed = allowedActions(plan);
  const existingById = new Map(plan.steps.map((step) => [step.id, step]));
  const steps: PlanStep[] = [];
  const ids = new Set<string>();

  for (let index = 0; index < raw.length; index += 1) {
    const proposed = raw[index] as ProposedStep;
    const action = typeof proposed.action === 'string' ? proposed.action.trim() : '';
    const title = typeof proposed.title === 'string' ? proposed.title.trim() : '';
    if (!action || !title || !allowed.has(action)) return null;

    const id = typeof proposed.id === 'string' && proposed.id.trim() ? proposed.id.trim() : `s${index + 1}`;
    if (ids.has(id)) return null;
    ids.add(id);

    const dependsOn = Array.isArray(proposed.dependsOn)
      ? proposed.dependsOn.filter((dep): dep is string => typeof dep === 'string')
      : undefined;

    const existing = existingById.get(id);
    steps.push({
      ...(existing && existing.action === action ? existing : {}),
      id,
      title,
      action,
      status: 'pending',
      ...(dependsOn && dependsOn.length > 0 ? { dependsOn } : {}),
    } as PlanStep);
  }

  // Every dependency must reference a step in the revised plan.
  for (const step of steps) {
    for (const dep of step.dependsOn || []) {
      if (!ids.has(dep)) return null;
    }
  }

  return steps;
}

export async function refinePlanWithLLM(input: {
  intent: ClassifiedIntent;
  plan: ExecutionPlan;
  learningHints?: string[];
}): Promise<PlanRefinement> {
  const original: PlanRefinement = { plan: input.plan, refined: false, reason: null };

  try {
    const result = await runOneAI<Record<string, unknown>>({
      type: 'plan_refinement',
      input: {
        systemPrompt: `You are the Planner of an AI operating system. Review the rule-generated execution plan below.
If the plan already fits the objective, return { "revise": false, "reason": string }.
If it can be improved (missing step, wrong order, unnecessary step), return
{ "revise": true, "reason": string, "steps": [{ "id": string, "title": string, "action": string, "dependsOn": string[] }] }.
Rules: only use actions from allowedActions; keep steps minimal; at most ${THEONE_CONFIG.maxSteps} steps. Respond with JSON only.`,
        objective: input.intent.objective,
        intentType: input.intent.type,
        currentSteps: input.plan.steps.map((step) => ({
          id: step.id,
          title: step.title,
          action: step.action,
          dependsOn: step.dependsOn || [],
        })),
        allowedActions: Array.from(allowedActions(input.plan)),
        learningHints: (input.learningHints || []).slice(0, 5),
        responseFormat: 'json',
      },
    });

    if (!result.success) return original;
    const data = extractOneAIData<Record<string, unknown>>(result);
    if (!data || data.revise !== true) return original;

    const steps = normalizeProposedSteps(data.steps, input.plan);
    if (!steps) return original;

    const revised = validatePlan({ ...input.plan, steps });
    return {
      plan: revised,
      refined: true,
      reason: typeof data.reason === 'string' ? data.reason.slice(0, 500) : null,
    };
  } catch {
    return original;
  }
}
