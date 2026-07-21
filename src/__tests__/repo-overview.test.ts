import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildRepoOverview, readProjectConventions } from '@/lib/theone/agent-engine/repo-overview';
import { deliverAsPullRequest } from '@/lib/theone/agent-engine/git-deliver';
import { executeTool } from '@/lib/theone/agent-engine/tools';
import type { AgentSessionState } from '@/lib/theone/agent-engine/types';

let workspace: string;

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-overview-'));
});
afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

describe('buildRepoOverview', () => {
  it('summarizes stack, scripts, and layout from package.json + files', async () => {
    await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({
      name: 'demo-app',
      scripts: { build: 'next build', test: 'vitest run', lint: 'eslint .' },
      dependencies: { next: '^15', react: '^19' },
      devDependencies: { typescript: '^5', vitest: '^4' },
    }));
    await fs.writeFile(path.join(workspace, 'README.md'), '# Demo\n\nA sample app that does things.');
    await fs.mkdir(path.join(workspace, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'src', 'index.ts'), 'export const x = 1;');

    const overview = await buildRepoOverview(workspace);
    expect(overview).toContain('demo-app');
    expect(overview).toContain('Next.js');
    expect(overview).toContain('TypeScript');
    expect(overview).toContain('test'); // script listed
    expect(overview).toContain('A sample app'); // README summary
  });

  it('returns empty string for an empty directory', async () => {
    expect(await buildRepoOverview(workspace)).toBe('');
  });

  it('detects non-node stacks', async () => {
    await fs.writeFile(path.join(workspace, 'go.mod'), 'module demo\n\ngo 1.22\n');
    const overview = await buildRepoOverview(workspace);
    expect(overview).toContain('Go');
  });
});

describe('readProjectConventions', () => {
  it('reads CLAUDE.md when present', async () => {
    await fs.writeFile(path.join(workspace, 'CLAUDE.md'), '# Rules\nAlways use tabs. Never touch /legacy.');
    const conventions = await readProjectConventions(workspace);
    expect(conventions).toContain('Project conventions');
    expect(conventions).toContain('Always use tabs');
  });
  it('returns empty when no convention file exists', async () => {
    expect(await readProjectConventions(workspace)).toBe('');
  });
});

describe('new tools (write / multi_edit / web_fetch)', () => {
  const state = (): AgentSessionState => ({ workspace, readFiles: new Set(), editedFiles: new Set(), commands: [] });
  const call = (s: AgentSessionState, name: string, input: Record<string, unknown>) =>
    executeTool(s, { id: `t_${Math.random().toString(36).slice(2)}`, name: name as never, input });

  it('write_file creates and overwrites, tracking it as read+edited', async () => {
    const s = state();
    const created = await call(s, 'write_file', { file_path: 'a/b.txt', content: 'one\ntwo' });
    expect(created.ok).toBe(true);
    expect(await fs.readFile(path.join(workspace, 'a/b.txt'), 'utf8')).toBe('one\ntwo');
    const over = await call(s, 'write_file', { file_path: 'a/b.txt', content: 'changed' });
    expect(over.output).toContain('Overwrote');
  });

  it('multi_edit applies all edits atomically after read', async () => {
    await fs.writeFile(path.join(workspace, 'm.ts'), 'const a = 1;\nconst b = 2;\n');
    const s = state();
    await call(s, 'read_file', { file_path: 'm.ts' });
    const result = await call(s, 'multi_edit', { file_path: 'm.ts', edits: [
      { old_string: 'const a = 1;', new_string: 'const a = 10;' },
      { old_string: 'const b = 2;', new_string: 'const b = 20;' },
    ] });
    expect(result.ok).toBe(true);
    expect(await fs.readFile(path.join(workspace, 'm.ts'), 'utf8')).toBe('const a = 10;\nconst b = 20;\n');
  });

  it('multi_edit writes nothing if any edit fails', async () => {
    await fs.writeFile(path.join(workspace, 'm.ts'), 'const a = 1;\n');
    const s = state();
    await call(s, 'read_file', { file_path: 'm.ts' });
    const result = await call(s, 'multi_edit', { file_path: 'm.ts', edits: [
      { old_string: 'const a = 1;', new_string: 'const a = 10;' },
      { old_string: 'does-not-exist', new_string: 'x' },
    ] });
    expect(result.ok).toBe(false);
    // Original file is untouched.
    expect(await fs.readFile(path.join(workspace, 'm.ts'), 'utf8')).toBe('const a = 1;\n');
  });

  it('web_fetch refuses non-https and private/internal hosts (SSRF guard)', async () => {
    const s = state();
    expect((await call(s, 'web_fetch', { url: 'http://example.com' })).output).toContain('https');
    expect((await call(s, 'web_fetch', { url: 'https://localhost/x' })).output).toMatch(/private|internal/);
    expect((await call(s, 'web_fetch', { url: 'https://169.254.169.254/latest/meta-data' })).output).toMatch(/private|internal/);
    expect((await call(s, 'web_fetch', { url: 'https://10.0.0.5/' })).output).toMatch(/private|internal/);
  });
});

describe('deliverAsPullRequest safety rails', () => {
  it('refuses when no git token is configured', async () => {
    const prev = { a: process.env.AGENT_GIT_TOKEN, b: process.env.GITHUB_TOKEN };
    delete process.env.AGENT_GIT_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      const result = await deliverAsPullRequest({ workspace, objective: 'anything' });
      expect(result.ok).toBe(false);
      expect(result.message).toContain('not configured');
    } finally {
      if (prev.a !== undefined) process.env.AGENT_GIT_TOKEN = prev.a;
      if (prev.b !== undefined) process.env.GITHUB_TOKEN = prev.b;
    }
  });

  it('refuses when there is no GitHub origin remote', async () => {
    const prev = process.env.AGENT_GIT_TOKEN;
    process.env.AGENT_GIT_TOKEN = 'ghp_testtoken';
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const git = promisify(execFile);
      await git('git', ['init'], { cwd: workspace });
      // No origin remote configured.
      const result = await deliverAsPullRequest({ workspace, objective: 'anything' });
      expect(result.ok).toBe(false);
      expect(result.message).toContain('origin');
    } finally {
      if (prev === undefined) delete process.env.AGENT_GIT_TOKEN;
      else process.env.AGENT_GIT_TOKEN = prev;
    }
  });
});
