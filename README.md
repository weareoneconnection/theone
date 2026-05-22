# TheOne Complete

A runnable TheOne architecture package built with Next.js App Router + TypeScript.

## What is included

- `/theone` launch page
- `/api/theone/run` orchestration API
- Intent classification
- Plan builder
- Agent router
- Proof/memory/network hooks
- Safe mock providers so the app runs without external services

## Quick start

```bash
npm install
npm run dev
```

Then open:

```bash
http://localhost:3000/theone
```

## Optional real provider wiring

Copy `.env.example` to `.env.local` and add your endpoints.

```bash
ONEAI_BASE_URL=https://oneai-api-production.up.railway.app
ONEAI_API_KEY=...
ONEAI_HEALTH_PATH=/health

ONECLAW_BASE_URL=https://oneclaw-production.up.railway.app
ONECLAW_TOKEN=...
ONECLAW_HEALTH_PATH=/health
```

Connection checks:

- `GET /api/theone/providers/check`
- `GET /api/theone/status?connections=1`

TheOne uses mock mode until keys are configured. OneAI stays the intelligence provider. OneClaw stays the execution provider. TheOne owns routing, context, permissions, approvals, proof, and memory.

## Demo prompts

- Make me money with a guarded strategy
- Grow my X account fast
- Create a mission for the community
- Research WAOC positioning
