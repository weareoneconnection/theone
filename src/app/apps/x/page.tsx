'use client';

import { OneClawActionApp, type ActionTemplate } from '@/components/theone/OneClawActionApp';
import { ProductPage, ProductStatusStrip } from '@/components/theone/ProductNav';

const templates: ActionTemplate[] = [
  {
    key: 'search',
    label: 'Search X',
    action: 'x.searchRecentTweets',
    description: 'Search recent tweets for reply candidates or market context.',
    fields: [
      { key: 'query', label: 'Query', defaultValue: 'AI agents workflow' },
      { key: 'maxResults', label: 'Max results', defaultValue: '10' },
    ],
    buildInput: (values) => ({ query: values.query, maxResults: Number(values.maxResults || 10) }),
  },
  {
    key: 'post',
    label: 'Prepare Post',
    action: 'social.post',
    approvalMode: 'manual',
    description: 'Prepare a public X post. Publishing remains approval gated.',
    fields: [
      { key: 'content', label: 'Post content', multiline: true, defaultValue: 'TheOne is becoming an AI operating system: intent, policy, workers, proof, and memory in one governed workflow.' },
    ],
    buildInput: (values) => ({ channel: 'x', mode: 'post', content: values.content }),
  },
  {
    key: 'reply',
    label: 'Prepare Reply',
    action: 'social.post',
    approvalMode: 'manual',
    description: 'Prepare a strict X reply to a specific tweet ID.',
    fields: [
      { key: 'replyToTweetId', label: 'Reply tweet ID', placeholder: '2057764916816425258' },
      { key: 'content', label: 'Reply content', multiline: true, defaultValue: 'Exactly. The real shift is the operating environment around agents: context, permissions, tools, and feedback loops.' },
    ],
    buildInput: (values) => ({
      channel: 'x',
      mode: 'reply_only',
      strictReply: true,
      replyToTweetId: values.replyToTweetId,
      content: values.content,
    }),
  },
];

export default function XAppPage() {
  return (
    <ProductPage
      eyebrow="X App"
      title="X content and growth workspace"
      subtitle="Search X, prepare posts, and prepare strict replies through OneClaw while TheOne keeps public publishing approval gated."
      compact
      aside={(
        <ProductStatusStrip
          items={[
            { label: 'Worker', value: 'x', tone: 'online' },
            { label: 'Search', value: 'auto', tone: 'online' },
            { label: 'Publish', value: 'approval', tone: 'manual' },
          ]}
        />
      )}
    >
      <OneClawActionApp templates={templates} defaultTemplate="search" resultTitle="X Result" />
    </ProductPage>
  );
}
