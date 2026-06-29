'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { friendlyStatus } from '@/components/theone/ProductNav';

const modes = ['manual', 'assist', 'auto'] as const;

type Mode = typeof modes[number];
type Locale = 'zh' | 'en';

type ConversationMessage = {
  id: string;
  role: 'assistant' | 'user' | 'system';
  content: string;
  createdAt: string;
  result?: any;
};

type CommandItem = {
  key: string;
  label: string;
  prompt: string;
  meta: string;
  source: 'template' | 'worker';
  action?: string;
  labelZh?: string;
  promptZh?: string;
  metaZh?: string;
};

type ChatAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  sourceId?: string;
  contentRef?: string;
  textHash?: string;
  path?: string;
  text?: string;
  textPreview?: string;
  reportContext?: string;
  summary?: string;
  insights?: Record<string, unknown>;
  error?: string;
  status: 'uploading' | 'ready' | 'failed';
};

type StreamEvent = {
  id: string;
  event: string;
  data: any;
  createdAt: string;
};

type TimelineItem = {
  key: string;
  title: string;
  detail: string;
  status: 'ready' | 'running' | 'done' | 'blocked' | 'waiting';
};

const workerPrompts = [
  {
    label: 'Web research',
    labelZh: '网页研究',
    prompt: 'Analyze website weareoneconnection.org and summarize useful findings',
    promptZh: '分析 weareoneconnection.org，并总结有价值发现',
  },
  {
    label: 'X growth',
    labelZh: 'X 增长',
    prompt: 'Prepare a high-signal X post: TheOne is becoming an AI operating system for real-world work.',
    promptZh: '准备一条高质量 X 推文：TheOne 正在成为真实世界工作的 AI 操作系统',
  },
  {
    label: 'GitHub',
    labelZh: 'GitHub',
    prompt: 'Check GitHub repo weareoneconnection/theone and explain what needs attention',
    promptZh: '检查 GitHub 仓库 weareoneconnection/theone，并说明需要关注的问题',
  },
  {
    label: 'Desktop',
    labelZh: '本地电脑',
    prompt: 'Use the local desktop bridge to inspect Chrome',
    promptZh: '使用本地桌面桥接检查 Chrome',
  },
  {
    label: 'Files',
    labelZh: '文件',
    prompt: 'List files in /tmp',
    promptZh: '列出 /tmp 里的文件',
  },
  {
    label: 'Report',
    labelZh: '报告',
    prompt: 'Create a report from research and proof',
    promptZh: '根据研究结果和证明记录生成报告',
  },
  {
    label: 'OneAI Bot',
    labelZh: 'OneAI Bot',
    prompt: 'Check the OneAI Bot bridge status and explain how it connects to TheOne',
    promptZh: '检查 OneAI Bot 桥接状态，并说明它如何接入 TheOne',
  },
  {
    label: 'API',
    labelZh: 'API',
    prompt: 'Call the OneClaw health API and summarize the result',
    promptZh: '调用 OneClaw 健康检查 API，并总结结果',
  },
];

const sessionShortcuts = [
  { label: 'New chat', labelZh: '新对话', href: '/run' },
  { label: 'Search', labelZh: '历史', href: '/runs' },
  { label: 'Workspaces', labelZh: '工作区', href: '/workspaces' },
];

const runCopy = {
  zh: {
    brand: 'TheOne',
    brandMark: 'AI OS',
    navNew: '新对话',
    activeWork: '当前工作',
    emptyWork: '开始一个任务，TheOne 会生成可追踪的工作线程。',
    history: '历史',
    settings: '设置',
    admin: '后台',
    topKicker: 'TheOne',
    publicWindow: '对外窗口',
    currentWork: '当前工作',
    hideInspector: '隐藏检查器',
    starter: '告诉我你想完成什么。TheOne 可以直接回答、规划工作流、调用 OneClaw workers、在需要时请求批准，并返回清晰结果和证明。',
    welcomeKicker: 'TheOne AI OS / 智能体操作系统',
    welcomeTitle: '把目标交给 TheOne。',
    welcomeBody: '用普通语言描述结果。TheOne 会调用 OneAI 大脑规划，经过策略检查，再把可执行工作交给 OneClaw，并把过程、证明和结果整理成你能直接使用的答案。',
    trustOneAI: 'OneAI 大脑',
    trustOneAIDetail: '理解目标与生成工作流',
    trustTheOne: 'TheOne 内核',
    trustTheOneDetail: '策略、权限、证明、记忆',
    trustOneClaw: 'OneClaw 执行',
    trustOneClawDetail: 'Workers、Apps、连接器',
    messageYou: '你',
    messageAssistant: 'TheOne',
    messageSystem: '系统',
    commands: '/ 指令',
    worker: '@ Worker',
    attach: '上传文件',
    commandPalette: '能力面板',
    searchPlaceholder: '搜索 App、Worker 或动作...',
    noCommand: '还没有匹配的指令。',
    workerRoute: 'Worker 路由',
    clear: '清除',
    shortcut: 'Cmd/Ctrl + Enter',
    placeholder: '让 TheOne 完成一个目标：读文件、分析网站、发 X、查 GitHub、控制本地电脑、生成报告...',
    sending: '执行中...',
    uploading: '上传中...',
    send: '发送',
    readReport: '读取并报告',
    attachmentWait: '附件仍在上传。上传完成后我就可以读取它。',
    resumeLoaded: '已载入任务',
    resumeHint: '告诉我你想修改、重试、总结或继续。',
    inspectorTitle: '工作检查器',
    inspectorSubtitle: '需要时查看当前目标、策略门、证明和原始细节。',
    currentGoal: '当前目标',
    defaultGoal: '先理解用户目标，再选择 App 或 Worker。',
    mode: '模式',
    intent: '意图',
    plan: '计划',
    describeOutcome: '描述一个目标',
    taskStep: '任务步骤',
    actions: '动作',
    details: '细节',
    continue: '继续',
    retry: '重试',
    report: '报告',
    save: '保存',
    approveAll: '全部批准',
    rejectAll: '全部拒绝',
    needsDecision: '需要决定',
    ready: '就绪',
  },
  en: {
    brand: 'TheOne',
    brandMark: 'AI OS',
    navNew: 'New chat',
    activeWork: 'Active Work',
    emptyWork: 'Start a mission to build the working thread.',
    history: 'History',
    settings: 'Settings',
    admin: 'Admin',
    topKicker: 'TheOne',
    publicWindow: 'Public window',
    currentWork: 'Current work',
    hideInspector: 'Hide inspector',
    starter: 'Tell me what you want finished. I can answer directly, plan a workflow, call OneClaw workers, ask for approval when needed, and return a clear result with proof.',
    welcomeKicker: 'TheOne AI OS',
    welcomeTitle: 'Tell TheOne what to finish.',
    welcomeBody: 'Describe the outcome in plain language. TheOne asks the OneAI brain to plan, checks policy, sends executable work to OneClaw, then returns a usable answer with proof.',
    trustOneAI: 'OneAI Brain',
    trustOneAIDetail: 'Goal reasoning and workflow design',
    trustTheOne: 'TheOne Kernel',
    trustTheOneDetail: 'Policy, permission, proof, memory',
    trustOneClaw: 'OneClaw Execution',
    trustOneClawDetail: 'Workers, apps, connectors',
    messageYou: 'You',
    messageAssistant: 'TheOne',
    messageSystem: 'System',
    commands: '/ Commands',
    worker: '@ Worker',
    attach: 'Attach',
    commandPalette: 'Command palette',
    searchPlaceholder: 'Search apps, workers, or actions...',
    noCommand: 'No matching command yet.',
    workerRoute: 'Worker route',
    clear: 'Clear',
    shortcut: 'Cmd/Ctrl + Enter',
    placeholder: 'Ask TheOne to finish a job, read files, inspect a site, prepare an X post, check GitHub, use desktop bridge...',
    sending: 'Working...',
    uploading: 'Uploading...',
    send: 'Send',
    readReport: 'Read + report',
    attachmentWait: 'The attachment is still uploading. I will be able to read it as soon as it is ready.',
    resumeLoaded: 'I loaded mission',
    resumeHint: 'Tell me what to change, retry, summarize, or continue.',
    inspectorTitle: 'Inspector',
    inspectorSubtitle: 'Current work, gates, proof, and raw details when needed.',
    currentGoal: 'Current goal',
    defaultGoal: 'Understand the user outcome before routing workers.',
    mode: 'Mode',
    intent: 'Intent',
    plan: 'Plan',
    describeOutcome: 'Describe an outcome',
    taskStep: 'Task step',
    actions: 'Actions',
    details: 'Details',
    continue: 'Continue',
    retry: 'Retry',
    report: 'Report',
    save: 'Save',
    approveAll: 'Approve all',
    rejectAll: 'Reject all',
    needsDecision: 'Needs decision',
    ready: 'ready',
  },
} satisfies Record<Locale, Record<string, string>>;

function copyFor(locale: Locale) {
  return runCopy[locale];
}

function localizedPrompt(item: typeof workerPrompts[number], locale: Locale) {
  return locale === 'zh' ? item.promptZh : item.prompt;
}

function localizedLabel(item: { label: string; labelZh?: string }, locale: Locale) {
  return locale === 'zh' ? item.labelZh || item.label : item.label;
}

function starterMessageFor(locale: Locale): ConversationMessage {
  return {
    id: 'assistant_starter',
    role: 'assistant',
    createdAt: new Date().toISOString(),
    content: copyFor(locale).starter,
  };
}

const liveProgressStagesByLocale: Record<Locale, string[]> = {
  zh: ['理解请求', '选择路线', '检查安全策略', '执行工作', '收集证明', '生成回答'],
  en: ['Understanding request', 'Choosing route', 'Checking safety', 'Running work', 'Collecting proof', 'Writing answer'],
};

const liveProgressStages = [
  'Understanding request',
  'Choosing route',
  'Checking safety',
  'Running work',
  'Collecting proof',
  'Writing answer',
];

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

const MAX_SERVER_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_ATTACHMENT_TEXT = 160_000;
const MAX_ATTACHMENT_REPORT_CONTEXT = 48_000;
const MAX_SPREADSHEET_ROWS_PER_SHEET = 300;
const MAX_SPREADSHEET_COLUMNS_PER_ROW = 40;

function isPdfUpload(file: File) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function isSpreadsheetUpload(file: File) {
  const name = file.name.toLowerCase();
  return /\.(xlsx|xls|csv|tsv)$/i.test(name)
    || [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'text/tab-separated-values',
    ].includes(file.type);
}

function isXlsxUpload(file: File) {
  return /\.xlsx$/i.test(file.name)
    || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

function isDelimitedSpreadsheetUpload(file: File) {
  return /\.(csv|tsv)$/i.test(file.name)
    || ['text/csv', 'text/tab-separated-values'].includes(file.type);
}

function compactText(value: string) {
  return value.replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

async function hashAttachmentText(value: string) {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

function buildBrowserReportContext(input: {
  id: string;
  name: string;
  type: string;
  text: string;
  pages?: number;
  sheets?: number;
  rows?: number;
  columns?: number;
  words: number;
}) {
  return [
    `THEONE_ATTACHMENT_SOURCE ${input.id}`,
    `File: ${input.name}`,
    `Type: ${input.type}`,
    typeof input.pages === 'number' ? `Estimated pages: ${input.pages}` : '',
    typeof input.sheets === 'number' ? `Sheets: ${input.sheets}` : '',
    typeof input.rows === 'number' ? `Rows: ${input.rows}` : '',
    typeof input.columns === 'number' ? `Estimated columns: ${input.columns}` : '',
    `Words: ${input.words}`,
    'Recommended report sections: Executive summary | Key findings | Risks and issues | Action items | Evidence',
    'Readable content:',
    input.text,
  ].filter(Boolean).join('\n\n').slice(0, MAX_ATTACHMENT_REPORT_CONTEXT);
}

async function extractPdfTextInBrowser(file: File) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/legacy/build/pdf.worker.mjs',
      import.meta.url
    ).toString();
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({
    data: bytes,
    useSystemFonts: true,
  } as any);
  const document = await task.promise;
  const parts: string[] = [];
  const maxPages = Math.min(Number(document.numPages || 0), 200);

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const line = (content.items || [])
      .map((item: any) => typeof item?.str === 'string' ? item.str : '')
      .filter(Boolean)
      .join(' ')
      .replace(/[^\S\n]+/g, ' ')
      .trim();
    if (line) parts.push(line);
    if (parts.join('\n\n').length >= MAX_ATTACHMENT_TEXT) break;
  }

  return {
    pages: maxPages,
    text: compactText(parts.join('\n\n')).slice(0, MAX_ATTACHMENT_TEXT),
  };
}

async function buildBrowserPdfAttachment(file: File): Promise<ChatAttachment> {
  const id = createId('attachment_pdf');
  try {
    const extracted = await extractPdfTextInBrowser(file);
    const words = extracted.text ? extracted.text.split(/\s+/).filter(Boolean).length : 0;
    if (!extracted.text || words < 20) {
      return {
        id,
        name: file.name,
        type: file.type || 'application/pdf',
        size: file.size,
        status: 'failed',
        summary: 'The browser could open the PDF but did not find readable text.',
        error: 'This PDF may be scanned/image-only. OCR is not connected in the current upload path.',
        insights: {
          kind: 'pdf',
          readable: false,
          recommendedWorker: 'document.parse',
          reportReadiness: 'needs_ocr',
        },
      };
    }

    const textHash = await hashAttachmentText(extracted.text);
    const reportContext = buildBrowserReportContext({
      id,
      name: file.name,
      type: file.type || 'application/pdf',
      text: extracted.text,
      pages: extracted.pages,
      words,
    });
    return {
      id,
      name: file.name,
      type: file.type || 'application/pdf',
      size: file.size,
      sourceId: id,
      contentRef: `theone://browser-attachment/${id}`,
      textHash,
      text: extracted.text,
      textPreview: extracted.text.slice(0, 12000),
      reportContext,
      summary: compactText(extracted.text).slice(0, 500),
      status: 'ready',
      insights: {
        schemaVersion: 'theone.attachment_insights.v1',
        kind: 'pdf',
        readable: true,
        extraction: 'browser_pdfjs_extract',
        recommendedWorker: 'document.parse',
        pageEstimate: extracted.pages,
        wordCount: words,
        reportContextAvailable: true,
        reportReadiness: 'ready',
        storage: {
          provider: 'browser_attachment_context',
          durable: false,
          uploadTextAvailable: true,
          pathAvailable: false,
        },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Browser PDF parsing failed.';
    return {
      id,
      name: file.name,
      type: file.type || 'application/pdf',
      size: file.size,
      status: 'failed',
      summary: `Browser PDF parsing failed: ${message}`,
      error: message,
      insights: {
        kind: 'pdf',
        readable: false,
        recommendedWorker: 'document.parse',
        reportReadiness: 'failed',
      },
    };
  }
}

type BrowserZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
};

function readUInt16(view: DataView, offset: number) {
  return view.getUint16(offset, true);
}

function readUInt32(view: DataView, offset: number) {
  return view.getUint32(offset, true);
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripXmlText(xml: string) {
  return decodeXmlEntities(xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function findZipEntries(bytes: Uint8Array): BrowserZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocdOffset = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 66_000); offset -= 1) {
    if (readUInt32(view, offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('Spreadsheet ZIP directory was not found.');

  const totalEntries = readUInt16(view, eocdOffset + 10);
  let centralOffset = readUInt32(view, eocdOffset + 16);
  const decoder = new TextDecoder();
  const entries: BrowserZipEntry[] = [];

  for (let index = 0; index < totalEntries; index += 1) {
    if (centralOffset + 46 > bytes.length || readUInt32(view, centralOffset) !== 0x02014b50) break;
    const method = readUInt16(view, centralOffset + 10);
    const compressedSize = readUInt32(view, centralOffset + 20);
    const nameLength = readUInt16(view, centralOffset + 28);
    const extraLength = readUInt16(view, centralOffset + 30);
    const commentLength = readUInt16(view, centralOffset + 32);
    const localHeaderOffset = readUInt32(view, centralOffset + 42);
    const nameBytes = bytes.slice(centralOffset + 46, centralOffset + 46 + nameLength);
    entries.push({
      name: decoder.decode(nameBytes),
      method,
      compressedSize,
      localHeaderOffset,
    });
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

async function inflateZipEntry(bytes: Uint8Array, entry: BrowserZipEntry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const localOffset = entry.localHeaderOffset;
  if (localOffset + 30 > bytes.length || readUInt32(view, localOffset) !== 0x04034b50) {
    throw new Error(`Invalid XLSX local header for ${entry.name}.`);
  }
  const nameLength = readUInt16(view, localOffset + 26);
  const extraLength = readUInt16(view, localOffset + 28);
  const dataStart = localOffset + 30 + nameLength + extraLength;
  const compressed = bytes.slice(dataStart, dataStart + entry.compressedSize);

  if (entry.method === 0) return compressed;
  if (entry.method !== 8) throw new Error(`Unsupported XLSX compression method ${entry.method}.`);

  const Decompression = (globalThis as any).DecompressionStream;
  if (!Decompression) {
    throw new Error('This browser does not support built-in XLSX decompression yet.');
  }
  const stream = new Blob([compressed]).stream().pipeThrough(new Decompression('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntryText(bytes: Uint8Array, entries: BrowserZipEntry[], name: string) {
  const entry = entries.find((item) => item.name === name);
  if (!entry) return '';
  const inflated = await inflateZipEntry(bytes, entry);
  return new TextDecoder().decode(inflated);
}

function parseSharedStrings(xml: string) {
  if (!xml) return [];
  return Array.from(xml.matchAll(/<si\b[\s\S]*?<\/si>/g)).map((match) => stripXmlText(match[0]));
}

function parseWorkbookSheets(workbookXml: string, relsXml: string, entries: BrowserZipEntry[]) {
  const rels = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b([^>]+)>/g)) {
    const attrs = match[1] || '';
    const id = attrs.match(/\bId="([^"]+)"/)?.[1];
    const target = attrs.match(/\bTarget="([^"]+)"/)?.[1];
    if (!id || !target) continue;
    const normalized = target.startsWith('/')
      ? target.replace(/^\//, '')
      : `xl/${target}`.replace(/\/\.\//g, '/');
    rels.set(id, normalized);
  }

  const sheets = Array.from(workbookXml.matchAll(/<sheet\b([^>]+)>/g)).map((match, index) => {
    const attrs = match[1] || '';
    const name = decodeXmlEntities(attrs.match(/\bname="([^"]+)"/)?.[1] || `Sheet ${index + 1}`);
    const relId = attrs.match(/\br:id="([^"]+)"/)?.[1];
    const path = relId ? rels.get(relId) : undefined;
    return { name, path };
  }).filter((sheet) => sheet.path);

  if (sheets.length) return sheets as Array<{ name: string; path: string }>;

  return entries
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name))
    .map((entry, index) => ({ name: `Sheet ${index + 1}`, path: entry.name }));
}

function parseWorksheetRows(xml: string, sharedStrings: string[]) {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[\s\S]*?<\/row>/g)) {
    const cells: string[] = [];
    const rowXml = rowMatch[0];
    for (const cellMatch of rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      if (cells.length >= MAX_SPREADSHEET_COLUMNS_PER_ROW) break;
      const attrs = cellMatch[1] || '';
      const cellXml = cellMatch[2] || '';
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      let value = '';
      if (type === 's') {
        const index = Number(cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] || NaN);
        value = Number.isFinite(index) ? sharedStrings[index] || '' : '';
      } else if (type === 'inlineStr') {
        value = stripXmlText(cellXml.match(/<is>([\s\S]*?)<\/is>/)?.[1] || cellXml);
      } else {
        value = decodeXmlEntities(cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] || stripXmlText(cellXml));
      }
      cells.push(compactText(value));
    }
    if (cells.some(Boolean)) rows.push(cells);
    if (rows.length >= MAX_SPREADSHEET_ROWS_PER_SHEET) break;
  }
  return rows;
}

async function extractXlsxTextInBrowser(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = findZipEntries(bytes);
  const [sharedXml, workbookXml, relsXml] = await Promise.all([
    readZipEntryText(bytes, entries, 'xl/sharedStrings.xml'),
    readZipEntryText(bytes, entries, 'xl/workbook.xml'),
    readZipEntryText(bytes, entries, 'xl/_rels/workbook.xml.rels'),
  ]);
  const sharedStrings = parseSharedStrings(sharedXml);
  const sheets = parseWorkbookSheets(workbookXml, relsXml, entries);
  const parts: string[] = [];
  let totalRows = 0;
  let maxColumns = 0;

  for (const sheet of sheets.slice(0, 20)) {
    const sheetXml = await readZipEntryText(bytes, entries, sheet.path);
    if (!sheetXml) continue;
    const rows = parseWorksheetRows(sheetXml, sharedStrings);
    totalRows += rows.length;
    maxColumns = Math.max(maxColumns, ...rows.map((row) => row.length), 0);
    parts.push(`## Sheet: ${sheet.name}`);
    parts.push(rows.map((row) => row.join('\t')).join('\n'));
    if (parts.join('\n\n').length >= MAX_ATTACHMENT_TEXT) break;
  }

  return {
    sheets: sheets.length,
    rows: totalRows,
    columns: maxColumns,
    text: compactText(parts.join('\n\n')).slice(0, MAX_ATTACHMENT_TEXT),
  };
}

async function extractDelimitedSpreadsheetText(file: File) {
  const raw = await file.text();
  const delimiter = /\.tsv$/i.test(file.name) || file.type === 'text/tab-separated-values' ? '\t' : ',';
  const lines = raw.split(/\r?\n/).filter((line) => line.trim()).slice(0, 1200);
  const columns = lines.reduce((max, line) => Math.max(max, line.split(delimiter).length), 0);
  return {
    sheets: 1,
    rows: lines.length,
    columns,
    text: compactText(lines.join('\n')).slice(0, MAX_ATTACHMENT_TEXT),
  };
}

async function buildBrowserSpreadsheetAttachment(file: File): Promise<ChatAttachment> {
  const id = createId('attachment_sheet');
  if (!isXlsxUpload(file) && !isDelimitedSpreadsheetUpload(file)) {
    return {
      id,
      name: file.name,
      type: file.type || 'application/vnd.ms-excel',
      size: file.size,
      status: 'failed',
      summary: 'Legacy spreadsheet format is not readable in the browser upload path.',
      error: 'Please save this spreadsheet as .xlsx, .csv, or .tsv, then attach it again.',
      insights: {
        kind: 'spreadsheet',
        readable: false,
        recommendedWorker: 'spreadsheet.read',
        reportReadiness: 'legacy_xls_not_supported_in_browser',
      },
    };
  }

  try {
    const extracted = isXlsxUpload(file)
      ? await extractXlsxTextInBrowser(file)
      : await extractDelimitedSpreadsheetText(file);
    const words = extracted.text ? extracted.text.split(/\s+/).filter(Boolean).length : 0;
    if (!extracted.text || words < 3) {
      return {
        id,
        name: file.name,
        type: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: file.size,
        status: 'failed',
        summary: 'The spreadsheet opened but no readable table text was found.',
        error: 'The workbook may be empty, protected, or image-only.',
        insights: {
          kind: 'spreadsheet',
          readable: false,
          recommendedWorker: 'spreadsheet.read',
          reportReadiness: 'no_readable_cells',
        },
      };
    }

    const textHash = await hashAttachmentText(extracted.text);
    const reportContext = buildBrowserReportContext({
      id,
      name: file.name,
      type: file.type || 'spreadsheet',
      text: extracted.text,
      sheets: extracted.sheets,
      rows: extracted.rows,
      columns: extracted.columns,
      words,
    });

    return {
      id,
      name: file.name,
      type: file.type || 'spreadsheet',
      size: file.size,
      sourceId: id,
      contentRef: `theone://browser-attachment/${id}`,
      textHash,
      text: extracted.text,
      textPreview: extracted.text.slice(0, 12000),
      reportContext,
      summary: compactText(extracted.text).slice(0, 500),
      status: 'ready',
      insights: {
        schemaVersion: 'theone.attachment_insights.v1',
        kind: 'spreadsheet',
        readable: true,
        extraction: isXlsxUpload(file) ? 'browser_xlsx_extract' : 'browser_delimited_extract',
        recommendedWorker: 'spreadsheet.read',
        sheetCount: extracted.sheets,
        rowCount: extracted.rows,
        columnEstimate: extracted.columns,
        wordCount: words,
        reportContextAvailable: true,
        reportReadiness: 'ready',
        storage: {
          provider: 'browser_attachment_context',
          durable: false,
          uploadTextAvailable: true,
          pathAvailable: false,
        },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Browser spreadsheet parsing failed.';
    return {
      id,
      name: file.name,
      type: file.type || 'spreadsheet',
      size: file.size,
      status: 'failed',
      summary: `Browser spreadsheet parsing failed: ${message}`,
      error: message,
      insights: {
        kind: 'spreadsheet',
        readable: false,
        recommendedWorker: 'spreadsheet.read',
        reportReadiness: 'failed',
      },
    };
  }
}

async function postChatWithStream(
  payload: Record<string, unknown>,
  onStage: (stage: number) => void,
  onDelta: (text: string) => void,
  onEvent?: (event: string, data: any) => void
) {
  const response = await fetch('/api/theone/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    throw new Error('TheOne stream unavailable.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: any = null;
  let streamError = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const packets = buffer.split('\n\n');
    buffer = packets.pop() || '';

    for (const packet of packets) {
      const event = packet.match(/^event:\s*(.+)$/m)?.[1]?.trim();
      const dataLine = packet.match(/^data:\s*(.+)$/m)?.[1];
      if (!event || !dataLine) continue;
      const data = JSON.parse(dataLine);
      if (event === 'stage') onStage(Number(data.index || 0));
      if (event === 'answer_delta' && typeof data.text === 'string') onDelta(data.text);
      if (!['stage', 'answer_delta', 'result', 'error'].includes(event)) onEvent?.(event, data);
      if (event === 'result') finalResult = data;
      if (event === 'error') streamError = data.error || 'TheOne stream failed.';
    }
  }

  if (streamError) throw new Error(streamError);
  if (!finalResult) throw new Error('TheOne stream finished without a result.');
  return finalResult;
}

async function postChatJson(payload: Record<string, unknown>) {
  const response = await fetch('/api/theone/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return response.json();
}

async function refreshRunResult(runId: string) {
  await new Promise((resolve) => window.setTimeout(resolve, 900));
  const response = await fetch(`/api/theone/runs/${runId}`, { cache: 'no-store' });
  if (!response.ok) return null;
  const data = await response.json();
  return data?.runId ? data : null;
}

function failedServerUploadAttachment(file: File, message: string): ChatAttachment {
  const kind = isSpreadsheetUpload(file) ? 'spreadsheet' : isPdfUpload(file) ? 'document' : 'file';
  const recommendedWorker = kind === 'spreadsheet' ? 'spreadsheet.read' : kind === 'document' ? 'document.parse' : 'file.read';
  return {
    id: createId('attachment_failed'),
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
    status: 'failed',
    summary: message,
    error: message,
    insights: {
      kind,
      readable: false,
      recommendedWorker,
      reportReadiness: 'upload_failed',
    },
  };
}

async function uploadChatAttachments(files: FileList | null): Promise<ChatAttachment[]> {
  const selected = Array.from(files || []).slice(0, 8);
  if (!selected.length) return [];

  const browserAttachments: ChatAttachment[] = [];
  const serverFiles: File[] = [];

  for (const file of selected) {
    if (isPdfUpload(file)) {
      browserAttachments.push(await buildBrowserPdfAttachment(file));
      continue;
    }

    if (isSpreadsheetUpload(file)) {
      browserAttachments.push(await buildBrowserSpreadsheetAttachment(file));
      continue;
    }

    if (file.size > MAX_SERVER_ATTACHMENT_BYTES) {
      browserAttachments.push({
        id: createId('attachment_failed'),
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        status: 'failed',
        summary: 'This file is too large for the current server upload path.',
        error: `The file is ${formatFileSize(file.size)}. The current server upload path is limited to about ${formatFileSize(MAX_SERVER_ATTACHMENT_BYTES)} on production.`,
        insights: {
          kind: 'file',
          readable: false,
          recommendedWorker: 'file.read',
          reportReadiness: 'too_large_for_server_upload',
        },
      });
      continue;
    }

    serverFiles.push(file);
  }

  if (!serverFiles.length) return browserAttachments;

  const form = new FormData();
  serverFiles.forEach((file) => form.append('files', file));
  const response = await fetch('/api/theone/chat/upload', {
    method: 'POST',
    body: form,
  });

  const raw = await response.text();
  let data: any = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    const message = `Attachment upload failed (${response.status}). ${raw.slice(0, 180) || 'The upload endpoint did not return JSON.'}`;
    return [...browserAttachments, ...serverFiles.map((file) => failedServerUploadAttachment(file, message))];
  }

  if (!response.ok || data?.ok === false) {
    const message = data?.error || `Attachment upload failed (${response.status}).`;
    return [...browserAttachments, ...serverFiles.map((file) => failedServerUploadAttachment(file, message))];
  }

  const serverAttachments = (Array.isArray(data.attachments) ? data.attachments : []).map((attachment: any) => ({
    id: String(attachment.id || createId('attachment')),
    name: String(attachment.name || 'attachment'),
    type: String(attachment.type || 'application/octet-stream'),
    size: Number(attachment.size || 0),
    sourceId: typeof attachment.sourceId === 'string' ? attachment.sourceId : undefined,
    contentRef: typeof attachment.contentRef === 'string' ? attachment.contentRef : undefined,
    textHash: typeof attachment.textHash === 'string' ? attachment.textHash : undefined,
    path: typeof attachment.path === 'string' ? attachment.path : undefined,
    text: typeof attachment.text === 'string' ? attachment.text : undefined,
    textPreview: typeof attachment.textPreview === 'string' ? attachment.textPreview : undefined,
    reportContext: typeof attachment.reportContext === 'string' ? attachment.reportContext : undefined,
    summary: typeof attachment.summary === 'string' ? attachment.summary : undefined,
    insights: attachment.insights && typeof attachment.insights === 'object' ? attachment.insights : undefined,
    error: typeof attachment.error === 'string' ? attachment.error : undefined,
    status: attachment.status === 'failed' ? 'failed' as const : 'ready' as const,
  }));

  return [...browserAttachments, ...serverAttachments];
}

function plainResult(result: any) {
  const assistant = result?.chat?.assistant?.content;
  const error = String(result?.error || '');
  const genericStartupFailure = typeof assistant === 'string' &&
    /could not start the intelligent chat workflow/i.test(assistant);
  if (error && (!assistant || genericStartupFailure)) {
    return `TheOne could not start this workflow.\n\nReason: ${error}`;
  }
  const objective = String(result?.intent?.objective || result?.chat?.mission?.objective || '');
  const websiteWorkerExpected = /(https?:\/\/|(?:[a-z0-9-]+\.)+[a-z]{2,})/i.test(objective) &&
    /(website|web page|browse|analy[sz]e|summarize|summary|findings|inspect|extract|网页|网站|浏览|总结|分析|提取)/i.test(objective);
  const misleadingNoWorker = typeof assistant === 'string' &&
    /no external worker was needed/i.test(assistant) &&
    websiteWorkerExpected;
  if (misleadingNoWorker) {
    return 'This website analysis needs the browser worker. Retry the mission so TheOne can route it through OneClaw browser extraction and return the findings.';
  }
  const placeholder = typeof assistant === 'string' &&
    /(please hold|while i gather|i'?ll extract|i will extract|i will gather|let me gather|gather the data|收集数据|正在收集|请稍等)/i.test(assistant);
  if (assistant && !placeholder) return websiteWorkerExpected ? formatWebsiteAnswer(assistant) : assistant;
  if (placeholder) {
    const diagnostic = result?.chat?.workerRuntime?.diagnostics?.userReadable;
    const assessment = result?.chat?.objectiveAssessment?.outcome;
    const nextAction = result?.chat?.objectiveAssessment?.nextAction || result?.chat?.nextActions?.[0];
    const fallback = [assessment, diagnostic, nextAction ? `Next: ${nextAction}` : ''].filter(Boolean).join('\n\n');
    if (fallback) return fallback;
  }
  if (error) return error.replace(/Invalid `prisma[^`]+` invocation:[\s\S]*/i, 'TheOne switched to safe mode because the memory database is temporarily unavailable.');
  if (result?.appResult?.summary) return result.appResult.summary;
  if (result?.appRoute?.summary) return result.appRoute.summary;
  if (result?.summary) return result.summary;
  const oneClaw = [...(result?.executions || [])].reverse().find((execution: any) => execution.provider === 'oneclaw');
  if (oneClaw?.summary) return oneClaw.summary;
  return 'TheOne is ready to plan, check policy, execute, and record proof.';
}

function formatWebsiteAnswer(value: string) {
  const compact = value.replace(/[ \t]+/g, ' ').trim();
  const labelMatches = compact.match(/\b(Outcome|Key findings|Positioning|Useful opportunities|Risks or gaps|Recommended next move)\b/gi) || [];
  if (labelMatches.length < 2) return value.trim();

  return compact
    .replace(/\s*Outcome:\s*/i, 'Outcome\n')
    .replace(/\s*Key findings(?:\s+indicate\s+that)?[:\s]+/i, '\n\nKey findings\n')
    .replace(/\s*Positioning:\s*/i, '\n\nPositioning\n')
    .replace(/\s*Useful opportunities(?:\s+include)?[:\s]+/i, '\n\nUseful opportunities\n')
    .replace(/\s*Risks or gaps:\s*/i, '\n\nRisks / gaps\n')
    .replace(/\s*Recommended next move:\s*/i, '\n\nRecommended next move\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function latestOneClawExecution(result: any) {
  return [...(result?.executions || [])].reverse().find((execution: any) => execution?.provider === 'oneclaw') || null;
}

function normalizedReceiptFromExecution(execution: any) {
  return execution?.raw?.normalizedReceipt || execution?.receipt?.raw?.normalizedReceipt || null;
}

function resultFailureText(result: any) {
  const oneclaw = latestOneClawExecution(result);
  const receipt = normalizedReceiptFromExecution(oneclaw);
  return [
    result?.error,
    result?.summary,
    result?.chat?.workerRuntime?.diagnostics?.userReadable,
    oneclaw?.summary,
    oneclaw?.raw?.oneclawError,
    receipt?.error,
    receipt?.summary,
    ...(Array.isArray(receipt?.nextActions) ? receipt.nextActions : []),
  ].filter(Boolean).join(' ');
}

function isContentLengthFailure(result: any) {
  return /too long|max 280|characters|character limit|字数|超长|超过/i.test(resultFailureText(result));
}

function isDocumentContextIssue(result: any) {
  return /attachment|document|file path|pdf|docx|xlsx|上传|附件|文档|文件/i.test(resultFailureText(result));
}

function runStats(result: any) {
  const approvals = result?.pendingApprovals || result?.approvals || [];
  const pendingApprovals = Array.isArray(approvals)
    ? approvals.filter((approval: any) => approval?.required === true && approval?.status === 'pending')
    : [];

  return {
    approvals: pendingApprovals.length,
    executions: result?.executions?.length || 0,
    proof: result?.proof?.length || result?.proofRecords?.length || 0,
  };
}

function activeStatus(result: any, loading: boolean) {
  if (loading) return 'running';
  if (!result) return 'ready';
  if (result.ok === false) return 'blocked';
  return result?.os?.workflow?.status || result?.status || 'completed';
}

function workerTone(status?: string) {
  if (!status) return 'ready';
  if (/approval|gated|pending|prepared/i.test(status)) return 'assist';
  if (/attention|failed|blocked|error/i.test(status)) return 'blocked';
  return 'ready';
}

function approvalReason(result: any) {
  const approvals = result?.approvals || [];
  return approvals.find((approval: any) => approval?.required && approval?.status === 'pending')?.reason ||
    result?.chat?.workerCoordination?.automationPolicy?.reasons?.join(' ') ||
    '';
}

function evidenceText(result: any) {
  return result?.chat?.workerCoordination?.workerResultText || '';
}

function workStatusLine(result: any) {
  if (!result?.chat && !result?.runId) return null;
  const steps = workflowSteps(result).length || result?.plan?.steps?.length || 0;
  const executions = result?.executions?.length || 0;
  const proof = result?.proof?.length || result?.proofRecords?.length || 0;
  const approvals = pendingApprovals(result).length;
  const pieces = [
    steps ? `${steps} plan step${steps === 1 ? '' : 's'}` : null,
    executions ? `${executions} worker call${executions === 1 ? '' : 's'}` : null,
    proof ? `${proof} proof record${proof === 1 ? '' : 's'}` : null,
    approvals ? `${approvals} approval${approvals === 1 ? '' : 's'} waiting` : null,
  ].filter(Boolean);
  return pieces.length ? pieces.join(' · ') : 'Answered directly';
}

function latestAssistantResult(messages: ConversationMessage[]) {
  return [...messages].reverse().find((message) => message.role === 'assistant' && message.result)?.result || null;
}

function conversationTitle(result: any, messages: ConversationMessage[]) {
  const latestUser = [...messages].reverse().find((message) => message.role === 'user')?.content;
  return result?.chat?.mission?.title ||
    result?.chat?.brain?.objective ||
    result?.intent?.objective ||
    (latestUser ? latestUser.slice(0, 92) : 'New TheOne mission');
}

function formatDuration(ms?: number | null) {
  if (!ms) return 'Ready';
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `Worked for ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `Worked for ${minutes}m ${rest}s`;
}

function formatRelativeTime(value?: string) {
  if (!value) return 'recent';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 'recent';
  const diff = Date.now() - time;
  const minutes = Math.max(0, Math.round(diff / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function runIdOf(run: any) {
  return run?.runId || run?.id || run?.taskId || '';
}

function runTitleOf(run: any) {
  return run?.title ||
    run?.taskName ||
    run?.chat?.mission?.title ||
    run?.metadata?.normalizedTask?.taskName ||
    run?.summary ||
    runIdOf(run) ||
    'TheOne mission';
}

function templateCommands(): CommandItem[] {
  return workerPrompts.map((item) => ({
    key: `template:${item.label}`,
    label: item.label,
    labelZh: item.labelZh,
    prompt: item.prompt,
    promptZh: item.promptZh,
    meta: 'starter',
    metaZh: '示例',
    source: 'template' as const,
  }));
}

function promptForWorker(action: string, title?: string) {
  if (/browser\.extract|browser\.scrape|search\.web/i.test(action)) return `Use ${action} to analyze https://weareoneconnection.org and summarize useful findings`;
  if (/social\.post|x\./i.test(action)) return `Use ${action} to prepare a high-signal X workflow and wait for approval when needed`;
  if (/git\./i.test(action)) return `Use ${action} for repo weareoneconnection/theone and explain what needs attention`;
  if (/desktop\./i.test(action)) return `Use ${action} through the local desktop bridge for Google Chrome`;
  if (/file\.|document\.|spreadsheet\./i.test(action)) return `Use ${action} to inspect files and summarize the result`;
  if (/api\.|webhook|health/i.test(action)) return `Use ${action} to call the OneClaw health API and summarize the response`;
  return `Use ${action || title || 'this worker'} to help finish my task`;
}

function normalizeWorkerCommands(payload: any): CommandItem[] {
  const workers = Array.isArray(payload?.workers) ? payload.workers : [];
  const commands: CommandItem[] = [];
  for (const worker of workers) {
    const rawActions = Array.isArray(worker?.actions)
      ? worker.actions
      : Array.isArray(worker?.capabilities)
        ? worker.capabilities
        : worker?.action
          ? [worker.action]
          : [];
    for (const raw of rawActions) {
      const action = typeof raw === 'string' ? raw : raw?.action || raw?.name || raw?.key;
      if (!action) continue;
      const title = typeof raw === 'string' ? worker?.title || worker?.name : raw?.title || worker?.title || worker?.name;
      const status = raw?.liveMode || raw?.maturity || worker?.status || worker?.mode || 'worker';
      commands.push({
        key: `worker:${worker?.key || worker?.id || worker?.name || 'oneclaw'}:${action}`,
        label: title || action,
        prompt: promptForWorker(action, title),
        meta: `${action} · ${friendlyStatus(status)}${raw?.approvalRequired || worker?.approvalRequired ? ' · approval' : ''}`,
        source: 'worker',
        action,
      });
    }
  }
  return commands;
}

function missionTimeline(result: any, loading: boolean, stage: number): TimelineItem[] {
  const hasResult = Boolean(result?.chat || result?.runId || result?.ok !== undefined);
  const blocked = result?.ok === false || activeStatus(result, loading) === 'blocked';
  const approvals = pendingApprovals(result).length;
  const executions = result?.executions?.length || 0;
  const proof = result?.proof?.length || result?.proofRecords?.length || 0;
  const current = Math.min(stage, 5);
  const timed = (index: number): TimelineItem['status'] => {
    if (blocked && index >= Math.max(2, current)) return 'blocked';
    if (loading && index === current) return 'running';
    if (loading && index > current) return 'waiting';
    return hasResult ? 'done' : index === 0 ? 'ready' : 'waiting';
  };

  return [
    { key: 'intent', title: 'Understand goal', detail: result?.chat?.brain?.objective || 'Turn the message into an outcome.', status: timed(0) },
    { key: 'plan', title: 'Build workflow', detail: result?.chat?.oneAiWorkflow?.summary || 'OneAI creates a structured route.', status: timed(1) },
    { key: 'policy', title: approvals ? 'Approval gate' : 'Policy cleared', detail: approvals ? `${approvals} decision waiting.` : 'TheOne validates risk and mode.', status: approvals ? 'blocked' : timed(2) },
    { key: 'worker', title: executions ? 'Worker called' : 'Prepare worker', detail: executions ? `${executions} execution record(s).` : 'OneClaw route is selected when needed.', status: timed(3) },
    { key: 'proof', title: proof ? 'Proof stored' : 'Collect proof', detail: proof ? `${proof} proof record(s).` : 'Receipts and evidence are attached.', status: timed(4) },
    { key: 'answer', title: 'Return answer', detail: hasResult ? 'Readable result is shown in chat.' : 'TheOne will answer when the route completes.', status: timed(5) },
  ];
}

function workerLifecycle(result: any, execution: any): TimelineItem[] {
  const approvals = pendingApprovals(result);
  const status = String(execution?.status || '').toLowerCase();
  const failed = /failed|error|rejected|blocked/.test(status);
  const completed = /success|completed|mock/.test(status);
  const approvalWaiting = approvals.length > 0;
  return [
    {
      key: 'planned',
      title: 'Planned',
      detail: execution?.taskName || result?.pendingOneClawTask?.taskName || 'TheOne selected a worker route.',
      status: 'done',
    },
    {
      key: 'policy',
      title: approvalWaiting ? 'Approval waiting' : 'Policy cleared',
      detail: approvalWaiting ? `${approvals.length} approval decision needed.` : 'Risk, mode, and worker access checked.',
      status: approvalWaiting ? 'blocked' : 'done',
    },
    {
      key: 'running',
      title: completed || failed ? 'Worker finished' : 'Worker running',
      detail: execution?.externalId || execution?.provider || 'OneClaw worker execution.',
      status: completed || failed ? 'done' : 'running',
    },
    {
      key: 'completed',
      title: failed ? 'Failed' : completed ? 'Completed' : 'Awaiting receipt',
      detail: execution?.summary || 'The worker receipt is tracked by TheOne.',
      status: failed ? 'blocked' : completed ? 'done' : 'waiting',
    },
    {
      key: 'summarized',
      title: 'Summarized',
      detail: result?.chat?.assistant?.content ? 'The result was converted into a readable answer.' : 'TheOne will summarize the worker output.',
      status: result?.chat?.assistant?.content ? 'done' : 'waiting',
    },
  ];
}

function workflowSteps(result: any) {
  return result?.chat?.oneAiWorkflow?.steps || [];
}

function activeWorkflowSteps(result: any) {
  const steps = workflowSteps(result);
  if (steps.length) return steps;
  return result?.plan?.steps || [];
}

function resultActions(result: any) {
  const actions = [
    { label: 'Continue', prompt: 'continue' },
    { label: 'Retry', prompt: 'retry' },
    { label: 'Revise', prompt: 'revise this result to be clearer and more useful' },
    { label: 'Report', prompt: 'turn this result into a concise report' },
    { label: 'Save', prompt: 'save this to TheOne memory' },
  ];
  if (isContentLengthFailure(result)) {
    actions.unshift({
      label: 'Shorten + retry',
      prompt: 'Shorten the failed X/social post so it is under 280 characters, keep the core meaning, then prepare the publish workflow again for approval.',
    });
  }
  if (isDocumentContextIssue(result)) {
    actions.unshift({
      label: 'Use attachment',
      prompt: 'Read the attached document and return a practical report in chat with executive summary, key findings, risks, action items, and evidence.',
    });
  }
  if (result?.chat?.documentRuntime) {
    actions.unshift(
      {
        label: 'Formal report',
        prompt: 'Turn the attached document analysis into a formal report with executive summary, key findings, risk register, action items, and evidence.',
      },
      {
        label: 'Risks',
        prompt: 'Extract a risk register from the attached document with severity, owner, evidence, and recommended action.',
      },
      {
        label: 'Export',
        prompt: 'Export this document report as a polished DOCX or PDF file, and ask for approval if a file worker is required.',
      }
    );
  }
  if (result?.chat?.reportArtifact) {
    actions.unshift(
      {
        label: 'Executive summary',
        prompt: 'Rewrite this report artifact as a sharp executive summary with decisions needed and key evidence.',
      },
      {
        label: 'Action plan',
        prompt: 'Turn this report artifact into an action plan with owners, priorities, dates, and evidence.',
      },
      {
        label: 'Export report',
        prompt: 'Export this report artifact as a polished DOCX or PDF file. Preserve executive summary, findings, risks, action items, evidence, and source files.',
      }
    );
  }
  if (result?.chat?.exportBundle || result?.chat?.deliveryStatus?.files?.length) {
    actions.unshift(
      {
        label: 'Revise + export',
        prompt: 'Revise this report to be clearer, keep the evidence, then export it again as DOCX and PDF.',
      },
      {
        label: 'Short report',
        prompt: 'Create a shorter executive version of this report and export it as DOCX and PDF.',
      }
    );
  }
  if (pendingApprovals(result).length) {
    return [{ label: 'Approve', prompt: 'approve' }, { label: 'Reject', prompt: 'reject' }, ...actions.filter((item) => item.label !== 'Save')];
  }
  return actions;
}

function PlanChecklist({ result }: { result: any }) {
  const steps = activeWorkflowSteps(result).slice(0, 6);
  if (!steps.length) return null;

  return (
    <div className="run-plan-checklist">
      <span>Plan</span>
      {steps.map((step: any, index: number) => (
        <div key={step.id || index}>
          <small>{friendlyStatus(step.status || step.approvalMode || 'ready')}</small>
          <strong>{step.title || step.action || 'Task step'}</strong>
        </div>
      ))}
    </div>
  );
}

function ResultActions({
  result,
  busy,
  content,
  onAction,
}: {
  result: any;
  busy: boolean;
  content: string;
  onAction: (prompt: string) => void;
}) {
  if (!result?.chat && !result?.runId) return null;
  return (
    <div className="run-result-actions">
      <button type="button" disabled={busy} onClick={() => navigator.clipboard?.writeText(content)}>
        Copy
      </button>
      {resultActions(result).map((action) => (
        <button key={action.label} type="button" disabled={busy} onClick={() => onAction(action.prompt)}>
          {action.label}
        </button>
      ))}
      {result.runId ? <Link href={`/runs/${result.runId}`}>Open run</Link> : null}
    </div>
  );
}

function WorkerReceiptSummary({ receipt }: { receipt: any }) {
  if (!receipt?.summary && !receipt?.error && !receipt?.evidence?.length && !receipt?.artifacts?.length) return null;
  return (
    <div className="run-worker-receipt-summary">
      {receipt.error ? <strong>{receipt.error}</strong> : null}
      {receipt.summary ? <p>{receipt.summary}</p> : null}
      {Array.isArray(receipt.evidence) && receipt.evidence.length ? (
        <div>
          <span>Evidence</span>
          {receipt.evidence.slice(0, 3).map((item: string) => <small key={item}>{item}</small>)}
        </div>
      ) : null}
      {Array.isArray(receipt.artifacts) && receipt.artifacts.length ? (
        <div>
          <span>Artifacts</span>
          {receipt.artifacts.slice(0, 3).map((item: string) => <small key={item}>{item}</small>)}
        </div>
      ) : null}
    </div>
  );
}

function DocumentRuntimeCard({ result }: { result: any }) {
  const documentRuntime = result?.chat?.documentRuntime;
  if (!documentRuntime) return null;
  const attachments = Array.isArray(documentRuntime.attachments) ? documentRuntime.attachments : [];
  const stages = Array.isArray(documentRuntime.stages) ? documentRuntime.stages : [];
  return (
    <div className="run-document-runtime-card">
      <div>
        <span>Document workflow</span>
        <strong>{friendlyStatus(documentRuntime.status || 'ready')}</strong>
      </div>
      {attachments.length ? (
        <div className="run-document-files">
          {attachments.slice(0, 3).map((attachment: any) => (
            <small key={attachment.name}>
              {attachment.name}
              <em>
                {attachment.hasReadableText ? 'text extracted' : 'stored file'}
                {attachment.recommendedWorker ? ` · ${attachment.recommendedWorker}` : ''}
                {attachment.pageEstimate ? ` · ${attachment.pageEstimate}p` : ''}
                {attachment.wordCount ? ` · ${attachment.wordCount} words` : ''}
              </em>
            </small>
          ))}
        </div>
      ) : null}
      {stages.length ? (
        <div className="run-document-stages">
          {stages.map((stage: any) => (
            <i key={stage.key} className={`stage-${stage.status}`}>
              <b>{stage.title}</b>
            </i>
          ))}
        </div>
      ) : null}
      {Array.isArray(documentRuntime.nextActions) && documentRuntime.nextActions.length ? (
        <p>{documentRuntime.nextActions.slice(0, 2).join(' ')}</p>
      ) : null}
    </div>
  );
}

function ReportArtifactCard({ result }: { result: any }) {
  const artifact = result?.chat?.reportArtifact || result?.networkSignals?.reportArtifact || result?.appResult?.reportArtifact;
  if (!artifact) return null;
  const sourceFiles = Array.isArray(artifact.sourceFiles) ? artifact.sourceFiles : [];
  const findings = Array.isArray(artifact.keyFindings) ? artifact.keyFindings : [];
  const risks = Array.isArray(artifact.risks) ? artifact.risks : [];
  const actions = Array.isArray(artifact.actionItems) ? artifact.actionItems : [];
  const evidence = Array.isArray(artifact.evidence) ? artifact.evidence : [];
  return (
    <div className="run-report-artifact-card">
      <div className="run-report-artifact-head">
        <span>Report Studio</span>
        <strong>{artifact.format || 'structured'}</strong>
      </div>
      <h3>{artifact.title || 'Document report'}</h3>
      {artifact.executiveSummary ? (
        <section className="run-report-section run-report-summary">
          <span>Executive Summary</span>
          <p>{artifact.executiveSummary}</p>
        </section>
      ) : null}
      <div className="run-report-artifact-grid">
        <div>
          <span>Findings</span>
          <strong>{findings.length}</strong>
        </div>
        <div>
          <span>Risks</span>
          <strong>{risks.length}</strong>
        </div>
        <div>
          <span>Actions</span>
          <strong>{actions.length}</strong>
        </div>
      </div>
      {findings.length ? (
        <section className="run-report-section">
          <span>Key Findings</span>
          <ul>
            {findings.slice(0, 5).map((item: string) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      ) : null}
      {risks.length ? (
        <section className="run-report-section">
          <span>Risks / Issues</span>
          <ul>
            {risks.slice(0, 4).map((item: any, index: number) => (
              <li key={`${item?.title || item}-${index}`}>
                <strong>{item?.severity || 'medium'}</strong>
                {item?.title || String(item)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {actions.length ? (
        <section className="run-report-section">
          <span>Action Items</span>
          <ul>
            {actions.slice(0, 4).map((item: any, index: number) => (
              <li key={`${item?.task || item}-${index}`}>{item?.task || String(item)}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {evidence.length ? (
        <section className="run-report-section">
          <span>Evidence</span>
          <ul>
            {evidence.slice(0, 4).map((item: string) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      ) : null}
      {sourceFiles.length ? (
        <div className="run-report-source-list">
          {sourceFiles.slice(0, 3).map((file: any) => (
            <small key={file.name}>
              {file.name}
              <em>{file.type || 'file'}</em>
            </small>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatFileSize(value: unknown) {
  const size = typeof value === 'number' ? value : Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) return 'ready';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
  return `${Math.round(size / 1024 / 102.4) / 10} MB`;
}

function attachmentInsight(attachment: ChatAttachment, key: string) {
  return attachment.insights && Object.prototype.hasOwnProperty.call(attachment.insights, key)
    ? attachment.insights[key]
    : undefined;
}

function attachmentWorkerLabel(attachment: ChatAttachment) {
  const worker = attachmentInsight(attachment, 'recommendedWorker');
  if (typeof worker === 'string' && worker.trim()) return worker;
  if (attachment.type.includes('pdf') || /\.(pdf|docx?|rtf)$/i.test(attachment.name)) return 'document.parse';
  if (/\.(csv|tsv|xlsx?|xls)$/i.test(attachment.name)) return 'spreadsheet.read';
  if (attachment.type.startsWith('image/')) return 'image.extractText';
  return attachment.text ? 'file.read' : 'file.store';
}

function attachmentQualityLabel(attachment: ChatAttachment) {
  if (attachment.status !== 'ready') {
    const readiness = attachmentInsight(attachment, 'reportReadiness');
    if (typeof readiness === 'string' && readiness.trim()) return readiness.replace(/_/g, '-');
    return attachment.status;
  }
  if (attachment.reportContext || attachmentInsight(attachment, 'reportContextAvailable') === true) return 'report-ready';
  const readable = attachmentInsight(attachment, 'readable');
  const pages = attachmentInsight(attachment, 'pageEstimate');
  const words = attachmentInsight(attachment, 'wordCount');
  if (typeof pages === 'number' && pages > 0) return `${pages} page${pages === 1 ? '' : 's'}`;
  if (typeof words === 'number' && words > 0) return `${words} words`;
  if (readable === true || attachment.text) return 'readable';
  return 'ready';
}

function attachmentTopicLabel(attachment: ChatAttachment) {
  const topics = attachmentInsight(attachment, 'detectedTopics');
  if (!Array.isArray(topics) || !topics.length) return '';
  return topics.slice(0, 2).map(String).join(' + ');
}

function attachmentReportPrompt(attachments: ChatAttachment[]) {
  const names = attachments.map((attachment) => attachment.name).join(', ');
  const workers = Array.from(new Set(attachments.map(attachmentWorkerLabel))).join(', ');
  return [
    `Read the attached file(s): ${names}.`,
    'Use the uploaded attachment content and report context as the source. Do not ask for a file path or URL.',
    `Route through the best available file/document worker (${workers}) when execution is needed.`,
    'Return a practical report with executive summary, key findings, risks/issues, action items, evidence, and recommended next steps.',
    'If the report is useful, prepare export options for DOCX, PDF, Markdown, HTML, and JSON.',
  ].join(' ');
}

function isAttachmentReadRequest(value: string) {
  return /(attach|attached|attachment|file|document|pdf|read|report|summarize|summary|analy[sz]e|附件|文件|文档|合同|读取|阅读|报告|总结|分析)/i.test(value);
}

function failedAttachmentMessage(attachments: ChatAttachment[]) {
  const names = attachments.map((attachment) => attachment.name).filter(Boolean).join(', ') || 'the attachment';
  const reasons = attachments
    .map((attachment) => attachment.error || attachment.summary)
    .filter(Boolean)
    .join(' ');
  return [
    `I can see ${names}, but it is not readable yet.`,
    reasons ? `What happened: ${reasons}` : 'What happened: the upload or document parsing step failed.',
    'Please clear the failed chip, attach the file again, and wait until it shows ready/readable before sending the request.',
  ].join('\n\n');
}

function DeliveryStatusCard({ result }: { result: any }) {
  const delivery = result?.chat?.deliveryStatus || result?.networkSignals?.deliveryStatus;
  const bundle = result?.chat?.exportBundle || result?.networkSignals?.exportBundle;
  const files = Array.isArray(delivery?.files) && delivery.files.length
    ? delivery.files
    : Array.isArray(bundle?.files)
      ? bundle.files
      : [];
  if (!delivery && !files.length) return null;
  const stages = Array.isArray(delivery?.stages) ? delivery.stages : [];
  return (
    <div className="run-delivery-status-card">
      <div className="run-delivery-head">
        <span>Delivery</span>
        <strong>{friendlyStatus(delivery?.status || (files.length ? 'export_ready' : 'ready'))}</strong>
      </div>
      {stages.length ? (
        <div className="run-delivery-stages">
          {stages.map((stage: any) => (
            <small key={stage.key || stage.title} className={`stage-${stage.status}`}>
              <b>{stage.title}</b>
              <em>{friendlyStatus(stage.status || 'ready')}</em>
            </small>
          ))}
        </div>
      ) : null}
      {files.length ? (
        <div className="run-export-files">
          {files.map((file: any) => (
            <a
              key={`${file.format}-${file.path || file.filename}`}
              href={`/api/theone/report/export/file?path=${encodeURIComponent(file.path || '')}`}
              target="_blank"
              rel="noreferrer"
            >
              <span>{String(file.format || 'file').toUpperCase()}</span>
              <strong>{file.filename || 'report'}</strong>
              <em>{formatFileSize(file.size)}</em>
            </a>
          ))}
        </div>
      ) : null}
      {delivery?.nextAction ? <p>{delivery.nextAction}</p> : null}
    </div>
  );
}

function ReportStudioCard({
  result,
  busy,
  onAction,
}: {
  result: any;
  busy: boolean;
  onAction: (prompt: string) => void;
}) {
  const documentRuntime = result?.chat?.documentRuntime;
  const artifact = result?.chat?.reportArtifact || result?.networkSignals?.reportArtifact || result?.appResult?.reportArtifact;
  const delivery = result?.chat?.deliveryStatus || result?.networkSignals?.deliveryStatus;
  if (!documentRuntime && !artifact && !delivery) return null;
  const sourceCount = Array.isArray(documentRuntime?.attachments)
    ? documentRuntime.attachments.length
    : Array.isArray(artifact?.sourceFiles)
      ? artifact.sourceFiles.length
      : 0;
  const quality = delivery?.quality?.sourceCoverage || documentRuntime?.sourceQuality || 'ready';
  const actions = [
    {
      label: 'Executive brief',
      prompt: 'Rewrite this document result as a concise executive brief with decision points and evidence.',
    },
    {
      label: 'Risk register',
      prompt: 'Extract a risk register from this document with severity, evidence, owner, and recommended action.',
    },
    {
      label: 'Action plan',
      prompt: 'Turn this document result into an action plan with owners, priorities, dates, and evidence.',
    },
    {
      label: 'Export package',
      prompt: 'Export this report as DOCX, PDF, Markdown, HTML, and JSON files.',
    },
  ];
  return (
    <div className="run-report-studio-card">
      <div className="run-report-studio-head">
        <span>Report Studio</span>
        <strong>{friendlyStatus(quality)}</strong>
      </div>
      <div className="run-report-studio-grid">
        <div>
          <span>Sources</span>
          <strong>{sourceCount}</strong>
        </div>
        <div>
          <span>Sections</span>
          <strong>{Array.isArray(documentRuntime?.reportSections) ? documentRuntime.reportSections.length : artifact ? 5 : 0}</strong>
        </div>
        <div>
          <span>Files</span>
          <strong>{Array.isArray(delivery?.files) ? delivery.files.length : 0}</strong>
        </div>
      </div>
      <div className="run-report-studio-actions">
        {actions.map((action) => (
          <button key={action.label} type="button" disabled={busy} onClick={() => onAction(action.prompt)}>
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ObjectiveAssessmentCard({ result }: { result: any }) {
  const assessment = result?.chat?.objectiveAssessment;
  if (!assessment) return null;
  return (
    <div className="run-objective-assessment">
      <div>
        <span>Outcome</span>
        <strong>{friendlyStatus(assessment.status || 'ready')}</strong>
      </div>
      <p>{assessment.outcome}</p>
      {Array.isArray(assessment.gaps) && assessment.gaps.length ? (
        <small>Gap: {assessment.gaps.slice(0, 2).join(' ')}</small>
      ) : null}
      {assessment.nextAction ? <em>{assessment.nextAction}</em> : null}
    </div>
  );
}

function pendingApprovals(result: any) {
  const approvals = result?.approvals || [];
  return Array.isArray(approvals)
    ? approvals.filter((approval: any) => approval?.required && approval?.status === 'pending')
    : [];
}

function compactApprovalValue(value: any, limit = 140) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

function approvalInputPreview(input: Record<string, any>) {
  const priority = ['content', 'text', 'body', 'message', 'url', 'repo', 'path', 'app', 'command', 'query'];
  const entries = [
    ...priority.filter((key) => input[key] !== undefined).map((key) => [key, input[key]] as const),
    ...Object.entries(input).filter(([key]) => !priority.includes(key)).slice(0, 4),
  ];
  return entries
    .map(([key, value]) => ({ key, value: compactApprovalValue(value) }))
    .filter((item) => item.value)
    .slice(0, 5);
}

function actionRiskLabel(action: string, result: any) {
  if (/social\.post|email\.send|message\.send|payment|transfer|delete|desktop\.(click|type|hotkey)/i.test(action)) {
    return 'External write';
  }
  if (/file\.write|document\.generate|spreadsheet\.write|database\.write/i.test(action)) return 'Creates output';
  if (result?.chat?.workerCoordination?.approvalGated) return 'Approval gated';
  return 'Managed';
}

function coordinationWorkers(result: any) {
  return result?.chat?.workerCoordination?.workers || [
    { key: 'oneai', title: 'OneAI', role: 'Builds the workflow', status: result ? 'ready' : 'waiting' },
    { key: 'theone', title: 'TheOne Kernel', role: 'Checks policy and proof', status: result ? 'ready' : 'waiting' },
    { key: 'oneclaw', title: 'OneClaw', role: 'Runs approved workers', status: result ? 'ready' : 'waiting' },
  ];
}

function missionQuickCommand(content: string, result: any) {
  const runId = result?.runId;
  if (!runId) return null;
  const value = content.trim().toLowerCase();
  const compact = value.replace(/\s+/g, ' ');
  const pending = pendingApprovals(result).length > 0;
  if (pending && /^(approve|approve all|批准|同意|确认|yes|ok|可以)$/.test(compact)) return 'approve';
  if (pending && /^(reject|reject all|拒绝|取消|不要|no)$/.test(compact)) return 'reject';
  if (/^(continue|resume|sync|继续|接着|同步|刷新)$/.test(compact)) return 'resume';
  if (/^(retry|rebuild|replay|重试|重新执行|重新规划|再跑一次)$/.test(compact)) return 'replay';
  return null;
}

function approvalDecisionMessage(decision: 'approve' | 'reject', result: any) {
  if (decision === 'reject') return 'Rejected. I kept the external worker from running.';
  const oneclaw = latestOneClawExecution(result);
  const receipt = normalizedReceiptFromExecution(oneclaw);
  const pending = pendingApprovals(result).length;
  if (oneclaw?.status === 'failed') {
    const reason = receipt?.error || oneclaw.summary || 'No worker receipt was returned.';
    const next = Array.isArray(receipt?.nextActions) && receipt.nextActions.length
      ? `\n\nNext: ${receipt.nextActions.join(' ')}`
      : isContentLengthFailure(result)
        ? '\n\nNext: use Shorten + retry so the post fits X\'s 280 character limit.'
        : '';
    return `Approved, but OneClaw failed to execute.\n\nReason: ${reason}${next}`;
  }
  if (oneclaw?.externalId || ['success', 'submitted', 'running', 'mock'].includes(String(oneclaw?.status || '').toLowerCase())) {
    return plainResult(result);
  }
  if (pending) {
    return `Approved in TheOne, but ${pending} approval gate is still waiting. Open the run details before expecting the external action to appear.`;
  }
  return 'Approved. TheOne refreshed the mission, but no OneClaw execution receipt was returned yet.';
}

function AgentProgress({ stage, stages = liveProgressStages }: { stage: number; stages?: string[] }) {
  return (
    <div className="run-agent-progress" aria-live="polite">
      <div>
        <span>{String(Math.min(stage + 1, stages.length)).padStart(2, '0')}</span>
        <strong>{stages[Math.min(stage, stages.length - 1)]}</strong>
      </div>
      <div className="run-progress-dots">
        {stages.map((label, index) => (
          <i key={label} className={index <= stage ? 'active' : ''} />
        ))}
      </div>
    </div>
  );
}

function MissionTimeline({
  result,
  loading,
  stage,
  stages = liveProgressStages,
}: {
  result: any;
  loading: boolean;
  stage: number;
  stages?: string[];
}) {
  const items = missionTimeline(result, loading, stage);
  return (
    <div className="run-mission-timeline">
      <div className="run-timeline-head">
        <span>Mission timeline</span>
        <strong>{loading ? stages[Math.min(stage, stages.length - 1)] : activeStatus(result, loading)}</strong>
      </div>
      {items.map((item, index) => (
        <div key={item.key} className={`run-timeline-item timeline-${item.status}`}>
          <small>{String(index + 1).padStart(2, '0')}</small>
          <div>
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function WorkStatusLine({ result }: { result: any }) {
  const text = workStatusLine(result);
  if (!text) return null;
  return (
    <div className="run-work-status-line">
      <span>Work</span>
      <strong>{text}</strong>
    </div>
  );
}

function WelcomePanel({
  busy,
  onPrompt,
  locale,
}: {
  busy: boolean;
  onPrompt: (prompt: string) => void;
  locale: Locale;
}) {
  const labels = copyFor(locale);
  return (
    <section className="run-welcome-panel">
      <span>{labels.welcomeKicker}</span>
      <h1>{labels.welcomeTitle}</h1>
      <p>{labels.welcomeBody}</p>
      <div className="run-welcome-trust">
        <div>
          <small>{labels.trustOneAI}</small>
          <strong>{labels.trustOneAIDetail}</strong>
        </div>
        <div>
          <small>{labels.trustTheOne}</small>
          <strong>{labels.trustTheOneDetail}</strong>
        </div>
        <div>
          <small>{labels.trustOneClaw}</small>
          <strong>{labels.trustOneClawDetail}</strong>
        </div>
      </div>
      <div className="run-welcome-prompts">
        {workerPrompts.slice(0, 4).map((item) => (
          <button key={item.label} type="button" disabled={busy} onClick={() => onPrompt(localizedPrompt(item, locale))}>
            <small>{localizedLabel(item, locale)}</small>
            <strong>{localizedPrompt(item, locale)}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}

function ApprovalCard({
  result,
  busy,
  onDecision,
}: {
  result: any;
  busy: boolean;
  onDecision: (decision: 'approve' | 'reject', approvalId?: string) => void;
}) {
  const approvals = pendingApprovals(result);
  if (!approvals.length) return null;
  const task = result?.pendingOneClawTask || result?.chat?.workerCoordination?.oneclawTask;
  const first = approvals[0];
  const firstStep = task?.steps?.[0] || {};
  const action = firstStep.action || first.action || 'worker.execute';
  const input = firstStep.input || first.input || {};
  const preview = approvalInputPreview(input);
  const content = compactApprovalValue(input.content || input.text || input.body || input.message, 400);
  const contentLength = content ? Array.from(content).length : 0;

  return (
    <div className="run-approval-card">
      <div>
        <span className="product-card-kicker">Approval gate</span>
        <strong>{task?.taskName || first.action || 'Worker task waiting'}</strong>
        <p>{first.reason || 'TheOne policy needs your decision before OneClaw executes this worker.'}</p>
      </div>
      <div className="run-approval-impact" aria-label="Approval impact">
        <div>
          <span>Action</span>
          <strong>{action}</strong>
        </div>
        <div>
          <span>Mode</span>
          <strong>{task?.approvalMode || result?.approvalMode || 'manual'}</strong>
        </div>
        <div>
          <span>Risk</span>
          <strong>{actionRiskLabel(action, result)}</strong>
        </div>
      </div>
      {preview.length ? (
        <div className="run-approval-preview">
          <span>Input preview</span>
          {preview.map((item) => (
            <small key={item.key}>
              <b>{item.key}</b>
              {item.value}
            </small>
          ))}
          {action === 'social.post' && content ? (
            <em className={contentLength > 280 ? 'warning' : ''}>
              X length: {contentLength}/280
            </em>
          ) : null}
        </div>
      ) : null}
      <div className="approval-actions">
        <button className="mini-action primary" type="button" disabled={busy} onClick={() => onDecision('approve', first.id)}>Approve</button>
        <button className="mini-action" type="button" disabled={busy} onClick={() => onDecision('reject', first.id)}>Reject</button>
        {approvals.length > 1 ? (
          <>
            <button className="mini-action primary" type="button" disabled={busy} onClick={() => onDecision('approve')}>Approve all</button>
            <button className="mini-action" type="button" disabled={busy} onClick={() => onDecision('reject')}>Reject all</button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ToolTrace({ result }: { result: any }) {
  if (!result?.chat) return null;

  const workflow = result.chat.oneAiWorkflow;
  const planningBrain = planningBrainFromResult(result);
  const coordination = result.chat.workerCoordination;
  const workers = coordinationWorkers(result);
  const steps = workflowSteps(result);
  const timeline = result.chat.agentTimeline || coordination?.agentTimeline || [];
  const oneclawRun = coordination?.oneclawRun;
  const evidence = evidenceText(result);
  const reason = approvalReason(result);

  return (
    <details className="run-tool-trace">
      <summary>
        <span>Work trace</span>
        <strong>{steps.length || workers.length || 1} step(s)</strong>
      </summary>
      <div className="run-tool-body">
        {timeline.length ? (
          <div className="run-agent-timeline">
            {timeline.map((item: any) => (
              <div key={item.key || `${item.actor}_${item.title}`} className={`timeline-${workerTone(item.status)}`}>
                <span>{item.actor || 'TheOne'}</span>
                <strong>{item.title}</strong>
                <em>{friendlyStatus(item.status)} · {item.detail}</em>
              </div>
            ))}
          </div>
        ) : null}

        <div className="run-tool-section">
          <span>OneAI plan</span>
          <strong>{workflow?.summary || 'TheOne asked OneAI to decide the workflow.'}</strong>
          {planningBrain ? (
            <div className="run-planning-brain-mini">
              <p>{planningBrain.reasoningSummary || planningBrain.understanding || 'OneAI prepared the planning frame for TheOne.'}</p>
              <div>
                {planningBrain.selectedApp ? <small>{planningBrain.selectedApp}</small> : null}
                {planningBrain.confidence ? <small>{Math.round(Number(planningBrain.confidence) * 100)}% confidence</small> : null}
                {planningBrain.executionBoundary ? <small>{planningBrain.executionBoundary}</small> : null}
              </div>
            </div>
          ) : null}
          {steps.length ? (
            <div className="run-tool-steps">
              {steps.map((step: any, index: number) => (
                <div key={step.id || index}>
                  <small>{String(index + 1).padStart(2, '0')}</small>
                  <p>{step.title || step.action || 'Workflow step'}</p>
                  <em>{step.worker || step.owner || 'theone'} · {friendlyStatus(step.status || step.approvalMode || 'ready')}</em>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className="run-tool-section">
          <span>Worker route</span>
          <div className="run-tool-workers">
            {workers.map((worker: any) => (
              <div key={worker.key || worker.title}>
                <strong>{worker.title}</strong>
                <small className={`status-pill status-${workerTone(worker.status)}`}>{friendlyStatus(worker.status)}</small>
                <p>{worker.role}</p>
              </div>
            ))}
          </div>
        </div>

        {reason ? (
          <div className="run-tool-section">
            <span>Policy</span>
            <strong>{reason}</strong>
          </div>
        ) : null}

        {oneclawRun ? (
          <div className="run-tool-section">
            <span>OneClaw receipt</span>
            <strong>{oneclawRun.taskName || 'Worker task'} · {friendlyStatus(oneclawRun.status || 'called')}</strong>
          </div>
        ) : null}

        {evidence ? (
          <div className="run-tool-section">
            <span>Evidence</span>
            <p>{evidence.slice(0, 900)}{evidence.length > 900 ? ' ...' : ''}</p>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function planningBrainFromResult(result: any) {
  return result?.chat?.oneAiBrain || result?.chat?.oneAiWorkflow?.planningBrain || null;
}

function PlanningBrainCard({ result }: { result: any }) {
  const planningBrain = planningBrainFromResult(result);
  if (!planningBrain) return null;

  const route = Array.isArray(planningBrain.workerRoute)
    ? planningBrain.workerRoute.filter(Boolean)
    : [];
  const confidence = Number(planningBrain.confidence);
  const confidenceLabel = Number.isFinite(confidence) ? `${Math.round(confidence * 100)}%` : 'ready';

  return (
    <div className="run-brain-card">
      <span className="product-card-kicker">Planning brain</span>
      <strong>{planningBrain.understanding || planningBrain.reasoningSummary || 'OneAI prepared the workflow plan.'}</strong>
      <div className="run-brain-meta">
        <div>
          <span>App</span>
          <strong>{planningBrain.selectedApp || 'TheOne chooses route'}</strong>
        </div>
        <div>
          <span>Confidence</span>
          <strong>{confidenceLabel}</strong>
        </div>
      </div>
      {route.length ? (
        <div className="run-brain-route">
          {route.slice(0, 6).map((item: string) => <span key={item}>{item}</span>)}
        </div>
      ) : null}
      {planningBrain.executionBoundary || planningBrain.reasoningSummary ? (
        <p className="panel-subtitle">
          {planningBrain.reasoningSummary || planningBrain.executionBoundary}
        </p>
      ) : null}
    </div>
  );
}

function WorkerCallCards({ result }: { result: any }) {
  const executions = Array.isArray(result?.executions) ? result.executions : [];
  if (!executions.length) return null;

  return (
    <div className="run-worker-call-cards">
      {executions.slice(-4).map((execution: any, index: number) => {
        const status = friendlyStatus(execution.status || 'ready');
        const taskName = execution.taskName || execution.action || execution.provider || 'worker.call';
        const receipt = execution.receipt || execution.raw?.receipt || execution.raw?.normalizedReceipt || execution.raw;
        const normalizedReceipt = normalizedReceiptFromExecution(execution);
        return (
          <details key={execution.id || `${taskName}_${index}`} className="run-worker-call-card">
            <summary>
              <span>{execution.provider || 'worker'}</span>
              <strong>{taskName}</strong>
              <small>{status}</small>
            </summary>
            <div>
              <p>{execution.summary || 'The worker returned a receipt for this mission.'}</p>
              <WorkerReceiptSummary receipt={normalizedReceipt} />
              <div className="run-worker-lifecycle">
                {workerLifecycle(result, execution).map((item, itemIndex) => (
                  <div key={item.key} className={`timeline-${item.status}`}>
                    <small>{String(itemIndex + 1).padStart(2, '0')}</small>
                    <strong>{item.title}</strong>
                    <span>{item.detail}</span>
                  </div>
                ))}
              </div>
              {execution.externalId ? <code>{execution.externalId}</code> : null}
              {receipt ? <pre>{JSON.stringify(receipt, null, 2).slice(0, 1800)}</pre> : null}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function StreamEventList({ events }: { events: StreamEvent[] }) {
  if (!events.length) return null;
  const labelFor = (event: string) => ({
    plan_delta: 'Plan',
    tool_start: 'Worker start',
    tool_result: 'Worker result',
    approval_required: 'Approval',
    proof_recorded: 'Proof',
  }[event] || event.replace(/_/g, ' '));

  return (
    <details className="run-side-details">
      <summary>
        <span>Live events</span>
        <strong>{events.length}</strong>
      </summary>
      <div className="run-stream-events">
        {events.slice(-8).map((item) => (
          <div key={item.id}>
            <small>{labelFor(item.event)}</small>
            <strong>{item.data?.title || item.data?.taskName || item.data?.action || item.data?.summary || item.data?.status || 'event'}</strong>
            {item.data?.reason || item.data?.value ? <p>{item.data.reason || item.data.value}</p> : null}
          </div>
        ))}
      </div>
    </details>
  );
}

function RunPageContent() {
  const searchParams = useSearchParams();
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>('assist');
  const [locale, setLocale] = useState<Locale>('zh');
  const [loading, setLoading] = useState(false);
  const [progressStage, setProgressStage] = useState(0);
  const [messages, setMessages] = useState<ConversationMessage[]>([starterMessageFor('zh')]);
  const [result, setResult] = useState<any>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [runHistory, setRunHistory] = useState<any[]>([]);
  const [workerCommands, setWorkerCommands] = useState<CommandItem[]>([]);
  const [selectedWorker, setSelectedWorker] = useState<CommandItem | null>(null);
  const [streamEvents, setStreamEvents] = useState<StreamEvent[]>([]);
  const [workedMs, setWorkedMs] = useState<number | null>(null);
  const [chatSessionId, setChatSessionId] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const labels = copyFor(locale);
  const progressStages = liveProgressStagesByLocale[locale];

  const status = activeStatus(result, loading);
  const stats = runStats(result);
  const workflow = result?.chat?.oneAiWorkflow;
  const coordination = result?.chat?.workerCoordination;
  const brain = result?.chat?.brain;
  const nextActions = result?.chat?.nextActions || [];
  const modelRoute = result?.chat?.modelRoute;
  const appPackages = result?.chat?.appPackages || [];
  const workerCatalog = result?.chat?.workerCatalog;
  const workerCapabilityMap = brain?.workerCapabilityMap || [];
  const latestResult = latestAssistantResult(messages) || result;
  const planningBrain = planningBrainFromResult(latestResult || result);
  const mission = latestResult?.chat?.mission || result?.chat?.mission;
  const workerRuntime = latestResult?.chat?.workerRuntime || result?.chat?.workerRuntime;
  const missionState = latestResult?.chat?.missionState || workerRuntime?.missionState || result?.chat?.missionState;
  const continuity = latestResult?.chat?.continuity || result?.chat?.continuity;
  const currentSteps = activeWorkflowSteps(latestResult);
  const title = conversationTitle(latestResult, messages);
  const hasUserMessages = messages.some((message) => message.role === 'user');
  const attachmentUploading = attachments.some((attachment) => attachment.status === 'uploading');
  const readyAttachmentCount = attachments.filter((attachment) => attachment.status === 'ready').length;
  const commands = [...templateCommands(), ...workerCommands];
  const filteredPrompts = commands.filter((item) => {
    const query = commandQuery.trim().toLowerCase();
    if (!query) return true;
    return `${item.label} ${item.prompt} ${item.meta}`.toLowerCase().includes(query);
  });

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    const stored = window.localStorage.getItem('theone.chatSessionId');
    const id = stored || createId('session');
    window.localStorage.setItem('theone.chatSessionId', id);
    setChatSessionId(id);
    const storedLocale = window.localStorage.getItem('theone.locale');
    if (storedLocale === 'zh' || storedLocale === 'en') {
      setLocale(storedLocale);
      setMessages((current) => (
        current.length === 1 && current[0]?.id === 'assistant_starter'
          ? [starterMessageFor(storedLocale)]
          : current
      ));
    }
  }, []);

  useEffect(() => {
    if (!loading) {
      setProgressStage(0);
      return undefined;
    }

    const timer = window.setInterval(() => {
      setProgressStage((stage) => Math.min(liveProgressStages.length - 1, stage + 1));
    }, 850);
    return () => window.clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch('/api/theone/runs?limit=8', { cache: 'no-store' }).then((res) => res.json()).catch(() => null),
      fetch('/api/theone/workers', { cache: 'no-store' }).then((res) => res.json()).catch(() => null),
    ]).then(([runsData, workersData]) => {
      if (!active) return;
      if (Array.isArray(runsData?.items)) setRunHistory(runsData.items);
      setWorkerCommands(normalizeWorkerCommands(workersData).slice(0, 80));
    });
    return () => {
      active = false;
    };
  }, [latestResult?.runId, stats.executions]);

  useEffect(() => {
    const continueRunId = searchParams.get('continue');
    if (!continueRunId || result) return;
    fetch(`/api/theone/runs/${continueRunId}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (!data?.runId) return;
        setResult(data);
        if (data?.chat?.conversation?.sessionId) {
          setChatSessionId(data.chat.conversation.sessionId);
          window.localStorage.setItem('theone.chatSessionId', data.chat.conversation.sessionId);
        }
        const restoredMessages = Array.isArray(data?.chat?.conversation?.messages)
          ? data.chat.conversation.messages
            .filter((message: any) => message?.role === 'user' || message?.role === 'assistant' || message?.role === 'system')
            .map((message: any, index: number) => ({
              id: createId(`restored_${index}`),
              role: message.role,
              content: String(message.content || ''),
              createdAt: message.createdAt || new Date().toISOString(),
              result: index === data.chat.conversation.messages.length - 1 && message.role === 'assistant' ? data : undefined,
            }))
            .filter((message: ConversationMessage) => message.content.trim())
          : [];
        if (restoredMessages.length) {
          setMessages(restoredMessages);
        } else {
          setMessages((current) => ([
            ...current,
            {
              id: createId('assistant_resume'),
              role: 'assistant',
              content: `${labels.resumeLoaded} ${data.runId}. ${labels.resumeHint}`,
              createdAt: new Date().toISOString(),
              result: data,
            },
          ]));
        }
      })
      .catch(() => undefined);
  }, [searchParams, result]);

  async function sendMessage(text?: string) {
    const content = (text ?? input).trim();
    if (!content || loading) return;
    const readyAttachments = attachments.filter((attachment) => attachment.status === 'ready');
    const failedAttachments = attachments.filter((attachment) => attachment.status === 'failed');
    const uploadInProgress = attachments.some((attachment) => attachment.status === 'uploading');
    if (uploadInProgress) {
      setMessages((current) => ([
        ...current,
        {
          id: createId('assistant_attachment_wait'),
          role: 'assistant',
          content: labels.attachmentWait,
          createdAt: new Date().toISOString(),
        },
      ]));
      return;
    }
    if (!readyAttachments.length && failedAttachments.length && isAttachmentReadRequest(content)) {
      const userMessage: ConversationMessage = {
        id: createId('user'),
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
      };
      setMessages((current) => ([
        ...current,
        userMessage,
        {
          id: createId('assistant_attachment_failed'),
          role: 'assistant',
          content: failedAttachmentMessage(failedAttachments),
          createdAt: new Date().toISOString(),
        },
      ]));
      setInput('');
      return;
    }

    const userMessage: ConversationMessage = {
      id: createId('user'),
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    setWorkedMs(null);
    setStreamEvents([]);
    const startedAt = Date.now();

    try {
      const command = missionQuickCommand(content, latestResult);
      if (command && latestResult?.runId) {
        const endpoint = command === 'approve'
          ? '/api/theone/approvals/approve'
          : command === 'reject'
            ? '/api/theone/approvals/reject'
            : command === 'resume'
              ? `/api/theone/runs/${latestResult.runId}/resume`
              : `/api/theone/runs/${latestResult.runId}/replay`;
        const data = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: command === 'approve'
            ? JSON.stringify({ runId: latestResult.runId, approveAll: true })
            : command === 'reject'
              ? JSON.stringify({ runId: latestResult.runId, rejectAll: true })
              : undefined,
        }).then((res) => res.json());
        const resolved = data.result || data;
        if (resolved?.ok === false || data?.ok === false) throw new Error(data.error || resolved.error || 'Mission command failed.');
        setResult(resolved);
        setMessages((current) => ([
          ...current,
          {
            id: createId(`assistant_${command}`),
            role: 'assistant',
            content: command === 'approve'
              ? approvalDecisionMessage('approve', resolved)
              : command === 'reject'
                ? 'Rejected. I kept the external worker from running.'
                : command === 'resume'
                  ? plainResult(resolved)
                  : `I rebuilt the mission route.\n\n${plainResult(resolved)}`,
            createdAt: new Date().toISOString(),
            result: resolved,
          },
        ]));
        return;
      }

      const payload = {
        input: content,
        mode,
        language: locale === 'zh' ? 'zh-CN' : 'en',
        context: latestResult?.chat ? {
          runId: latestResult.runId,
          mission: latestResult.chat.mission,
          workerRuntime: latestResult.chat.workerRuntime,
          missionState: latestResult.chat.missionState || latestResult.chat.workerRuntime?.missionState,
          documentRuntime: latestResult.chat.documentRuntime,
          reportArtifact: latestResult.chat.reportArtifact,
          exportBundle: latestResult.chat.exportBundle,
          deliveryStatus: latestResult.chat.deliveryStatus,
          continuity: latestResult.chat.continuity,
          pendingOneClawTask: latestResult.pendingOneClawTask,
          approvals: latestResult.approvals,
          executions: latestResult.executions,
          lastAssistant: latestResult.chat.assistant?.content || latestResult.summary,
        } : undefined,
        messages: nextMessages.map((message) => ({ role: message.role, content: message.content })),
        sessionId: chatSessionId || undefined,
        attachments: readyAttachments,
        selectedWorker: selectedWorker ? {
          key: selectedWorker.key,
          label: selectedWorker.label,
          action: selectedWorker.action,
          meta: selectedWorker.meta,
        } : undefined,
      };
      let data: any;
      const streamMessageId = createId('assistant_stream');
      let streamed = false;
      try {
        data = await postChatWithStream(
          payload,
          (stage) => setProgressStage(stage),
          (delta) => {
            streamed = true;
            setMessages((current) => {
              const existing = current.find((message) => message.id === streamMessageId);
              if (existing) {
                return current.map((message) => (
                  message.id === streamMessageId
                    ? { ...message, content: `${message.content}${delta}` }
                    : message
                ));
              }
              return [
                ...current,
                {
                  id: streamMessageId,
                  role: 'assistant',
                  content: delta,
                  createdAt: new Date().toISOString(),
                },
              ];
            });
          },
          (event, eventData) => {
            setStreamEvents((current) => [
              ...current.slice(-24),
              {
                id: createId('stream'),
                event,
                data: eventData,
                createdAt: new Date().toISOString(),
              },
            ]);
          }
        );
      } catch {
        data = await postChatJson(payload);
      }
      setResult(data);
      setMessages((current) => {
        if (streamed) {
          return current.map((message) => (
            message.id === streamMessageId
              ? { ...message, content: plainResult(data), result: data }
              : message
          ));
        }
        return [
          ...current,
          {
            id: createId('assistant'),
            role: 'assistant',
            content: plainResult(data),
            createdAt: new Date().toISOString(),
            result: data,
          },
        ];
      });
      if (data?.chat?.conversation?.sessionId) {
        setChatSessionId(data.chat.conversation.sessionId);
        window.localStorage.setItem('theone.chatSessionId', data.chat.conversation.sessionId);
      }
      setAttachments((current) => current.filter((attachment) => attachment.status === 'uploading'));
      setSelectedWorker(null);
    } catch (error) {
      const failure = { ok: false, error: error instanceof Error ? error.message : 'TheOne could not start this run.' };
      setResult(failure);
      setMessages((current) => ([
        ...current,
        {
          id: createId('assistant_error'),
          role: 'assistant',
          content: plainResult(failure),
          createdAt: new Date().toISOString(),
          result: failure,
        },
      ]));
    } finally {
      setWorkedMs(Date.now() - startedAt);
      setLoading(false);
    }
  }

  async function decideApproval(decision: 'approve' | 'reject', approvalId?: string) {
    const runId = latestResult?.runId || result?.runId;
    if (!runId || loading) return;
    setLoading(true);
    setWorkedMs(null);
    const startedAt = Date.now();
    try {
      const endpoint = decision === 'approve' ? '/api/theone/approvals/approve' : '/api/theone/approvals/reject';
      const payload = decision === 'approve'
        ? { runId, approvalId, approveAll: !approvalId }
        : { runId, approvalId, rejectAll: !approvalId };
      const data = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((res) => res.json());
      if (data.ok === false) throw new Error(data.error || 'Approval decision failed.');
      const synced = decision === 'approve' ? await refreshRunResult(runId).catch(() => null) : null;
      const resolved = synced || data;
      setResult(resolved);
      setMessages((current) => ([
        ...current,
        {
          id: createId(`assistant_${decision}`),
          role: 'assistant',
          content: approvalDecisionMessage(decision, resolved),
          createdAt: new Date().toISOString(),
          result: resolved,
        },
      ]));
    } catch (error) {
      const failure = { ok: false, error: error instanceof Error ? error.message : 'Approval decision failed.' };
      setResult(failure);
      setMessages((current) => ([
        ...current,
        {
          id: createId('assistant_approval_error'),
          role: 'assistant',
          content: plainResult(failure),
          createdAt: new Date().toISOString(),
          result: failure,
        },
      ]));
    } finally {
      setWorkedMs(Date.now() - startedAt);
      setLoading(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      sendMessage();
    }
  }

  async function handleAttachmentInput(files: FileList | null) {
    const pending = Array.from(files || []).slice(0, 8).map((file) => ({
      id: createId('attachment_pending'),
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      status: 'uploading' as const,
    }));
    if (!pending.length) return;
    setAttachments((current) => [...current, ...pending].slice(-12));
    try {
      const uploaded = await uploadChatAttachments(files);
      setAttachments((current) => [
        ...current.filter((item) => !pending.some((pendingItem) => pendingItem.id === item.id)),
        ...uploaded,
      ].slice(-12));
    } catch (error) {
      setAttachments((current) => current.map((item) => (
        pending.some((pendingItem) => pendingItem.id === item.id)
          ? { ...item, status: 'failed' as const, summary: 'Upload failed.', error: error instanceof Error ? error.message : 'Upload failed.' }
          : item
      )));
    }
  }

  function startNewChat() {
    const id = createId('session');
    window.localStorage.setItem('theone.chatSessionId', id);
    setChatSessionId(id);
    setMessages([starterMessageFor(locale)]);
    setResult(null);
    setInput('');
    setAttachments([]);
    setSelectedWorker(null);
    setStreamEvents([]);
    setWorkedMs(null);
  }

  function changeLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    window.localStorage.setItem('theone.locale', nextLocale);
    setMessages((current) => (
      current.length === 1 && current[0]?.id === 'assistant_starter'
        ? [starterMessageFor(nextLocale)]
        : current
    ));
  }

  return (
    <main className={inspectorOpen ? 'run-product-shell' : 'run-product-shell inspector-closed'}>
          <aside className="run-session-rail run-product-sidebar" aria-label="TheOne sessions">
            <div className="run-rail-brand">
              <strong>{labels.brand}</strong>
              <span>{labels.brandMark}</span>
            </div>
            <nav className="run-rail-nav">
              <button type="button" onClick={startNewChat}>{labels.navNew}</button>
              {sessionShortcuts.filter((item) => item.label !== 'New chat').map((item) => (
                <Link key={item.label} href={item.href}>{localizedLabel(item, locale)}</Link>
              ))}
            </nav>
            <div className="run-rail-projects">
              <span>{labels.activeWork}</span>
              {runHistory.length ? runHistory.slice(0, 7).map((run) => {
                const id = runIdOf(run);
                return (
                  <Link key={id || runTitleOf(run)} className="run-history-item" href={id ? `/run?continue=${id}` : '/runs'}>
                    <strong>{runTitleOf(run).slice(0, 58)}{runTitleOf(run).length > 58 ? '...' : ''}</strong>
                    <small>{friendlyStatus(run?.status || run?.workflow?.status || 'saved')} · {formatRelativeTime(run?.updatedAt || run?.createdAt)}</small>
                  </Link>
                );
              }) : (messages.filter((message) => message.role === 'user').slice(-5).reverse()).map((message, index) => (
                <button key={message.id} type="button" onClick={() => setInput(message.content)}>
                  <strong>{message.content.slice(0, 48)}{message.content.length > 48 ? '...' : ''}</strong>
                  <small>#{index + 1}</small>
                </button>
              ))}
              {!runHistory.length && messages.filter((message) => message.role === 'user').length === 0 ? (
                <p>{labels.emptyWork}</p>
              ) : null}
            </div>
            <div className="run-rail-footer">
              <Link href="/runs">{labels.history}</Link>
              <Link href="/settings">{labels.settings}</Link>
              <Link href="/admin">{labels.admin}</Link>
            </div>
          </aside>

          <section className="run-product-main">
          <div className="run-product-topbar">
            <div className="run-title-block">
              <span>{labels.topKicker}</span>
              <strong>{title}</strong>
              <em>{loading ? progressStages[Math.min(progressStage, progressStages.length - 1)] : formatDuration(workedMs)}</em>
            </div>
            <div className="run-topbar-actions">
              <span className="run-public-badge">{labels.publicWindow}</span>
              <div className="run-language-toggle" aria-label="Language">
                <button type="button" className={locale === 'zh' ? 'active' : ''} onClick={() => changeLocale('zh')}>中文</button>
                <button type="button" className={locale === 'en' ? 'active' : ''} onClick={() => changeLocale('en')}>EN</button>
              </div>
              <span className={`status-pill status-${status}`}>{friendlyStatus(status)}</span>
              <button type="button" className="mini-action" onClick={() => setInspectorOpen((open) => !open)}>
                {inspectorOpen ? labels.hideInspector : labels.currentWork}
              </button>
            </div>
          </div>

          <div className={`run-thread ${!hasUserMessages ? 'run-thread-empty' : ''}`} ref={threadRef} aria-live="polite">
            {!hasUserMessages ? <WelcomePanel busy={loading} locale={locale} onPrompt={(prompt) => sendMessage(prompt)} /> : null}
            {messages.map((message) => (
              <article key={message.id} className={`run-message run-message-${message.role}`}>
                <div className="run-message-meta">
                  <span>{message.role === 'user' ? labels.messageYou : message.role === 'assistant' ? labels.messageAssistant : labels.messageSystem}</span>
                  <small>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                </div>
                <p>{message.content}</p>
                {message.role === 'assistant' && message.result ? <WorkStatusLine result={message.result} /> : null}
                {message.role === 'assistant' && message.result ? <DocumentRuntimeCard result={message.result} /> : null}
                {message.role === 'assistant' && message.result ? <ReportArtifactCard result={message.result} /> : null}
                {message.role === 'assistant' && message.result ? <DeliveryStatusCard result={message.result} /> : null}
                {message.role === 'assistant' && message.result ? (
                  <ReportStudioCard result={message.result} busy={loading} onAction={(prompt) => sendMessage(prompt)} />
                ) : null}
                {message.role === 'assistant' && message.result ? <ObjectiveAssessmentCard result={message.result} /> : null}
                {message.result?.appRoute ? (
                  <div className="run-message-route">
                    <span>{message.result.appRoute.title}</span>
                    <strong>{message.result.appRoute.action}</strong>
                  </div>
                ) : null}
                {inspectorOpen && message.role === 'assistant' && message.result ? <ToolTrace result={message.result} /> : null}
                {inspectorOpen && message.role === 'assistant' && message.result ? <WorkerCallCards result={message.result} /> : null}
                {message.role === 'assistant' && message.result ? (
                  <ApprovalCard result={message.result} busy={loading} onDecision={decideApproval} />
                ) : null}
                {message.role === 'assistant' && message.result ? (
                  <ResultActions result={message.result} busy={loading} content={message.content} onAction={(prompt) => sendMessage(prompt)} />
                ) : null}
              </article>
            ))}
            {loading ? <AgentProgress stage={progressStage} stages={progressStages} /> : null}
          </div>

          <div className="run-composer">
            <div className="run-composer-toolbar">
              <button type="button" onClick={() => setExamplesOpen((open) => !open)} disabled={loading}>{labels.commands}</button>
              <button type="button" onClick={() => {
                setExamplesOpen(true);
                setCommandQuery('worker');
              }} disabled={loading}>{labels.worker}</button>
              <label className="run-attach-button">
                {labels.attach}
                <input
                  type="file"
                  multiple
                  onChange={async (event) => {
                    await handleAttachmentInput(event.target.files);
                    event.currentTarget.value = '';
                  }}
                />
              </label>
            </div>
            {examplesOpen ? (
              <div className="run-examples-popover">
                <div className="run-command-search">
                  <span>{labels.commandPalette}</span>
                  <input
                    value={commandQuery}
                    onChange={(event) => setCommandQuery(event.target.value)}
                    placeholder={labels.searchPlaceholder}
                  />
                </div>
                {filteredPrompts.slice(0, 24).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setExamplesOpen(false);
                      setCommandQuery('');
                      setInput(item.prompt);
                      setSelectedWorker(item.source === 'worker' ? item : null);
                    }}
                  disabled={loading}
                >
                    <span>{item.source === 'worker' ? 'Worker' : localizedLabel(item, locale)}</span>
                    <strong>{locale === 'zh' ? item.promptZh || item.prompt : item.prompt}</strong>
                    <small>{item.source === 'worker' ? item.meta : 'template'}</small>
                  </button>
                ))}
                {!filteredPrompts.length ? <p>{labels.noCommand}</p> : null}
              </div>
            ) : null}
            <textarea
              value={input}
              onChange={(event) => {
                const value = event.target.value;
                setInput(value);
                if (value.startsWith('/')) {
                  setExamplesOpen(true);
                  setCommandQuery(value.slice(1));
                } else if (value.startsWith('@')) {
                  setExamplesOpen(true);
                  setCommandQuery(value.slice(1) || 'worker');
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder={labels.placeholder}
            />
            {selectedWorker ? (
              <div className="run-selected-worker">
                <span>{labels.workerRoute}</span>
                <strong>{selectedWorker.action || selectedWorker.label}</strong>
                <small>{selectedWorker.meta}</small>
                <button type="button" onClick={() => setSelectedWorker(null)}>{labels.clear}</button>
              </div>
            ) : null}
            <div className="run-composer-actions">
              <div className="run-permission-menu" aria-label="Execution mode">
                {modes.map((item) => (
                  <button key={item} type="button" className={mode === item ? 'active' : ''} onClick={() => setMode(item)}>
                    {item}
                  </button>
                ))}
              </div>
              <span>{labels.shortcut}</span>
              <button className="run-button" type="button" onClick={() => sendMessage()} disabled={loading || attachmentUploading || !input.trim()}>
                {loading ? labels.sending : attachmentUploading ? labels.uploading : labels.send}
              </button>
            </div>
            {attachments.length ? (
              <div className="run-attachment-strip">
                {attachments.map((attachment) => (
                  <span
                    key={attachment.id}
                    className={`attachment-${attachment.status}`}
                    title={attachment.error || attachment.summary || attachment.name}
                  >
                    <strong>{attachment.name}</strong>
                    <small>
                      {attachmentQualityLabel(attachment)}
                      {' · '}
                      {attachmentWorkerLabel(attachment)}
                      {attachmentTopicLabel(attachment) ? ` · ${attachmentTopicLabel(attachment)}` : ''}
                    </small>
                    {attachment.status === 'failed' && (attachment.error || attachment.summary) ? (
                      <em>{String(attachment.error || attachment.summary).slice(0, 150)}</em>
                    ) : null}
                  </span>
                ))}
                {readyAttachmentCount ? (
                  <button
                    type="button"
                    onClick={() => setInput(attachmentReportPrompt(attachments.filter((attachment) => attachment.status === 'ready')))}
                    disabled={loading}
                  >
                    {labels.readReport}
                  </button>
                ) : null}
                <button type="button" onClick={() => setAttachments([])}>{labels.clear}</button>
              </div>
            ) : null}
          </div>
          </section>

        <aside className="run-codex-side run-product-inspector">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">{labels.inspectorTitle}</h2>
              <p className="panel-subtitle">{labels.inspectorSubtitle}</p>
            </div>
            <span className={`status-pill status-${status}`}>{friendlyStatus(status)}</span>
          </div>

          <div className="run-mission-card">
            <span className="product-card-kicker">{labels.currentGoal}</span>
            <strong>{mission?.title || brain?.objective || planningBrain?.understanding || labels.defaultGoal}</strong>
            <div className="run-explain-grid">
              <div>
                <span>{labels.mode}</span>
                <strong>{mission?.mode || brain?.mode || mode}</strong>
              </div>
              <div>
                <span>{labels.intent}</span>
                <strong>{mission?.conversationKind || brain?.conversationKind || labels.ready}</strong>
              </div>
            </div>
            {mission?.workspace ? (
              <p className="panel-subtitle">
                Workspace: {mission.workspace.title}. Resume from {mission.recovery?.replayRoute || '/runs'}.
              </p>
            ) : null}
            {brain?.reasoning?.strategy ? (
              <p className="panel-subtitle">{brain.reasoning.strategy}</p>
            ) : null}
          </div>

          <PlanningBrainCard result={latestResult || result} />

          <MissionTimeline result={latestResult} loading={loading} stage={progressStage} stages={progressStages} />
          <StreamEventList events={streamEvents} />

          <details className="run-side-details">
            <summary>
              <span>{labels.plan}</span>
              <strong>{currentSteps.length || 1}</strong>
            </summary>
            <div className="run-current-plan">
              {(currentSteps.length ? currentSteps.slice(0, 6) : [{ id: 'ready', title: labels.describeOutcome, status: 'ready' }]).map((step: any, index: number) => (
                <div key={step.id || index}>
                  <small>{friendlyStatus(step.status || step.approvalMode || 'ready')}</small>
                  <strong>{step.title || step.action || labels.taskStep}</strong>
                </div>
              ))}
            </div>
          </details>

          {workerRuntime ? (
            <div className="run-mission-card">
              <span className="product-card-kicker">Now</span>
              <strong>{workerRuntime.current?.title || friendlyStatus(workerRuntime.status)}</strong>
            <p className="panel-subtitle">{workerRuntime.current?.detail || workerRuntime.diagnostics?.userReadable}</p>
              {latestResult?.chat?.documentRuntime ? <DocumentRuntimeCard result={latestResult} /> : null}
              {latestResult?.chat?.reportArtifact ? <ReportArtifactCard result={latestResult} /> : null}
              {latestResult?.chat?.deliveryStatus || latestResult?.chat?.exportBundle ? <DeliveryStatusCard result={latestResult} /> : null}
              {latestResult?.chat?.documentRuntime || latestResult?.chat?.reportArtifact || latestResult?.chat?.deliveryStatus ? (
                <ReportStudioCard result={latestResult} busy={loading} onAction={(prompt) => sendMessage(prompt)} />
              ) : null}
              {latestResult?.chat?.objectiveAssessment ? <ObjectiveAssessmentCard result={latestResult} /> : null}
              {missionState ? (
                <div className="run-state-strip">
                  <span>{friendlyStatus(missionState.state)}</span>
                  <strong>{missionState.canResume ? 'Can resume' : 'Stable'}</strong>
                  <em>{missionState.canRetry ? 'Retry available' : continuity?.followUpIntent || 'Context linked'}</em>
                </div>
              ) : null}
            </div>
          ) : null}

          {pendingApprovals(latestResult).length ? (
            <div className="run-mission-card">
              <span className="product-card-kicker">{labels.needsDecision}</span>
              <strong>{pendingApprovals(latestResult)[0]?.action || 'Approval required'}</strong>
              <p className="panel-subtitle">{pendingApprovals(latestResult)[0]?.reason}</p>
              <div className="approval-actions">
                <button className="mini-action primary" type="button" disabled={loading} onClick={() => decideApproval('approve')}>{labels.approveAll}</button>
                <button className="mini-action" type="button" disabled={loading} onClick={() => decideApproval('reject')}>{labels.rejectAll}</button>
              </div>
            </div>
          ) : null}

          <details className="run-side-details" open={pendingApprovals(latestResult).length > 0}>
            <summary>
              <span>{labels.actions}</span>
              <strong>{pendingApprovals(latestResult).length ? 'decision' : 'ready'}</strong>
            </summary>
            <div className="run-side-action-grid">
              <button type="button" disabled={loading || !latestResult?.runId} onClick={() => sendMessage('continue')}>{labels.continue}</button>
              <button type="button" disabled={loading || !latestResult?.runId} onClick={() => sendMessage('retry')}>{labels.retry}</button>
              <button type="button" disabled={loading} onClick={() => sendMessage(locale === 'zh' ? '把当前结果整理成简洁报告' : 'turn the current result into a concise report')}>{labels.report}</button>
              <button type="button" disabled={loading} onClick={() => sendMessage(locale === 'zh' ? '保存到 TheOne 记忆' : 'save this to TheOne memory')}>{labels.save}</button>
            </div>
            <WorkerCallCards result={latestResult} />
          </details>

          <details className="run-side-details">
            <summary>
              <span>{labels.details}</span>
              <strong>{workflowSteps(latestResult).length || 1}</strong>
            </summary>
            <strong>{workflow?.summary || (locale === 'zh' ? '等待目标。' : 'Waiting for a goal.')}</strong>
            <div className="run-workflow-list">
              {(workflow?.steps || [
                { id: 'ready', title: 'Describe an outcome', owner: 'oneai', status: 'ready' },
              ]).map((step: any, index: number) => (
                <div key={step.id || index} className="run-workflow-step">
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <strong>{step.title}</strong>
                    <small>{step.owner || 'theone'} · {friendlyStatus(step.status)}</small>
                  </div>
                </div>
              ))}
            </div>
            {workerRuntime?.phases?.length ? (
              <div className="run-tool-steps">
                {workerRuntime.phases.map((phase: any) => (
                  <div key={phase.key}>
                    <small>{friendlyStatus(phase.status)}</small>
                    <p>{phase.title}</p>
                    <em>{phase.detail}</em>
                  </div>
                ))}
              </div>
            ) : null}
            {missionState?.stages?.length ? (
              <div className="run-tool-steps">
                {missionState.stages.map((stage: any) => (
                  <div key={stage.key}>
                    <small>{friendlyStatus(stage.status)}</small>
                    <p>{stage.title}</p>
                    <em>{stage.key}</em>
                  </div>
                ))}
              </div>
            ) : null}
          </details>

          <div className="run-result-stats">
            <div>
              <span>Approvals</span>
              <strong>{stats.approvals}</strong>
            </div>
            <div>
              <span>Executions</span>
              <strong>{stats.executions}</strong>
            </div>
            <div>
              <span>Proof</span>
              <strong>{stats.proof}</strong>
            </div>
          </div>

          <details className="run-side-details">
            <summary>
              <span>Advanced context</span>
              <strong>{modelRoute?.model || 'frontier'}</strong>
            </summary>
            <div className="run-explain-grid">
              <div>
                <span>Model</span>
                <strong>{modelRoute?.model || 'frontier alias'}</strong>
              </div>
              <div>
                <span>Workers</span>
                <strong>{workerCatalog?.workers || coordination?.workers?.length || 'ready'}</strong>
              </div>
            </div>
            {appPackages.length ? (
              <div className="app-next-list">
                {appPackages.slice(0, 4).map((pkg: any) => <span key={pkg.key}>{pkg.title}</span>)}
              </div>
            ) : null}
          </details>

          <details className="run-side-details">
            <summary>
              <span>Workers</span>
              <strong>{coordination?.workers?.length || 'ready'}</strong>
            </summary>
            <div className="run-worker-list">
              {coordinationWorkers(latestResult).map((worker: any) => (
                <div key={worker.key || worker.title} className="run-worker-row">
                  <div>
                    <strong>{worker.title}</strong>
                    <span>{worker.role}</span>
                  </div>
                  <small className={`status-pill status-${workerTone(worker.status)}`}>{friendlyStatus(worker.status)}</small>
                </div>
              ))}
            </div>
          </details>

          <div className="run-mission-card">
            <span className="product-card-kicker">Next</span>
            <div className="app-next-list">
              {(nextActions.length > 0 ? nextActions : [
                'Start with a normal request. TheOne will choose the app or worker.',
                'Use Advanced only when you need raw traces.',
              ]).map((item: string) => <span key={item}>{item}</span>)}
            </div>
          </div>

          {workerCapabilityMap.length ? (
            <details className="run-side-details">
              <summary>
                <span>Capability map</span>
                <strong>{workerCapabilityMap.length}</strong>
              </summary>
              <div className="app-next-list">
                {workerCapabilityMap.slice(0, 28).map((item: any) => (
                  <span key={item.domain}>
                    {item.title} · {item.actions?.length || 0} · {friendlyStatus(item.status)}
                  </span>
                ))}
              </div>
            </details>
          ) : null}

        </aside>
    </main>
  );
}

export default function RunPage() {
  return (
    <Suspense fallback={null}>
      <RunPageContent />
    </Suspense>
  );
}
