import { sampleFixtures } from '../lib/fixtures';
import { assessChangeRisk } from '../lib/risk-engine';

type CheckResult = {
  label: string;
  pass: boolean;
};

let failureCount = 0;

for (const fixture of sampleFixtures) {
  const assessment = assessChangeRisk(fixture.request);
  const blastRadiusText = assessment.blastRadius.join(' ').toLowerCase();

  const checks: CheckResult[] = [
    {
      label: 'risk level',
      pass: assessment.riskLevel === fixture.expected.riskLevel,
    },
    {
      label: 'blast radius hint',
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
      label: 'rollback guidance',
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

  const fixturePassed = checks.every(check => check.pass);

  if (!fixturePassed) {
    failureCount += 1;
  }

  const summary = checks
    .map(check => `${check.pass ? 'PASS' : 'FAIL'} ${check.label}`)
    .join(' | ');

  console.log(
    `${fixturePassed ? 'PASS' : 'FAIL'} ${fixture.id} -> ${assessment.riskLevel} (${assessment.evidenceStrength})`,
  );
  console.log(`  ${summary}`);
}

if (failureCount > 0) {
  console.error(`\n${failureCount} fixture(s) failed the heuristic eval.`);
  process.exit(1);
}

console.log(`\nAll ${sampleFixtures.length} fixture evaluations passed.`);
