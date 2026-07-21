import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// PR-only delivery: after a verified agent run, commit the work onto a fresh
// theone-agent/* branch, push it, and open a pull request. It never pushes a
// protected branch, never force-pushes, and never triggers a deploy directly —
// merging the PR is a human action. The git token lives only here and is
// redacted from every returned string, so the model never sees it.

const BRANCH_PREFIX = "theone-agent/";
const PROTECTED = new Set(["main", "master", "develop", "release", "production", "prod"]);

export type DeliverResult = {
  ok: boolean;
  branch?: string;
  pushed?: boolean;
  prUrl?: string;
  commit?: string;
  message: string;
};

function slugify(input: string): string {
  const base = input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "change";
  return `${BRANCH_PREFIX}${base}-${Date.now().toString(36)}`;
}

function redact(text: string, token: string): string {
  if (!token) return text;
  return text.split(token).join("***");
}

async function git(workspace: string, args: string[], env?: NodeJS.ProcessEnv) {
  return execFileAsync("git", args, {
    cwd: workspace, timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
    env: env ? { ...process.env, ...env } : process.env,
  });
}

function deliverConfig() {
  return {
    token: String(process.env.AGENT_GIT_TOKEN || process.env.GITHUB_TOKEN || "").trim(),
    apiBase: String(process.env.AGENT_GITHUB_API || "https://api.github.com").trim().replace(/\/+$/, ""),
    author: {
      name: String(process.env.AGENT_GIT_AUTHOR_NAME || "TheOne Agent").trim(),
      email: String(process.env.AGENT_GIT_AUTHOR_EMAIL || "agent@theone.local").trim(),
    },
  };
}

async function remoteSlug(workspace: string): Promise<{ owner: string; repo: string } | null> {
  try {
    const { stdout } = await git(workspace, ["remote", "get-url", "origin"]);
    const url = stdout.trim();
    const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/i);
    if (!match) return null;
    return { owner: match[1], repo: match[2] };
  } catch {
    return null;
  }
}

async function defaultBranch(workspace: string): Promise<string> {
  try {
    const { stdout } = await git(workspace, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
    const name = stdout.trim().split("/").pop();
    if (name) return name;
  } catch { /* fall through */ }
  return "main";
}

export async function deliverAsPullRequest(input: {
  workspace: string;
  objective: string;
  title?: string;
  body?: string;
}): Promise<DeliverResult> {
  const { token, apiBase, author } = deliverConfig();
  if (!token) {
    return { ok: false, message: "PR delivery is not configured: set AGENT_GIT_TOKEN on this runtime." };
  }

  // Must be a git repo with a GitHub origin.
  const slug = await remoteSlug(input.workspace);
  if (!slug) {
    return { ok: false, message: "PR delivery needs a GitHub 'origin' remote on the workspace." };
  }

  const base = await defaultBranch(input.workspace);
  const branch = slugify(input.objective);
  // Hard rail: the target must be a fresh agent branch, never a protected one.
  const shortName = branch.slice(BRANCH_PREFIX.length).split("-")[0];
  if (!branch.startsWith(BRANCH_PREFIX) || PROTECTED.has(branch) || PROTECTED.has(shortName)) {
    return { ok: false, message: `Refusing to deliver onto a non-agent or protected branch: ${branch}` };
  }

  try {
    // Detect whether there is anything to deliver.
    const { stdout: status } = await git(input.workspace, ["status", "--porcelain"]);
    if (!status.trim()) {
      const { stdout: head } = await git(input.workspace, ["rev-parse", "HEAD"]).catch(() => ({ stdout: "" }));
      if (!head) return { ok: false, message: "Nothing to deliver: the workspace has no changes." };
    }

    await git(input.workspace, ["checkout", "-b", branch]);
    await git(input.workspace, ["add", "-A"]);
    const commitMessage = input.title?.trim() || `TheOne agent: ${input.objective.slice(0, 72)}`;
    await git(input.workspace, [
      "-c", `user.name=${author.name}`, "-c", `user.email=${author.email}`,
      "commit", "-m", commitMessage,
    ]).catch(() => undefined); // already-committed work is fine

    const { stdout: commitHash } = await git(input.workspace, ["rev-parse", "HEAD"]);

    // Push with a tokenized remote URL that is never persisted or logged.
    const authUrl = `https://x-access-token:${token}@github.com/${slug.owner}/${slug.repo}.git`;
    try {
      await git(input.workspace, ["push", authUrl, `${branch}:${branch}`]);
    } catch (error) {
      const detail = redact(error instanceof Error ? error.message : String(error), token);
      return { ok: false, branch, message: `git push failed: ${detail}` };
    }

    // Open the PR through the GitHub API.
    const prTitle = input.title?.trim() || commitMessage;
    const prBody = `${input.body?.trim() || "Automated change prepared by the TheOne agent engine."}\n\n_Objective: ${input.objective.slice(0, 500)}_\n\n⚠️ Review before merge — merging is what triggers deployment.`;
    const response = await fetch(`${apiBase}/repos/${slug.owner}/${slug.repo}/pulls`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ title: prTitle, head: branch, base, body: prBody }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const detail = redact(await response.text().catch(() => ""), token).slice(0, 300);
      return {
        ok: true, branch, pushed: true, commit: commitHash.trim(),
        message: `Branch ${branch} pushed, but PR creation returned ${response.status}: ${detail}. Open the PR manually on GitHub.`,
      };
    }

    const pr = await response.json() as { html_url?: string; number?: number };
    return {
      ok: true, branch, pushed: true, commit: commitHash.trim(), prUrl: pr.html_url,
      message: `Pull request opened: ${pr.html_url || `#${pr.number}`} (${branch} → ${base}). Review and merge to deploy.`,
    };
  } catch (error) {
    const detail = redact(error instanceof Error ? error.message : String(error), token);
    return { ok: false, branch, message: `Delivery failed: ${detail}` };
  }
}
