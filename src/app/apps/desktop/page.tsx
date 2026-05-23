'use client';

import { OneClawActionApp, type ActionTemplate } from '@/components/theone/OneClawActionApp';
import { ProductPage, ProductStatusStrip } from '@/components/theone/ProductNav';

const templates: ActionTemplate[] = [
  {
    key: 'state',
    label: 'App State',
    action: 'desktop.app.state',
    approvalMode: 'manual',
    description: 'Read the state of a local Mac app through the Local Desktop Bridge.',
    fields: [{ key: 'app', label: 'App', defaultValue: 'Google Chrome' }],
  },
  {
    key: 'screenshot',
    label: 'Screenshot',
    action: 'desktop.screenshot',
    approvalMode: 'manual',
    description: 'Capture a screenshot of the selected app after approval.',
    fields: [{ key: 'app', label: 'App', defaultValue: 'Google Chrome' }],
  },
  {
    key: 'hotkey',
    label: 'Hotkey',
    action: 'desktop.hotkey',
    approvalMode: 'manual',
    description: 'Send an approved keyboard shortcut to a local app.',
    fields: [
      { key: 'app', label: 'App', defaultValue: 'Google Chrome' },
      { key: 'keys', label: 'Keys', defaultValue: 'cmd,l', placeholder: 'cmd,l' },
    ],
    buildInput: (values) => ({ app: values.app, keys: values.keys.split(',').map((key) => key.trim()).filter(Boolean) }),
  },
  {
    key: 'type',
    label: 'Type Text',
    action: 'desktop.type',
    approvalMode: 'manual',
    description: 'Type text into the active local app after approval.',
    fields: [
      { key: 'app', label: 'App', defaultValue: 'Google Chrome' },
      { key: 'text', label: 'Text', defaultValue: 'https://theone-eta.vercel.app/' },
    ],
  },
];

export default function DesktopAppPage() {
  return (
    <ProductPage
      eyebrow="Desktop App"
      title="Local computer control workspace"
      subtitle="Operate local desktop actions through the OneClaw Local Desktop Bridge. These actions are intentionally approval gated."
      compact
      aside={(
        <ProductStatusStrip
          items={[
            { label: 'Worker', value: 'desktop', tone: 'manual' },
            { label: 'Bridge', value: 'local', tone: 'assist' },
            { label: 'Actions', value: 'approval', tone: 'manual' },
          ]}
        />
      )}
    >
      <OneClawActionApp templates={templates} defaultTemplate="state" resultTitle="Desktop Result" />
    </ProductPage>
  );
}
