export function createAppMemoryPack(input: {
  app: string;
  title: string;
  summary: string;
  facts?: string[];
  nextActions?: string[];
  sourceRunId?: string;
}) {
  return {
    app: input.app,
    title: input.title,
    summary: input.summary,
    facts: (input.facts || []).filter(Boolean).slice(0, 8),
    nextActions: (input.nextActions || []).filter(Boolean).slice(0, 6),
    sourceRunId: input.sourceRunId,
  };
}
