import { describe, it, expect } from 'vitest';
import { extractWorkspacePath, needsPipeline } from '@/lib/theone/chat/message-routing';

const PASTED_TEST_FILE = `import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';

describe('workspace confinement', () => {
  it('rejects paths escaping the workspace', () => {
    expect(() => resolveWorkspacePath(workspace, '../../etc/passwd')).toThrow(/escapes/);
  });
});
分析这段代码`;

describe('needsPipeline', () => {
  it('keeps pasted code analysis on the direct path', () => {
    // Regression: "分析" + fs.mkdtemp inside the paste used to route to the
    // pipeline, where the planner turned fs.mkdtemp into https://fs.mkdtemp/.
    expect(needsPipeline(PASTED_TEST_FILE)).toBe(false);
    expect(needsPipeline('分析这段代码')).toBe(false);
    expect(needsPipeline('帮我看看这个报错是什么意思')).toBe(false);
  });

  it('routes real external targets to the pipeline', () => {
    expect(needsPipeline('分析 wearoneconnection.org 并总结有价值发现')).toBe(true);
    expect(needsPipeline('检查 GitHub 仓库 weareoneconnection/theone')).toBe(true);
    expect(needsPipeline('用本地桌面桥接检查 Chrome')).toBe(true);
  });

  it('routes workspace paths to the pipeline even inside long pastes', () => {
    const longTaskWithPath = `${PASTED_TEST_FILE}\n把 /Users/maqing/Desktop/repo 里的这个 bug 修掉`;
    expect(needsPipeline(longTaskWithPath)).toBe(true);
    expect(needsPipeline('帮我修 /app/workspaces/OneClaw 里的 timeout bug')).toBe(true);
  });

  it('keeps plain conversation on the direct path', () => {
    expect(needsPipeline('你好,简单介绍一下你自己')).toBe(false);
    expect(needsPipeline('谢谢')).toBe(false);
  });

  it('always uses the pipeline when files are attached', () => {
    expect(needsPipeline('这个文件讲了什么', true)).toBe(true);
  });
});

describe('extractWorkspacePath', () => {
  it('pulls the path and trims trailing punctuation', () => {
    expect(extractWorkspacePath('workspace 是 /Users/maqing/Desktop/repo,请修复'))
      .toBe('/Users/maqing/Desktop/repo');
    expect(extractWorkspacePath('没有路径')).toBeNull();
  });
});
