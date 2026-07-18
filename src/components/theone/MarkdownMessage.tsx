'use client';

import { isValidElement, type ReactNode, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function nodeText(value: ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(nodeText).join('');
  }
  if (isValidElement<{ children?: ReactNode }>(value)) {
    return nodeText(value.props.children);
  }
  return '';
}

function CodeBlock({ code, language, locale }: { code: string; language: string; locale: string }) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="run-markdown-code">
      <div className="run-markdown-code-head">
        <span>{language || (locale === 'zh' ? '代码' : 'Code')}</span>
        <button type="button" onClick={copyCode}>
          {copied ? (locale === 'zh' ? '已复制' : 'Copied') : locale === 'zh' ? '复制' : 'Copy'}
        </button>
      </div>
      <pre>
        <code className={language ? `language-${language}` : undefined}>{code}</code>
      </pre>
    </div>
  );
}

export function MarkdownMessage({ content, locale }: { content: string; locale: string }) {
  return (
    <div className="run-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          pre: ({ children }) => {
            const child = isValidElement<{ className?: string; children?: ReactNode }>(children)
              ? children
              : null;
            const className = child?.props.className || '';
            const language = className.match(/language-([\w#+.-]+)/)?.[1] || '';
            const code = nodeText(child?.props.children ?? children).replace(/\n$/, '');
            return <CodeBlock code={code} language={language} locale={locale} />;
          },
          code: ({ className, children }) => (
            <code className={className}>{children}</code>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
