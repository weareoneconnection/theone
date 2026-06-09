import { readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const exportRoot = path.join(tmpdir(), 'theone-report-exports');

function contentTypeFor(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.md') return 'text/markdown; charset=utf-8';
  return 'application/octet-stream';
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedPath = url.searchParams.get('path') || '';
    if (!requestedPath) {
      return Response.json({ ok: false, error: 'Missing export file path.' }, { status: 400 });
    }
    const resolved = path.resolve(requestedPath);
    const root = path.resolve(exportRoot);
    if (!resolved.startsWith(`${root}${path.sep}`)) {
      return Response.json({ ok: false, error: 'Export file path is outside the allowed report export directory.' }, { status: 403 });
    }
    const info = await stat(resolved);
    if (!info.isFile()) {
      return Response.json({ ok: false, error: 'Export path is not a file.' }, { status: 404 });
    }
    const data = await readFile(resolved);
    const filename = path.basename(resolved).replace(/"/g, '');
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': contentTypeFor(resolved),
        'Content-Length': String(data.length),
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Could not download report export file.',
    }, { status: 404 });
  }
}
