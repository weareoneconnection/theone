export type TheOneModelUseCase =
  | 'theone.chat.primary'
  | 'theone.chat.fast'
  | 'theone.chat.finalize'
  | 'theone.code.agent'
  | 'theone.vision'
  | 'theone.realtime';

export type TheOneModelRoute = {
  useCase: TheOneModelUseCase;
  provider: 'openai' | 'oneai';
  model: string;
  envKey: string;
  role: string;
  latencyClass: 'fast' | 'balanced' | 'deep' | 'realtime';
};

const DEFAULT_FRONTIER_MODEL = 'gpt-5.5';
const DEFAULT_FAST_MODEL = 'gpt-5.5';
const DEFAULT_CODE_MODEL = 'gpt-5.2-codex';
const DEFAULT_REALTIME_MODEL = 'gpt-realtime';

const modelRoutes: Record<TheOneModelUseCase, Omit<TheOneModelRoute, 'model'>> = {
  'theone.chat.primary': {
    useCase: 'theone.chat.primary',
    provider: 'openai',
    envKey: 'THEONE_FRONTIER_MODEL',
    role: 'Primary Codex-like super-agent conversation model.',
    latencyClass: 'deep',
  },
  'theone.chat.fast': {
    useCase: 'theone.chat.fast',
    provider: 'openai',
    envKey: 'THEONE_FAST_MODEL',
    role: 'Fast turn-taking, lightweight clarification, and UI helper model.',
    latencyClass: 'fast',
  },
  'theone.chat.finalize': {
    useCase: 'theone.chat.finalize',
    provider: 'openai',
    envKey: 'THEONE_FINALIZE_MODEL',
    role: 'Summarizes worker evidence into user-facing results.',
    latencyClass: 'balanced',
  },
  'theone.code.agent': {
    useCase: 'theone.code.agent',
    provider: 'openai',
    envKey: 'THEONE_CODE_MODEL',
    role: 'Code and repository reasoning model.',
    latencyClass: 'deep',
  },
  'theone.vision': {
    useCase: 'theone.vision',
    provider: 'openai',
    envKey: 'THEONE_VISION_MODEL',
    role: 'Image, screenshot, and document visual understanding model.',
    latencyClass: 'balanced',
  },
  'theone.realtime': {
    useCase: 'theone.realtime',
    provider: 'openai',
    envKey: 'THEONE_REALTIME_MODEL',
    role: 'Realtime voice or streaming operation model.',
    latencyClass: 'realtime',
  },
};

function fallbackModel(useCase: TheOneModelUseCase) {
  if (useCase === 'theone.chat.fast') return process.env.THEONE_FRONTIER_MODEL || DEFAULT_FAST_MODEL;
  if (useCase === 'theone.chat.finalize') return process.env.THEONE_FRONTIER_MODEL || DEFAULT_FRONTIER_MODEL;
  if (useCase === 'theone.code.agent') return DEFAULT_CODE_MODEL;
  if (useCase === 'theone.realtime') return DEFAULT_REALTIME_MODEL;
  return DEFAULT_FRONTIER_MODEL;
}

export function resolveTheOneModel(useCase: TheOneModelUseCase): TheOneModelRoute {
  const route = modelRoutes[useCase];
  return {
    ...route,
    model: String(process.env[route.envKey] || fallbackModel(useCase)).trim(),
  };
}

export function listTheOneModelRoutes() {
  return (Object.keys(modelRoutes) as TheOneModelUseCase[]).map(resolveTheOneModel);
}
