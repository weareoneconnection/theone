import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out", "coverage",
  ".turbo", ".vercel", "__pycache__", ".venv", "venv", "target", ".cache",
]);
const MAX_ENTRIES = 200;
const MAX_DEPTH = 4;

// A Codex/Claude-Code-style bird's-eye view of the repo, generated once at the
// start of a run and injected into the system prompt so the agent does not
// have to spend turns rediscovering the layout and stack.

async function listTrackedOrWalked(workspace: string): Promise<string[]> {
  // Prefer git — it already knows the tracked/ignored split and is fast.
  try {
    const { stdout } = await execFileAsync("git", ["ls-files"], {
      cwd: workspace, timeout: 15_000, maxBuffer: 8 * 1024 * 1024,
    });
    const files = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
    if (files.length) return files;
  } catch {
    // Not a git repo or git unavailable — fall through to a find walk.
  }
  try {
    const prune = Array.from(IGNORED_DIRS).map((dir) => `-path '*/${dir}/*' -prune -o`).join(" ");
    const { stdout } = await execFileAsync("/bin/sh", ["-c",
      `find . ${prune} -type f -print 2>/dev/null | head -1000`,
    ], { cwd: workspace, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 });
    return stdout.split("\n").map((line) => line.replace(/^\.\//, "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function buildTree(files: string[]): string {
  const filtered = files.filter((file) => {
    const parts = file.split("/");
    if (parts.some((part) => IGNORED_DIRS.has(part))) return false;
    return parts.length <= MAX_DEPTH + 1;
  });

  // Collapse to directory + file counts so a huge repo still fits.
  const dirs = new Map<string, number>();
  const topFiles: string[] = [];
  for (const file of filtered) {
    const slash = file.indexOf("/");
    if (slash === -1) {
      topFiles.push(file);
    } else {
      const top = file.slice(0, file.indexOf("/", file.indexOf("/") + 1) === -1 ? slash : file.indexOf("/", slash + 1));
      dirs.set(top, (dirs.get(top) || 0) + 1);
    }
  }

  const lines: string[] = [];
  for (const file of topFiles.slice(0, 30).sort()) lines.push(file);
  for (const [dir, count] of Array.from(dirs.entries()).sort((a, b) => b[1] - a[1]).slice(0, MAX_ENTRIES)) {
    lines.push(`${dir}/  (${count} files)`);
  }
  return lines.join("\n");
}

async function detectStack(workspace: string): Promise<{ summary: string; scripts: string[] }> {
  const facts: string[] = [];
  const scripts: string[] = [];
  try {
    const pkgRaw = await readFile(path.join(workspace, "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as {
      name?: string; scripts?: Record<string, string>;
      dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
    };
    if (pkg.name) facts.push(`package: ${pkg.name}`);
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const detected: string[] = [];
    if (deps.next) detected.push("Next.js");
    if (deps.react) detected.push("React");
    if (deps.vue) detected.push("Vue");
    if (deps.express) detected.push("Express");
    if (deps.vitest) detected.push("Vitest");
    if (deps.jest) detected.push("Jest");
    if (deps.typescript) detected.push("TypeScript");
    if (deps.prisma) detected.push("Prisma");
    if (detected.length) facts.push(`stack: ${detected.join(", ")}`);
    if (pkg.scripts) {
      for (const key of ["build", "test", "check", "typecheck", "lint", "dev", "start"]) {
        if (pkg.scripts[key]) scripts.push(key);
      }
    }
  } catch {
    // No package.json — try a couple of other ecosystems.
    for (const [file, label] of [
      ["pyproject.toml", "Python (pyproject)"],
      ["requirements.txt", "Python (requirements)"],
      ["go.mod", "Go"],
      ["Cargo.toml", "Rust"],
    ] as const) {
      try {
        await readFile(path.join(workspace, file), "utf8");
        facts.push(`stack: ${label}`);
        break;
      } catch { /* keep trying */ }
    }
  }
  return { summary: facts.join("; "), scripts };
}

async function readmeSummary(workspace: string): Promise<string> {
  for (const name of ["README.md", "readme.md", "README", "README.txt"]) {
    try {
      const raw = await readFile(path.join(workspace, name), "utf8");
      const body = raw.replace(/^#.*$/m, "").trim().split("\n\n").slice(0, 2).join(" ").replace(/\s+/g, " ");
      if (body) return body.slice(0, 600);
    } catch { /* try next */ }
  }
  return "";
}

// Project convention files (CLAUDE.md, AGENTS.md, .cursorrules, …) are the
// project's own instructions — style, no-go zones, how to run things. Reading
// them makes the agent's output look like the team wrote it.
const CONVENTION_FILES = [
  "CLAUDE.md", "AGENTS.md", ".cursorrules", ".cursor/rules",
  ".github/copilot-instructions.md", "CONVENTIONS.md",
];

export async function readProjectConventions(workspace: string): Promise<string> {
  const found: string[] = [];
  for (const name of CONVENTION_FILES) {
    try {
      const raw = await readFile(path.join(workspace, name), "utf8");
      const body = raw.trim();
      if (body) found.push(`## ${name}\n${body.slice(0, 6_000)}`);
    } catch { /* not present */ }
    if (found.length >= 2) break;
  }
  if (!found.length) return "";
  return `# Project conventions (follow these — they are the project's own rules)\n${found.join("\n\n")}`;
}

export async function buildRepoOverview(workspace: string): Promise<string> {
  const [files, stack, readme] = await Promise.all([
    listTrackedOrWalked(workspace),
    detectStack(workspace),
    readmeSummary(workspace),
  ]);
  if (!files.length && !stack.summary) return "";

  const sections: string[] = [];
  if (stack.summary) sections.push(stack.summary);
  if (stack.scripts.length) sections.push(`available npm scripts: ${stack.scripts.join(", ")}`);
  if (files.length) sections.push(`~${files.length} tracked files`);
  const parts = [`# Repository overview\n${sections.join("\n")}`];
  const tree = buildTree(files);
  if (tree) parts.push(`\n## Layout\n${tree}`);
  if (readme) parts.push(`\n## README\n${readme}`);
  return parts.join("\n");
}
