#!/usr/bin/env node
// End-to-end live smoke test against a running deployment.
// Usage: BASE_URL=https://your-app.vercel.app node scripts/smoke-live.mjs
//        (defaults to http://localhost:3000)

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function call(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function main() {
  console.log(`Smoke target: ${BASE_URL}\n`);

  // 1. Provider/kernel status
  try {
    const { status, json } = await call('GET', '/api/theone/status');
    record('status endpoint', status === 200 && !!json, `HTTP ${status}`);
    const providers = json?.providers || json?.os?.providers || [];
    const configured = Array.isArray(providers)
      ? providers.filter((p) => p.configured).map((p) => p.key).join(', ')
      : 'unknown';
    console.log(`   configured providers: ${configured || 'none'}`);
  } catch (error) {
    record('status endpoint', false, error.message);
  }

  // 2. Low-risk end-to-end run
  let runId = null;
  try {
    const { status, json } = await call('POST', '/api/theone/run', {
      input: 'Summarize what this system can do in three bullet points',
      mode: 'assist',
    });
    runId = json?.runId || null;
    record('low-risk run', status === 200 && json?.ok === true, `runId=${runId}, HTTP ${status}`);

    const executions = json?.executions || [];
    const mockCount = executions.filter((e) => e.status === 'mock').length;
    record(
      'real (non-mock) execution',
      executions.length > 0 && mockCount === 0,
      `${executions.length} execution(s), ${mockCount} mock`,
    );
    const llmAgents = json?.multiAgentRuntime?.proof?.[0]?.metadata?.llmAgents ?? 0;
    record('LLM agents active', llmAgents > 0, `${llmAgents}/5 agents used LLM`);
  } catch (error) {
    record('low-risk run', false, error.message);
  }

  // 3. Memory + embedding realness
  try {
    const { status, json } = await call('GET', '/api/theone/memory');
    const memories = Array.isArray(json) ? json : json?.memories || json?.items || [];
    record('memory endpoint', status === 200, `${memories.length} record(s)`);
  } catch (error) {
    record('memory endpoint', false, error.message);
  }

  // 4. Observability report
  try {
    const { status, json } = await call('GET', '/api/theone/observability');
    record('observability report', status === 200 && json?.ok === true, `HTTP ${status}`);
    if (json?.ok) {
      console.log(`   pgVector=${json.memory.pgVector} embeddingCoverage=${json.memory.embeddingCoverage}`);
      console.log(`   runs(24h)=${json.runs.total} successRate=${json.runs.successRate} llmAdoption=${json.agents.llmAdoptionRate}`);
      console.log(`   lastTickAt=${json.automation.lastTickAt}`);
      record('pgvector active', json.memory.pgVector === true, 'set EMBEDDING_DIM + Neon pgvector if false');
    }
  } catch (error) {
    record('observability report', false, error.message);
  }

  // 5. Automation tick (manual trigger; requires CRON_SECRET only if configured)
  try {
    const headers = process.env.CRON_SECRET ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : {};
    const res = await fetch(`${BASE_URL}/api/theone/automation/tick?limit=1`, { headers, signal: AbortSignal.timeout(120_000) });
    const json = await res.json().catch(() => null);
    record('automation tick', res.status === 200 && json?.ok === true,
      `checked=${json?.checked}, executionSync=${json?.executionSync?.checked ?? 'n/a'}, learning=${json?.learning?.generated ?? 'n/a'}`);
  } catch (error) {
    record('automation tick', false, error.message);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exit(1);
});
