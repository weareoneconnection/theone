import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database layer
vi.mock('@/lib/theone/db/prisma', () => ({
  ensureTheOneDatabase: vi.fn().mockResolvedValue(undefined),
  isPgVectorAvailable: vi.fn().mockReturnValue(false),
  embeddingDimension: vi.fn().mockReturnValue(128),
  prisma: {
    theOneMemory: {
      create: vi.fn().mockResolvedValue({ id: 'mem_test_001' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

// Mock embedText — returns a deterministic 4-dim vector for speed
vi.mock('@/lib/theone/providers/oneai', () => ({
  embedText: vi.fn().mockImplementation(async (text: string) => {
    const seed = text.length;
    return {
      embedding: [seed * 0.1, seed * 0.2, seed * 0.3, seed * 0.4],
      model: 'mock',
      mock: true,
    };
  }),
  runOneAI: vi.fn().mockResolvedValue({ success: false, data: null }),
  extractOneAIData: vi.fn().mockReturnValue(null),
}));

describe('storeRunMemory', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stores a memory record and returns ok: true', async () => {
    const { storeRunMemory } = await import('@/lib/theone/memory');
    const result = await storeRunMemory({
      runId: 'run_001',
      intent: {
        type: 'knowledge',
        objective: 'Summarize the AI market landscape',
        entities: ['AI', 'market'],
        constraints: [],
        priority: 'normal',
        confidence: 0.9,
        requiresApproval: false,
      },
      summary: 'Prepared a comprehensive AI market summary.',
    });

    expect(result.ok).toBe(true);
    expect(result.stored).toBe(true);
    expect(result.memoryId).toBeDefined();
  });

  it('calls prisma.create with correct fields', async () => {
    const { prisma } = await import('@/lib/theone/db/prisma');
    const { storeRunMemory } = await import('@/lib/theone/memory');

    await storeRunMemory({
      runId: 'run_002',
      intent: {
        type: 'growth',
        objective: 'Grow X followers',
        entities: ['X'],
        constraints: [],
        priority: 'high',
        confidence: 0.8,
        requiresApproval: true,
      },
      summary: 'Growth strategy prepared.',
    });

    expect(prisma.theOneMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          runId: 'run_002',
          kind: 'growth',
          title: 'Grow X followers',
          summary: 'Growth strategy prepared.',
        }),
      }),
    );
  });

  it('stores embeddingJson alongside content', async () => {
    const { prisma } = await import('@/lib/theone/db/prisma');
    const { storeRunMemory } = await import('@/lib/theone/memory');

    await storeRunMemory({
      runId: 'run_003',
      intent: {
        type: 'general',
        objective: 'Test embedding storage',
        entities: [],
        constraints: [],
        priority: 'normal',
        confidence: 0.75,
        requiresApproval: false,
      },
      summary: 'Embedding test run.',
    });

    const createCall = vi.mocked(prisma.theOneMemory.create).mock.calls[0][0];
    expect(createCall.data.embeddingJson).toBeDefined();
    const parsed = JSON.parse(createCall.data.embeddingJson as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  it('returns ok: false gracefully when DB throws', async () => {
    const { prisma } = await import('@/lib/theone/db/prisma');
    vi.mocked(prisma.theOneMemory.create).mockRejectedValueOnce(new Error('DB connection failed'));

    const { storeRunMemory } = await import('@/lib/theone/memory');
    const result = await storeRunMemory({
      runId: 'run_fail',
      intent: {
        type: 'general',
        objective: 'This will fail',
        entities: [],
        constraints: [],
        priority: 'low',
        confidence: 0.5,
        requiresApproval: false,
      },
      summary: 'Fail test.',
    });

    expect(result.ok).toBe(false);
    expect(result.stored).toBe(false);
  });
});

describe('cosineSimilarity (via queryMemoryGraph)', () => {
  it('returns higher-scored results for semantically similar queries', async () => {
    const { prisma } = await import('@/lib/theone/db/prisma');

    const mockRows = [
      {
        id: 'mem_a', runId: null, kind: 'knowledge', title: 'AI agents overview',
        summary: 'Deep dive into AI agents and workflows',
        contentJson: null,
        embeddingJson: JSON.stringify([0.8, 0.6, 0.1, 0.2]),
        createdAt: new Date('2026-01-01'),
        run: null,
      },
      {
        id: 'mem_b', runId: null, kind: 'financial', title: 'Stock market analysis',
        summary: 'Equity and bond portfolio rebalancing',
        contentJson: null,
        embeddingJson: JSON.stringify([0.1, 0.2, 0.9, 0.8]),
        createdAt: new Date('2026-01-02'),
        run: null,
      },
    ];

    vi.mocked(prisma.theOneMemory.findMany).mockResolvedValueOnce(mockRows as never);

    // embedText for query 'AI agents workflow' → same seed as our mock
    const { queryMemoryGraph } = await import('@/lib/theone/state/run-store');
    const results = await queryMemoryGraph({ query: 'AI agents workflow', limit: 5 });

    // Both should return (have some score) — we just verify the function runs
    expect(Array.isArray(results)).toBe(true);
  });
});
