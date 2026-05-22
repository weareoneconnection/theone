export type TheOneMode = 'manual' | 'assist' | 'auto';

export type TheOneRuntimeStatus =
  | 'online'
  | 'ready'
  | 'mock'
  | 'running'
  | 'blocked'
  | 'degraded'
  | 'offline';

export type TheOneIntentType =
  | 'financial'
  | 'growth'
  | 'mission'
  | 'knowledge'
  | 'automation'
  | 'general';

export type TheOnePriority = 'low' | 'normal' | 'high' | 'critical';

export type IntentInput = {
  raw: string;
  userId?: string;
  sessionId?: string;
  language?: string;
  mode?: TheOneMode;
};

export type TheOneLayerKey =
  | 'shell'
  | 'intent_kernel'
  | 'context_layer'
  | 'planner'
  | 'workflow_runtime'
  | 'policy'
  | 'execution_driver'
  | 'proof_ledger'
  | 'memory_graph'
  | 'app_layer';

export type TheOneLayer = {
  key: TheOneLayerKey;
  title: string;
  role: string;
  status: TheOneRuntimeStatus;
  detail: string;
};

export type ProviderCapability = {
  name: string;
  kind: 'intelligence' | 'execution' | 'storage' | 'context' | 'system';
  risk: 'low' | 'medium' | 'high';
};

export type ProviderStatus = {
  key: 'oneai' | 'oneclaw' | 'theone';
  label: string;
  role: string;
  configured: boolean;
  mode: 'live' | 'mock';
  baseUrl?: string;
  status: TheOneRuntimeStatus;
  capabilities: ProviderCapability[];
  warnings?: string[];
};

export type ProviderConnectionCheck = {
  key: 'oneai' | 'oneclaw';
  label: string;
  configured: boolean;
  mode: 'live' | 'mock';
  ok: boolean;
  status: 'connected' | 'not_configured' | 'unreachable' | 'error';
  baseUrl: string;
  endpoint: string;
  latencyMs?: number;
  checkedAt: string;
  message: string;
  statusCode?: number;
};

export type CapabilityPrimitive =
  | 'think'
  | 'plan'
  | 'create'
  | 'research'
  | 'communicate'
  | 'operate'
  | 'transact'
  | 'coordinate'
  | 'monitor'
  | 'record'
  | 'remember'
  | 'integrate'
  | 'govern'
  | 'learn';

export type CapabilityDefinition = {
  key: CapabilityPrimitive;
  title: string;
  purpose: string;
  defaultRisk: 'low' | 'medium' | 'high';
  providerKinds: Array<ProviderCapability['kind']>;
};

export type SkillIOSchema = {
  required?: string[];
  properties?: Record<string, 'string' | 'number' | 'boolean' | 'array' | 'object' | 'unknown'>;
};

export type SkillDefinition = {
  key: string;
  title: string;
  description: string;
  capabilities: CapabilityPrimitive[];
  actions: PlanStepAction[];
  providerNeeds: Array<'theone' | 'oneai' | 'oneclaw'>;
  risk: 'low' | 'medium' | 'high';
  proofType: ProofRecord['type'];
  memoryPolicy: 'none' | 'summary' | 'full';
  inputSchema?: SkillIOSchema;
  outputSchema?: SkillIOSchema;
};

export type AppBundleDefinition = {
  key: string;
  title: string;
  domain: string;
  status: 'core' | 'installed' | 'planned';
  description: string;
  capabilities: CapabilityPrimitive[];
  skills: string[];
  requiredProviders: Array<'theone' | 'oneai' | 'oneclaw'>;
  riskProfile: 'low' | 'medium' | 'high';
};

export type ConnectorKind =
  | 'browser'
  | 'files'
  | 'communication'
  | 'knowledge'
  | 'commerce'
  | 'finance'
  | 'productivity'
  | 'operations'
  | 'identity'
  | 'custom';

export type ConnectorDefinition = {
  key: string;
  title: string;
  kind: ConnectorKind;
  status: 'available' | 'planned';
  description: string;
  capabilities: CapabilityPrimitive[];
  provider: 'theone' | 'oneclaw';
  actions: string[];
  permissionScopes: PermissionScope[];
  riskProfile: 'low' | 'medium' | 'high';
};

export type CapabilityRoute = {
  intentType: TheOneIntentType;
  objective: string;
  capabilities: CapabilityPrimitive[];
  skills: SkillDefinition[];
  apps: AppBundleDefinition[];
  connectors: ConnectorDefinition[];
  risk: 'low' | 'medium' | 'high';
  summary: string;
};

export type ClassifiedIntent = {
  type: TheOneIntentType;
  objective: string;
  entities: string[];
  constraints: string[];
  priority: TheOnePriority;
  confidence: number;
  requiresApproval: boolean;
};

export type PlanStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'skipped';

export type PlanStepAction =
  | 'oneai.generate'
  | 'oneclaw.execute'
  | 'trading.scan'
  | 'trading.place'
  | 'social.post'
  | 'social.reply'
  | 'browser.open'
  | 'browser.extract'
  | 'mission.create'
  | 'mission.record'
  | 'proof.write'
  | 'memory.store'
  | 'network.update'
  | 'custom';

export type PlanStep = {
  id: string;
  title: string;
  action: PlanStepAction;
  status: PlanStepStatus;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  requiresApproval?: boolean;
  skillKey?: string;
  capability?: CapabilityPrimitive;
  dependsOn?: string[];
  attempts?: number;
};

export type ExecutionPlan = {
  id: string;
  intent: ClassifiedIntent;
  summary: string;
  steps: PlanStep[];
  estimatedRisk: 'low' | 'medium' | 'high';
  estimatedValue?: string;
  capabilityRoute?: CapabilityRoute;
  memoryContext?: MemoryGraphHit[];
};

export type ContextResourceKind =
  | 'intent'
  | 'user'
  | 'session'
  | 'capability'
  | 'skill'
  | 'app'
  | 'connector'
  | 'memory'
  | 'approval'
  | 'execution'
  | 'provider'
  | 'external_action';

export type ContextResource = {
  id: string;
  kind: ContextResourceKind;
  title: string;
  source: 'user' | 'theone' | 'oneai' | 'oneclaw';
  risk: 'low' | 'medium' | 'high';
  capabilities?: CapabilityPrimitive[];
  provider?: 'theone' | 'oneai' | 'oneclaw';
  connectorKey?: string;
  metadata?: Record<string, unknown>;
};

export type PermissionScope =
  | 'read_context'
  | 'read_memory'
  | 'write_memory'
  | 'use_connector'
  | 'submit_external'
  | 'operate_browser'
  | 'read_file'
  | 'write_file'
  | 'send_message'
  | 'transact'
  | 'admin';

export type PermissionDecision = {
  id: string;
  scope: PermissionScope;
  resourceId: string;
  resourceKind: ContextResourceKind;
  provider: 'theone' | 'oneai' | 'oneclaw';
  action?: string;
  status: 'allowed' | 'requires_approval' | 'denied';
  risk: 'low' | 'medium' | 'high';
  mode: TheOneMode;
  reason: string;
};

export type ContextBusFrame = {
  id: string;
  runId: string;
  mode: TheOneMode;
  objective: string;
  createdAt: string;
  resources: ContextResource[];
  summary: {
    resourceCount: number;
    connectorCount: number;
    memoryHitCount: number;
    approvalCount: number;
    executionCount: number;
    permissionSummary: {
      allowed: number;
      requiresApproval: number;
      denied: number;
    };
  };
};

export type OneAIGeneratePayload = {
  type: string;
  input: unknown;
  options?: Record<string, unknown>;
};

export type OneAIGenerateResult<TData = unknown> = {
  success: boolean;
  attempts?: number;
  usage?: unknown | null;
  usageTotal?: unknown | null;
  data: TData | null;
  error?: string | null;
  mock?: boolean;
  raw?: unknown;
};

export type OneClawStep = {
  id: string;
  action: string;
  input: Record<string, unknown>;
  dependsOn?: string[];
};

export type OneClawTask = {
  taskName: string;
  approvalMode?: 'auto' | 'manual';
  steps: OneClawStep[];
  metadata?: Record<string, unknown>;
};

export type OneClawTaskRun = {
  id?: string | null;
  status: string;
  taskName?: string;
  raw?: unknown;
  mock?: boolean;
};

export type OneClawCapabilityMaturity = 'production' | 'guarded' | 'prepared' | 'planned' | 'stub';

export type OneClawCapabilityDefinition = {
  action: string;
  title: string;
  domain: string;
  capabilities: CapabilityPrimitive[];
  connectorKey?: string;
  maturity: OneClawCapabilityMaturity;
  liveMode?: 'live' | 'dry_run' | 'prepared' | 'disabled';
  risk: 'low' | 'medium' | 'high';
  approvalRequired: boolean;
  supportsDryRun: boolean;
  supportsRollback: boolean;
  inputRequired: string[];
  outputContract: string[];
  productionNote: string;
};

export type OneClawConnectorReadiness = {
  key: string;
  title: string;
  domain: string;
  status: 'connected' | 'configured' | 'dry_run' | 'prepared' | 'not_configured' | 'disabled';
  mode: 'live' | 'dry_run' | 'prepared' | 'disabled';
  requiredEnv: string[];
  configuredEnv: string[];
  actions: string[];
  note: string;
};

export type OneClawCapabilityManifest = {
  ok: boolean;
  service: string;
  version: string;
  maturity?: Record<string, number>;
  capabilities: OneClawCapabilityDefinition[];
  connectors?: OneClawConnectorReadiness[];
  plugins?: unknown[];
  source: 'live' | 'fallback';
  fetchedAt: string;
  error?: string;
};

export type OneClawApprovalRecord = {
  id: string;
  taskId: string;
  stepId: string;
  action: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  input?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionNote?: string;
};

export type ExecutionTemplateDefinition = {
  key: string;
  title: string;
  intentHints: string[];
  capabilities: CapabilityPrimitive[];
  actions: string[];
  defaultApprovalMode: 'auto' | 'manual';
  risk: 'low' | 'medium' | 'high';
  status: 'ready' | 'guarded' | 'planned';
};

export type ExecutionPreflightCheck = {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
};

export type ExecutionPreflightReport = {
  ok: boolean;
  status: 'ready' | 'needs_approval' | 'blocked';
  templateKey?: string;
  taskName?: string;
  actions: string[];
  checks: ExecutionPreflightCheck[];
  deniedActions: string[];
  approvalActions: string[];
  unsupportedActions: string[];
};

export type ApprovalGate = {
  id: string;
  stepId: string;
  action: string;
  risk: 'low' | 'medium' | 'high';
  required: boolean;
  status: 'not_required' | 'pending' | 'approved' | 'rejected';
  mode: TheOneMode;
  reason: string;
};

export type ProviderReceipt = {
  id: string;
  provider: 'oneai' | 'oneclaw' | 'theone';
  operation: string;
  status: 'planned' | 'success' | 'failed' | 'submitted' | 'running' | 'blocked' | 'mock' | 'rejected';
  externalId?: string | null;
  mock?: boolean;
  latencyMs?: number;
  timestamp: string;
  raw?: unknown;
};

export type ExecutionRecord = {
  id: string;
  provider: 'oneai' | 'oneclaw' | 'theone';
  status: 'planned' | 'submitted' | 'running' | 'success' | 'blocked' | 'failed' | 'mock' | 'rejected';
  summary: string;
  externalId?: string | null;
  taskName?: string;
  raw?: unknown;
  receipt?: ProviderReceipt;
};

export type WorkflowTraceStep = {
  id: string;
  title: string;
  action: string;
  status: PlanStepStatus;
  provider: 'theone' | 'oneai' | 'oneclaw';
  risk: 'low' | 'medium' | 'high';
  approvalStatus: ApprovalGate['status'];
  skillKey?: string;
  capability?: CapabilityPrimitive;
  dependsOn?: string[];
};

export type WorkflowTrace = {
  id: string;
  runId: string;
  mode: TheOneMode;
  status: 'idle' | 'running' | 'completed' | 'blocked' | 'failed';
  summary: string;
  steps: WorkflowTraceStep[];
};

export type TheOneAppSurface = {
  key: string;
  title: string;
  domain: string;
  status: 'core' | 'installed' | 'planned';
};

export type TheOneOsState = {
  name: 'TheOne';
  version: string;
  mode: TheOneMode;
  architecture: 'Universal AI OS';
  principle: string;
  layers: TheOneLayer[];
  providers: ProviderStatus[];
  workflow: WorkflowTrace;
  approvals: ApprovalGate[];
  executions: ExecutionRecord[];
  apps: TheOneAppSurface[];
  capabilities: CapabilityDefinition[];
  skills: SkillDefinition[];
  appBundles: AppBundleDefinition[];
  connectors: ConnectorDefinition[];
  contextFrame?: ContextBusFrame;
  permissions?: PermissionDecision[];
  oneClawCapabilities?: OneClawCapabilityDefinition[];
  oneClawConnectors?: OneClawConnectorReadiness[];
  oneClawManifest?: OneClawCapabilityManifest | null;
  executionTemplates?: ExecutionTemplateDefinition[];
  preflight?: ExecutionPreflightReport | null;
};

export type MemoryGraphHit = {
  id: string;
  runId?: string | null;
  kind: string;
  title: string;
  summary: string;
  score: number;
  matchedTerms: string[];
  createdAt: string;
  run?: {
    id: string;
    intentType: string;
    objective: string;
  } | null;
};

export type AgentRuntimeContext = {
  runId: string;
  mode: TheOneMode;
  providerStatus: ProviderStatus[];
  approvalGates: ApprovalGate[];
  canSubmitExternalTasks: boolean;
  capabilityRoute?: CapabilityRoute;
  memoryContext?: MemoryGraphHit[];
  contextFrame?: ContextBusFrame;
  permissions?: PermissionDecision[];
  preflight?: ExecutionPreflightReport | null;
  oneClawManifest?: OneClawCapabilityManifest | null;
};

export type ProofRecord = {
  type: 'execution' | 'mission' | 'reward' | 'trade' | 'social' | 'system';
  title: string;
  value?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
};

export type TheOneEvent =
  | { type: 'intent.classified'; payload: ClassifiedIntent }
  | { type: 'plan.created'; payload: ExecutionPlan }
  | {
      type: 'step.updated';
      payload: { stepId: string; status: PlanStepStatus; message?: string };
    }
  | { type: 'proof.recorded'; payload: ProofRecord }
  | { type: 'run.completed'; payload: { runId: string; ok: boolean } };

export type AgentExecutionResult = {
  ok: boolean;
  agent: string;
  summary: string;
  data?: Record<string, unknown>;
  updatedSteps?: PlanStep[];
  proof?: ProofRecord[];
  approvals?: ApprovalGate[];
  executions?: ExecutionRecord[];
  oneclawTask?: OneClawTask | null;
};

export type TheOneRunResult = {
  ok: boolean;
  runId: string;
  intent: ClassifiedIntent;
  plan: ExecutionPlan;
  execution: {
    completedSteps: number;
    failedSteps: number;
    agentResults: AgentExecutionResult[];
  };
  proof: ProofRecord[];
  networkSignals?: Record<string, unknown>;
  approvals?: ApprovalGate[];
  executions?: ExecutionRecord[];
  pendingOneClawTask?: OneClawTask | null;
  memoryContext?: MemoryGraphHit[];
  contextFrame?: ContextBusFrame;
  permissions?: PermissionDecision[];
  preflight?: ExecutionPreflightReport | null;
  os?: TheOneOsState;
  error?: string;
};
