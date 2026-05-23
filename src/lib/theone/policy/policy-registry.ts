import { ensureTheOneDatabase, prisma } from '../db/prisma';

export type AutomationDecision = 'auto' | 'manual' | 'blocked';
export type PolicyRisk = 'low' | 'medium' | 'high';

export type AutomationPolicyRule = {
  id: string;
  domain: string;
  action: string;
  mode: string;
  risk: PolicyRisk;
  decision: AutomationDecision;
  enabled: boolean;
  reason: string;
  conditions?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
};

const defaultRules: AutomationPolicyRule[] = [
  {
    id: 'read_git_repo_get',
    domain: 'read',
    action: 'git.repo.get',
    mode: 'assist,auto',
    risk: 'low',
    decision: 'auto',
    enabled: true,
    reason: 'Read-only repository metadata can run automatically.',
  },
  {
    id: 'read_git_actions_runs',
    domain: 'read',
    action: 'git.actions.runs',
    mode: 'assist,auto',
    risk: 'low',
    decision: 'auto',
    enabled: true,
    reason: 'Read-only CI and workflow run lookups can run automatically.',
  },
  {
    id: 'x_strict_reply',
    domain: 'reply',
    action: 'social.post',
    mode: 'assist,auto',
    risk: 'medium',
    decision: 'auto',
    enabled: true,
    reason: 'Strict X replies may auto-run only with reply_only and strictReply safeguards.',
    conditions: { channel: 'x', mode: 'reply_only', strictReply: true },
  },
  {
    id: 'x_public_post',
    domain: 'publish',
    action: 'social.post',
    mode: 'manual,assist,auto',
    risk: 'high',
    decision: 'manual',
    enabled: true,
    reason: 'Public posts create external visible state and require approval.',
    conditions: { mode: 'post' },
  },
  {
    id: 'github_issue_create',
    domain: 'publish',
    action: 'git.issue.create',
    mode: 'manual,assist,auto',
    risk: 'high',
    decision: 'manual',
    enabled: true,
    reason: 'GitHub issue creation changes an external repository.',
  },
  {
    id: 'email_send',
    domain: 'communication',
    action: 'email.send',
    mode: 'manual,assist,auto',
    risk: 'high',
    decision: 'manual',
    enabled: true,
    reason: 'Email send is user-visible external communication.',
  },
  {
    id: 'critical_payment_shell_database',
    domain: 'critical',
    action: 'payment.*|shell.*|database.write|web3.write',
    mode: 'manual,assist,auto',
    risk: 'high',
    decision: 'blocked',
    enabled: true,
    reason: 'Money, shell, persistent database writes, and signing stay blocked by default.',
  },
];

function nowId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

function parseRule(row: any): AutomationPolicyRule {
  let rule: Record<string, unknown> = {};
  try {
    rule = JSON.parse(row.rulejson ?? row.ruleJson ?? '{}');
  } catch {
    rule = {};
  }

  return {
    id: row.id,
    domain: row.domain,
    action: row.action,
    mode: row.mode,
    risk: row.risk,
    decision: row.decision,
    enabled: Boolean(row.enabled),
    reason: row.reason,
    conditions: (rule.conditions && typeof rule.conditions === 'object') ? rule.conditions as Record<string, unknown> : undefined,
    createdAt: row.createdat?.toISOString?.() || row.createdAt?.toISOString?.() || row.createdat || row.createdAt,
    updatedAt: row.updatedat?.toISOString?.() || row.updatedAt?.toISOString?.() || row.updatedat || row.updatedAt,
  };
}

async function seedDefaultsIfEmpty() {
  const count = await prisma.$queryRawUnsafe<Array<{ count: bigint | number }>>('select count(*) as count from "TheOnePolicyRule"');
  if (Number(count[0]?.count || 0) > 0) return;

  for (const rule of defaultRules) {
    await upsertAutomationPolicyRule(rule);
  }
}

export async function listAutomationPolicyRules() {
  try {
    await ensureTheOneDatabase();
    await seedDefaultsIfEmpty();
    const rows = await prisma.$queryRawUnsafe<any[]>('select * from "TheOnePolicyRule" order by domain asc, action asc');
    return rows.map(parseRule);
  } catch (error) {
    console.warn('[theone] using default automation policy rules:', error instanceof Error ? error.message : 'database unavailable');
    return defaultRules;
  }
}

export async function upsertAutomationPolicyRule(rule: Partial<AutomationPolicyRule>) {
  await ensureTheOneDatabase();

  const record: AutomationPolicyRule = {
    id: String(rule.id || nowId('policy')),
    domain: String(rule.domain || 'custom').trim() || 'custom',
    action: String(rule.action || '').trim(),
    mode: String(rule.mode || 'assist,auto').trim() || 'assist,auto',
    risk: (rule.risk === 'low' || rule.risk === 'medium' || rule.risk === 'high') ? rule.risk : 'medium',
    decision: (rule.decision === 'auto' || rule.decision === 'manual' || rule.decision === 'blocked') ? rule.decision : 'manual',
    enabled: rule.enabled !== false,
    reason: String(rule.reason || 'Custom automation policy rule.').trim(),
    conditions: rule.conditions || {},
  };

  if (!record.action) throw new Error('Policy action is required.');

  await prisma.$executeRawUnsafe(
    `insert into "TheOnePolicyRule" (id, domain, action, mode, risk, decision, enabled, reason, ruleJson)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (id) do update set
       domain = excluded.domain,
       action = excluded.action,
       mode = excluded.mode,
       risk = excluded.risk,
       decision = excluded.decision,
       enabled = excluded.enabled,
       reason = excluded.reason,
       ruleJson = excluded.ruleJson,
       updatedAt = now()`,
    record.id,
    record.domain,
    record.action,
    record.mode,
    record.risk,
    record.decision,
    record.enabled,
    record.reason,
    safeJson({ conditions: record.conditions || {} })
  );

  return record;
}

export async function automationPolicySummary() {
  const rules = await listAutomationPolicyRules();
  return {
    total: rules.length,
    auto: rules.filter((rule) => rule.enabled && rule.decision === 'auto').length,
    manual: rules.filter((rule) => rule.enabled && rule.decision === 'manual').length,
    blocked: rules.filter((rule) => rule.enabled && rule.decision === 'blocked').length,
    rules,
  };
}
