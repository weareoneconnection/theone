import type { TheOneChatAttachment } from '@/lib/theone/state/chat-session-store';

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'xml', 'html', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'sql', 'yaml', 'yml']);
const MAX_TEXT_BYTES = 512 * 1024;
const MAX_FILES = 8;

function createId(name: string) {
  return `att_${Date.now()}_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 32)}_${Math.random().toString(36).slice(2, 7)}`;
}

function extension(name: string) {
  return name.split('.').pop()?.toLowerCase() || '';
}

function isTextFile(file: File) {
  return file.type.startsWith('text/') ||
    file.type.includes('json') ||
    file.type.includes('xml') ||
    TEXT_EXTENSIONS.has(extension(file.name));
}

function summarizeText(value: string) {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.slice(0, 500);
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const files = form.getAll('files').filter((item): item is File => item instanceof File).slice(0, MAX_FILES);

    const attachments: TheOneChatAttachment[] = [];
    for (const file of files) {
      const item: TheOneChatAttachment = {
        id: createId(file.name),
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
      };

      if (isTextFile(file)) {
        const bytes = await file.arrayBuffer();
        const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, MAX_TEXT_BYTES));
        item.text = text;
        item.textPreview = text.slice(0, 4000);
        item.summary = summarizeText(text);
      } else {
        item.summary = 'Binary attachment captured as metadata. Use an image, document, or file worker to inspect content.';
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
