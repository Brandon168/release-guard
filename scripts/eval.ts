import { loadEnvConfig } from '@next/env';
import { featuredFixtures, sampleFixtures } from '../lib/fixtures';
import {
  getConfiguredReviewModels,
  getModelLabel,
  hasGatewayAccess,
} from '../lib/model';
import {
  reviewChangeRisk,
  type ReviewProgressData,
} from '../lib/review';
import { assessChangeRisk } from '../lib/risk-engine';
import {
  evidenceStrengths,
  riskLevels,
  type ChangeFixture,
  type ChangeReviewResult,
} from '../lib/types';

// Load Next-style env files so local eval runs can exercise the model path
// without requiring the caller to export AI Gateway credentials manually.
loadEnvConfig(process.cwd());

type CheckResult = {
  label: string;
  pass: boolean;
};

type BaselineFixtureRun = {
  fixture: ChangeFixture;
  assessment: ReturnType<typeof assessChangeRisk>;
  checks: CheckResult[];
  passed: boolean;
};

type ModelFixtureRun = {
  fixture: ChangeFixture;
  result: ChangeReviewResult;
  progress: ReviewProgressData[];
  durationMs: number;
  riskMatch: boolean;
  trailIntegrity: boolean;
};

type EvalOptions = {
  runBaseline: boolean;
  runModels: boolean;
  allModelFixtures: boolean;
  strictModels: boolean;
};

// Default mode shows both layers: deterministic baseline first, then a live
// model-path smoke test. The flags let CI stay deterministic or let demos
// focus on the model path only.
function parseOptions(argv: string[]): EvalOptions {
  const flags = new Set(argv);

  return {
    runBaseline: !flags.has('--models-only'),
    runModels: !flags.has('--baseline-only'),
    allModelFixtures: flags.has('--all-model-fixtures'),
    strictModels: flags.has('--strict-models'),
  };
}

function countBy<T extends string>(order: readonly T[], values: readonly T[]) {
  const counts = Object.fromEntries(order.map(value => [value, 0])) as Record<
    T,
    number
  >;

  for (const value of values) {
    counts[value] += 1;
  }

  return counts;
}

function countStrings(values: readonly string[]) {
  const counts: Record<string, number> = {};

  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }

  return counts;
}

function formatCounts<T extends string>(order: readonly T[], counts: Record<T, number>) {
  return order.map(value => `${value}=${counts[value]}`).join(' | ');
}

function formatStringCounts(counts: Record<string, number>) {
  return Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, count]) => `${label}=${count}`)
    .join(' | ');
}

function printHeading(title: string) {
  console.log(title);
  console.log('='.repeat(title.length));
}

function formatDuration(durationMs: number) {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatProgressEvent(event: ReviewProgressData) {
  if (event.stage === 'fallback') {
    return 'fallback';
  }

  if (event.stage === 'done') {
    return event.modelId ? `done:${getModelLabel(event.modelId)}` : 'done';
  }

  return event.modelId
    ? `${event.stage}:${getModelLabel(event.modelId)}`
    : event.stage;
}

function formatProgressDetail(event: ReviewProgressData) {
  const prefix = event.modelId
    ? `${event.label} (${getModelLabel(event.modelId)})`
    : event.label;

  return `${prefix}: ${event.detail}`;
}

function getFinalSourceLabel(result: ChangeReviewResult) {
  return result.trail.finalModelId
    ? getModelLabel(result.trail.finalModelId)
    : 'Deterministic fallback';
}

function hasConsistentTrail(result: ChangeReviewResult) {
  const { trail } = result;

  if (trail.reviewPath === 'primary') {
    return (
      !trail.fallbackUsed &&
      !trail.escalationTriggered &&
      trail.finalModelId === trail.primaryModelId
    );
  }

  if (trail.reviewPath === 'escalated') {
    return (
      !trail.fallbackUsed &&
      trail.escalationTriggered &&
      trail.escalationCompleted &&
      trail.finalModelId === trail.escalationModelId
    );
  }

  if (trail.reviewPath === 'deterministic-fallback') {
    return trail.fallbackUsed && trail.finalModelId === null;
  }

  return true;
}

function buildBaselineRuns() {
  return sampleFixtures.map<BaselineFixtureRun>(fixture => {
    const assessment = assessChangeRisk(fixture.request);
    const blastRadiusText = assessment.blastRadius.join(' ').toLowerCase();

    const checks: CheckResult[] = [
      {
        label: 'risk tier',
        pass: assessment.riskLevel === fixture.expected.riskLevel,
      },
      {
        label: 'blast radius',
        pass: fixture.expected.blastRadiusKeywords.some(keyword =>
          blastRadiusText.includes(keyword.toLowerCase()),
        ),
      },
      {
        label: 'clarifying questions',
        pass:
          assessment.clarifyingQuestions.length >=
          fixture.expected.minimumQuestions,
      },
      {
        label: 'rollback',
        pass:
          !fixture.expected.expectRollbackGuidance ||
          assessment.rollbackConsiderations.length > 0,
      },
      {
        label: 'unknown handling',
        pass:
          !fixture.expected.expectUnknownHandling ||
          (assessment.riskLevel === 'unknown' &&
            assessment.evidenceStrength === 'weak'),
      },
    ];

    return {
      fixture,
      assessment,
      checks,
      passed: checks.every(check => check.pass),
    };
  });
}

function runBaselineEval() {
  const runs = buildBaselineRuns();
  const idWidth = Math.max(...sampleFixtures.map(fixture => fixture.id.length));
  const expectedTierCounts = countBy(
    riskLevels,
    sampleFixtures.map(fixture => fixture.expected.riskLevel),
  );
  const actualTierCounts = countBy(
    riskLevels,
    runs.map(run => run.assessment.riskLevel),
  );
  const evidenceCounts = countBy(
    evidenceStrengths,
    runs.map(run => run.assessment.evidenceStrength),
  );

  const totalChecks = runs.reduce((sum, run) => sum + run.checks.length, 0);
  const passedChecks = runs.reduce(
    (sum, run) => sum + run.checks.filter(check => check.pass).length,
    0,
  );
  const passedFixtures = runs.filter(run => run.passed).length;

  const metaFailures: string[] = [];

  if (sampleFixtures.length !== 12) {
    metaFailures.push(
      `Expected 12 synthetic fixtures for the terminal demo, found ${sampleFixtures.length}.`,
    );
  }

  const missingExpectedTiers = riskLevels.filter(
    level => expectedTierCounts[level] === 0,
  );

  if (missingExpectedTiers.length > 0) {
    metaFailures.push(
      `Fixture coverage is incomplete. Missing tiers: ${missingExpectedTiers.join(', ')}.`,
    );
  }

  printHeading('Deterministic baseline eval');
  console.log(`Fixtures: ${sampleFixtures.length} synthetic fixtures`);
  console.log(
    'Rubric: risk tier, blast radius, clarifying questions, rollback, unknown handling',
  );
  console.log(`Expected tier spread: ${formatCounts(riskLevels, expectedTierCounts)}`);
  console.log('');

  for (const tier of riskLevels) {
    const tierRuns = runs.filter(run => run.fixture.expected.riskLevel === tier);

    if (tierRuns.length === 0) {
      continue;
    }

    console.log(`${tier.toUpperCase()} TIER (${tierRuns.length})`);

    for (const run of tierRuns) {
      const checkSummary = run.checks
        .map(check => `${check.pass ? 'PASS' : 'FAIL'} ${check.label}`)
        .join(' | ');

      console.log(
        `${run.passed ? 'PASS' : 'FAIL'} ${run.fixture.id.padEnd(idWidth)} expected=${run.fixture.expected.riskLevel.padEnd(7)} actual=${run.assessment.riskLevel.padEnd(7)} score=${String(run.assessment.score).padStart(3)} evidence=${run.assessment.evidenceStrength}`,
      );
      console.log(`  ${checkSummary}`);
    }

    console.log('');
  }

  console.log('Summary');
  console.log('-------');
  console.log(`Fixtures passed: ${passedFixtures}/${runs.length}`);
  console.log(`Checks passed: ${passedChecks}/${totalChecks}`);
  console.log(`Observed tier spread: ${formatCounts(riskLevels, actualTierCounts)}`);
  console.log(
    `Evidence spread: ${formatCounts(evidenceStrengths, evidenceCounts)}`,
  );

  const weakUnknowns = runs.filter(
    run =>
      run.assessment.riskLevel === 'unknown' &&
      run.assessment.evidenceStrength === 'weak',
  ).length;

  if (weakUnknowns > 0) {
    console.log(
      `Unknown guardrail: ${weakUnknowns} fixture(s) stayed unknown because the evidence remained weak.`,
    );
  }

  if (metaFailures.length > 0) {
    console.error('\nMeta check failures:');

    for (const failure of metaFailures) {
      console.error(`- ${failure}`);
    }
  }

  if (passedFixtures !== runs.length || metaFailures.length > 0) {
    console.error('\nDeterministic eval failed.');
    return false;
  }

  console.log('\nDeterministic eval passed.');
  return true;
}

async function runModelEval(options: EvalOptions) {
  printHeading('Live review path smoke');

  if (!hasGatewayAccess()) {
    console.log(
      'Skipped: AI Gateway credentials are unavailable after loading .env.local.',
    );
    console.log(
      'Run `pnpm eval --baseline-only` for the deterministic suite only, or export gateway credentials before re-running.',
    );
    return true;
  }

  const fixtures = options.allModelFixtures ? sampleFixtures : featuredFixtures;
  const { primaryModelId, escalationModelId } = getConfiguredReviewModels();
  const idWidth = Math.max(...fixtures.map(fixture => fixture.id.length));

  console.log(
    `Fixtures: ${fixtures.length} ${
      options.allModelFixtures
        ? 'synthetic fixtures through the live review pipeline'
        : 'featured fixtures spanning low, medium, high, and unknown'
    }`,
  );
  console.log(
    `Configured models: primary=${getModelLabel(primaryModelId)} | escalation=${getModelLabel(escalationModelId)}`,
  );
  console.log(
    'This section is informational by default. Use `--strict-models` if you want model mismatches or fallbacks to fail the command.',
  );
  console.log('');

  // Stream fixture progress as it happens so terminal demos do not sit silent
  // while the primary model or escalation model is running.
  const runs: ModelFixtureRun[] = [];

  for (const fixture of fixtures) {
    const progress: ReviewProgressData[] = [];
    console.log(
      `RUN  ${fixture.id.padEnd(idWidth)} expected=${fixture.expected.riskLevel} title="${fixture.title}"`,
    );
    const startedAt = Date.now();
    const result = await reviewChangeRisk(fixture.request, {
      onProgress: event => {
        progress.push(event);
        console.log(`  -> ${formatProgressDetail(event)}`);
      },
    });
    const durationMs = Date.now() - startedAt;

    runs.push({
      fixture,
      result,
      progress,
      durationMs,
      riskMatch: result.assessment.riskLevel === fixture.expected.riskLevel,
      trailIntegrity: hasConsistentTrail(result),
    });
  }

  for (const run of runs) {
    const finalSource = getFinalSourceLabel(run.result);
    const status =
      run.riskMatch &&
      run.trailIntegrity &&
      !run.result.trail.fallbackUsed
        ? 'PASS'
        : 'WARN';

    console.log(
      `${status} ${run.fixture.id.padEnd(idWidth)} expected=${run.fixture.expected.riskLevel.padEnd(7)} final=${run.result.assessment.riskLevel.padEnd(7)} path=${run.result.trail.reviewPath.padEnd(22)} source=${finalSource}`,
    );
    console.log(
      `  primary=${getModelLabel(run.result.trail.primaryModelId)} | final=${finalSource} | duration=${formatDuration(run.durationMs)}`,
    );

    if (run.result.initialAssessment) {
      console.log(
        `  initial judgment=${run.result.initialAssessment.riskLevel} (${run.result.initialAssessment.confidence})`,
      );
    }

    if (run.result.trail.escalationTriggered) {
      console.log(
        `  escalation=${getModelLabel(run.result.trail.escalationModelId)} | reason=${run.result.trail.escalationReason ?? 'uncertain first pass'}`,
      );
    } else {
      console.log('  escalation=not used');
    }

    if (run.result.trail.fallbackUsed && run.result.trail.fallbackReason) {
      console.log(`  fallback reason=${run.result.trail.fallbackReason}`);
    }

    if (run.progress.length > 0) {
      console.log(
        `  events: ${run.progress.map(event => formatProgressEvent(event)).join(' -> ')}`,
      );
    }
  }

  const reviewPathCounts = countStrings(
    runs.map(run => run.result.trail.reviewPath),
  );
  const finalSourceCounts = countStrings(
    runs.map(run => getFinalSourceLabel(run.result)),
  );
  const riskMatches = runs.filter(run => run.riskMatch).length;
  const trailIntegrityPasses = runs.filter(run => run.trailIntegrity).length;
  const fallbackCount = runs.filter(run => run.result.trail.fallbackUsed).length;
  const durations = runs.map(run => run.durationMs);
  const totalDurationMs = durations.reduce((sum, value) => sum + value, 0);
  const averageDurationMs =
    durations.length > 0 ? totalDurationMs / durations.length : 0;

  console.log('');
  console.log('Summary');
  console.log('-------');
  console.log(`Risk matches: ${riskMatches}/${runs.length}`);
  console.log(`Trail integrity: ${trailIntegrityPasses}/${runs.length}`);
  console.log(`Review paths: ${formatStringCounts(reviewPathCounts)}`);
  console.log(`Final sources: ${formatStringCounts(finalSourceCounts)}`);
  console.log(
    `Latency: avg=${formatDuration(averageDurationMs)} total=${formatDuration(totalDurationMs)}`,
  );

  if (fallbackCount > 0) {
    console.log(
      `Fallbacks observed: ${fallbackCount}. The deterministic safety floor took over for those runs.`,
    );
  }

  const modelSectionPassed =
    riskMatches === runs.length &&
    trailIntegrityPasses === runs.length &&
    fallbackCount === 0;

  if (!options.strictModels) {
    console.log('\nModel smoke complete.');
    return true;
  }

  if (!modelSectionPassed) {
    console.error('\nStrict model smoke failed.');
    return false;
  }

  console.log('\nStrict model smoke passed.');
  return true;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  let passed = true;

  if (options.runBaseline) {
    passed = runBaselineEval() && passed;
  }

  if (options.runModels) {
    if (options.runBaseline) {
      console.log('');
    }

    passed = (await runModelEval(options)) && passed;
  }

  if (!passed) {
    process.exit(1);
  }
}

void main();
