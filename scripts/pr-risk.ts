import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { evaluatePullRequestRisk } from '../lib/github-risk';
import type { RiskPolicy } from '../lib/risk-policy';

type Args = {
  base?: string;
  head?: string;
  output?: string;
  failOnUnknown?: boolean;
  failOnHighRisk?: boolean;
  warnOnMediumRisk?: boolean;
  warnOnWeakConfidence?: boolean;
  warnOnFallback?: boolean;
};

type GitHubEvent = {
  pull_request?: {
    title?: string;
    body?: string | null;
    base?: {
      ref?: string;
      sha?: string;
    };
    head?: {
      ref?: string;
      sha?: string;
    };
  };
};

function parseBoolean(value: string) {
  return value === 'true' || value === '1';
}

function parseArgs(argv: string[]) {
  const args: Args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--base' && next) {
      args.base = next;
      index += 1;
    } else if (arg === '--head' && next) {
      args.head = next;
      index += 1;
    } else if (arg === '--output' && next) {
      args.output = next;
      index += 1;
    } else if (arg === '--fail-on-unknown' && next) {
      args.failOnUnknown = parseBoolean(next);
      index += 1;
    } else if (arg === '--fail-on-high-risk' && next) {
      args.failOnHighRisk = parseBoolean(next);
      index += 1;
    } else if (arg === '--warn-on-medium-risk' && next) {
      args.warnOnMediumRisk = parseBoolean(next);
      index += 1;
    } else if (arg === '--warn-on-weak-confidence' && next) {
      args.warnOnWeakConfidence = parseBoolean(next);
      index += 1;
    } else if (arg === '--warn-on-fallback' && next) {
      args.warnOnFallback = parseBoolean(next);
      index += 1;
    }
  }

  return args;
}

function readGitHubEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;

  if (!eventPath) {
    return {} satisfies GitHubEvent;
  }

  try {
    return JSON.parse(readFileSync(eventPath, 'utf8')) as GitHubEvent;
  } catch {
    return {} satisfies GitHubEvent;
  }
}

function buildPolicy(args: Args): Partial<RiskPolicy> {
  return {
    failOnUnknown: args.failOnUnknown,
    failOnHighRisk: args.failOnHighRisk,
    warnOnMediumRisk: args.warnOnMediumRisk,
    warnOnWeakConfidence: args.warnOnWeakConfidence,
    warnOnFallback: args.warnOnFallback,
  };
}

function getDiff(base: string, head: string) {
  return execFileSync('git', ['diff', '--unified=3', `${base}...${head}`], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  }).trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const event = readGitHubEvent();
  const baseSha = args.base ?? event.pull_request?.base?.sha;
  const headSha = args.head ?? event.pull_request?.head?.sha;

  if (!baseSha || !headSha) {
    console.error(
      'Missing base/head commit SHAs. Pass --base and --head, or run inside pull_request GitHub Actions.',
    );
    process.exit(2);
  }

  const result = await evaluatePullRequestRisk({
    title: event.pull_request?.title,
    body: event.pull_request?.body ?? '',
    baseRef: event.pull_request?.base?.ref,
    headRef: event.pull_request?.head?.ref,
    diff: getDiff(baseSha, headSha),
    policy: buildPolicy(args),
  });

  const payload = {
    baseSha,
    headSha,
    decision: result.decision,
    assessment: result.assessment,
    initialAssessment: result.initialAssessment,
    baselineAssessment: result.baselineAssessment,
    trail: result.trail,
    request: result.request,
    toolActivity: result.toolActivity,
  };

  console.log(`Risk gate: ${result.decision.status.toUpperCase()}`);
  console.log(
    `Risk grade: ${result.assessment.riskLevel} | Confidence: ${result.assessment.confidence} | Scope: ${result.assessment.expectedScope}`,
  );
  console.log(
    `Review path: ${result.trail.reviewPath} | Final source: ${
      result.trail.finalModelId ??
      (result.trail.reviewPath === 'policy-exempt'
        ? 'repo policy exemption'
        : 'deterministic fallback')
    }`,
  );

  if (result.decision.reasons.length) {
    console.log(`Gate reasons: ${result.decision.reasons.join(' ')}`);
  }

  if (args.output) {
    writeFileSync(args.output, JSON.stringify(payload, null, 2));
  }

  if (result.decision.status === 'fail') {
    process.exit(1);
  }
}

void main();
