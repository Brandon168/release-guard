# Change Risk Copilot

Change Risk Copilot is a compact, production-minded AI app for analyzing proposed software and infrastructure changes. It takes a proposed change, streams back a defensible assessment, and treats missing evidence as a first-class outcome instead of a failure.

## Minimal Architecture

- `Next.js App Router` serves a single analyst workbench page and one streaming API route.
- The client uses `useChat` from `@ai-sdk/react` with `DefaultChatTransport` to stream results from `/api/analyze`.
- A shared deterministic risk engine scores the request first. It produces a preview, grounds the prompt, powers the eval harness, and provides a no-model fallback.
- An artifact ingestion layer turns pasted change artifacts into the same shared request shape used by the deterministic engine.
- The API route uses `streamText` from `ai` with explicit `AI Gateway` isolation and the current default model `openai/gpt-5-mini`.
- Two simple AI tools are available during generation: `getChangeChecklist(changeType)` and `lookupRunbook(systemName)`.
- If Gateway credentials are unavailable locally, the route streams a deterministic fallback report instead of failing.
- An optional repo grounding pack in `.changeRisk/` gives the model repo-specific taxonomy, policy, and examples.
- No database, auth, or persistence layer is included. The app is intentionally single-session and fixture-driven.

## Repo Structure

```text
app/
  api/analyze/route.ts      Streaming analysis endpoint
  globals.css               Visual system and layout
  layout.tsx                Fonts and metadata
  page.tsx                  Entry page
components/
  change-risk-workbench.tsx Main UI and streamed result panel
/.changeRisk/
  README.md                 Repo-grounding contract for the demo
  project.md                Project shape, sensitive paths, and priorities
  risk-taxonomy.md          Repo-specific low/medium/high/unknown definitions
  policy.yaml               Path sensitivity, review defaults, and PR exemptions
  examples/                 Repo-native grading examples
lib/
  artifact-ingestion.ts      Artifact parsing and normalization
  change-tools.ts           AI SDK tools for checklist and runbook lookup
  demo-scenarios.ts         Four curated demo artifacts
  fixtures.ts               12 synthetic scenarios and expectations
  model.ts                  AI Gateway model defaults
  prompt.ts                 Server prompt construction
  report.ts                 Deterministic fallback formatter
  risk-engine.ts            Shared heuristic assessment layer
  types.ts                  Shared schemas and domain types
  ui-stream.ts              Helper for streaming non-LLM text responses
scripts/
  eval.ts                   Lightweight fixture-based evaluation
```

## Exact MVP Feature Set

- Single-page change review workbench with an artifact-first input.
- Support for PR diffs, Terraform plans, change tickets, release notes, and config changes.
- Four curated demo artifacts in the UI: low, medium, high, and explicit unknown.
- Optional advanced context panel for rollout, rollback, observability, and scope overrides.
- Deterministic preview showing provisional risk level, evidence strength, blast radius, and clarifying questions before model output.
- Optional repo grounding pack so severity calibration can be repo-specific instead of purely generic.
- Visible runtime mode section showing deterministic preview, AI-assisted final assessment, and fallback usage.
- Evidence and provenance chips for signals used and missing evidence.
- Streamed final assessment covering:
  - risk rating
  - blast radius
  - reasoning
  - missing info
  - rollback considerations
  - executive summary
- Lightweight tool activity panel so the demo can show checklist and runbook lookups without turning into a generic chatbot.
- Explicit handling for ambiguous inputs using `unknown` risk rather than throwing validation errors.
- Deterministic fallback mode when the model is unavailable locally.
- Lightweight evaluation script over synthetic fixtures.

## Eval Approach

The MVP uses a pragmatic, low-cost regression eval instead of a full judge-model pipeline.

- `pnpm eval` runs the shared heuristic engine against 12 synthetic fixtures.
- The product UI only shows four curated presets so the demo stays focused, but the regression harness keeps the broader 12-case synthetic set.
- Each fixture checks:
  - expected risk level
  - at least one expected blast-radius keyword
  - minimum clarifying question count
  - rollback guidance presence
  - explicit unknown handling for ambiguous cases
- This eval keeps the stable, explainable layer under test without requiring model calls on every run.

## Repo Grounding Pack

The demo now includes a committed `.changeRisk/` folder to represent the repo-local
context a real deployment would maintain.

- `project.md` explains what is in scope and which runtime paths are sensitive.
- `risk-taxonomy.md` defines what `low`, `medium`, `high`, and `unknown` mean for this repo.
- `policy.yaml` captures lightweight path sensitivity, review expectations, and optional non-runtime PR exemptions.
- `examples/` provides short repo-native examples that calibrate the grader.

The current server review flow loads this pack and includes it in the model prompt
when present. That keeps model choice separate from repo policy and gives a clean
demo story for future automation that refreshes the pack over time.

## Sample Fixture Types

```ts
type ChangeFixture = {
  id: string;
  title: string;
  description: string;
  request: ChangeRequest;
  expected: {
    riskLevel: 'low' | 'medium' | 'high' | 'unknown';
    blastRadiusKeywords: string[];
    minimumQuestions: number;
    expectRollbackGuidance: boolean;
    expectUnknownHandling?: boolean;
  };
};
```

## Twelve Concrete Test Cases

1. Billing banner copy behind existing flag: low
2. Async worker memory limit increase: low
3. Redis cart TTL reduction: medium
4. Authentication SDK major upgrade: medium
5. Concurrent index on orders table: medium
6. Production security group tightening: high
7. Kubernetes ingress path rewrite: high
8. Drop legacy customer column: high
9. VPC peering route table change: high
10. Vague production performance tuning: unknown
11. Undefined cache layer rollout: unknown
12. Node-level logging agent rollout: medium

## Implementation Plan In Phases

1. Foundation
Create the Next.js App Router shell, shared types, environment defaults, and the basic workbench layout.

2. Deterministic Layer
Implement the shared heuristic risk engine plus synthetic fixtures so the app has a preview, a fallback, and an explainable baseline.

3. Streaming AI Layer
Add the `/api/analyze` route with `streamText`, AI Gateway model configuration, and streamed UI rendering via `useChat`.

4. Hardening
Add the fixture-based eval, write the README, and verify build, lint, and typecheck behavior.

## Setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Set `AI_GATEWAY_API_KEY` for local model calls. On Vercel, Gateway OIDC can be used instead. `AI_MODEL` is optional and defaults to `openai/gpt-5-mini`.

## Commands

```bash
pnpm dev                 # Run the Next.js app
pnpm build               # Build the app
pnpm risk:pr            # Evaluate the current PR diff inside GitHub Actions
```

## GitHub Automation Path

The repo now includes a deployable JSON endpoint at `/api/github/risk` plus CI helpers in `scripts/`.

- `POST /api/github/risk` accepts PR-like payloads with title, body, diff, optional file patches, and optional policy overrides.
- The endpoint reuses the same artifact ingestion and deterministic risk engine used by the workbench.
- The policy layer converts the assessment into a gate outcome: `pass`, `warn`, or `fail`.
- `.github/workflows/pr-risk.yml` shows the Vercel-native demo path: run baseline checks, build a PR payload, call the deployed Vercel preview endpoint, post a sticky PR comment, and fail the job when the policy says to block.
- `scripts/build-pr-risk-payload.ts` converts the GitHub event plus git diff into the JSON body the deployed endpoint expects.
- `scripts/pr-risk.ts` remains available as a local fallback for development, but the demo workflow intentionally leans on the deployed Vercel endpoint.

### Vercel Demo Setup

For the interview demo, the simplest defensible setup is:

1. Deploy this repo to Vercel as a preview deployment.
2. Turn on Vercel Deployment Protection for previews.
3. Share the protected preview URL with humans using Vercel's native access flow.
4. Configure GitHub Actions to call the same preview URL using Vercel's native automation bypass header.

Required GitHub Actions secrets:

- `RISK_ENDPOINT_URL`
  Set this to the protected Vercel preview URL for the deployed endpoint, for example `https://your-demo-url.vercel.app/api/github/risk`.
- `VERCEL_AUTOMATION_BYPASS_SECRET`
  Use the bypass secret from Vercel Deployment Protection so GitHub Actions can reach the preview deployment without hand-rolled app auth.

This demo intentionally does not add a custom password wall. The point is to show that Vercel's native preview deployment and protection features are enough to support a real GitHub-to-deployment flow with very little application code.

Example endpoint request:

```json
{
  "title": "Tighten inbound rules for production app subnet",
  "body": "Restrict ingress to approved load balancers and bastion hosts.",
  "baseRef": "main",
  "headRef": "feature/security-group-change",
  "diff": "diff --git a/infra/main.tf b/infra/main.tf\n..."
}
```

Example response shape:

```json
{
  "ok": true,
  "decision": {
    "status": "fail",
    "summary": "PR should be blocked pending review."
  },
  "assessment": {
    "riskLevel": "high",
    "score": 61,
    "evidenceStrength": "moderate"
  }
}
```

## Deliberate Trade-offs

- The output is a streamed narrative report, not a deeply structured dashboard. That keeps the build small and the enterprise story easy to defend in 4-6 hours.
- The heuristic engine is intentionally simple and readable. It is not a full rules engine; it exists to ground the model, surface ambiguity, and provide a deterministic fallback.
- The artifact parser is intentionally heuristic and transparent. Its job is to reduce demo friction, not to pretend it can fully parse every change document.
- There is no persistence, auth, or database because those concerns do not materially improve the take-home signal.
- The eval harness focuses on the deterministic layer, not on subjective model grading. That is a deliberate choice to keep cost and complexity low while still showing regression discipline.
- The UI behaves like a workbench, not a memoryful chatbot. Each run clears prior messages so reviewers do not accidentally inherit stale context.
