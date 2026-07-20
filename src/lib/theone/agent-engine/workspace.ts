import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Every file path a tool touches must stay inside the workspace root.
export function resolveWorkspacePath(workspace: string, filePath: string): string {
  const root = path.resolve(workspace);
  const resolved = path.resolve(root, filePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Path escapes the workspace: ${filePath}`);
  }
  return resolved;
}

export const SNAPSHOT_BRANCH = 'theone-agent-snapshot';

async function git(workspace: string, args: string[]) {
  return execFileAsync('git', args, { cwd: workspace, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
}

// Snapshot the workspace before an agent run. Returns the commit hash to
// roll back to, or null when the workspace is not a git repository.
export async function snapshotWorkspace(workspace: string): Promise<string | null> {
  try {
    await git(workspace, ['rev-parse', '--git-dir']);
  } catch {
    return null;
  }
  try {
    // Stash-free snapshot: record the current tree in a detached commit.
    await git(workspace, ['add', '-A']);
    const { stdout: tree } = await git(workspace, ['write-tree']);
    const { stdout: head } = await git(workspace, ['rev-parse', 'HEAD']).catch(() => ({ stdout: '' }));
    const parent = head.trim() ? ['-p', head.trim()] : [];
    const { stdout: commit } = await git(workspace, [
      'commit-tree', tree.trim(), ...parent, '-m', 'theone-agent snapshot',
    ]);
    await git(workspace, ['reset']);
    return commit.trim();
  } catch {
    return null;
  }
}

export async function rollbackWorkspace(workspace: string, snapshotCommit: string): Promise<boolean> {
  try {
    await git(workspace, ['checkout', snapshotCommit, '--', '.']);
    return true;
  } catch {
    return false;
  }
}

// Diff the current tree against the pre-run snapshot for the receipt.
export async function diffAgainstSnapshot(
  workspace: string,
  snapshotCommit: string,
): Promise<{ diffStat: string; diff: string }> {
  try {
    const { stdout: diffStat } = await git(workspace, ['diff', '--stat', snapshotCommit]);
    const { stdout: diff } = await git(workspace, ['diff', snapshotCommit]);
    return {
      diffStat: diffStat.trim().slice(-8_000),
      diff: diff.length > 200_000 ? `${diff.slice(0, 200_000)}\n… [diff truncated at 200000 chars]` : diff,
    };
  } catch {
    return { diffStat: '', diff: '' };
  }
}
