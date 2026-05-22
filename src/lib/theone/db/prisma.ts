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

export function ensureTheOneDatabase() {
  ensurePromise ??= (async () => {
    if (!databaseUrl()) {
      throw new Error('DATABASE_URL is required for TheOne database access.');
    }

    if (!usesSqliteFileDatabase()) {
      await prisma.$queryRawUnsafe('select 1');
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
  })();

  return ensurePromise;
}
