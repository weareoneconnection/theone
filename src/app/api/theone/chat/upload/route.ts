import type { TheOneChatAttachment } from '@/lib/theone/state/chat-session-store';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { inflateRawSync, inflateSync } from 'node:zlib';

export const runtime = 'nodejs';
export const maxDuration = 30;

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'xml', 'html', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'sql', 'yaml', 'yml']);
const MAX_TEXT_BYTES = 512 * 1024;
const MAX_EXTRACTED_TEXT = 160_000;
const MAX_REPORT_CONTEXT = 48_000;
const MAX_FILES = 8;
const MAX_SPREADSHEET_SHEETS = 12;
const MAX_SPREADSHEET_ROWS_PER_SHEET = 300;
const MAX_SPREADSHEET_COLUMNS_PER_ROW = 40;

const DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'rtf']);
const SPREADSHEET_EXTENSIONS = new Set(['csv', 'tsv', 'xls', 'xlsx', 'xlsm']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic']);

function createId(name: string) {
  return `att_${Date.now()}_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 32)}_${Math.random().toString(36).slice(2, 7)}`;
}

function extension(name: string) {
  return name.split('.').pop()?.toLowerCase() || '';
}

function safeFilename(name: string) {
  return name.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 120) || 'attachment';
}

function uploadDirectory() {
  return process.env.THEONE_UPLOAD_DIR || path.join(tmpdir(), 'theone-chat-uploads');
}

function hasPersistentUploadStorage() {
  return Boolean(process.env.THEONE_UPLOAD_DIR);
}

function isServerlessRuntime() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.cwd().startsWith('/var/task'));
}

function isTextLike(name: string, type: string) {
  return type.startsWith('text/') ||
    type.includes('json') ||
    type.includes('xml') ||
    TEXT_EXTENSIONS.has(extension(name));
}

function summarizeText(value: string) {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.slice(0, 500);
}

function hashText(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function readableTextQuality(value: string) {
  const compact = value.replace(/\s+/g, '');
  if (compact.length < 40) return { ok: false, reason: 'No meaningful readable text was extracted.' };

  let printable = 0;
  let signal = 0;
  let control = 0;
  let replacement = 0;
  for (const char of compact) {
    const code = char.charCodeAt(0);
    if (code === 0xfffd) replacement += 1;
    if (code >= 32 && code !== 0xfffd) printable += 1;
    if (/[\p{L}\p{N}]/u.test(char)) signal += 1;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) control += 1;
  }

  const printableRatio = printable / compact.length;
  const signalRatio = signal / compact.length;
  const controlRatio = control / compact.length;
  const replacementRatio = replacement / compact.length;
  const ok = printableRatio >= 0.72 && signalRatio >= 0.18 && controlRatio <= 0.03 && replacementRatio <= 0.02;
  return {
    ok,
    reason: ok
      ? ''
      : `Upload-time text looked unreadable or binary-like (printable ${(printableRatio * 100).toFixed(0)}%, signal ${(signalRatio * 100).toFixed(0)}%, replacement ${(replacementRatio * 100).toFixed(0)}%).`,
  };
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function inflateZipPayload(payload: Buffer) {
  try {
    return inflateRawSync(payload);
  } catch {
    return inflateSync(payload);
  }
}

function fileKind(name: string, type: string) {
  const ext = extension(name);
  if (ext === 'pdf' || type === 'application/pdf') return 'pdf';
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document';
  if (SPREADSHEET_EXTENSIONS.has(ext)) return 'spreadsheet';
  if (IMAGE_EXTENSIONS.has(ext) || type.startsWith('image/')) return 'image';
  if (isTextLike(name, type)) return 'text';
  return 'file';
}

function recommendedWorker(name: string, type: string) {
  const kind = fileKind(name, type);
  if (kind === 'pdf' || kind === 'document') return 'document.parse';
  if (kind === 'spreadsheet') return 'spreadsheet.read';
  if (kind === 'image') return 'image.extractText';
  return 'file.read';
}

function estimatePdfPages(buffer: Buffer) {
  const latin = buffer.toString('latin1');
  const matches = latin.match(/\/Type\s*\/Page\b/g);
  return matches?.length || undefined;
}

function usefulEvidenceLines(text: string) {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 28 && line.length < 240)
    .slice(0, 8);
}

function detectedTopics(text: string, name: string) {
  const haystack = `${name}\n${text}`.toLowerCase();
  const topics: string[] = [];
  const checks: Array<[string, RegExp]> = [
    ['contract', /contract|subcontract|agreement|clause|scope|variation|payment|retention|liquidated/i],
    ['construction', /construction|project|site|works|completion|defect|qaqc|hse|engineer|contractor/i],
    ['commercial', /invoice|cost|budget|price|payment|purchase|order|commercial/i],
    ['schedule', /schedule|milestone|deadline|program|delay|timeline|calendar/i],
    ['risk', /risk|liability|penalty|termination|insurance|indemnity|dispute|claim/i],
    ['technical', /specification|drawing|design|technical|material|equipment|method/i],
  ];
  for (const [topic, pattern] of checks) {
    if (pattern.test(haystack)) topics.push(topic);
  }
  return topics.slice(0, 6);
}

function reportSectionsFor(kind: string, topics: string[]) {
  if (topics.includes('contract') || topics.includes('construction')) {
    return ['Executive summary', 'Scope and deliverables', 'Commercial terms', 'Risks and issues', 'Action items', 'Evidence'];
  }
  if (kind === 'spreadsheet') return ['Executive summary', 'Data overview', 'Notable values', 'Risks or gaps', 'Action items'];
  if (kind === 'image') return ['Image summary', 'Visible text', 'Findings', 'Limitations', 'Next actions'];
  return ['Executive summary', 'Key findings', 'Risks or issues', 'Action items', 'Evidence'];
}

function buildReportContext(input: {
  id: string;
  name: string;
  type: string;
  text: string;
  insights: Record<string, unknown>;
}) {
  const evidence = Array.isArray(input.insights.evidencePreview) ? input.insights.evidencePreview.map(String) : [];
  const sections = Array.isArray(input.insights.reportSections) ? input.insights.reportSections.map(String) : [];
  const topics = Array.isArray(input.insights.detectedTopics) ? input.insights.detectedTopics.map(String) : [];
  return [
    `THEONE_ATTACHMENT_SOURCE ${input.id}`,
    `File: ${input.name}`,
    `Type: ${input.type}`,
    topics.length ? `Detected topics: ${topics.join(', ')}` : '',
    typeof input.insights.wordCount === 'number' ? `Words: ${input.insights.wordCount}` : '',
    typeof input.insights.pageEstimate === 'number' ? `Estimated pages: ${input.insights.pageEstimate}` : '',
    sections.length ? `Recommended report sections: ${sections.join(' | ')}` : '',
    evidence.length ? `Evidence preview:\n- ${evidence.join('\n- ')}` : '',
    'Readable content:',
    input.text,
  ].filter(Boolean).join('\n\n').slice(0, MAX_REPORT_CONTEXT);
}

function buildAttachmentInsights(input: {
  name: string;
  type: string;
  size: number;
  text: string;
  buffer: Buffer;
  qualityWarning?: string;
}) {
  const kind = fileKind(input.name, input.type);
  const lines = input.text ? input.text.split(/\r?\n/) : [];
  const words = input.text.trim() ? input.text.trim().split(/\s+/).length : 0;
  const topics = detectedTopics(input.text, input.name);
  const readable = Boolean(input.text.trim());
  const limitations = [
    readable ? '' : 'No readable text was extracted during upload; TheOne should route a worker for deeper reading.',
    input.qualityWarning || '',
    kind === 'pdf' && readable && input.text.length >= MAX_EXTRACTED_TEXT ? 'PDF text was truncated to the upload extraction limit.' : '',
  ].filter(Boolean);

  return {
    schemaVersion: 'theone.attachment_insights.v1',
    kind,
    readable,
    size: input.size,
    extraction: readable ? 'upload_text_extract' : 'stored_file_only',
    recommendedWorker: recommendedWorker(input.name, input.type),
    pageEstimate: kind === 'pdf' ? estimatePdfPages(input.buffer) : undefined,
    wordCount: words,
    lineCount: lines.length,
    detectedTopics: topics,
    evidencePreview: usefulEvidenceLines(input.text),
    reportSections: reportSectionsFor(kind, topics),
    limitations,
  };
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)));
}

function decodePdfString(value: string) {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\([0-7]{1,3})/g, (_match, code) => String.fromCharCode(parseInt(code, 8)));
}

function extractPdfText(buffer: Buffer) {
  const latin = buffer.toString('latin1');
  const sources = [latin];
  const streamPattern = /(<<[\s\S]{0,2000}?>>)\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;

  while ((match = streamPattern.exec(latin))) {
    const dict = match[1] || '';
    const raw = Buffer.from(match[2] || '', 'latin1');
    try {
      sources.push(/FlateDecode/.test(dict) ? inflateSync(raw).toString('utf8') : raw.toString('utf8'));
    } catch {
      sources.push(raw.toString('latin1'));
    }
  }

  const textParts: string[] = [];
  const source = sources.join('\n');
  for (const item of source.matchAll(/\((?:\\.|[^\\)]){2,}\)\s*Tj/g)) {
    textParts.push(decodePdfString(item[0].replace(/\)\s*Tj$/, '').slice(1)));
  }
  for (const item of source.matchAll(/\[(.*?)\]\s*TJ/gs)) {
    const line = Array.from((item[1] || '').matchAll(/\((?:\\.|[^\\)])*\)/g))
      .map((part) => decodePdfString(part[0].slice(1, -1)))
      .join('');
    if (line.trim()) textParts.push(line);
  }

  return textParts
    .join('\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_EXTRACTED_TEXT);
}

function pythonCandidates() {
  return [
    process.env.THEONE_PYTHON_BIN,
    process.env.PYTHON_BIN,
    '/Users/maqing/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3',
    'python3',
  ].filter((candidate): candidate is string => Boolean(candidate));
}

function extractPdfTextWithPython(filePath: string) {
  if (!existsSync(filePath)) return '';
  const script = [
    'import sys',
    'from pypdf import PdfReader',
    'reader = PdfReader(sys.argv[1])',
    'parts = []',
    'for page in reader.pages[:200]:',
    '    text = page.extract_text() or ""',
    '    if text.strip():',
    '        parts.append(text)',
    `sys.stdout.write("\\n\\n".join(parts)[:${MAX_EXTRACTED_TEXT}])`,
  ].join('\n');

  for (const python of pythonCandidates()) {
    try {
      const output = execFileSync(python, ['-c', script, filePath], {
        encoding: 'utf8',
        maxBuffer: MAX_EXTRACTED_TEXT * 4,
        timeout: 12_000,
      });
      if (output.trim()) return output.slice(0, MAX_EXTRACTED_TEXT);
    } catch {
      continue;
    }
  }
  return '';
}

// Lazy import — pdfjs-dist can crash at module load on serverless, and a
// static top-level import takes the whole upload route down (empty-body 500).
// Loading it only when a PDF actually needs parsing keeps every other upload
// (images, text, spreadsheets) working even if pdfjs is broken here.
async function importPdfJs() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

async function extractPdfTextWithPdfJs(buffer: Buffer) {
  const pdfjs = await importPdfJs();

  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
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
    if (parts.join('\n\n').length >= MAX_EXTRACTED_TEXT) break;
  }

  return parts.join('\n\n').slice(0, MAX_EXTRACTED_TEXT);
}

async function extractPdfTextRobust(buffer: Buffer, storedPath?: string) {
  const attempts = isServerlessRuntime()
    ? [
        async () => extractPdfTextWithPdfJs(buffer),
        async () => extractPdfText(buffer),
        async () => storedPath ? extractPdfTextWithPython(storedPath) : '',
      ]
    : [
        async () => storedPath ? extractPdfTextWithPython(storedPath) : '',
        async () => extractPdfTextWithPdfJs(buffer),
        async () => extractPdfText(buffer),
      ];

  for (const attempt of attempts) {
    try {
      const text = await attempt();
      if (text.trim()) return text.slice(0, MAX_EXTRACTED_TEXT);
    } catch {
      continue;
    }
  }

  return '';
}

function readZipEntry(buffer: Buffer, wanted: RegExp) {
  let offset = 0;
  while (offset + 30 < buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) {
      offset += 1;
      continue;
    }

    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const name = buffer.slice(nameStart, nameStart + fileNameLength).toString('utf8');
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > buffer.length || compressedSize === 0) {
      offset = dataStart + Math.max(compressedSize, 1);
      continue;
    }

    const compressed = buffer.slice(dataStart, dataEnd);
    if (wanted.test(name)) {
      if (method === 0) return compressed;
      if (method === 8) return inflateZipPayload(compressed);
      return null;
    }
    offset = dataEnd;
  }
  return null;
}

type ZipDirectoryEntry = {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

function readZipEntries(buffer: Buffer) {
  const maxCommentLength = 0xffff;
  const searchStart = Math.max(0, buffer.length - maxCommentLength - 22);
  let endOfCentralDirectory = -1;
  for (let offset = buffer.length - 22; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      endOfCentralDirectory = offset;
      break;
    }
  }
  if (endOfCentralDirectory < 0) return [];

  const entryCount = buffer.readUInt16LE(endOfCentralDirectory + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(endOfCentralDirectory + 16);
  const entries: ZipDirectoryEntry[] = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount && offset + 46 <= buffer.length; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + nameLength).toString('utf8');
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipDirectoryEntry(buffer: Buffer, entry: ZipDirectoryEntry) {
  const offset = entry.localHeaderOffset;
  if (offset < 0 || offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) return null;
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) return null;
  const compressed = buffer.slice(dataStart, dataEnd);
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return inflateZipPayload(compressed);
  return null;
}

function readZipEntryByName(buffer: Buffer, entries: ZipDirectoryEntry[], wanted: string | RegExp) {
  const entry = entries.find((item) => typeof wanted === 'string' ? item.name === wanted : wanted.test(item.name));
  return entry ? readZipDirectoryEntry(buffer, entry) : null;
}

function xmlToText(xml: string) {
  return decodeXmlEntities(
    xml
      .replace(/<\/(?:t|si|row|p)>/g, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

function parseSharedStringsXml(xml: string) {
  const strings: string[] = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const fragments = Array.from(match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)).map((fragment) => fragment[1]);
    strings.push(xmlToText(fragments.length ? fragments.join('') : match[1]).replace(/\n+/g, ' ').trim());
  }
  return strings;
}

function normalizeWorkbookTarget(target: string) {
  const clean = target.replace(/^\/+/, '');
  if (clean.startsWith('xl/')) return clean;
  return `xl/${clean.replace(/^\.\.\//, '')}`;
}

function parseWorkbookRelationships(xml: string) {
  const relationships = new Map<string, string>();
  for (const match of xml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    relationships.set(match[1], normalizeWorkbookTarget(match[2]));
  }
  return relationships;
}

function parseWorkbookSheets(workbookXml: string, relationshipsXml: string) {
  const relationships = parseWorkbookRelationships(relationshipsXml);
  const sheets: Array<{ name: string; path: string }> = [];
  let fallbackIndex = 1;
  for (const match of workbookXml.matchAll(/<sheet\b([^>]+?)\/?>/g)) {
    const attrs = match[1];
    const name = attrs.match(/\bname="([^"]+)"/)?.[1] || `Sheet ${fallbackIndex}`;
    const relationshipId = attrs.match(/\br:id="([^"]+)"/)?.[1] || '';
    const path = relationships.get(relationshipId) || `xl/worksheets/sheet${fallbackIndex}.xml`;
    sheets.push({ name: decodeXmlEntities(name), path });
    fallbackIndex += 1;
  }
  return sheets;
}

function columnIndex(cellRef: string) {
  const letters = (cellRef.match(/^[A-Z]+/i)?.[0] || '').toUpperCase();
  if (!letters) return -1;
  let value = 0;
  for (const letter of letters) value = value * 26 + (letter.charCodeAt(0) - 64);
  return value - 1;
}

function parseWorksheetRows(xml: string, sharedStrings: string[]) {
  const rows: string[] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = new Map<number, string>();
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = attrs.match(/\br="([^"]+)"/)?.[1] || '';
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] || '';
      const index = columnIndex(ref);
      if (index < 0 || index >= MAX_SPREADSHEET_COLUMNS_PER_ROW) continue;
      let value = '';
      if (type === 'inlineStr') {
        value = xmlToText(Array.from(body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)).map((item) => item[1]).join(' '));
      } else {
        const rawValue = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] || '';
        value = type === 's' ? sharedStrings[Number(rawValue)] || '' : decodeXmlEntities(rawValue).trim();
      }
      if (value) cells.set(index, value.replace(/\s+/g, ' ').trim());
    }
    if (!cells.size) continue;
    const maxIndex = Math.min(MAX_SPREADSHEET_COLUMNS_PER_ROW - 1, Math.max(...cells.keys()));
    const values = Array.from({ length: maxIndex + 1 }, (_, index) => cells.get(index) || '').join('\t').trim();
    if (values) rows.push(values);
    if (rows.length >= MAX_SPREADSHEET_ROWS_PER_SHEET) break;
  }
  return rows;
}

function extractDocxText(buffer: Buffer) {
  const entries = readZipEntries(buffer);
  const documentXml = readZipEntryByName(buffer, entries, 'word/document.xml') || readZipEntry(buffer, /^word\/document\.xml$/);
  if (!documentXml) return '';
  return decodeXmlEntities(
    documentXml
      .toString('utf8')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  ).slice(0, MAX_EXTRACTED_TEXT);
}

function extractSpreadsheetText(buffer: Buffer) {
  const entries = readZipEntries(buffer);
  const sharedStringsXml = readZipEntryByName(buffer, entries, 'xl/sharedStrings.xml') || readZipEntry(buffer, /^xl\/sharedStrings\.xml$/);
  const workbookXml = readZipEntryByName(buffer, entries, 'xl/workbook.xml');
  const workbookRelationshipsXml = readZipEntryByName(buffer, entries, 'xl/_rels/workbook.xml.rels');
  const sharedStrings = sharedStringsXml ? parseSharedStringsXml(sharedStringsXml.toString('utf8')) : [];
  const workbookSheets = workbookXml
    ? parseWorkbookSheets(workbookXml.toString('utf8'), workbookRelationshipsXml?.toString('utf8') || '')
    : [];
  const worksheetEntries = workbookSheets.length
    ? workbookSheets
    : entries
        .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name))
        .map((entry, index) => ({ name: `Sheet ${index + 1}`, path: entry.name }));

  const parts: string[] = [];
  for (const sheet of worksheetEntries.slice(0, MAX_SPREADSHEET_SHEETS)) {
    const worksheetXml = readZipEntryByName(buffer, entries, sheet.path);
    if (!worksheetXml) continue;
    const rows = parseWorksheetRows(worksheetXml.toString('utf8'), sharedStrings);
    if (rows.length) parts.push(`## Sheet: ${sheet.name}\n${rows.join('\n')}`);
  }

  if (parts.length) return parts.join('\n\n').slice(0, MAX_EXTRACTED_TEXT);
  if (sharedStrings.length) return sharedStrings.join('\n').slice(0, MAX_EXTRACTED_TEXT);
  return '';
}

async function extractReadableContent(name: string, type: string, buffer: Buffer, storedPath?: string) {
  const ext = extension(name);
  if (isTextLike(name, type)) {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer.subarray(0, MAX_TEXT_BYTES));
  }
  if (ext === 'pdf' || type === 'application/pdf') {
    return extractPdfTextRobust(buffer, storedPath);
  }
  if (ext === 'docx') return extractDocxText(buffer);
  if (ext === 'xlsx' || ext === 'xlsm') return extractSpreadsheetText(buffer);
  return '';
}

function unsupportedLegacySpreadsheetReason(name: string) {
  return extension(name) === 'xls'
    ? 'Legacy .xls spreadsheets are not supported by the production upload parser. Please save the file as .xlsx, .xlsm, .csv, or .tsv and attach it again.'
    : '';
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch (error) {
    // Body too large or malformed multipart — the platform may also reject
    // this before we run, but when it reaches us, say why.
    const message = errorMessage(error, 'Could not read the uploaded files.');
    const tooLarge = /body|size|large|limit|413/i.test(message);
    return Response.json({
      ok: false,
      error: tooLarge
        ? 'Upload exceeds the request size limit (about 4MB on serverless). Compress or split the file, or paste the text into chat instead.'
        : message,
    }, { status: tooLarge ? 413 : 400 });
  }
  try {
    const files = (form as FormData).getAll('files').filter((item): item is File => item instanceof File).slice(0, MAX_FILES);
    const uploadDir = uploadDirectory();
    let uploadDirError = '';
    try {
      await mkdir(uploadDir, { recursive: true });
    } catch (error) {
      uploadDirError = errorMessage(error, 'Upload directory could not be prepared.');
    }

    const attachments: TheOneChatAttachment[] = [];
    for (const file of files) {
      try {
      const bytes = Buffer.from(await file.arrayBuffer());
      const id = createId(file.name);
      let storedPath: string | undefined = uploadDirError ? undefined : path.join(uploadDir, `${id}-${safeFilename(file.name)}`);
      let storageError = uploadDirError;
      if (storedPath) {
        try {
          await writeFile(storedPath, bytes);
        } catch (error) {
          storageError = errorMessage(error, 'Attachment could not be written to upload storage.');
          storedPath = undefined;
        }
      }

      const item: TheOneChatAttachment = {
        id,
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        sourceId: id,
        contentRef: `theone://attachment/${id}`,
        ...(storedPath ? { path: storedPath } : {}),
      };

      let text = '';
      let extractionError = '';
      try {
        text = await extractReadableContent(file.name, file.type || '', bytes, storedPath);
      } catch (error) {
        extractionError = error instanceof Error ? error.message : 'Upload-time text extraction failed.';
      }
      const quality = readableTextQuality(text);
      const readableText = quality.ok ? text : '';

      item.insights = buildAttachmentInsights({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        text: readableText,
        buffer: bytes,
        qualityWarning: text.trim() && !quality.ok ? quality.reason : undefined,
      });
      item.insights.sourceId = id;
      item.insights.contentRef = item.contentRef;
      item.insights.storage = {
        provider: hasPersistentUploadStorage() ? 'theone_upload_dir' : isServerlessRuntime() ? 'serverless_upload_context' : 'local_tmp',
        durable: hasPersistentUploadStorage(),
        pathAvailable: Boolean(item.path),
        writeAvailable: !storageError,
        writeError: storageError || undefined,
        uploadTextAvailable: Boolean(readableText.trim()),
      };
      if (storageError) {
        item.insights.storageError = storageError;
      }
      if (extractionError) {
        item.insights.extractionError = extractionError;
        item.insights.extraction = 'stored_file_extraction_failed';
      }
      if (readableText.trim()) {
        item.textHash = hashText(readableText);
        item.text = readableText;
        item.textPreview = readableText.slice(0, 12000);
        item.summary = summarizeText(readableText);
        item.reportContext = buildReportContext({
          id,
          name: file.name,
          type: file.type || 'application/octet-stream',
          text: readableText,
          insights: item.insights,
        });
        item.insights.textHash = item.textHash;
        item.insights.reportContextAvailable = true;
        item.insights.reportReadiness = 'ready';
      } else {
        const worker = typeof item.insights.recommendedWorker === 'string' ? item.insights.recommendedWorker : recommendedWorker(file.name, file.type || '');
        const unsupportedReason = unsupportedLegacySpreadsheetReason(file.name);
        const reason = unsupportedReason
          || (storageError
          ? `Upload storage failed: ${storageError}.`
          : extractionError
            ? `Upload-time text extraction failed: ${extractionError}.`
            : text.trim() && !quality.ok
              ? `Upload-time text was not reliable: ${quality.reason}.`
              : 'No readable text was extracted during upload.');
        if (unsupportedReason) {
          item.status = 'failed';
          item.error = reason;
          item.summary = reason;
          item.insights.extraction = 'legacy_spreadsheet_unsupported';
          item.insights.reportContextAvailable = false;
          item.insights.reportReadiness = 'needs_supported_spreadsheet';
          item.insights.limitations = [
            ...(Array.isArray(item.insights.limitations) ? item.insights.limitations : []),
            'Convert the workbook to a modern spreadsheet or delimited file before upload.',
          ];
        } else if (isServerlessRuntime() && !hasPersistentUploadStorage()) {
          delete item.path;
          item.status = 'failed';
          item.error = `${reason} Serverless temporary file paths cannot be reused across chat requests. Configure THEONE_UPLOAD_DIR with persistent storage or enable upload-time parsing for this file type.`;
          item.summary = item.error;
          item.insights.extraction = 'upload_text_unavailable_serverless';
          item.insights.reportContextAvailable = false;
          item.insights.reportReadiness = 'needs_source';
          item.insights.limitations = [
            ...(Array.isArray(item.insights.limitations) ? item.insights.limitations : []),
            'Serverless temporary file path is not a durable source.',
          ];
        } else {
          item.summary = `${reason} Recommended worker: ${worker}. TheOne should use the stored attachment path instead of asking the user for a new path.`;
          item.insights.reportContextAvailable = false;
          item.insights.reportReadiness = 'needs_worker';
        }
      }

      attachments.push(item);
      } catch (error) {
        const id = createId(file.name);
        const message = error instanceof Error ? error.message : 'Attachment upload failed.';
        attachments.push({
          id,
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          sourceId: id,
          contentRef: `theone://attachment/${id}`,
          status: 'failed',
          error: message,
          summary: `Upload failed before this attachment became readable. ${message}`,
          insights: {
            extraction: 'upload_failed',
            reportReadiness: 'needs_source',
            reportContextAvailable: false,
            limitations: [
              'The upload route isolated this file failure so the chat session can continue.',
              'Re-upload the file or provide a durable file source.',
            ],
            storage: {
              provider: hasPersistentUploadStorage() ? 'theone_upload_dir' : isServerlessRuntime() ? 'serverless_upload_context' : 'local_tmp',
              durable: hasPersistentUploadStorage(),
              pathAvailable: false,
              writeAvailable: false,
              uploadTextAvailable: false,
              writeError: message,
            },
          },
        });
      }
    }

    return Response.json({
      ok: true,
      attachments,
      limit: {
        maxFiles: MAX_FILES,
        maxTextBytes: MAX_TEXT_BYTES,
      },
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Attachment upload failed.',
    }, { status: 500 });
  }
}
