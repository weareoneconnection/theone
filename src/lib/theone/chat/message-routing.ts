// Decides whether a chat message needs the full AI OS pipeline (planning,
// policy, workers) or can be answered directly by the conversational model.
//
// The rule that matters: an action verb alone is NOT a task. "Analyze this
// code I pasted" is reasoning over material already in the conversation —
// sending it to the pipeline makes the planner hunt for an external source it
// will never find (and, at worst, invent one).

export const WORKSPACE_PATH_PATTERN = /(?:\/app\/workspaces|\/Users\/|\/home\/)[^\s,，。;:"'）)]+/;

const ACTION_PATTERN = /分析|检查|研究|调研|准备|生成|创建|发布|发[个一条]|推文|报告|总结|汇总|抓取|爬|读取|查[询一]|搜索|下载|上传|部署|运行|执行|跑|修|改|新增|删除|监控|提醒|安排|工作流|任务|浏览器|桌面|网站|网页|仓库|测试|workspace|npm|github|repo|worker|post|tweet|analy|research|check|inspect|generate|create|publish|scrape|fetch|search|deploy|run|fix|refactor|implement|report|summar|schedule|monitor|browse|code\./i;

// Something the system could actually go act on, outside this conversation.
const TARGET_PATTERN = /https?:\/\/|www\.|\.(com|org|net|io|dev|ai|cn)\b|\/(?:app|Users|home|var|opt)\/|仓库\s*[\w-]+\/[\w-]+|[\w-]+\/[\w-]+\s*仓库|repo\s|github|workspace|桌面|浏览器|chrome|@\w+/i;

// Pasted material (code, logs, documents) is the source to reason about, not a
// request to fetch something.
export function looksLikePastedMaterial(text: string) {
  return text.split('\n').length >= 8
    || text.length >= 800
    || /```|^import |^const |^function |^class |\bdescribe\(|\bit\(/m.test(text);
}

export function extractWorkspacePath(text: string): string | null {
  const match = text.match(WORKSPACE_PATH_PATTERN);
  return match ? match[0].replace(/[，。;:]+$/, '') : null;
}

export function needsPipeline(text: string, hasAttachments = false): boolean {
  if (hasAttachments) return true;
  // A concrete local path is always a real target, even inside a long paste.
  if (WORKSPACE_PATH_PATTERN.test(text)) return true;
  if (looksLikePastedMaterial(text)) return false;
  return ACTION_PATTERN.test(text) && TARGET_PATTERN.test(text);
}
