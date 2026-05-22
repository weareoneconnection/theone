# TheOne Universal AI OS 产品架构蓝图

## 定位

TheOne 是通用 AI 操作系统控制层。它不替代 OneAI，也不替代 OneClaw。

- OneAI 是默认智能驱动：负责判断、规划、生成结构化结果。
- OneClaw 是默认执行驱动：负责运行任务、调用 worker、连接真实世界。
- TheOne 是 OS 内核：负责意图、上下文、工作流、权限、审批、证据、记忆和应用层。

## 核心闭环

```text
Intent
  -> Context
  -> Policy
  -> OneAI Provider
  -> Workflow Runtime
  -> Approval
  -> OneClaw Provider
  -> Proof Ledger
  -> Memory Graph
```

## TheOne 拥有的对象

```text
Intent
Context
Plan
Workflow
Task
Step
Agent
Skill
Tool
Provider
Approval
Execution
Proof
Memory
Policy
App
```

## Provider 边界

TheOne 只通过标准 HTTP contract 接入外部系统：

- OneAI: `POST /v1/generate`
- OneClaw: `POST /v1/tasks/run`
- OneClaw: `GET /v1/tasks/:id`

TheOne 不复制 OneAI workflow，不复制 OneClaw worker，不拥有外部执行逻辑。

## Kernel v1 模块

```text
kernel/status.ts
  OS 层、provider 状态、app surface

policy/approval-policy.ts
  风险判断、审批门、外部执行许可

runtime/workflow-runtime.ts
  workflow trace、步骤状态、execution record

providers/oneai.ts
  OneAI driver client 和 mock fallback

providers/oneclaw.ts
  OneClaw driver client 和 mock fallback
```

## Phase 4 Capability Graph

TheOne must not be bounded by sample domains such as Growth, Knowledge, Mission, Construction, or Trading.

The kernel now routes through universal real-world capability primitives:

```text
Think
Plan
Create
Research
Communicate
Operate
Transact
Coordinate
Monitor
Record
Remember
Integrate
Govern
Learn
```

Domain apps are no longer kernel primitives. They are bundles composed from capabilities and skills.

Core modules:

```text
capabilities/registry.ts
  Defines universal real-world primitives.

capabilities/router.ts
  Maps classified intent to capability needs, skills, app bundles, and risk.

skills/registry.ts
  Defines reusable skills by capabilities, actions, provider needs, proof type, and memory policy.

apps/registry.ts
  Defines app bundles as compositions of skills and capabilities.
```

The routing model is:

```text
Intent
  -> Capability needs
  -> Skill match
  -> App bundle surface
  -> Workflow plan
  -> Policy
  -> Providers
  -> Proof and memory
```

This keeps TheOne universal: any future industry app should be represented as a bundle over capability primitives, not as a new kernel branch.

## Phase 5 Skill Runtime

Skills are no longer only declarations. TheOne now executes workflows through `skills/runtime.ts`.

Runtime model:

```text
Plan steps
  -> step.skillKey
  -> skill runner
  -> provider calls
  -> normalized step status
  -> approvals
  -> executions
  -> proof
  -> pending OneClaw task
```

Implemented runners:

- `objective_analysis`
- `research_summary`
- `content_prepare`
- `external_publish`
- `mission_orchestration`
- `external_operation`
- `transaction_guard`
- `status_monitor`

Legacy agents remain as fallback only. The main path is now capability route -> skill workflow, which makes TheOne less dependent on hard-coded domain agents.

## Phase 6 Runtime Beta

TheOne workflow runtime is now dependency-aware. A plan step can declare `dependsOn`, so the OS can run universal workflows as a DAG instead of a fragile linear script.

Runtime contracts:

- `PlanStep.dependsOn`: declares upstream work that must complete first.
- `SkillDefinition.inputSchema`: lightweight contract for what a skill accepts from TheOne.
- `SkillDefinition.outputSchema`: lightweight contract for what a skill returns to the OS.
- `ProviderReceipt`: normalized evidence from OneAI, OneClaw, or TheOne itself.

Execution rule:

```text
Intent
  -> Capability route
  -> DAG plan
  -> Skill IO validation
  -> Provider call or internal system action
  -> Provider receipt
  -> Durable ledger
  -> Proof and memory
```

This is the first runtime-beta layer. OneAI is still only the intelligence provider. OneClaw is still only the execution provider. TheOne owns dependency ordering, contracts, receipts, approval, proof, and memory.

## Phase 7 Connector Registry + Memory Graph Query

TheOne now treats real-world systems as connectors instead of hard-coded domains.

Connector model:

- `ConnectorDefinition`: a normalized surface for browser, files, communication, knowledge, commerce, finance, productivity, operations, identity, and custom systems.
- `CapabilityRoute.connectors`: selected connectors for a specific intent.
- Provider boundary: connectors declare whether TheOne can handle the coordination internally or should route operation through OneClaw.

Memory model:

- `queryMemoryGraph`: retrieves related prior run memory by objective, intent type, and capability terms.
- `ExecutionPlan.memoryContext`: carries recalled context into the current run.
- `AgentRuntimeContext.memoryContext`: gives skill runtime and OneAI payloads relevant prior context.
- `POST /api/theone/memory/query`: query surface for future UI search and agent retrieval.

This upgrades TheOne from a workflow executor into a contextual OS control plane: it can now select external system surfaces and remember relevant prior work without turning OneAI or OneClaw into internal modules.

## Phase 8 Context Bus + Permission Model

TheOne now builds a governed context frame for each run.

Context bus model:

- `ContextResource`: normalized resource for intent, user, session, capability, skill, app, connector, memory, approval, execution, provider, and external action.
- `ContextBusFrame`: one per run; carries resource inventory, connector count, memory hits, approvals, executions, and permission summary.
- `AgentRuntimeContext.contextFrame`: gives runtime and OneAI payloads a compact view of the governed context.

Permission model:

- `PermissionScope`: read context, read memory, write memory, use connector, submit external action, browser operation, file read/write, messaging, transaction, and admin scopes.
- `PermissionDecision`: allowed, requires approval, or denied.
- `ConnectorDefinition.permissionScopes`: every connector declares the scopes it needs.
- TheOne evaluates permissions before runtime and passes the result into the workflow context.

Boundary rule:

```text
TheOne owns context and permission decisions.
OneAI receives governed context for intelligence.
OneClaw receives executable tasks only after approval and permission gates.
```

This is the governance layer that makes TheOne feel like an operating system rather than a workflow app.

## 产品第一版目标

1. 用户输入任意目标。
2. TheOne 分类意图并生成 plan。
3. TheOne 生成带依赖的 DAG plan，并匹配 capability + skill。
4. TheOne 选择 connector route，并召回相关 memory context。
5. TheOne 生成 context bus frame，并评估 permission decisions。
6. TheOne 调 OneAI 生成结构化计划或 OneClaw task。
7. TheOne 根据 mode、risk、permission 创建 approval gates。
8. 低风险动作可提交 OneClaw，高风险动作等待审批。
9. TheOne 写入 provider receipt、proof，并把结果沉淀到 memory contract。

## Phase 3 Durable OS Ledger

TheOne now persists OS state into SQLite through Prisma Client.

Durable objects:

- `TheOneRun`: run snapshot, intent, plan, result, pending OneClaw task.
- `TheOneApproval`: approval gates and operator decisions.
- `TheOneExecution`: provider execution records and external task ids.
- `TheOneProof`: proof receipts and provider metadata.
- `TheOneMemory`: memory graph v1 notes from run, approval, execution, and sync events.

API surfaces:

- `GET /api/theone/runs`
- `GET /api/theone/runs/:runId`
- `GET /api/theone/proof`
- `GET /api/theone/memory`

The SQLite database lives at `prisma/dev.db` by default and is ignored by git. Prisma's CLI `db push` is optional in local development because TheOne initializes its tables through Prisma Client on first use.

## 三种运行模式

- Manual: 外部动作默认等待人工确认。
- Assist: AI 可规划，低风险可运行，高风险等待确认。
- Auto: 只允许安全动作自动运行，高风险仍需确认。

## 不可变原则

TheOne owns coordination. OneAI owns intelligence. OneClaw owns execution.

TheOne 的长期价值不在于多一个聊天入口，而在于把 AI、工具、权限、证据和记忆组织成一个可扩展的操作系统。
