import type { TheOneChatAttachment } from '@/lib/theone/state/chat-session-store';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'xml', 'html', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'sql', 'yaml', 'yml']);
const MAX_TEXT_BYTES = 512 * 1024;
const MAX_EXTRACTED_TEXT = 80_000;
const MAX_FILES = 8;

function createId(name: string) {
  return `att_${Date.now()}_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 32)}_${Math.random().toString(36).slice(2, 7)}`;
}

function extension(name: string) {
  return name.split('.').pop()?.toLowerCase() || '';
}

function safeFilename(name: string) {
  return name.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 120) || 'attachment';
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

function extractReadableContent(name: string, type: string, buffer: Buffer) {
  const ext = extension(name);
  if (isTextLike(name, type)) {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer.subarray(0, MAX_TEXT_BYTES));
  }
  if (ext === 'pdf' || type === 'application/pdf') return extractPdfText(buffer);
  if (ext === 'docx') return extractDocxText(buffer);
  if (ext === 'xlsx') return extractSpreadsheetText(buffer);
  return '';
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const files = form.getAll('files').filter((item): item is File => item instanceof File).slice(0, MAX_FILES);
    const uploadDir = path.join(tmpdir(), 'theone-chat-uploads');
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

      const text = extractReadableContent(file.name, file.type || '', bytes);
      if (text.trim()) {
        item.text = text;
        item.textPreview = text.slice(0, 4000);
        item.summary = summarizeText(text);
      } else {
        item.summary = 'Attachment uploaded and stored. TheOne can route a document, image, spreadsheet, or file worker if deeper inspection is needed.';
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
