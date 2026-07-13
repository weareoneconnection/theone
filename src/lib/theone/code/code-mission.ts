import { createHash } from "node:crypto";

type CodeMissionMode = "manual" | "assist" | "auto";

type CodeMissionPlanStep = {
  id: string;
  title: string;
  action?: string;
  status: string;
};

export type CodeMissionSnapshot = {
  schemaVersion: "theone.code_mission.v1";
  id: string;
  sessionId: string;
  runId?: string;
  objective: string;
  mode: CodeMissionMode;
  status: "planning" | "running" | "waiting_approval" | "blocked" | "failed" | "completed";
  iteration: number;
  currentAction?: string;
  nextAction?: string;
  workspace?: {
    id?: string;
    path?: string;
    repo?: string;
    branch?: string;
    stage?: string;
    rollbackToken?: string;
  };
  acceptanceCriteria: string[];
  constraints: string[];
  plan: CodeMissionPlanStep[];
  completedActions: string[];
  files: string[];
  tests: {
    status: "not_run" | "running" | "passed" | "failed" | "blocked";
    results: string[];
  };
  recovery: {
    checkpointAvailable: boolean;
    rollbackAvailable: boolean;
    reason?: string;
  };
  loop: {
    canContinue: boolean;
    decision: "plan" | "execute" | "wait_for_approval" | "run_tests" | "verify" | "prepare_delivery" | "stop";
    stopReason?: string;
    maxIterations: number;
  };
  updatedAt: string;
};

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function missionId(sessionId: string) {
  return `code_mission_${createHash("sha256").update(sessionId).digest("hex").slice(0, 16)}`;
}

function inferStatus(result: Record<string, any>, runtime: Record<string, any>, workspace: Record<string, any>) {
  const taskStatus = String(result?.oneclawTask?.status || "").toLowerCase();
  const runtimeStatus = String(runtime.status || "").toLowerCase();
  const stage = String(workspace.stage || runtime.stage || "").toLowerCase();
  const missionState = String(
    result?.missionState?.state || result?.networkSignals?.missionState?.state || "",
  ).toLowerCase();
  const outcome = String(
    result?.objectiveAssessment?.outcome || result?.networkSignals?.objectiveAssessment?.outcome || "",
  ).toLowerCase();
  const approval = result?.pendingTask || result?.approvalRequired;
  if (approval || taskStatus === "awaiting_approval" || missionState === "waiting_approval") {
    return "waiting_approval" as const;
  }
  if ([taskStatus, runtimeStatus, missionState, stage].some((value) => ["failed", "error"].includes(value))) {
    return "failed" as const;
  }
  if ([taskStatus, runtimeStatus, missionState].some((value) => ["blocked", "denied"].includes(value))) {
    return "blocked" as const;
  }
  if (outcome === "satisfied" || stage === "delivery_ready") return "completed" as const;
  if ([taskStatus, runtimeStatus, missionState].some((value) => ["running", "executing", "applied"].includes(value))) {
    return "running" as const;
  }
  return "planning" as const;
}

function inferLoop(
  status: CodeMissionSnapshot["status"],
  stage: string,
  testsStatus: CodeMissionSnapshot["tests"]["status"],
  iteration: number,
) {
  const maxIterations = 12;
  if (iteration >= maxIterations) {
    return { canContinue: false, decision: "stop" as const, stopReason: "Iteration budget reached.", maxIterations };
  }
  if (status === "waiting_approval") {
    return { canContinue: false, decision: "wait_for_approval" as const, stopReason: "Human approval is required.", maxIterations };
  }
  if (status === "failed" || status === "blocked") {
    return { canContinue: false, decision: "stop" as const, stopReason: "The current route needs recovery or user input.", maxIterations };
  }
  if (status === "completed" || stage === "delivery_ready") {
    return { canContinue: false, decision: "stop" as const, stopReason: "Mission outcome is satisfied.", maxIterations };
  }
  if (testsStatus === "failed" || testsStatus === "blocked") {
    return { canContinue: false, decision: "stop" as const, stopReason: "Verification failed; revise or roll back before continuing.", maxIterations };
  }
  if (stage === "applied" && testsStatus !== "passed") {
    return { canContinue: true, decision: "run_tests" as const, maxIterations };
  }
  if (stage === "tested" && testsStatus === "passed") {
    return { canContinue: true, decision: "verify" as const, maxIterations };
  }
  if (stage === "verified") {
    return { canContinue: true, decision: "prepare_delivery" as const, maxIterations };
  }
  if (stage === "diff_ready") return { canContinue: true, decision: "execute" as const, maxIterations };
  return { canContinue: true, decision: "plan" as const, maxIterations };
}

function testResultLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return item;
    const result = asRecord(item);
    const name = String(result.script || result.name || "test");
    const status = String(result.status || (result.ok === true ? "passed" : result.ok === false ? "failed" : "unknown"));
    return `${name}: ${status}`;
  });
}

export function buildCodeMissionSnapshot(input: {
  sessionId: string;
  runId?: string;
  mode?: string;
  objective?: string;
  result: Record<string, any>;
  previous?: unknown;
}): CodeMissionSnapshot | null {
  const result = asRecord(input.result);
  const runtime = asRecord(result.codeRuntime || result?.networkSignals?.codeRuntime);
  const workspace = asRecord(result.codeWorkspace || result?.networkSignals?.codeWorkspace);
  const previous = asRecord(input.previous);
  const isCodeMission = Boolean(runtime.action || runtime.workspacePath || workspace.id || previous.schemaVersion === "theone.code_mission.v1");
  if (!isCodeMission) return null;

  const lifecycle = Array.isArray(runtime.lifecycle) ? runtime.lifecycle : [];
  const plan = lifecycle.map((step: any, index: number) => ({
    id: String(step?.id || `step_${index + 1}`),
    title: String(step?.title || step?.action || `Code step ${index + 1}`),
    action: typeof step?.action === "string" ? step.action : undefined,
    status: String(step?.status || "pending"),
  }));
  const completedActions = plan
    .filter((step) => ["completed", "success", "passed", "ready"].includes(step.status.toLowerCase()))
    .map((step) => step.action || step.id);
  const files = asStrings(runtime.files).length > 0 ? asStrings(runtime.files) : asStrings(previous.files);
  const testsRuntime = asRecord(runtime.tests);
  const rawTestsStatus = String(testsRuntime.status || previous?.tests?.status || "not_run").toLowerCase();
  const testsStatus: CodeMissionSnapshot["tests"]["status"] =
    rawTestsStatus === "passed" || rawTestsStatus === "failed" || rawTestsStatus === "running" || rawTestsStatus === "blocked"
      ? rawTestsStatus
      : "not_run";
  const status = inferStatus(result, runtime, workspace);
  const stage = String(workspace.stage || runtime.stage || previous?.workspace?.stage || "registered");
  const iteration = Math.max(1, Number(previous.iteration || 0) + 1);
  const nextActions = asStrings(runtime.nextActions);

  return {
    schemaVersion: "theone.code_mission.v1",
    id: String(previous.id || missionId(input.sessionId)),
    sessionId: input.sessionId,
    runId: input.runId,
    objective: String(previous.objective || input.objective || runtime.summary || "Complete the coding mission."),
    mode: input.mode === "manual" || input.mode === "auto" ? input.mode : "assist",
    status,
    iteration,
    currentAction: String(runtime.action || previous.currentAction || "") || undefined,
    nextAction: nextActions[0] || previous.nextAction,
    workspace: {
      id: workspace.id || previous?.workspace?.id,
      path: runtime.workspacePath || workspace.workspacePath || previous?.workspace?.path,
      repo: workspace.repo || runtime?.delivery?.repo || previous?.workspace?.repo,
      branch: workspace.branch || runtime?.delivery?.branch || previous?.workspace?.branch,
      stage,
      rollbackToken: runtime?.rollback?.token || workspace.rollbackToken || previous?.workspace?.rollbackToken,
    },
    acceptanceCriteria: asStrings(result?.missionState?.acceptanceCriteria).length
      ? asStrings(result?.missionState?.acceptanceCriteria)
      : asStrings(previous.acceptanceCriteria),
    constraints: asStrings(result?.missionState?.constraints).length
      ? asStrings(result?.missionState?.constraints)
      : asStrings(previous.constraints),
    plan: plan.length ? plan : Array.isArray(previous.plan) ? previous.plan : [],
    completedActions: Array.from(new Set([...asStrings(previous.completedActions), ...completedActions])),
    files: Array.from(new Set(files)),
    tests: {
      status: testsStatus,
      results: testResultLabels(testsRuntime.results).length
        ? testResultLabels(testsRuntime.results)
        : asStrings(previous?.tests?.results),
    },
    recovery: {
      checkpointAvailable: Boolean(runtime?.rollback?.available || previous?.recovery?.checkpointAvailable),
      rollbackAvailable: Boolean(runtime?.rollback?.available || workspace.rollbackToken || previous?.recovery?.rollbackAvailable),
      reason: runtime?.rollback?.reason || previous?.recovery?.reason,
    },
    loop: inferLoop(status, stage, testsStatus, iteration),
    updatedAt: new Date().toISOString(),
  };
}

export function attachCodeMission<T extends Record<string, any>>(input: {
  result: T;
  sessionId: string;
  runId?: string;
  mode?: string;
  objective?: string;
  previous?: unknown;
}): T & { codeMission?: CodeMissionSnapshot } {
  const codeMission = buildCodeMissionSnapshot(input);
  if (!codeMission) return input.result;
  return {
    ...input.result,
    codeMission,
    chat: {
      ...asRecord(input.result.chat),
      codeMission,
    },
    networkSignals: {
      ...asRecord(input.result.networkSignals),
      codeMission,
    },
  };
}
