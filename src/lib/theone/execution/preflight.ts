import { getOneClawCapability } from './oneclaw-capabilities';
import { selectExecutionTemplate } from './templates';
import { getOneClawConfig } from '../providers/oneclaw';
import type {
  ClassifiedIntent,
  ExecutionPreflightCheck,
  ExecutionPreflightReport,
  OneClawCapabilityDefinition,
  OneClawTask,
  TheOneMode,
} from '../types';

function check(
  id: string,
  label: string,
  status: ExecutionPreflightCheck['status'],
  detail: string
): ExecutionPreflightCheck {
  return { id, label, status, detail };
}

function hasRequiredFields(input: Record<string, unknown>, required: string[]) {
  return required.every((field) => input[field] !== undefined && input[field] !== null && input[field] !== '');
}

export function preflightOneClawTask(input: {
  task: OneClawTask | null | undefined;
  intent: ClassifiedIntent;
  mode: TheOneMode;
  capabilities?: OneClawCapabilityDefinition[];
}): ExecutionPreflightReport {
  const template = selectExecutionTemplate(input.intent);
  const config = getOneClawConfig();
  const task = input.task;
  const actions = task?.steps.map((step) => step.action) || [];
  const checks: ExecutionPreflightCheck[] = [
    check(
      'oneclaw_token',
      'OneClaw credential',
      config.token ? 'pass' : 'warn',
      config.token ? 'OneClaw live token is present.' : 'No OneClaw token; execution will stay in mock mode.'
    ),
    check(
      'template_match',
      'Execution template',
      template ? 'pass' : 'warn',
      template ? `${template.title} matched this intent.` : 'No production template matched; use guarded generic execution.'
    ),
  ];

  if (!task) {
    return {
      ok: true,
      status: 'ready',
      templateKey: template?.key,
      actions,
      checks: [
        ...checks,
        check('task_present', 'OneClaw task', 'warn', 'No OneClaw task was produced for this run.'),
      ],
      deniedActions: [],
      approvalActions: [],
      unsupportedActions: [],
    };
  }

  checks.push(check('task_present', 'OneClaw task', 'pass', `${task.steps.length} executable step(s) prepared.`));

  const deniedActions: string[] = [];
  const approvalActions: string[] = [];
  const unsupportedActions: string[] = [];

  for (const step of task.steps) {
    const capability = input.capabilities?.find((item) => item.action === step.action) || getOneClawCapability(step.action);

    if (!capability) {
      unsupportedActions.push(step.action);
      checks.push(check(
        `capability_${step.id}`,
        step.action,
        'fail',
        'This action is not in TheOne production capability registry.'
      ));
      continue;
    }

    if (capability.maturity === 'stub') {
      deniedActions.push(step.action);
      checks.push(check(
        `capability_${step.id}`,
        step.action,
        'fail',
        `${capability.title} is marked stub and cannot run live.`
      ));
      continue;
    }

    if (capability.maturity === 'planned') {
      checks.push(check(
        `capability_${step.id}`,
        step.action,
        'warn',
        `${capability.title} is planned/record-only; verify downstream system integration.`
      ));
    } else {
      checks.push(check(
        `capability_${step.id}`,
        step.action,
        'pass',
        `${capability.title} is ${capability.maturity}.`
      ));
    }

    if (!hasRequiredFields(step.input || {}, capability.inputRequired)) {
      checks.push(check(
        `input_${step.id}`,
        `${step.action} input`,
        'fail',
        `Missing required input: ${capability.inputRequired.join(', ')}.`
      ));
      deniedActions.push(step.action);
    }

    if (capability.approvalRequired || input.mode === 'manual' || task.approvalMode === 'manual') {
      approvalActions.push(step.action);
    }
  }

  const hasFailures = checks.some((item) => item.status === 'fail');
  const needsApproval = approvalActions.length > 0;

  return {
    ok: !hasFailures,
    status: hasFailures ? 'blocked' : needsApproval ? 'needs_approval' : 'ready',
    templateKey: template?.key,
    taskName: task.taskName,
    actions,
    checks,
    deniedActions: Array.from(new Set(deniedActions)),
    approvalActions: Array.from(new Set(approvalActions)),
    unsupportedActions: Array.from(new Set(unsupportedActions)),
  };
}
