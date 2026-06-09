import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';

export type TheOneReportArtifact = {
  schemaVersion: 'theone.report_artifact.v1';
  id: string;
  title: string;
  format: string;
  sourceFiles: Array<{
    name: string;
    type?: string;
    path?: string;
    summary?: string;
    insights?: Record<string, unknown>;
    pageEstimate?: number;
    wordCount?: number;
    recommendedWorker?: string;
  }>;
  executiveSummary: string;
  keyFindings: string[];
  risks: Array<{
    title: string;
    severity: 'low' | 'medium' | 'high';
    evidence?: string;
    action?: string;
  }>;
  actionItems: Array<{
    task: string;
    owner?: string;
    priority?: 'low' | 'medium' | 'high';
    evidence?: string;
  }>;
  evidence: string[];
  sourceExcerpt: string;
  createdAt: string;
};

export type ReportExportFile = {
  format: 'markdown' | 'html' | 'json' | 'pdf' | 'docx';
  path: string;
  filename: string;
  contentType: string;
  size: number;
};

export type ReportExportBundle = {
  schemaVersion: 'theone.report_export_bundle.v1';
  id: string;
  status: 'ready';
  createdAt: string;
  files: ReportExportFile[];
};

function slugify(value: string, fallback = 'theone-report') {
  const slug = value
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || fallback;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(value: string) {
  return escapeHtml(value).replace(/\n/g, '<w:br/>');
}

function wrapText(value: string, max = 92) {
  const words = value.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = `${line} ${word}`.trim();
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function renderReportMarkdown(artifact: TheOneReportArtifact) {
  return [
    `# ${artifact.title}`,
    '',
    `Generated: ${artifact.createdAt}`,
    `Format: ${artifact.format}`,
    '',
    '## Executive summary',
    artifact.executiveSummary || 'No executive summary was generated.',
    '',
    '## Key findings',
    ...(artifact.keyFindings.length ? artifact.keyFindings.map((item) => `- ${item}`) : ['- No key findings were generated.']),
    '',
    '## Risks and issues',
    ...(artifact.risks.length ? artifact.risks.map((risk) => [
      `- [${risk.severity}] ${risk.title}`,
      risk.evidence ? `  - Evidence: ${risk.evidence}` : '',
      risk.action ? `  - Action: ${risk.action}` : '',
    ].filter(Boolean).join('\n')) : ['- No risks were generated.']),
    '',
    '## Action items',
    ...(artifact.actionItems.length ? artifact.actionItems.map((item) => [
      `- ${item.task}`,
      item.owner ? `  - Owner: ${item.owner}` : '',
      item.priority ? `  - Priority: ${item.priority}` : '',
      item.evidence ? `  - Evidence: ${item.evidence}` : '',
    ].filter(Boolean).join('\n')) : ['- No action items were generated.']),
    '',
    '## Evidence',
    ...(artifact.evidence.length ? artifact.evidence.map((item) => `- ${item}`) : ['- No evidence snippets were generated.']),
    '',
    '## Source files',
    ...(artifact.sourceFiles.length ? artifact.sourceFiles.map((file) => `- ${file.name}${file.type ? ` (${file.type})` : ''}`) : ['- No source files recorded.']),
    '',
  ].join('\n');
}

function renderReportHtml(artifact: TheOneReportArtifact) {
  const list = (items: string[]) => items.length
    ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
    : '<p>No items recorded.</p>';
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8"/>',
    `<title>${escapeHtml(artifact.title)}</title>`,
    '<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:40px;line-height:1.55;color:#111}h1{font-size:34px}h2{margin-top:28px}.meta{color:#555}.risk,.action{border:1px solid #ddd;border-radius:8px;padding:12px;margin:10px 0}.tag{text-transform:uppercase;font-size:12px;font-weight:700;color:#096}</style>',
    '</head><body>',
    `<h1>${escapeHtml(artifact.title)}</h1>`,
    `<p class="meta">Generated ${escapeHtml(artifact.createdAt)} · ${escapeHtml(artifact.format)}</p>`,
    '<h2>Executive summary</h2>',
    `<p>${escapeHtml(artifact.executiveSummary || 'No executive summary was generated.')}</p>`,
    '<h2>Key findings</h2>',
    list(artifact.keyFindings),
    '<h2>Risks and issues</h2>',
    artifact.risks.map((risk) => `<div class="risk"><span class="tag">${escapeHtml(risk.severity)}</span><h3>${escapeHtml(risk.title)}</h3>${risk.evidence ? `<p><b>Evidence:</b> ${escapeHtml(risk.evidence)}</p>` : ''}${risk.action ? `<p><b>Action:</b> ${escapeHtml(risk.action)}</p>` : ''}</div>`).join('') || '<p>No risks were generated.</p>',
    '<h2>Action items</h2>',
    artifact.actionItems.map((item) => `<div class="action"><h3>${escapeHtml(item.task)}</h3>${item.owner ? `<p><b>Owner:</b> ${escapeHtml(item.owner)}</p>` : ''}${item.priority ? `<p><b>Priority:</b> ${escapeHtml(item.priority)}</p>` : ''}${item.evidence ? `<p><b>Evidence:</b> ${escapeHtml(item.evidence)}</p>` : ''}</div>`).join('') || '<p>No action items were generated.</p>',
    '<h2>Evidence</h2>',
    list(artifact.evidence),
    '<h2>Source files</h2>',
    list(artifact.sourceFiles.map((file) => `${file.name}${file.type ? ` (${file.type})` : ''}`)),
    '</body></html>',
  ].join('\n');
}

function pdfEscape(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function renderSimplePdf(artifact: TheOneReportArtifact) {
  const markdown = renderReportMarkdown(artifact)
    .replace(/^#+\s*/gm, '')
    .split('\n')
    .flatMap((line) => wrapText(line || ' ', 84))
    .slice(0, 110);
  const stream = [
    'BT',
    '/F1 10 Tf',
    '50 780 Td',
    '14 TL',
    ...markdown.map((line, index) => `${index === 0 ? '' : 'T* '}(${pdfEscape(line)}) Tj`),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  const chunks = ['%PDF-1.4\n'];
  const offsets: number[] = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(chunks.join('')));
    chunks.push(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`);
  }
  const xrefOffset = Buffer.byteLength(chunks.join(''));
  chunks.push(`xref\n0 ${objects.length + 1}\n`);
  chunks.push('0000000000 65535 f \n');
  offsets.slice(1).forEach((offset) => chunks.push(`${String(offset).padStart(10, '0')} 00000 n \n`));
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return Buffer.from(chunks.join(''), 'utf8');
}

const crcTable = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries: Array<{ name: string; data: Buffer; compress?: boolean }>) {
  const fileParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = entry.compress === false ? entry.data : deflateRawSync(entry.data);
    const method = entry.compress === false ? 0 : 8;
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    fileParts.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralOffset = offset;
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([...fileParts, central, end]);
}

function docParagraph(text: string) {
  return `<w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`;
}

function renderDocx(artifact: TheOneReportArtifact) {
  const paragraphs = renderReportMarkdown(artifact)
    .split('\n')
    .map((line) => docParagraph(line || ' ')).join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr/></w:body></w:document>`;
  return zip([
    { name: '[Content_Types].xml', compress: false, data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
    { name: '_rels/.rels', compress: false, data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
    { name: 'word/document.xml', data: Buffer.from(documentXml) },
  ]);
}

export async function exportReportArtifact(artifact: TheOneReportArtifact): Promise<ReportExportBundle> {
  const exportId = `export_${Date.now()}_${slugify(artifact.title)}`;
  const dir = path.join(tmpdir(), 'theone-report-exports', exportId);
  await mkdir(dir, { recursive: true });
  const base = slugify(artifact.title);
  const outputs: Array<{ format: ReportExportFile['format']; filename: string; contentType: string; data: Buffer }> = [
    { format: 'markdown', filename: `${base}.md`, contentType: 'text/markdown; charset=utf-8', data: Buffer.from(renderReportMarkdown(artifact)) },
    { format: 'html', filename: `${base}.html`, contentType: 'text/html; charset=utf-8', data: Buffer.from(renderReportHtml(artifact)) },
    { format: 'json', filename: `${base}.json`, contentType: 'application/json; charset=utf-8', data: Buffer.from(JSON.stringify(artifact, null, 2)) },
    { format: 'pdf', filename: `${base}.pdf`, contentType: 'application/pdf', data: renderSimplePdf(artifact) },
    { format: 'docx', filename: `${base}.docx`, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: renderDocx(artifact) },
  ];
  const files: ReportExportFile[] = [];
  for (const output of outputs) {
    const filePath = path.join(dir, output.filename);
    await writeFile(filePath, output.data);
    files.push({
      format: output.format,
      path: filePath,
      filename: output.filename,
      contentType: output.contentType,
      size: output.data.length,
    });
  }
  return {
    schemaVersion: 'theone.report_export_bundle.v1',
    id: exportId,
    status: 'ready',
    createdAt: new Date().toISOString(),
    files,
  };
}
