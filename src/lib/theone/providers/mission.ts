import type { ProofRecord } from '../types';

export async function recordMissionProof(records: ProofRecord[]) {
  return {
    ok: true,
    count: records.length,
  };
}
