export async function pushNetworkSignals(input: Record<string, unknown>) {
  return {
    ok: true,
    accepted: true,
    input,
  };
}
