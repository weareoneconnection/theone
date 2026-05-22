import { THEONE_CONFIG } from '../config';
import { listAppBundles } from '../apps/registry';
import { listCapabilities } from '../capabilities/registry';
import { listConnectors } from '../connectors/registry';
import { listOneClawCapabilities } from '../execution/oneclaw-capabilities';
import { listExecutionTemplates } from '../execution/templates';
import { getOneAIProviderStatus } from '../providers/oneai';
import { getOneClawProviderStatus } from '../providers/oneclaw';
import { listSkills } from '../skills/registry';
import { listWorkerRuntimes } from '../workers/runtime-registry';
import type {
  ProviderStatus,
  OneClawCapabilityManifest,
  TheOneAppSurface,
  TheOneLayer,
  TheOneMode,
  TheOneOsState,
  WorkflowTrace,
} from '../types';

const appSurfaces: TheOneAppSurface[] = listAppBundles().map((app) => ({
  key: app.key,
  title: app.title,
  domain: app.domain,
  status: app.status,
}));

function createLayers(providers: ProviderStatus[]): TheOneLayer[] {
  const oneAI = providers.find((provider) => provider.key === 'oneai');
  const oneClaw = providers.find((provider) => provider.key === 'oneclaw');

  return [
    {
      key: 'shell',
      title: 'TheOne Shell',
      role: 'Universal command surface for humans, agents, apps, approvals, and proof.',
      status: 'online',
      detail: 'Next.js shell is serving the control plane.',
    },
    {
      key: 'intent_kernel',
      title: 'Intent Kernel',
      role: 'Classifies objectives, priority, domain, and required control mode.',
      status: 'online',
      detail: 'Local classifier and normalizer are active.',
    },
    {
      key: 'context_layer',
      title: 'Context Layer',
      role: 'Collects resources into a governed context bus for planning and runtime.',
      status: 'ready',
      detail: 'Context bus v1 tracks intent, connectors, memory, approvals, and executions.',
    },
    {
      key: 'planner',
      title: 'Planner Layer',
      role: 'Calls intelligence providers to convert intent into structured plans.',
      status: oneAI?.status ?? 'mock',
      detail: oneAI?.configured ? 'OneAI is configured as the default intelligence driver.' : 'OneAI is in mock mode.',
    },
    {
      key: 'workflow_runtime',
      title: 'Workflow Runtime',
      role: 'Turns DAG plans into trackable steps with status, risk, contracts, and approval gates.',
      status: 'online',
      detail: 'Dependency-aware skill runtime is active.',
    },
    {
      key: 'policy',
      title: 'Policy & Approval',
      role: 'Evaluates permissions and decides what can run automatically or wait for approval.',
      status: 'online',
      detail: 'Permission model v1 is active for context, connectors, memory, and external actions.',
    },
    {
      key: 'execution_driver',
      title: 'Execution Driver',
      role: 'Submits executable tasks to external action runtimes.',
      status: oneClaw?.status ?? 'mock',
      detail: oneClaw?.configured ? 'OneClaw is configured as the default execution driver.' : 'OneClaw is in mock mode.',
    },
    {
      key: 'proof_ledger',
      title: 'Proof Ledger',
      role: 'Records outcomes, provider receipts, and execution evidence.',
      status: 'online',
      detail: 'Proof records are normalized by TheOne.',
    },
    {
      key: 'memory_graph',
      title: 'Memory Graph',
      role: 'Queries execution history and compounds it into future context.',
      status: 'ready',
      detail: 'Memory graph query v1 is active.',
    },
    {
      key: 'app_layer',
      title: 'Capability / Skill / Connector Layer',
      role: 'Maps real-world capability primitives to skills, app bundles, and connectors.',
      status: 'ready',
      detail: 'Apps and connectors are compositions of universal primitives, not kernel boundaries.',
    },
  ];
}

export function createEmptyWorkflowTrace(mode: TheOneMode): WorkflowTrace {
  return {
    id: 'workflow_idle',
    runId: 'run_idle',
    mode,
    status: 'idle',
    summary: 'Waiting for intent.',
    steps: [],
  };
}

export function getTheOneProviderStatus(): ProviderStatus[] {
  return [
    {
      key: 'theone',
      label: 'TheOne Kernel',
      role: 'Universal AI OS control plane',
      configured: true,
      mode: 'live',
      status: 'online',
      capabilities: [
        { name: 'intent.classify', kind: 'system', risk: 'low' },
        { name: 'workflow.trace', kind: 'system', risk: 'low' },
        { name: 'policy.approval', kind: 'system', risk: 'low' },
        { name: 'context.bus', kind: 'context', risk: 'low' },
        { name: 'permission.evaluate', kind: 'system', risk: 'low' },
        { name: 'proof.write', kind: 'storage', risk: 'low' },
      ],
    },
    getOneAIProviderStatus(),
    getOneClawProviderStatus(),
  ];
}

export function getTheOneKernelStatus(
  mode: TheOneMode = THEONE_CONFIG.defaultMode,
  oneClawManifest?: OneClawCapabilityManifest | null
): TheOneOsState {
  const providers = getTheOneProviderStatus();
  const capabilities = listCapabilities();
  const skills = listSkills();
  const appBundles = listAppBundles();
  const connectors = listConnectors();
  const oneClawCapabilities = oneClawManifest?.capabilities?.length
    ? oneClawManifest.capabilities
    : listOneClawCapabilities();
  const executionTemplates = listExecutionTemplates();

  return {
    name: 'TheOne',
    version: THEONE_CONFIG.version,
    mode,
    architecture: 'Universal AI OS',
    principle: 'OneAI and OneClaw are external providers; TheOne owns intent, policy, workflow, proof, and memory.',
    layers: createLayers(providers),
    providers,
    workflow: createEmptyWorkflowTrace(mode),
    approvals: [],
    executions: [],
    apps: appSurfaces,
    capabilities,
    skills,
    appBundles,
    connectors,
    oneClawCapabilities,
    oneClawConnectors: oneClawManifest?.connectors || [],
    oneClawManifest: oneClawManifest || null,
    executionTemplates,
    preflight: null,
  };
}

export async function getTheOneKernelStatusWithWorkers(
  mode: TheOneMode = THEONE_CONFIG.defaultMode,
  oneClawManifest?: OneClawCapabilityManifest | null
) {
  const [os, workerRuntimes] = await Promise.all([
    Promise.resolve(getTheOneKernelStatus(mode, oneClawManifest)),
    listWorkerRuntimes(),
  ]);

  return {
    ...os,
    workerRuntimes,
  };
}
