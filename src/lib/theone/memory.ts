export async function storeRunMemory(input: Record<string, unknown>) {
  return {
    ok: true,
    stored: true,
    input,
  };
}
