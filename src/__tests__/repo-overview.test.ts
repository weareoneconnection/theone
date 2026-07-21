import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildRepoOverview } from '@/lib/theone/agent-engine/repo-overview';
import { deliverAsPullRequest } from '@/lib/theone/agent-engine/git-deliver';

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
