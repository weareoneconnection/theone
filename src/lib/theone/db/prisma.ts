import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  theOnePrisma?: PrismaClient;
};

function databaseUrl() {
  return String(process.env.DATABASE_URL || '').trim();
}

function usesSqliteFileDatabase() {
  return databaseUrl().startsWith('file:');
}

export const prisma = globalForPrisma.theOnePrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.theOnePrisma = prisma;
}

let ensurePromise: Promise<void> | null = null;

async function ensurePostgresAuxTables() {
  await prisma.$executeRawUnsafe(`
    create table if not exists "TheOnePolicyRule" (
      id text primary key not null,
      domain text not null,
      action text not null,
      mode text not null,
      risk text not null,
      decision text not null,
      enabled boolean not null default true,
      reason text not null,
      ruleJson text not null,
      createdAt timestamptz not null default now(),
      updatedAt timestamptz not null default now()
    )
  `);
  await prisma.$executeRawUnsafe(`create index if not exists "TheOnePolicyRule_action_idx" on "TheOnePolicyRule"(action)`);
  await prisma.$executeRawUnsafe(`create index if not exists "TheOnePolicyRule_decision_idx" on "TheOnePolicyRule"(decision)`);

  await prisma.$executeRawUnsafe(`
    create table if not exists "TheOneEvent" (
      id text primary key not null,
      runId text,
      type text not null,
      provider text not null,
      status text not null,
      summary text not null,
      payloadJson text,
      createdAt timestamptz not null default now()
    )
  `);
  await prisma.$executeRawUnsafe(`create index if not exists "TheOneEvent_runId_idx" on "TheOneEvent"(runId)`);
  await prisma.$executeRawUnsafe(`create index if not exists "TheOneEvent_type_idx" on "TheOneEvent"(type)`);
  await prisma.$executeRawUnsafe(`create index if not exists "TheOneEvent_createdAt_idx" on "TheOneEvent"(createdAt)`);

  await prisma.$executeRawUnsafe(`
    create table if not exists "TheOneAutomationJob" (
      id text primary key not null,
      name text not null,
      triggerType text not null,
      triggerJson text not null,
      command text not null,
      mode text not null default 'assist',
      status text not null default 'active',
      maxRunsPerDay integer not null default 3,
      cooldownMinutes integer not null default 60,
      failureStreak integer not null default 0,
      circuitOpen boolean not null default false,
      lastRunAt timestamptz,
      nextRunAt timestamptz,
      createdAt timestamptz not null default now(),
      updatedAt timestamptz not null default now()
    )
  `);
  await prisma.$executeRawUnsafe(`create index if not exists "TheOneAutomationJob_status_idx" on "TheOneAutomationJob"(status)`);
  await prisma.$executeRawUnsafe(`create index if not exists "TheOneAutomationJob_nextRunAt_idx" on "TheOneAutomationJob"(nextRunAt)`);

  await prisma.$executeRawUnsafe(`
    create table if not exists "TheOneAutomationRun" (
      id text primary key not null,
      jobId text not null,
      runId text,
      status text not null,
      summary text not null,
      payloadJson text,
      createdAt timestamptz not null default now()
    )
  `);
  await prisma.$executeRawUnsafe(`create index if not exists "TheOneAutomationRun_jobId_idx" on "TheOneAutomationRun"(jobId)`);
  await prisma.$executeRawUnsafe(`create index if not exists "TheOneAutomationRun_createdAt_idx" on "TheOneAutomationRun"(createdAt)`);

  await prisma.$executeRawUnsafe(`
    create table if not exists "TheOneExternalEvent" (
      id text primary key not null,
      source text not null,
      eventType text not null,
      externalId text,
      status text not null default 'received',
      summary text not null,
      payloadJson text,
      createdAt timestamptz not null default now()
    )
  `);
  await prisma.$executeRawUnsafe(`create index if not exists "TheOneExternalEvent_source_idx" on "TheOneExternalEvent"(source)`);
  await prisma.$executeRawUnsafe(`create index if not exists "TheOneExternalEvent_status_idx" on "TheOneExternalEvent"(status)`);
  await prisma.$executeRawUnsafe(`create index if not exists "TheOneExternalEvent_externalId_idx" on "TheOneExternalEvent"(externalId)`);

  await prisma.$executeRawUnsafe(`
    create table if not exists "TheOnePackage" (
      id text primary key not null,
      kind text not null,
      name text not null,
      title text not null,
      version text not null,
      status text not null default 'available',
      enabled boolean not null default false,
      source text not null default 'theone',
      dependenciesJson text not null default '[]',
      manifestJson text not null,
      installedAt timestamptz,
      createdAt timestamptz not null default now(),
      updatedAt timestamptz not null default now()
    )
  `);
  await prisma.$executeRawUnsafe(`create index if not exists "TheOnePackage_kind_idx" on "TheOnePackage"(kind)`);
  await prisma.$executeRawUnsafe(`create index if not exists "TheOnePackage_status_idx" on "TheOnePackage"(status)`);
  await prisma.$executeRawUnsafe(`create index if not exists "TheOnePackage_enabled_idx" on "TheOnePackage"(enabled)`);

  await prisma.$executeRawUnsafe(`
    create table if not exists "TheOneLearningInsight" (
      id text primary key not null,
      category text not null,
      title text not null,
      summary text not null,
      recommendation text not null,
      targetType text not null,
      targetId text,
      confidence double precision not null default 0.5,
      status text not null default 'suggested',
      evidenceJson text not null,
      createdAt timestamptz not null default now(),
      appliedAt timestamptz
    )
  `);
  await prisma.$executeRawUnsafe(`create index if not exists "TheOneLearningInsight_category_idx" on "TheOneLearningInsight"(category)`);
  await prisma.$executeRawUnsafe(`create index if not exists "TheOneLearningInsight_status_idx" on "TheOneLearningInsight"(status)`);
  await prisma.$executeRawUnsafe(`create index if not exists "TheOneLearningInsight_target_idx" on "TheOneLearningInsight"(targetType, targetId)`);
}

export function ensureTheOneDatabase() {
  ensurePromise ??= (async () => {
    if (!databaseUrl()) {
      throw new Error('DATABASE_URL is required for TheOne database access.');
    }

    if (!usesSqliteFileDatabase()) {
      await prisma.$queryRawUnsafe('select 1');
      await ensurePostgresAuxTables();
      return;
    }

    await prisma.$executeRawUnsafe(`
      create table if not exists TheOneRun (
        id text primary key not null,
        ok boolean not null,
        mode text not null,
        intentType text not null,
        objective text not null,
        planJson text not null,
        resultJson text not null,
        pendingOneClawTaskJson text,
        createdAt datetime not null default current_timestamp,
        updatedAt datetime not null default current_timestamp
      )
    `);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneRun_createdAt_idx on TheOneRun(createdAt)`);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneRun_intentType_idx on TheOneRun(intentType)`);

    await prisma.$executeRawUnsafe(`
      create table if not exists TheOneApproval (
        id text primary key not null,
        runId text not null,
        stepId text not null,
        action text not null,
        risk text not null,
        required boolean not null,
        status text not null,
        mode text not null,
        reason text not null,
        gateJson text not null,
        createdAt datetime not null default current_timestamp,
        updatedAt datetime not null default current_timestamp,
        foreign key (runId) references TheOneRun(id) on delete cascade on update cascade
      )
    `);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneApproval_runId_idx on TheOneApproval(runId)`);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneApproval_status_idx on TheOneApproval(status)`);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneApproval_action_idx on TheOneApproval(action)`);

    await prisma.$executeRawUnsafe(`
      create table if not exists TheOneExecution (
        id text primary key not null,
        runId text not null,
        provider text not null,
        status text not null,
        summary text not null,
        externalId text,
        taskName text,
        rawJson text,
        createdAt datetime not null default current_timestamp,
        updatedAt datetime not null default current_timestamp,
        foreign key (runId) references TheOneRun(id) on delete cascade on update cascade
      )
    `);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneExecution_runId_idx on TheOneExecution(runId)`);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneExecution_provider_idx on TheOneExecution(provider)`);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneExecution_status_idx on TheOneExecution(status)`);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneExecution_externalId_idx on TheOneExecution(externalId)`);

    await prisma.$executeRawUnsafe(`
      create table if not exists TheOneProof (
        id text primary key not null,
        runId text not null,
        type text not null,
        title text not null,
        value text,
        metadataJson text,
        timestamp datetime not null,
        createdAt datetime not null default current_timestamp,
        foreign key (runId) references TheOneRun(id) on delete cascade on update cascade
      )
    `);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneProof_runId_idx on TheOneProof(runId)`);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneProof_type_idx on TheOneProof(type)`);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneProof_timestamp_idx on TheOneProof(timestamp)`);

    await prisma.$executeRawUnsafe(`
      create table if not exists TheOneMemory (
        id text primary key not null,
        runId text,
        kind text not null,
        title text not null,
        summary text not null,
        contentJson text,
        createdAt datetime not null default current_timestamp,
        foreign key (runId) references TheOneRun(id) on delete set null on update cascade
      )
    `);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneMemory_runId_idx on TheOneMemory(runId)`);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneMemory_kind_idx on TheOneMemory(kind)`);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneMemory_createdAt_idx on TheOneMemory(createdAt)`);

    await prisma.$executeRawUnsafe(`
      create table if not exists TheOnePolicyRule (
        id text primary key not null,
        domain text not null,
        action text not null,
        mode text not null,
        risk text not null,
        decision text not null,
        enabled boolean not null default true,
        reason text not null,
        ruleJson text not null,
        createdAt datetime not null default current_timestamp,
        updatedAt datetime not null default current_timestamp
      )
    `);
    await prisma.$executeRawUnsafe(`create index if not exists TheOnePolicyRule_action_idx on TheOnePolicyRule(action)`);
    await prisma.$executeRawUnsafe(`create index if not exists TheOnePolicyRule_decision_idx on TheOnePolicyRule(decision)`);

    await prisma.$executeRawUnsafe(`
      create table if not exists TheOneEvent (
        id text primary key not null,
        runId text,
        type text not null,
        provider text not null,
        status text not null,
        summary text not null,
        payloadJson text,
        createdAt datetime not null default current_timestamp
      )
    `);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneEvent_runId_idx on TheOneEvent(runId)`);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneEvent_type_idx on TheOneEvent(type)`);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneEvent_createdAt_idx on TheOneEvent(createdAt)`);

    await prisma.$executeRawUnsafe(`
      create table if not exists TheOneAutomationJob (
        id text primary key not null,
        name text not null,
        triggerType text not null,
        triggerJson text not null,
        command text not null,
        mode text not null default 'assist',
        status text not null default 'active',
        maxRunsPerDay integer not null default 3,
        cooldownMinutes integer not null default 60,
        failureStreak integer not null default 0,
        circuitOpen boolean not null default false,
        lastRunAt datetime,
        nextRunAt datetime,
        createdAt datetime not null default current_timestamp,
        updatedAt datetime not null default current_timestamp
      )
    `);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneAutomationJob_status_idx on TheOneAutomationJob(status)`);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneAutomationJob_nextRunAt_idx on TheOneAutomationJob(nextRunAt)`);

    await prisma.$executeRawUnsafe(`
      create table if not exists TheOneAutomationRun (
        id text primary key not null,
        jobId text not null,
        runId text,
        status text not null,
        summary text not null,
        payloadJson text,
        createdAt datetime not null default current_timestamp
      )
    `);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneAutomationRun_jobId_idx on TheOneAutomationRun(jobId)`);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneAutomationRun_createdAt_idx on TheOneAutomationRun(createdAt)`);

    await prisma.$executeRawUnsafe(`
      create table if not exists TheOneExternalEvent (
        id text primary key not null,
        source text not null,
        eventType text not null,
        externalId text,
        status text not null default 'received',
        summary text not null,
        payloadJson text,
        createdAt datetime not null default current_timestamp
      )
    `);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneExternalEvent_source_idx on TheOneExternalEvent(source)`);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneExternalEvent_status_idx on TheOneExternalEvent(status)`);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneExternalEvent_externalId_idx on TheOneExternalEvent(externalId)`);

    await prisma.$executeRawUnsafe(`
      create table if not exists TheOnePackage (
        id text primary key not null,
        kind text not null,
        name text not null,
        title text not null,
        version text not null,
        status text not null default 'available',
        enabled boolean not null default false,
        source text not null default 'theone',
        dependenciesJson text not null default '[]',
        manifestJson text not null,
        installedAt datetime,
        createdAt datetime not null default current_timestamp,
        updatedAt datetime not null default current_timestamp
      )
    `);
    await prisma.$executeRawUnsafe(`create index if not exists TheOnePackage_kind_idx on TheOnePackage(kind)`);
    await prisma.$executeRawUnsafe(`create index if not exists TheOnePackage_status_idx on TheOnePackage(status)`);
    await prisma.$executeRawUnsafe(`create index if not exists TheOnePackage_enabled_idx on TheOnePackage(enabled)`);

    await prisma.$executeRawUnsafe(`
      create table if not exists TheOneLearningInsight (
        id text primary key not null,
        category text not null,
        title text not null,
        summary text not null,
        recommendation text not null,
        targetType text not null,
        targetId text,
        confidence real not null default 0.5,
        status text not null default 'suggested',
        evidenceJson text not null,
        createdAt datetime not null default current_timestamp,
        appliedAt datetime
      )
    `);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneLearningInsight_category_idx on TheOneLearningInsight(category)`);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneLearningInsight_status_idx on TheOneLearningInsight(status)`);
    await prisma.$executeRawUnsafe(`create index if not exists TheOneLearningInsight_target_idx on TheOneLearningInsight(targetType, targetId)`);
  })();

  return ensurePromise;
}
