import type { ClassifiedIntent, ExecutionTemplateDefinition } from '../types';

export const executionTemplates: ExecutionTemplateDefinition[] = [
  {
    key: 'external_publish',
    title: 'External Publish',
    intentHints: ['post', 'tweet', 'publish', 'x', 'twitter', '发布', '推文', '内容'],
    capabilities: ['create', 'communicate', 'govern', 'record'],
    actions: ['social.post'],
    defaultApprovalMode: 'manual',
    risk: 'high',
    status: 'ready',
  },
  {
    key: 'web_research',
    title: 'Web Research',
    intentHints: ['research', 'search', 'scrape', 'monitor', 'website', 'browse', 'url', 'http', '研究', '搜索', '抓取', '监控', '网站', '网页'],
    capabilities: ['research', 'operate', 'monitor', 'record'],
    actions: ['browser.open', 'browser.extract', 'x.searchRecentTweets'],
    defaultApprovalMode: 'auto',
    risk: 'medium',
    status: 'guarded',
  },
  {
    key: 'api_integration',
    title: 'API Integration',
    intentHints: ['api', 'webhook', 'sync', 'integrate', '接口', '同步', '集成'],
    capabilities: ['integrate', 'operate', 'record'],
    actions: ['api.request', 'api.webhook'],
    defaultApprovalMode: 'auto',
    risk: 'medium',
    status: 'guarded',
  },
  {
    key: 'operator_notification',
    title: 'Operator Notification',
    intentHints: ['notify', 'message', 'approval', '通知', '消息', '审批'],
    capabilities: ['communicate', 'coordinate', 'govern', 'record'],
    actions: ['message.send', 'human.approval.request'],
    defaultApprovalMode: 'manual',
    risk: 'high',
    status: 'guarded',
  },
  {
    key: 'construction_ops',
    title: 'Construction Operations',
    intentHints: ['construction', 'project', 'rfi', 'inspection', '建筑', '项目', '巡检', '审批', '采购'],
    capabilities: ['coordinate', 'operate', 'monitor', 'govern', 'record'],
    actions: ['construction.task.create', 'construction.approval.request', 'construction.rfi.create'],
    defaultApprovalMode: 'manual',
    risk: 'high',
    status: 'planned',
  },
  {
    key: 'guarded_transaction',
    title: 'Guarded Transaction',
    intentHints: ['trade', 'payment', 'buy', 'sell', 'transfer', '交易', '付款', '购买', '转账'],
    capabilities: ['transact', 'research', 'monitor', 'govern', 'record'],
    actions: ['web3.transfer'],
    defaultApprovalMode: 'manual',
    risk: 'high',
    status: 'planned',
  },
];

export function listExecutionTemplates() {
  return executionTemplates;
}

export function selectExecutionTemplate(intent: ClassifiedIntent) {
  const raw = `${intent.type} ${intent.objective}`.toLowerCase();

  return executionTemplates.find((template) => (
    template.intentHints.some((hint) => raw.includes(hint.toLowerCase()))
    || template.capabilities.some((capability) => raw.includes(capability))
  )) || null;
}
