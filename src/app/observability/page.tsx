import { buildObservabilityReport } from '@/lib/theone/observability/metrics-report';

export const dynamic = 'force-dynamic';

function Metric({ label, value, good }: { label: string; value: string | number; good?: boolean }) {
  return (
    <div style={{ padding: '12px 16px', border: '1px solid #ddd', borderRadius: 8, minWidth: 140 }}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: good === false ? '#c0392b' : good === true ? '#27ae60' : 'inherit' }}>
        {value}
      </div>
    </div>
  );
}

export default async function ObservabilityPage() {
  const report = await buildObservabilityReport(24);

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 24 }}>TheOne Observability（近 24 小时）</h1>
      <p style={{ opacity: 0.7 }}>生成于 {report.generatedAt}{report.error ? ` — ${report.error}` : ''}</p>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>运行</h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Metric label="总运行数" value={report.runs.total} />
        <Metric label="失败" value={report.runs.failed} good={report.runs.failed === 0} />
        <Metric label="等待审批" value={report.runs.pendingApproval} />
        <Metric label="成功率" value={`${Math.round(report.runs.successRate * 100)}%`} good={report.runs.successRate >= 0.8} />
      </div>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>智能体</h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Metric label="LLM 参与的运行" value={report.agents.runsWithLlm} />
        <Metric label="纯规则运行" value={report.agents.runsRuleOnly} />
        <Metric label="LLM 采用率" value={`${Math.round(report.agents.llmAdoptionRate * 100)}%`} good={report.agents.llmAdoptionRate > 0} />
      </div>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>执行</h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Metric label="总执行数" value={report.executions.total} />
        <Metric label="进行中" value={report.executions.inFlight} />
        {Object.entries(report.executions.byStatus).map(([status, count]) => (
          <Metric key={status} label={status} value={count} good={status === 'success' ? true : status === 'failed' ? false : undefined} />
        ))}
      </div>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>记忆</h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Metric label="记忆总数" value={report.memory.total} />
        <Metric label="含向量" value={report.memory.withEmbedding} />
        <Metric label="向量覆盖率" value={`${Math.round(report.memory.embeddingCoverage * 100)}%`} good={report.memory.embeddingCoverage >= 0.8} />
        <Metric label="pgvector" value={report.memory.pgVector ? '启用' : '未启用'} good={report.memory.pgVector} />
      </div>

      <h2 style={{ fontSize: 16, marginTop: 24 }}>自动化</h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Metric label="tick 事件" value={report.automation.tickEvents} />
        <Metric label="学习循环" value={report.automation.learningCycles} />
        <Metric label="执行同步" value={report.automation.executionSyncs} />
        <Metric label="最近 tick" value={report.automation.lastTickAt ? new Date(report.automation.lastTickAt).toLocaleString() : '无'} good={!!report.automation.lastTickAt} />
      </div>
    </main>
  );
}
