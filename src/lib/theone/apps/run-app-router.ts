import { getTheOneKernelStatus } from '../kernel/status';
import { runBotBridgeApp } from './bot-bridge';
import { runApiOperationApp } from './api-operation';
import { runBrowserOperationApp } from './browser-operation';
import { runDesktopControlApp } from './desktop-control';
import { runFilesWorkflowApp } from './files-workflow';
import { runGitHubAnalysisApp } from './github-analysis';
import { runReportGenerateApp } from './report-generate';
import { runWebAnalysisApp } from './web-analysis';
import { runXGrowthApp } from './x-growth';
import { runOneClawAction, getOneClawBridgeStatus, getOneClawCapabilityManifest } from '../providers/oneclaw';
import { createRunId, createPlanId } from '../runtime';
import { createExecutionRecord, createWorkflowTrace } from '../runtime/workflow-runtime';
import type {
  ApprovalGate,
  ClassifiedIntent,
  ExecutionPlan,
  PlanStep,
  ProofRecord,
  TheOneMode,
  TheOneRunResult,
} from '../types';

type AppRoute = {
  app: string;
  title: string;
  action: string;
  input: Record<string, unknown>;
  approvalMode: 'auto' | 'manual';
  risk: 'low' | 'medium' | 'high';
  summary: string;
};

function text(input: string) {
  return input.trim();
}

function lower(input: string) {
  return input.toLowerCase();
}

function extractUrl(input: string) {
  const match = input.match(/https?:\/\/[^\s)]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s)]*)?/i);
  if (!match) return 'https://weareoneconnection.org';
  const value = match[0];
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function extractRepo(input: string) {
  return input.match(/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+/)?.[0] || 'weareoneconnection/theone';
}

function extractPath(input: string) {
  return input.match(/(?:\/Users|\/tmp|\/private|~\/|\.\/)[^\s]+/)?.[0] || '/tmp';
}

function pathExtension(value: string) {
  return value.split(/[?#]/)[0]?.split('.').pop()?.toLowerCase() || '';
}

function readActionForPath(value: string) {
  const ext = pathExtension(value);
  if (['pdf', 'doc', 'docx', 'rtf'].includes(ext)) return 'document.parse';
  if (['csv', 'tsv', 'xls', 'xlsx'].includes(ext)) return 'spreadsheet.read';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'tif', 'tiff'].includes(ext)) return 'image.extractText';
  return 'file.read';
}

function extractHttpUrl(input: string) {
  const match = input.match(/https?:\/\/[^\s)]+/i);
  return match?.[0] || '';
}

function contentAfterColon(input: string) {
  const parts = input.split(/[:：]/);
  return (parts.length > 1 ? parts.slice(1).join(':') : input).trim();
}

export function routeRunToApp(raw: string): AppRoute | null {
  const value = text(raw);
  const valueLower = lower(value);

  if (/(github|repo|repository|仓库|代码库|ci|workflow|actions?)/i.test(value)) {
    const repo = extractRepo(value);
    if (/(issue|创建.*任务|提.*问题)/i.test(value)) {
      return {
        app: 'github',
        title: 'GitHub Workflow',
        action: 'git.issue.create',
        input: {
          repo,
          title: 'TheOne generated GitHub task',
          body: value,
        },
        approvalMode: 'manual',
        risk: 'high',
        summary: `Prepare a GitHub issue in ${repo}.`,
      };
    }
    if (/(ci|workflow|actions?|构建|build)/i.test(value)) {
      return {
        app: 'github',
        title: 'GitHub Workflow',
        action: 'git.actions.runs',
        input: { repo, branch: value.match(/\b(main|dev|develop|master)\b/i)?.[0] || 'main' },
        approvalMode: 'auto',
        risk: 'low',
        summary: `Check GitHub Actions runs for ${repo}.`,
      };
    }
    return {
      app: 'github',
      title: 'GitHub Workflow',
      action: 'git.repo.get',
      input: { repo },
      approvalMode: 'auto',
      risk: 'low',
      summary: `Read GitHub repository status for ${repo}.`,
    };
  }

  if (/(bot|telegram|oneai bot|机器人|电报)/i.test(value)) {
    return {
      app: 'bot',
      title: 'OneAI Bot Bridge',
      action: 'oneai.bot.bridge.status',
      input: {},
      approvalMode: 'auto',
      risk: 'low',
      summary: 'Check the OneAI Bot bridge and record the runtime contract.',
    };
  }

  if (/(report|brief|memo|报告|简报|总结文档)/i.test(value)) {
    return {
      app: 'report',
      title: 'Report Generation',
      action: 'report.generate',
      input: {
        topic: contentAfterColon(value) || value,
        source: value,
        format: /investor|投资/i.test(value) ? 'Investor summary' : 'Brief',
      },
      approvalMode: 'auto',
      risk: 'low',
      summary: 'Generate a report and store it as reusable memory.',
    };
  }

  if (/(api|webhook|接口|sync|同步)/i.test(value)) {
    const url = extractHttpUrl(value) || 'https://oneclaw-production.up.railway.app/health';
    const method = value.match(/\b(GET|POST|PUT|PATCH|DELETE)\b/i)?.[0]?.toUpperCase() || 'GET';
    return {
      app: 'api',
      title: 'API Operations',
      action: 'api.request',
      input: { url, method, body: contentAfterColon(value) },
      approvalMode: method === 'GET' ? 'auto' : 'manual',
      risk: method === 'GET' ? 'medium' : 'high',
      summary: `Run ${method} API operation for ${url}.`,
    };
  }

  if (/(twitter|tweet|\bx\b|推文|发帖|回复)/i.test(value)) {
    if (/(search|find|搜索|查找)/i.test(value)) {
      return {
        app: 'x',
        title: 'X Growth',
        action: 'x.searchRecentTweets',
        input: { query: contentAfterColon(value) || 'AI agents workflow', maxResults: 10 },
        approvalMode: 'auto',
        risk: 'medium',
        summary: 'Search recent X posts for context or engagement candidates.',
      };
    }
    const replyId = value.match(/\b\d{12,}\b/)?.[0];
    return {
      app: 'x',
      title: 'X Growth',
      action: 'social.post',
      input: replyId
        ? { channel: 'x', mode: 'reply_only', strictReply: true, replyToTweetId: replyId, content: contentAfterColon(value) }
        : { channel: 'x', mode: 'post', content: contentAfterColon(value) },
      approvalMode: 'manual',
      risk: replyId ? 'medium' : 'high',
      summary: replyId ? `Prepare a strict X reply to ${replyId}.` : 'Prepare a public X post for approval.',
    };
  }

  if (/(desktop|computer|chrome|电脑|本地|截图|hotkey|快捷键|type|输入)/i.test(value)) {
    const app = /chrome/i.test(value) ? 'Google Chrome' : 'Google Chrome';
    if (/(screenshot|截图)/i.test(value)) {
      return {
        app: 'desktop',
        title: 'Desktop Control',
        action: 'desktop.screenshot',
        input: { app },
        approvalMode: 'manual',
        risk: 'high',
        summary: `Capture a local screenshot from ${app}.`,
      };
    }
    if (/(type|输入)/i.test(value)) {
      return {
        app: 'desktop',
        title: 'Desktop Control',
        action: 'desktop.type',
        input: { app, text: contentAfterColon(value) || extractUrl(value) },
        approvalMode: 'manual',
        risk: 'high',
        summary: `Type text into ${app} through the local bridge.`,
      };
    }
    return {
      app: 'desktop',
      title: 'Desktop Control',
      action: 'desktop.app.state',
      input: { app },
      approvalMode: 'manual',
      risk: 'medium',
      summary: `Inspect local app state for ${app}.`,
    };
  }

  if (/(file|folder|文件|目录|read|write|list|append|浏览文件)/i.test(value)) {
    const path = extractPath(value);
    if (/(write|写入)/i.test(value)) {
      return {
        app: 'files',
        title: 'Files',
        action: 'file.write',
        input: { path, content: contentAfterColon(value) || 'Created from TheOne Run.' },
        approvalMode: 'manual',
        risk: 'medium',
        summary: `Prepare a guarded file write to ${path}.`,
      };
    }
    if (/(read|读取)/i.test(value)) {
      const action = readActionForPath(path);
      return {
        app: 'files',
        title: 'Files',
        action,
        input: { path },
        approvalMode: 'auto',
        risk: 'low',
        summary: action === 'document.parse'
          ? `Parse document ${path}.`
          : action === 'spreadsheet.read'
            ? `Read spreadsheet ${path}.`
            : action === 'image.extractText'
              ? `Extract text from image ${path}.`
            : `Read file ${path}.`,
      };
    }
    return {
      app: 'files',
      title: 'Files',
      action: 'file.list',
      input: { path },
      approvalMode: 'auto',
      risk: 'low',
      summary: `List files in ${path}.`,
    };
  }

  if (/(browser|浏览器|screenshot page|open page)/i.test(value)) {
    const url = extractUrl(value);
    return {
      app: 'browser',
      title: 'Browser Operations',
      action: /open|打开/i.test(value) ? 'browser.open' : /screenshot|截图/i.test(value) ? 'browser.screenshot' : 'browser.extract',
      input: { url },
      approvalMode: 'auto',
      risk: 'medium',
      summary: `Run a browser operation for ${url}.`,
    };
  }

  if (/(website|web page|browse|网页|网站|浏览)/i.test(valueLower) || /https?:\/\/|(?:[a-z0-9-]+\.)+[a-z]{2,}/i.test(value)) {
    const url = extractUrl(value);
    return {
      app: 'web',
      title: 'Web Analysis',
      action: 'browser.extract',
      input: { url },
      approvalMode: 'auto',
      risk: 'medium',
      summary: `Extract and summarize useful findings from ${url}.`,
    };
  }

  return null;
}

export async function runUnifiedAppRoute(input: {
  raw: string;
  mode: TheOneMode;
  route: AppRoute;
}): Promise<TheOneRunResult> {
  if (input.route.app === 'web') {
    return runWebAnalysisApp({
      url: String(input.route.input.url || ''),
      focus: contentAfterColon(input.raw) || 'Useful findings',
      mode: input.mode,
      language: 'en',
    });
  }

  if (input.route.app === 'github' && input.route.action !== 'git.issue.create') {
    return runGitHubAnalysisApp({
      repo: String(input.route.input.repo || ''),
      branch: String(input.route.input.branch || 'main'),
      focus: /release|发布/i.test(input.raw) ? 'Release readiness' : /risk|风险/i.test(input.raw) ? 'Risk check' : 'CI health',
      mode: input.mode,
      language: 'en',
    });
  }

  if (input.route.app === 'x') {
    return runXGrowthApp({
      topic: String(input.route.input.query || input.route.input.content || contentAfterColon(input.raw) || 'AI agents workflow'),
      goal: input.route.action === 'x.searchRecentTweets' ? 'Summarize market conversation' : 'Prepare a high-signal X post',
      mode: input.mode,
      language: 'en',
    });
  }

  if (input.route.app === 'desktop') {
    const action = input.route.action;
    const operation = action === 'desktop.screenshot'
      ? 'screenshot'
      : action === 'desktop.type'
        ? 'type'
        : action === 'desktop.hotkey'
          ? 'hotkey'
          : 'state';
    return runDesktopControlApp({
      app: String(input.route.input.app || 'Google Chrome'),
      operation,
      text: input.route.input.text ? String(input.route.input.text) : undefined,
      keys: Array.isArray(input.route.input.keys) ? input.route.input.keys.map(String) : undefined,
      mode: input.mode,
    });
  }

  if (input.route.app === 'api') {
    return runApiOperationApp({
      url: String(input.route.input.url || ''),
      method: String(input.route.input.method || 'GET'),
      body: input.route.input.body ? String(input.route.input.body) : undefined,
      mode: input.mode,
    });
  }

  if (input.route.app === 'browser') {
    const action = input.route.action;
    return runBrowserOperationApp({
      url: String(input.route.input.url || ''),
      operation: action === 'browser.open' ? 'open' : action === 'browser.screenshot' ? 'screenshot' : 'extract',
      mode: input.mode,
    });
  }

  if (input.route.app === 'report') {
    return runReportGenerateApp({
      topic: String(input.route.input.topic || input.raw),
      source: String(input.route.input.source || input.raw),
      format: String(input.route.input.format || 'Brief'),
      mode: input.mode,
      language: 'en',
    });
  }

  if (input.route.app === 'files') {
    const action = input.route.action;
    const operation = action === 'file.exists'
      ? 'exists'
      : action === 'file.read'
        ? 'read'
        : action === 'document.parse'
          ? 'document_parse'
          : action === 'spreadsheet.read'
            ? 'spreadsheet_read'
            : action === 'image.extractText'
              ? 'image_extract_text'
              : action === 'image.analyze'
                ? 'image_analyze'
                : action === 'file.write'
                  ? 'write'
                  : action === 'file.append'
                    ? 'append'
                    : 'list';
    return runFilesWorkflowApp({
      path: String(input.route.input.path || '/tmp'),
      operation,
      content: input.route.input.content ? String(input.route.input.content) : undefined,
      mode: input.mode,
    });
  }

  if (input.route.app === 'bot') {
    return runBotBridgeApp({ mode: input.mode });
  }

  return runAppRoutedAction(input);
}

function statusFromTask(task: any): 'submitted' | 'success' | 'blocked' | 'failed' | 'mock' {
  const status = String(task?.status || task?.task?.status || task?.steps?.[0]?.status || '').toLowerCase();
  if (/failed|error/.test(status)) return 'failed';
  if (/awaiting|pending|approval|blocked/.test(status)) return 'blocked';
  if (/success|completed/.test(status)) return 'success';
  if (/mock/.test(status)) return 'mock';
  return 'submitted';
}

function externalId(task: any) {
  return task?.id || task?.task?.id || task?.steps?.[0]?.taskId || null;
}

export async function runAppRoutedAction(input: {
  raw: string;
  mode: TheOneMode;
  route: AppRoute;
}): Promise<TheOneRunResult> {
  const runId = createRunId();
  const [oneClawManifest, oneClawBridge] = await Promise.all([
    getOneClawCapabilityManifest(),
    getOneClawBridgeStatus(),
  ]);
  const kernel = getTheOneKernelStatus(input.mode, oneClawManifest, oneClawBridge);
  const startedAt = new Date().toISOString();
  const task = await runOneClawAction<any>({
    action: input.route.action,
    input: input.route.input,
    approvalMode: input.route.approvalMode,
    idempotencyKey: `run-${runId}-${input.route.app}`,
  });
  const executionStatus = statusFromTask(task);
  const taskId = externalId(task);
  const stepStatus = executionStatus === 'success' || executionStatus === 'submitted' || executionStatus === 'mock'
    ? 'completed'
    : executionStatus === 'blocked'
      ? 'blocked'
      : 'failed';
  const intent: ClassifiedIntent = {
    type: input.route.app === 'x' ? 'growth' : input.route.app === 'web' ? 'knowledge' : input.route.app === 'github' ? 'automation' : 'general',
    objective: input.raw,
    entities: [input.route.app],
    constraints: [],
    priority: 'normal',
    confidence: 0.92,
    requiresApproval: input.route.approvalMode === 'manual',
  };
  const steps: PlanStep[] = [
    {
      id: 'step_route',
      title: `Route to ${input.route.title}`,
      action: 'custom',
      status: 'completed',
      output: { app: input.route.app, action: input.route.action },
    },
    {
      id: 'step_oneclaw',
      title: `Run ${input.route.action}`,
      action: 'oneclaw.execute',
      status: stepStatus,
      input: input.route.input,
      output: { taskId, action: input.route.action, app: input.route.app },
      requiresApproval: input.route.approvalMode === 'manual',
      dependsOn: ['step_route'],
    },
    {
      id: 'step_proof',
      title: 'Record proof',
      action: 'proof.write',
      status: stepStatus === 'failed' || stepStatus === 'blocked' ? 'pending' : 'completed',
      dependsOn: ['step_oneclaw'],
    },
  ];
  const plan: ExecutionPlan = {
    id: createPlanId(),
    intent,
    summary: input.route.summary,
    steps,
    estimatedRisk: input.route.risk,
    capabilityRoute: {
      intentType: intent.type,
      objective: input.raw,
      capabilities: ['operate', 'govern', 'record'],
      skills: [],
      apps: [],
      connectors: [],
      risk: input.route.risk,
      summary: `${input.route.title} selected ${input.route.action}.`,
    },
  };
  const approvals: ApprovalGate[] = input.route.approvalMode === 'manual'
    ? [{
      id: `approval_${runId}_oneclaw`,
      stepId: 'step_oneclaw',
      action: input.route.action,
      risk: input.route.risk,
      required: true,
      status: executionStatus === 'blocked' ? 'pending' : 'not_required',
      mode: input.mode,
      reason: `${input.route.title} action is approval gated.`,
    }]
    : [];
  const executions = [
    createExecutionRecord({
      provider: 'oneclaw',
      status: executionStatus,
      summary: input.route.summary,
      externalId: taskId,
      taskName: `action:${input.route.action}`,
      raw: task,
    }),
  ];
  const proof: ProofRecord[] = [{
    type: input.route.app === 'x' ? 'social' : 'execution',
    title: `${input.route.title} action submitted`,
    value: `${input.route.action} -> ${executionStatus}${taskId ? ` (${taskId})` : ''}`,
    timestamp: startedAt,
    metadata: {
      app: input.route.app,
      action: input.route.action,
      approvalMode: input.route.approvalMode,
      taskId,
      route: input.route,
    },
  }];
  const workflow = createWorkflowTrace({ runId, mode: input.mode, plan, approvals });

  return {
    ok: executionStatus !== 'failed',
    runId,
    summary: input.route.summary,
    intent,
    plan,
    execution: {
      completedSteps: steps.filter((step) => step.status === 'completed').length,
      failedSteps: steps.filter((step) => step.status === 'failed').length,
      agentResults: [],
    },
    proof,
    approvals,
    executions,
    pendingOneClawTask: null,
    os: {
      ...kernel,
      workflow,
      approvals,
      executions,
    },
    networkSignals: {
      appRoute: input.route.app,
      oneClawAction: input.route.action,
      oneClawTaskId: taskId,
    },
  };
}
