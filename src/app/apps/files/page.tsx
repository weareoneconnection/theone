'use client';

import { OneClawActionApp, type ActionTemplate } from '@/components/theone/OneClawActionApp';
import { ProductPage, ProductStatusStrip } from '@/components/theone/ProductNav';

const templates: ActionTemplate[] = [
  {
    key: 'list',
    label: 'List Folder',
    action: 'file.list',
    description: 'List files in a folder through the OneClaw filesystem worker.',
    fields: [{ key: 'path', label: 'Path', defaultValue: '/tmp' }],
  },
  {
    key: 'exists',
    label: 'Exists',
    action: 'file.exists',
    description: 'Check whether a file or folder exists.',
    fields: [{ key: 'path', label: 'Path', defaultValue: '/tmp' }],
  },
  {
    key: 'read',
    label: 'Read File',
    action: 'file.read',
    description: 'Read a file through the guarded filesystem worker.',
    fields: [{ key: 'path', label: 'Path', placeholder: '/tmp/example.txt' }],
  },
  {
    key: 'write',
    label: 'Write File',
    action: 'file.write',
    approvalMode: 'manual',
    description: 'Prepare a file write. Writes remain approval gated.',
    fields: [
      { key: 'path', label: 'Path', defaultValue: '/tmp/theone-note.txt' },
      { key: 'content', label: 'Content', multiline: true, defaultValue: 'Created from TheOne Files App.' },
    ],
  },
  {
    key: 'append',
    label: 'Append File',
    action: 'file.append',
    approvalMode: 'manual',
    description: 'Prepare an append operation with approval.',
    fields: [
      { key: 'path', label: 'Path', defaultValue: '/tmp/theone-note.txt' },
      { key: 'content', label: 'Content', multiline: true, defaultValue: '\nAppended from TheOne Files App.' },
    ],
  },
];

export default function FilesAppPage() {
  return (
    <ProductPage
      eyebrow="Files App"
      title="File browsing and writing workspace"
      subtitle="Browse files, read artifacts, and prepare guarded writes through the OneClaw filesystem worker."
      compact
      aside={(
        <ProductStatusStrip
          items={[
            { label: 'Worker', value: 'files', tone: 'assist' },
            { label: 'Reads', value: 'auto', tone: 'online' },
            { label: 'Writes', value: 'approval', tone: 'manual' },
          ]}
        />
      )}
    >
      <OneClawActionApp templates={templates} defaultTemplate="list" resultTitle="File Result" />
    </ProductPage>
  );
}
