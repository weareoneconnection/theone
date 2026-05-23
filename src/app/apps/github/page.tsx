'use client';

import { OneClawActionApp, type ActionTemplate } from '@/components/theone/OneClawActionApp';
import { ProductPage, ProductStatusStrip } from '@/components/theone/ProductNav';

const templates: ActionTemplate[] = [
  {
    key: 'repo',
    label: 'Repo Status',
    action: 'git.repo.get',
    description: 'Read repository metadata and permissions through the GitHub worker.',
    fields: [{ key: 'repo', label: 'Repository', defaultValue: 'weareoneconnection/oneaitradingbot' }],
  },
  {
    key: 'runs',
    label: 'Action Runs',
    action: 'git.actions.runs',
    description: 'Read GitHub Actions workflow runs for a branch.',
    fields: [
      { key: 'repo', label: 'Repository', defaultValue: 'weareoneconnection/oneaitradingbot' },
      { key: 'branch', label: 'Branch', defaultValue: 'main' },
    ],
  },
  {
    key: 'checks',
    label: 'Checks',
    action: 'git.checks.list',
    description: 'Read check runs for a ref when token permissions allow it.',
    fields: [
      { key: 'repo', label: 'Repository', defaultValue: 'weareoneconnection/oneaitradingbot' },
      { key: 'ref', label: 'Ref', defaultValue: 'main' },
    ],
  },
  {
    key: 'issue',
    label: 'Create Issue',
    action: 'git.issue.create',
    approvalMode: 'manual',
    description: 'Prepare a GitHub issue. The external write stays approval gated.',
    fields: [
      { key: 'repo', label: 'Repository', defaultValue: 'weareoneconnection/oneaitradingbot' },
      { key: 'title', label: 'Issue title', defaultValue: 'TheOne generated GitHub task' },
      { key: 'body', label: 'Issue body', multiline: true, defaultValue: 'Prepared from TheOne GitHub Workflow App.' },
    ],
  },
];

export default function GitHubAppPage() {
  return (
    <ProductPage
      eyebrow="GitHub App"
      title="GitHub workflow workspace"
      subtitle="Inspect repositories, workflow runs, checks, and approval-gated issue creation through the OneClaw GitHub worker."
      compact
      aside={(
        <ProductStatusStrip
          items={[
            { label: 'Worker', value: 'github', tone: 'online' },
            { label: 'Reads', value: 'auto', tone: 'online' },
            { label: 'Writes', value: 'approval', tone: 'manual' },
          ]}
        />
      )}
    >
      <OneClawActionApp templates={templates} defaultTemplate="repo" resultTitle="GitHub Result" />
    </ProductPage>
  );
}
