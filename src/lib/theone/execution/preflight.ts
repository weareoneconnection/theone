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

function isReadOnlyAutoAction(action: string, stepInput: Record<string, unknown>) {
  const method = String(stepInput.method || 'GET').toUpperCase();

  if (action === 'api.request') return method === 'GET';
  if ([
    'browser.open',
    'browser.extract',
    'browser.scrape',
    'browser.screenshot',
    'git.repo.get',
    'git.actions.runs',
    'git.checks.list',
    'git.ci.status',
    'git.repo.search',
    'x.getTweet',
    'x.getTweets',
    'x.getUserByUsername',
    'x.getUserTweets',
    'x.getUserTweetsByUsername',
    'x.searchRecentTweets',
    'file.read',
    'file.list',
    'file.exists',
    'database.query',
    'database.schema.inspect',
    'knowledge.query',
    'vector.query',
    'storage.get',
    'storage.signUrl',
    'web3.balance',
    'web3.tx',
    'web3.contract.read',
    'chain.query',
    'secret.check',
  ].includes(action)) return true;

  return (
    action.endsWith('.get') ||
    action.endsWith('.list') ||
    action.endsWith('.search') ||
    action.endsWith('.query') ||
    action.includes('.read') ||
    action.includes('.inspect')
  );
}

function sandboxBoundaryForAction(action: string): ExecutionPreflightCheck {
  if (action.startsWith('desktop.')) {
    return check(
      `sandbox_${action}`,
      `${action} sandbox`,
      'warn',
      'Desktop control must run through a local bridge, app allowlist, and operator approval boundary.'
    );
  }

  if (['file.write', 'file.append', 'file.delete'].includes(action)) {
    return check(
      `sandbox_${action}`,
      `${action} sandbox`,
      'warn',
      'Filesystem writes require scoped paths, approval, and rollback or receipt evidence.'
    );
  }

  if (action === 'social.post') {
    return check(
      `sandbox_${action}`,
      `${action} sandbox`,
      'warn',
      'Public communication requires approval, account limits, duplicate checks, and rate-limit guardrails.'
    );
  }

  if (action.startsWith('api.') || action.startsWith('browser.')) {
    return check(
      `sandbox_${action}`,
      `${action} sandbox`,
      'pass',
      'Network execution is constrained by host allowlists, timeout policy, and proof receipts.'
    );
  }

  if (action.startsWith('git.') || action.startsWith('x.')) {
    return check(
      `sandbox_${action}`,
      `${action} sandbox`,
      'pass',
      'External connector read/write boundaries are covered by scoped credentials and action-level policy.'
    );
  }

  if (action.startsWith('shell.') || action.startsWith('payment.') || action.startsWith('web3.')) {
    return check(
      `sandbox_${action}`,
      `${action} sandbox`,
      'warn',
      'Critical actions require explicit approval and should remain disabled or prepared until a policy pack allows them.'
    );
  }

  return check(
    `sandbox_${action}`,
    `${action} sandbox`,
    'pass',
    'Action runs inside the default TheOne sandbox boundary.'
  );
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
      const missingFields = capability.inputRequired
        .filter((field) => !hasRequiredFields(step.input || {}, [field]));
      checks.push(check(
        `input_${step.id}`,
        `${step.action} input`,
        'fail',
        `Missing required input: ${missingFields.join(', ')}. TheOne task contract must map generated output into ${step.action}.input.`
      ));
      deniedActions.push(step.action);
    }

    const readOnlyAuto = isReadOnlyAutoAction(step.action, step.input || {});
    const manualModeRequiresApproval = input.mode === 'manual' && !readOnlyAuto;
    const taskRequiresApproval = task.approvalMode === 'manual' && !readOnlyAuto;

    if (capability.approvalRequired || manualModeRequiresApproval || taskRequiresApproval) {
      approvalActions.push(step.action);
    }

    checks.push(sandboxBoundaryForAction(step.action));
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
