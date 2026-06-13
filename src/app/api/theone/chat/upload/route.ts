import type { TheOneChatAttachment } from '@/lib/theone/state/chat-session-store';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { inflateSync } from 'node:zlib';

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'xml', 'html', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'sql', 'yaml', 'yml']);
const MAX_TEXT_BYTES = 512 * 1024;
const MAX_EXTRACTED_TEXT = 80_000;
const MAX_FILES = 8;

const DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'rtf']);
const SPREADSHEET_EXTENSIONS = new Set(['csv', 'tsv', 'xls', 'xlsx']);
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

function readableTextQuality(value: string) {
  const compact = value.replace(/\s+/g, '');
  if (compact.length < 40) return { ok: false, reason: 'No meaningful readable text was extracted.' };

  let printable = 0;
  let signal = 0;
  let control = 0;
  for (const char of compact) {
    const code = char.charCodeAt(0);
    if ((code >= 32 && code <= 126) || code >= 0x4e00) printable += 1;
    if (/[A-Za-z0-9\u4e00-\u9fff]/.test(char)) signal += 1;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) control += 1;
  }

  const printableRatio = printable / compact.length;
  const signalRatio = signal / compact.length;
  const controlRatio = control / compact.length;
  const ok = printableRatio >= 0.75 && signalRatio >= 0.28 && controlRatio <= 0.03;
  return {
    ok,
    reason: ok
      ? ''
      : `Upload-time text looked unreadable or binary-like (printable ${(printableRatio * 100).toFixed(0)}%, signal ${(signalRatio * 100).toFixed(0)}%).`,
  };
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

async function importPdfJs() {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
  const candidates = [
    process.env.THEONE_PDFJS_MODULE,
    'pdfjs-dist/legacy/build/pdf.mjs',
    '/Users/maqing/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pdfjs-dist/legacy/build/pdf.mjs',
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      return await dynamicImport(candidate);
    } catch {
      continue;
    }
  }

  return null;
}

async function extractPdfTextWithPdfJs(buffer: Buffer) {
  const pdfjs = await importPdfJs();
  if (!pdfjs?.getDocument) return '';

  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    useSystemFonts: true,
  });
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
      if (method === 8) return inflateSync(compressed);
      return null;
    }
    offset = dataEnd;
  }
  return null;
}

function extractDocxText(buffer: Buffer) {
  const documentXml = readZipEntry(buffer, /^word\/document\.xml$/);
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
  const sharedStrings = readZipEntry(buffer, /^xl\/sharedStrings\.xml$/);
  if (!sharedStrings) return '';
  return decodeXmlEntities(
    sharedStrings
      .toString('utf8')
      .replace(/<\/si>/g, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  ).slice(0, MAX_EXTRACTED_TEXT);
}

async function extractReadableContent(name: string, type: string, buffer: Buffer, storedPath?: string) {
  const ext = extension(name);
  if (isTextLike(name, type)) {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer.subarray(0, MAX_TEXT_BYTES));
  }
  if (ext === 'pdf' || type === 'application/pdf') {
    return (storedPath ? extractPdfTextWithPython(storedPath) : '') || await extractPdfTextWithPdfJs(buffer) || extractPdfText(buffer);
  }
  if (ext === 'docx') return extractDocxText(buffer);
  if (ext === 'xlsx') return extractSpreadsheetText(buffer);
  return '';
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const files = form.getAll('files').filter((item): item is File => item instanceof File).slice(0, MAX_FILES);
    const uploadDir = uploadDirectory();
    await mkdir(uploadDir, { recursive: true });

    const attachments: TheOneChatAttachment[] = [];
    for (const file of files) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const id = createId(file.name);
      const storedPath = path.join(uploadDir, `${id}-${safeFilename(file.name)}`);
      await writeFile(storedPath, bytes);

      const item: TheOneChatAttachment = {
        id,
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        path: storedPath,
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
      if (extractionError) {
        item.insights.extractionError = extractionError;
        item.insights.extraction = 'stored_file_extraction_failed';
      }
      if (readableText.trim()) {
        item.text = readableText;
        item.textPreview = readableText.slice(0, 4000);
        item.summary = summarizeText(readableText);
      } else {
        const worker = typeof item.insights.recommendedWorker === 'string' ? item.insights.recommendedWorker : recommendedWorker(file.name, file.type || '');
        const reason = extractionError
          ? `Upload-time text extraction failed: ${extractionError}.`
          : text.trim() && !quality.ok
            ? `Upload-time text was not reliable: ${quality.reason}.`
            : 'No readable text was extracted during upload.';
        if (isServerlessRuntime() && !hasPersistentUploadStorage()) {
          delete item.path;
          item.status = 'failed';
          item.error = `${reason} Serverless temporary file paths cannot be reused across chat requests. Configure THEONE_UPLOAD_DIR with persistent storage or enable upload-time parsing for this file type.`;
          item.summary = item.error;
          item.insights.extraction = 'upload_text_unavailable_serverless';
          item.insights.limitations = [
            ...(Array.isArray(item.insights.limitations) ? item.insights.limitations : []),
            'Serverless temporary file path is not a durable source.',
          ];
        } else {
          item.summary = `${reason} Recommended worker: ${worker}. TheOne should use the stored attachment path instead of asking the user for a new path.`;
        }
      }

      attachments.push(item);
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
