import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { resolveWorkspacePath } from './workspace';
import type { AgentSessionState, ToolCall, ToolResult } from './types';

const execFileAsync = promisify(execFile);

const MAX_READ_LINES = 2000;
const MAX_LINE_CHARS = 2000;
const MAX_BASH_OUTPUT = 30_000;
const DEFAULT_BASH_TIMEOUT_MS = 120_000;
const MAX_BASH_TIMEOUT_MS = 600_000;
const MAX_SEARCH_RESULTS = 100;

// Bash subprocesses must not see the runtime's credentials (the engine's
// own API key included) — the model could otherwise echo them.
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
    name: 'read_file',
    description: 'Reads a file from the workspace. Returns cat -n style output (line numbers starting at 1). Reads up to 2000 lines by default; use offset/limit for larger files. You must read a file before editing it.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Path relative to the workspace root (absolute paths inside the workspace also accepted)' },
        offset: { type: 'number', description: 'Line number to start reading from (1-indexed)' },
        limit: { type: 'number', description: 'Number of lines to read' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'edit_file',
    description: 'Performs exact string replacement in a file. old_string must match the file contents exactly (including whitespace) and must be unique in the file unless replace_all is true. You must read the file first. To create a new file, pass an empty old_string on a path that does not exist.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: { type: 'string', description: 'Path relative to the workspace root' },
        old_string: { type: 'string', description: 'The exact text to replace (empty string to create a new file)' },
        new_string: { type: 'string', description: 'The replacement text' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence (default false)' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'bash',
    description: 'Executes a shell command in the workspace and returns stdout+stderr. Output over 30000 characters is truncated. Default timeout 120s (max 600s via timeout_ms). Use for running tests, builds, git, and inspection commands.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'The command to execute' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds (max 600000)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'search',
    description: 'Searches the workspace. mode "grep" searches file contents with a regex pattern; mode "glob" finds files by name pattern (e.g. "src/**/*.ts"). Returns up to 100 matches.',
    input_schema: {
      type: 'object' as const,
      properties: {
        mode: { type: 'string', enum: ['grep', 'glob'], description: 'grep = content regex search, glob = filename pattern' },
        pattern: { type: 'string', description: 'Regex (grep) or glob pattern (glob)' },
        path: { type: 'string', description: 'Subdirectory to search (default workspace root)' },
      },
      required: ['mode', 'pattern'],
    },
  },
];

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

async function runRead(state: AgentSessionState, input: Record<string, unknown>): Promise<string> {
  const filePath = asString(input.file_path);
  if (!filePath) throw new Error('file_path is required');
  const resolved = resolveWorkspacePath(state.workspace, filePath);

  const content = await fs.readFile(resolved, 'utf8');
  const lines = content.split('\n');
  const offset = Math.max(1, Number(input.offset) || 1);
  const limit = Math.max(1, Math.min(Number(input.limit) || MAX_READ_LINES, MAX_READ_LINES));
  const slice = lines.slice(offset - 1, offset - 1 + limit);

  state.readFiles.add(resolved);

  const numbered = slice
    .map((line, index) => `${String(offset + index).padStart(6)}\t${line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}… [line truncated]` : line}`)
    .join('\n');
  const remaining = lines.length - (offset - 1 + slice.length);
  return remaining > 0 ? `${numbered}\n… (${remaining} more lines — use offset to continue)` : numbered;
}

async function runEdit(state: AgentSessionState, input: Record<string, unknown>): Promise<string> {
  const filePath = asString(input.file_path);
  if (!filePath) throw new Error('file_path is required');
  const oldString = asString(input.old_string);
  const newString = asString(input.new_string);
  const replaceAll = input.replace_all === true;
  const resolved = resolveWorkspacePath(state.workspace, filePath);

  const exists = await fs.stat(resolved).then((s) => s.isFile()).catch(() => false);

  // New-file creation path.
  if (!exists) {
    if (oldString !== '') {
      throw new Error(`File does not exist: ${filePath}. To create it, pass an empty old_string.`);
    }
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, newString, 'utf8');
    state.readFiles.add(resolved);
    state.editedFiles.add(resolved);
    return `Created ${filePath} (${newString.split('\n').length} lines).`;
  }

  if (!state.readFiles.has(resolved)) {
    throw new Error(`You must read ${filePath} before editing it. Use read_file first.`);
  }
  if (oldString === '') {
    throw new Error(`File already exists: ${filePath}. Provide the exact old_string to replace.`);
  }
  if (oldString === newString) {
    throw new Error('old_string and new_string are identical.');
  }

  const content = await fs.readFile(resolved, 'utf8');
  const occurrences = content.split(oldString).length - 1;

  if (occurrences === 0) {
    // Help the model self-correct: point to the closest line.
    const firstLine = oldString.split('\n')[0]?.trim().slice(0, 80);
    const hint = firstLine && content.includes(firstLine)
      ? ` The first line of old_string appears in the file — check whitespace/indentation of the following lines.`
      : '';
    throw new Error(`old_string not found in ${filePath}.${hint}`);
  }
  if (occurrences > 1 && !replaceAll) {
    throw new Error(`old_string matches ${occurrences} locations in ${filePath}. Add surrounding context to make it unique, or pass replace_all: true.`);
  }

  const updated = replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, newString);
  await fs.writeFile(resolved, updated, 'utf8');
  state.editedFiles.add(resolved);
  return `Edited ${filePath}: replaced ${replaceAll ? occurrences : 1} occurrence(s).`;
}

async function runBash(state: AgentSessionState, input: Record<string, unknown>): Promise<string> {
  const command = asString(input.command);
  if (!command) throw new Error('command is required');
  const timeout = Math.min(Math.max(Number(input.timeout_ms) || DEFAULT_BASH_TIMEOUT_MS, 1000), MAX_BASH_TIMEOUT_MS);

  state.commands.push(command);

  try {
    const { stdout, stderr } = await execFileAsync('/bin/sh', ['-c', command], {
      cwd: state.workspace,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...subprocessEnv(), CI: 'true' },
    });
    const output = [stdout, stderr].filter(Boolean).join('\n--- stderr ---\n').trim() || '(no output)';
    return output.length > MAX_BASH_OUTPUT
      ? `${output.slice(0, MAX_BASH_OUTPUT)}\n… [output truncated at ${MAX_BASH_OUTPUT} chars]`
      : output;
  } catch (error) {
    // Real failures (non-zero exit, timeout) go back to the model verbatim —
    // the error text is what lets it self-correct.
    const err = error as { code?: number | string; killed?: boolean; stdout?: string; stderr?: string; message?: string };
    const parts = [
      err.killed ? `Command timed out after ${timeout}ms.` : `Command failed (exit ${err.code ?? 'unknown'}).`,
      err.stdout?.trim(),
      err.stderr?.trim(),
    ].filter(Boolean);
    const output = parts.join('\n');
    throw new Error(output.length > MAX_BASH_OUTPUT ? `${output.slice(0, MAX_BASH_OUTPUT)}\n… [truncated]` : output);
  }
}

async function runSearch(state: AgentSessionState, input: Record<string, unknown>): Promise<string> {
  const mode = asString(input.mode);
  const pattern = asString(input.pattern);
  if (!pattern) throw new Error('pattern is required');
  const searchPath = asString(input.path) || '.';
  resolveWorkspacePath(state.workspace, searchPath);

  if (mode === 'glob') {
    const { stdout } = await execFileAsync('/bin/sh', ['-c',
      `find ${JSON.stringify(searchPath)} -type f -path ${JSON.stringify(`*${pattern.replace(/\*\*/g, '*')}`)} -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.next/*' | head -${MAX_SEARCH_RESULTS}`,
    ], { cwd: state.workspace, timeout: 30_000, maxBuffer: 4 * 1024 * 1024, env: subprocessEnv() });
    return stdout.trim() || 'No files matched.';
  }

  try {
    const { stdout } = await execFileAsync('grep', [
      '-rn', '-E', '--include=*', '-I',
      '--exclude-dir=node_modules', '--exclude-dir=.git', '--exclude-dir=.next', '--exclude-dir=dist',
      pattern, searchPath,
    ], { cwd: state.workspace, timeout: 30_000, maxBuffer: 8 * 1024 * 1024, env: subprocessEnv() });
    const lines = stdout.trim().split('\n').slice(0, MAX_SEARCH_RESULTS);
    return lines.join('\n') || 'No matches.';
  } catch (error) {
    const err = error as { code?: number };
    if (err.code === 1) return 'No matches.';
    throw error;
  }
}

export async function executeTool(state: AgentSessionState, call: ToolCall): Promise<ToolResult> {
  try {
    let output: string;
    switch (call.name) {
      case 'read_file': output = await runRead(state, call.input); break;
      case 'edit_file': output = await runEdit(state, call.input); break;
      case 'bash': output = await runBash(state, call.input); break;
      case 'search': output = await runSearch(state, call.input); break;
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
