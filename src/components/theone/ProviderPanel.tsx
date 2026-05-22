export function ProviderPanel({
  result,
  providerChecks = [],
}: {
  result: any;
  providerChecks?: any[];
}) {
  const providers = result?.os?.providers || providerChecks.map((check: any) => ({
    key: check.key,
    label: check.label,
    role: check.key === 'oneai' ? 'Default intelligence and planning driver' : 'Default real-world execution driver',
    configured: check.configured,
    mode: check.mode,
    baseUrl: check.baseUrl,
    capabilities: [],
    warnings: check.configured ? [] : [check.message],
  }));
  const checksByKey = new Map(providerChecks.map((check: any) => [check.key, check]));

  return (
    <section className="panel-card">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Provider Drivers</h2>
          <p className="panel-subtitle">
            OneAI and OneClaw stay outside TheOne. TheOne only connects to them as drivers.
          </p>
        </div>
      </div>
      <div className="provider-list">
        {providers.length === 0 ? (
          <div className="provider-item">
            <div className="feed-title">Waiting for system status.</div>
            <div className="proof-meta">Run TheOne to inspect provider mode and capabilities.</div>
          </div>
        ) : (
          providers.map((provider: any) => (
            <ProviderItem
              key={provider.key}
              provider={provider}
              check={checksByKey.get(provider.key)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function ProviderItem({ provider, check }: { provider: any; check?: any }) {
  const connectionStatus = check?.status || (provider.configured ? 'ready' : 'not_configured');
  const connectionLabel = check?.ok ? 'connected' : connectionStatus;

  return (
    <div className="provider-item">
      <div className="provider-head">
        <div>
          <div className="feed-title">{provider.label}</div>
          <div className="proof-meta">{provider.role}</div>
        </div>
        <span className={`provider-mode provider-${provider.mode}`}>{provider.mode}</span>
      </div>
      <div className="provider-connection-row">
        <span className={`status-pill status-${connectionLabel}`}>{connectionLabel}</span>
        <span className="proof-meta no-margin">{check?.latencyMs ? `${check.latencyMs}ms` : provider.configured ? 'pending check' : 'missing key'}</span>
      </div>
      <div className="provider-endpoint">{check?.baseUrl || provider.baseUrl || 'No endpoint configured'}</div>
      {check?.message || provider.warnings?.length ? (
        <div className="proof-meta">
          {check?.message || provider.warnings.join(' ')}
        </div>
      ) : null}
      <div className="capability-row">
        {(provider.capabilities || []).slice(0, 4).map((capability: any) => (
          <span key={capability.name} className="capability-chip">
            {capability.name}
          </span>
        ))}
      </div>
    </div>
  );
}
