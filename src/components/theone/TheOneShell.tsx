'use client';

import { IntentInput } from './IntentInput';
import { SystemFlow } from './SystemFlow';
import { ExecutionFeed } from './ExecutionFeed';
import { ResultPanel } from './ResultPanel';
import { NetworkHeat } from './NetworkHeat';
import { ProofPanel } from './ProofPanel';
import { ProviderPanel } from './ProviderPanel';
import { ApprovalPanel } from './ApprovalPanel';
import { ArchitecturePanel } from './ArchitecturePanel';
import { RunHistoryPanel } from './RunHistoryPanel';
import { LedgerPanel } from './LedgerPanel';
import { CapabilityMapPanel } from './CapabilityMapPanel';
import { ConnectorMapPanel } from './ConnectorMapPanel';
import { MemoryContextPanel } from './MemoryContextPanel';
import { ContextBusPanel } from './ContextBusPanel';
import { PermissionPanel } from './PermissionPanel';
import { RunLogPanel } from './RunLogPanel';
import { ProductionExecutionPanel } from './ProductionExecutionPanel';
import { RunTheOneSandbox } from './RunTheOneSandbox';
import { AutomationPolicyPanel } from './AutomationPolicyPanel';
import { PolicyRuleEditorPanel } from './PolicyRuleEditorPanel';
import { RuntimeOpsPanel } from './RuntimeOpsPanel';
import { EventLedgerPanel } from './EventLedgerPanel';
import { AutomationSchedulerPanel } from './AutomationSchedulerPanel';
import { EventSourcePanel } from './EventSourcePanel';
import { MultiAgentRuntimePanel } from './MultiAgentRuntimePanel';
import { PackageRegistryPanel } from './PackageRegistryPanel';
import { LearningEnginePanel } from './LearningEnginePanel';
import { ProductionMaturityPanel } from './ProductionMaturityPanel';
import { OneClawWorkerCatalogPanel } from './OneClawWorkerCatalogPanel';
import { LocalDesktopBridgePanel } from './LocalDesktopBridgePanel';

export function TheOneShell({
  loading,
  result,
  osStatus,
  workerCatalog,
  ledger,
  providerChecks,
  oneClawApprovals,
  oneClawTasks,
  onRun,
  onApprove,
  onReject,
  onApproveOneClaw,
  onRejectOneClaw,
  onRunOneClawAction,
  onRefreshOneClawTask,
  onSync,
  onOpenRun,
}: {
  loading: boolean;
  result: any;
  osStatus: any;
  workerCatalog: any[];
  ledger: { runs: any[]; proof: any[]; memory: any[] };
  providerChecks: any[];
  oneClawApprovals: any[];
  oneClawTasks: any[];
  onRun: (input: string, mode: string) => void;
  onApprove: (approvalId?: string, approveAll?: boolean) => void;
  onReject: (approvalId?: string, rejectAll?: boolean) => void;
  onApproveOneClaw: (approvalId: string) => void;
  onRejectOneClaw: (approvalId: string) => void;
  onRunOneClawAction: (payload: {
    action: string;
    input: Record<string, unknown>;
    approvalMode: 'auto' | 'manual';
  }) => void;
  onRefreshOneClawTask: (taskId?: string) => void;
  onSync: () => void;
  onOpenRun: (runId: string) => void;
}) {
  const activeOs = result?.os || osStatus || {};
  const hydratedResult = result || (osStatus ? { ok: true, os: osStatus } : null);
  const mode = activeOs?.mode || 'assist';
  const providers = activeOs?.providers || [];
  const oneAiCheck = providerChecks.find((provider: any) => provider.key === 'oneai');
  const oneClawCheck = providerChecks.find((provider: any) => provider.key === 'oneclaw');
  const oneAiMode = providers.find((provider: any) => provider.key === 'oneai')?.mode || oneAiCheck?.mode || 'mock';
  const oneClawMode = providers.find((provider: any) => provider.key === 'oneclaw')?.mode || oneClawCheck?.mode || 'mock';
  const workflowStatus = loading ? 'running' : activeOs?.workflow?.status || (result?.ok ? 'completed' : 'idle');
  const permissionSummary = result?.contextFrame?.summary?.permissionSummary
    || activeOs?.contextFrame?.summary?.permissionSummary
    || { allowed: 0, requiresApproval: 0, denied: 0 };
  const connectors = result?.plan?.capabilityRoute?.connectors || [];
  const runCapabilities = result?.plan?.capabilityRoute?.capabilities || [];
  const osCapabilities = activeOs?.capabilities || [];
  const capabilities = runCapabilities.length ? runCapabilities : osCapabilities;
  const runWorkerRuntimes = result?.os?.workerRuntimes || [];
  const osWorkerRuntimes = activeOs?.workerRuntimes || [];
  const workerRuntimes = runWorkerRuntimes.length ? runWorkerRuntimes : (workerCatalog.length ? workerCatalog : osWorkerRuntimes);
  const runMemoryHits = result?.memoryContext?.length || result?.plan?.memoryContext?.length || 0;
  const memoryHits = runMemoryHits || ledger.memory.length;
  const capabilitiesDetail = formatMetricList(capabilities, 'OS registry');
  const workerDetail = formatMetricList(workerRuntimes, 'OneClaw catalog');
  const memoryDetail = runMemoryHits ? 'Current run recall' : 'Saved memory ledger';
  const permissionDetail = result?.runId ? 'Current run policy' : 'Latest policy scope';
  const runId = result?.runId ? String(result.runId).slice(-8) : 'standby';

  return (
    <main className="theone-shell">
      <div className="theone-container">
        <section className="os-hero">
          <div className="os-hero-main">
            <div className="eyebrow">Universal AI Operating System</div>
            <div>
              <h1>TheOne</h1>
              <p className="hero-subtitle">
                Universal control plane for intent, context, permissions, workflow, proof, and memory.
              </p>
            </div>
          </div>
          <div className="os-status-board">
            <StatusMetric label="Mode" value={mode} />
            <StatusMetric label="Workflow" value={workflowStatus} tone={workflowStatus} />
            <StatusMetric label="Run" value={runId} />
            <StatusMetric label="OneAI" value={oneAiMode} tone={oneAiMode} />
            <StatusMetric label="OneClaw" value={oneClawMode} tone={oneClawMode} />
            <StatusMetric label="Level" value="L22" tone="online" />
          </div>
        </section>

        <section className="os-summary-band">
          <SummaryMetric label="Capabilities" value={capabilities.length} detail={capabilitiesDetail} />
          <SummaryMetric label="Workers" value={workerRuntimes.length} detail={workerDetail} />
          <SummaryMetric label="Memory Hits" value={memoryHits} detail={memoryDetail} />
          <SummaryMetric label="Allowed" value={permissionSummary.allowed} detail={permissionDetail} />
          <SummaryMetric label="Approval" value={permissionSummary.requiresApproval} detail={permissionDetail} />
          <SummaryMetric label="Denied" value={permissionSummary.denied} detail={permissionDetail} />
        </section>

        <section className="command-deck">
          <div className="stack">
            <IntentInput onRun={onRun} loading={loading} />
            <RunTheOneSandbox
              result={result}
              loading={loading}
              providerChecks={providerChecks}
              oneClawTasks={oneClawTasks}
            />
          </div>
          <ResultPanel result={result} />
        </section>

        <div className="os-workbench">
          <div className="stack os-primary">
            <SystemFlow result={result} loading={loading} />
            <RunLogPanel result={result} loading={loading} />
            <ContextBusPanel result={result} />
            <PermissionPanel result={result} />
            <ExecutionFeed result={result} />
          </div>
          <div className="stack os-secondary">
            <ProviderPanel result={hydratedResult} providerChecks={providerChecks} />
            <LocalDesktopBridgePanel result={hydratedResult} />
            <OneClawWorkerCatalogPanel />
            <ProductionExecutionPanel
              result={result}
              loading={loading}
              oneClawTasks={oneClawTasks}
              onRunOneClawAction={onRunOneClawAction}
              onRefreshOneClawTask={onRefreshOneClawTask}
            />
            <AutomationPolicyPanel result={result} oneClawTasks={oneClawTasks} />
            <EventSourcePanel />
            <AutomationSchedulerPanel />
            <PolicyRuleEditorPanel />
            <MultiAgentRuntimePanel result={result} />
            <PackageRegistryPanel />
            <LearningEnginePanel />
            <ProductionMaturityPanel />
            <RuntimeOpsPanel result={result} ledger={ledger} />
            <ApprovalPanel
              result={result}
              loading={loading}
              oneClawApprovals={oneClawApprovals}
              onApprove={onApprove}
              onReject={onReject}
              onApproveOneClaw={onApproveOneClaw}
              onRejectOneClaw={onRejectOneClaw}
              onSync={onSync}
            />
            <RunHistoryPanel items={ledger.runs} onOpenRun={onOpenRun} />
            <MemoryContextPanel result={result} />
          </div>
        </div>

        <div className="os-map-zone">
          <CapabilityMapPanel result={result} />
          <ConnectorMapPanel result={result} />
        </div>

        <div className="os-ledger-zone">
          <div className="stack">
            <ProofPanel result={result} />
            <EventLedgerPanel />
            <LedgerPanel proof={ledger.proof} memory={ledger.memory} />
          </div>
          <div className="stack">
            <ArchitecturePanel result={result} />
            <NetworkHeat />
          </div>
        </div>
      </div>
    </main>
  );
}

function formatMetricList(items: any[], fallback: string) {
  const labels = (items || [])
    .slice(0, 4)
    .map((item) => {
      if (typeof item === 'string') return item;
      return item?.title || item?.label || item?.name || item?.key || item?.action || '';
    })
    .filter(Boolean);

  return labels.join(' · ') || fallback;
}

function StatusMetric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="os-stat">
      <div className="os-stat-label">{label}</div>
      <div className={`os-stat-value tone-${tone || value}`}>{value}</div>
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="summary-metric">
      <div className="summary-number">{value}</div>
      <div>
        <div className="summary-label">{label}</div>
        <div className="summary-detail">{detail}</div>
      </div>
    </div>
  );
}
