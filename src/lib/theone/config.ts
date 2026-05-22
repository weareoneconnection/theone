export const THEONE_CONFIG = {
  appName: 'TheOne',
  version: '1.0.0',
  defaultMode: 'assist',
  enableProof: true,
  enableNetworkSync: true,
  enableMissionRecording: true,
  maxSteps: 12,
  safeActions: new Set([
    'oneai.generate',
    'trading.scan',
    'browser.open',
    'browser.extract',
    'memory.store',
    'network.update',
    'mission.create',
    'proof.write',
  ]),
} as const;
