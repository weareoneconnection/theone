import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { resolveWorkspacePath } from "./workspace";
import type { AgentSessionState, ToolCall, ToolResult } from "./types";

const execFileAsync = promisify(execFile);

const MAX_READ_LINES = 2000;
const MAX_LINE_CHARS = 2000;
const MAX_BASH_OUTPUT = 30_000;
const DEFAULT_BASH_TIMEOUT_MS = 120_000;
const MAX_BASH_TIMEOUT_MS = 600_000;
const MAX_SEARCH_RESULTS = 100;

// Bash subprocesses must not see the container's credentials (the engine's
// own API key included) — same redaction rule as the classic code worker.
function subprocessEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => (
      !/(TOKEN|SECRET|PASSWORD|API_KEY|DATABASE_URL|AUTH|COOKIE|CREDENTIAL)/i.test(key)
    ))
  ) as NodeJS.ProcessEnv;
}

// Tool definitions in Anthropic tool-use format. Descriptions and shapes are
// aligned with Claude Code's published tools so the model behaves natively.
export const TOOL_DEFINITIONS = [
  {
    name: "read_file",
    description: "Reads a file from the workspace. Returns cat -n style output (line numbers starting at 1). Reads up to 2000 lines by default; use offset/limit for larger files. You must read a file before editing it.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_path: { type: "string", description: "Path relative to the workspace root (absolute paths inside the workspace also accepted)" },
        offset: { type: "number", description: "Line number to start reading from (1-indexed)" },
        limit: { type: "number", description: "Number of lines to read" },
      },
      required: ["file_path"],
    },
  },
  {
    name: "edit_file",
    description: "Performs exact string replacement in a file. old_string must match the file contents exactly (including whitespace) and must be unique in the file unless replace_all is true. You must read the file first. To create a new file, pass an empty old_string on a path that does not exist.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_path: { type: "string", description: "Path relative to the workspace root" },
        old_string: { type: "string", description: "The exact text to replace (empty string to create a new file)" },
        new_string: { type: "string", description: "The replacement text" },
        replace_all: { type: "boolean", description: "Replace every occurrence (default false)" },
      },
      required: ["file_path", "old_string", "new_string"],
    },
  },
  {
    name: "bash",
    description: "Executes a shell command in the workspace and returns stdout+stderr. Output over 30000 characters is truncated. Default timeout 120s (max 600s via timeout_ms). Use for running tests, builds, git, and inspection commands.",
    input_schema: {
      type: "object" as const,
      properties: {
        command: { type: "string", description: "The command to execute" },
        timeout_ms: { type: "number", description: "Timeout in milliseconds (max 600000)" },
      },
      required: ["command"],
    },
  },
  {
    name: "search",
    description: "Searches the workspace. mode \"grep\" searches file contents with a regex pattern; mode \"glob\" finds files by name pattern (e.g. \"src/**/*.ts\"). Returns up to 100 matches.",
    input_schema: {
      type: "object" as const,
      properties: {
        mode: { type: "string", enum: ["grep", "glob"], description: "grep = content regex search, glob = filename pattern" },
        pattern: { type: "string", description: "Regex (grep) or glob pattern (glob)" },
        path: { type: "string", description: "Subdirectory to search (default workspace root)" },
      },
      required: ["mode", "pattern"],
    },
  },
  {
    name: "write_file",
    description: "Writes a file, overwriting it if it exists or creating it (with parent directories) if not. Prefer edit_file for changing part of an existing file; use write_file to create new files or fully replace one you have already read.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_path: { type: "string", description: "Path relative to the workspace root" },
        content: { type: "string", description: "The full file contents to write" },
      },
      required: ["file_path", "content"],
    },
  },
  {
    name: "multi_edit",
    description: "Applies several exact string replacements to one file in a single atomic operation (all succeed or none are written). You must read the file first. Each edit's old_string must be unique unless replace_all is set. Edits apply in order.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_path: { type: "string", description: "Path relative to the workspace root" },
        edits: {
          type: "array",
          description: "Ordered list of replacements",
          items: {
            type: "object",
            properties: {
              old_string: { type: "string" },
              new_string: { type: "string" },
              replace_all: { type: "boolean" },
            },
            required: ["old_string", "new_string"],
          },
        },
      },
      required: ["file_path", "edits"],
    },
  },
  {
    name: "web_fetch",
    description: "Fetches a public URL over HTTPS and returns its readable text (HTML is stripped to text). Read-only: use it to check API docs, changelogs, or an error message's issue thread. Cannot reach private/internal addresses. Output is truncated to 30000 characters.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "An https:// URL to fetch" },
      },
      required: ["url"],
    },
  },
  {
    name: "read_image",
    description: "Reads an image file (png/jpg/jpeg/gif/webp) from the workspace and returns it so you can see it — e.g. a screenshot of a bug, a design mockup, or a chart. Use this instead of read_file for images.",
    input_schema: {
      type: "object" as const,
      properties: {
        file_path: { type: "string", description: "Path to the image, relative to the workspace root" },
      },
      required: ["file_path"],
    },
  },
];

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
};
// The Messages API rejects images much larger than this; fail early with a
// clear message rather than a 400.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function runRead(state: AgentSessionState, input: Record<string, unknown>): Promise<string> {
  const filePath = asString(input.file_path);
  if (!filePath) throw new Error("file_path is required");
  const resolved = resolveWorkspacePath(state.workspace, filePath);

  const content = await fs.readFile(resolved, "utf8");
  const lines = content.split("\n");
  const offset = Math.max(1, Number(input.offset) || 1);
  const limit = Math.max(1, Math.min(Number(input.limit) || MAX_READ_LINES, MAX_READ_LINES));
  const slice = lines.slice(offset - 1, offset - 1 + limit);

  state.readFiles.add(resolved);

  const numbered = slice
    .map((line, index) => `${String(offset + index).padStart(6)}\t${line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}… [line truncated]` : line}`)
    .join("\n");
  const remaining = lines.length - (offset - 1 + slice.length);
  return remaining > 0 ? `${numbered}\n… (${remaining} more lines — use offset to continue)` : numbered;
}

async function runEdit(state: AgentSessionState, input: Record<string, unknown>): Promise<string> {
  const filePath = asString(input.file_path);
  if (!filePath) throw new Error("file_path is required");
  const oldString = asString(input.old_string);
  const newString = asString(input.new_string);
  const replaceAll = input.replace_all === true;
  const resolved = resolveWorkspacePath(state.workspace, filePath);

  const exists = await fs.stat(resolved).then((s) => s.isFile()).catch(() => false);

  // New-file creation path.
  if (!exists) {
    if (oldString !== "") {
      throw new Error(`File does not exist: ${filePath}. To create it, pass an empty old_string.`);
    }
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, newString, "utf8");
    state.readFiles.add(resolved);
    state.editedFiles.add(resolved);
    return `Created ${filePath} (${newString.split("\n").length} lines).`;
  }

  if (!state.readFiles.has(resolved)) {
    throw new Error(`You must read ${filePath} before editing it. Use read_file first.`);
  }
  if (oldString === "") {
    throw new Error(`File already exists: ${filePath}. Provide the exact old_string to replace.`);
  }
  if (oldString === newString) {
    throw new Error("old_string and new_string are identical.");
  }

  const content = await fs.readFile(resolved, "utf8");
  const occurrences = content.split(oldString).length - 1;

  if (occurrences === 0) {
    // Help the model self-correct: point to the closest line.
    const firstLine = oldString.split("\n")[0]?.trim().slice(0, 80);
    const hint = firstLine && content.includes(firstLine)
      ? ` The first line of old_string appears in the file — check whitespace/indentation of the following lines.`
      : "";
    throw new Error(`old_string not found in ${filePath}.${hint}`);
  }
  if (occurrences > 1 && !replaceAll) {
    throw new Error(`old_string matches ${occurrences} locations in ${filePath}. Add surrounding context to make it unique, or pass replace_all: true.`);
  }

  const updated = replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, newString);
  await fs.writeFile(resolved, updated, "utf8");
  state.editedFiles.add(resolved);
  return `Edited ${filePath}: replaced ${replaceAll ? occurrences : 1} occurrence(s).`;
}

async function runBash(state: AgentSessionState, input: Record<string, unknown>): Promise<string> {
  const command = asString(input.command);
  if (!command) throw new Error("command is required");
  const timeout = Math.min(Math.max(Number(input.timeout_ms) || DEFAULT_BASH_TIMEOUT_MS, 1000), MAX_BASH_TIMEOUT_MS);

  state.commands.push(command);

  try {
    const { stdout, stderr } = await execFileAsync("/bin/sh", ["-c", command], {
      cwd: state.workspace,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...subprocessEnv(), CI: "true" },
    });
    const output = [stdout, stderr].filter(Boolean).join("\n--- stderr ---\n").trim() || "(no output)";
    return output.length > MAX_BASH_OUTPUT
      ? `${output.slice(0, MAX_BASH_OUTPUT)}\n… [output truncated at ${MAX_BASH_OUTPUT} chars]`
      : output;
  } catch (error) {
    // Real failures (non-zero exit, timeout) go back to the model verbatim —
    // the error text is what lets it self-correct.
    const err = error as { code?: number | string; killed?: boolean; stdout?: string; stderr?: string; message?: string };
    const parts = [
      err.killed ? `Command timed out after ${timeout}ms.` : `Command failed (exit ${err.code ?? "unknown"}).`,
      err.stdout?.trim(),
      err.stderr?.trim(),
    ].filter(Boolean);
    const output = parts.join("\n");
    throw new Error(output.length > MAX_BASH_OUTPUT ? `${output.slice(0, MAX_BASH_OUTPUT)}\n… [truncated]` : output);
  }
}

async function runSearch(state: AgentSessionState, input: Record<string, unknown>): Promise<string> {
  const mode = asString(input.mode);
  const pattern = asString(input.pattern);
  if (!pattern) throw new Error("pattern is required");
  const searchPath = asString(input.path) || ".";
  resolveWorkspacePath(state.workspace, searchPath);

  if (mode === "glob") {
    const { stdout } = await execFileAsync("/bin/sh", ["-c",
      `find ${JSON.stringify(searchPath)} -type f -path ${JSON.stringify(`*${pattern.replace(/\*\*/g, "*")}`)} -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.next/*' | head -${MAX_SEARCH_RESULTS}`,
    ], { cwd: state.workspace, timeout: 30_000, maxBuffer: 4 * 1024 * 1024, env: subprocessEnv() });
    return stdout.trim() || "No files matched.";
  }

  try {
    const { stdout } = await execFileAsync("grep", [
      "-rn", "-E", "--include=*", "-I",
      "--exclude-dir=node_modules", "--exclude-dir=.git", "--exclude-dir=.next", "--exclude-dir=dist",
      pattern, searchPath,
    ], { cwd: state.workspace, timeout: 30_000, maxBuffer: 8 * 1024 * 1024, env: subprocessEnv() });
    const lines = stdout.trim().split("\n").slice(0, MAX_SEARCH_RESULTS);
    return lines.join("\n") || "No matches.";
  } catch (error) {
    const err = error as { code?: number };
    if (err.code === 1) return "No matches.";
    throw error;
  }
}

async function runWrite(state: AgentSessionState, input: Record<string, unknown>): Promise<string> {
  const filePath = asString(input.file_path);
  if (!filePath) throw new Error("file_path is required");
  const content = typeof input.content === "string" ? input.content : "";
  const resolved = resolveWorkspacePath(state.workspace, filePath);
  const existed = await fs.stat(resolved).then((s) => s.isFile()).catch(() => false);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, "utf8");
  state.readFiles.add(resolved);
  state.editedFiles.add(resolved);
  return `${existed ? "Overwrote" : "Created"} ${filePath} (${content.split("\n").length} lines).`;
}

type MultiEditItem = { old_string: string; new_string: string; replace_all?: boolean };

async function runMultiEdit(state: AgentSessionState, input: Record<string, unknown>): Promise<string> {
  const filePath = asString(input.file_path);
  if (!filePath) throw new Error("file_path is required");
  const edits = Array.isArray(input.edits) ? (input.edits as MultiEditItem[]) : [];
  if (!edits.length) throw new Error("edits must be a non-empty array");
  const resolved = resolveWorkspacePath(state.workspace, filePath);

  const exists = await fs.stat(resolved).then((s) => s.isFile()).catch(() => false);
  if (!exists) throw new Error(`File does not exist: ${filePath}. Use write_file to create it.`);
  if (!state.readFiles.has(resolved)) {
    throw new Error(`You must read ${filePath} before editing it. Use read_file first.`);
  }

  // Apply to an in-memory copy first; only write if every edit lands.
  let content = await fs.readFile(resolved, "utf8");
  edits.forEach((edit, index) => {
    const oldString = typeof edit.old_string === "string" ? edit.old_string : "";
    const newString = typeof edit.new_string === "string" ? edit.new_string : "";
    if (oldString === "") throw new Error(`edits[${index}].old_string is empty.`);
    const occurrences = content.split(oldString).length - 1;
    if (occurrences === 0) throw new Error(`edits[${index}].old_string not found (after earlier edits applied): ${oldString.split("\n")[0].slice(0, 60)}`);
    if (occurrences > 1 && edit.replace_all !== true) {
      throw new Error(`edits[${index}].old_string matches ${occurrences} locations. Add context or set replace_all.`);
    }
    content = edit.replace_all === true ? content.split(oldString).join(newString) : content.replace(oldString, newString);
  });

  await fs.writeFile(resolved, content, "utf8");
  state.editedFiles.add(resolved);
  return `Applied ${edits.length} edit(s) to ${filePath}.`;
}

// SSRF guard: block private, loopback, link-local, and cloud-metadata targets.
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return true;
  if (host === "169.254.169.254" || host === "metadata.google.internal") return true;
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) return true;
  }
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true;
  return false;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
}

async function runWebFetch(input: Record<string, unknown>): Promise<string> {
  const raw = asString(input.url);
  if (!raw) throw new Error("url is required");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error(`Invalid URL: ${raw}`); }
  if (url.protocol !== "https:") throw new Error("Only https:// URLs are allowed.");
  if (isBlockedHost(url.hostname)) throw new Error(`Refusing to fetch a private/internal address: ${url.hostname}`);

  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "TheOneAgent/1.0", "Accept": "text/html,text/plain,application/json;q=0.9,*/*;q=0.8" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new Error(`Fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  // A redirect could land on an internal host — recheck the final URL.
  if (isBlockedHost(new URL(response.url).hostname)) throw new Error("Redirected to a private/internal address; refused.");
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url.hostname}`);

  const contentType = response.headers.get("content-type") || "";
  const body = (await response.text()).slice(0, 400_000);
  const text = /json|text\/plain|application\/xml|\+xml/.test(contentType) ? body : stripHtml(body);
  const clipped = text.length > MAX_BASH_OUTPUT ? `${text.slice(0, MAX_BASH_OUTPUT)}\n… [truncated at ${MAX_BASH_OUTPUT} chars]` : text;
  return `Fetched ${response.url} (${contentType.split(";")[0] || "unknown"}):\n\n${clipped}`;
}

const MUTATING_TOOLS = new Set<string>(["edit_file", "write_file", "multi_edit"]);

async function runImage(state: AgentSessionState, input: Record<string, unknown>): Promise<{ output: string; images: Array<{ mediaType: string; data: string }> }> {
  const filePath = asString(input.file_path);
  if (!filePath) throw new Error("file_path is required");
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const mediaType = IMAGE_MEDIA_TYPES[ext];
  if (!mediaType) throw new Error(`Unsupported image type: .${ext}. Supported: png, jpg, jpeg, gif, webp.`);
  const resolved = resolveWorkspacePath(state.workspace, filePath);
  const buffer = await fs.readFile(resolved);
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`Image is ${buffer.length} bytes, over the ${MAX_IMAGE_BYTES}-byte limit. Downsize it first.`);
  }
  state.readFiles.add(resolved);
  return {
    output: `Loaded image ${filePath} (${mediaType}, ${buffer.length} bytes).`,
    images: [{ mediaType, data: buffer.toString("base64") }],
  };
}

export async function executeTool(state: AgentSessionState, call: ToolCall): Promise<ToolResult> {
  try {
    // Plan mode refuses file mutations so the run stays a read-only proposal.
    if (state.planMode && MUTATING_TOOLS.has(call.name)) {
      return {
        toolCallId: call.id,
        ok: false,
        output: `ERROR: ${call.name} is disabled in plan mode. Explore with read_file/search/web_fetch, then finish with a step-by-step plan (no changes).`,
      };
    }
    // read_image returns image blocks, not just text.
    if (call.name === "read_image") {
      const result = await runImage(state, call.input);
      return { toolCallId: call.id, ok: true, output: result.output, images: result.images };
    }
    let output: string;
    switch (call.name) {
      case "read_file": output = await runRead(state, call.input); break;
      case "edit_file": output = await runEdit(state, call.input); break;
      case "bash": output = await runBash(state, call.input); break;
      case "search": output = await runSearch(state, call.input); break;
      case "write_file": output = await runWrite(state, call.input); break;
      case "multi_edit": output = await runMultiEdit(state, call.input); break;
      case "web_fetch": output = await runWebFetch(call.input); break;
      default: throw new Error(`Unknown tool: ${call.name}`);
    }
    return { toolCallId: call.id, ok: true, output };
  } catch (error) {
    return {
      toolCallId: call.id,
      ok: false,
      output: `ERROR: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
