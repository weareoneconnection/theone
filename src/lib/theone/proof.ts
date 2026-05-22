import type { ProofRecord } from './types';

export async function writeProof(records: ProofRecord[]): Promise<ProofRecord[]> {
  return records.map((record) => ({
    ...record,
    metadata: {
      ...(record.metadata || {}),
      storedBy: 'TheOne',
    },
  }));
}
