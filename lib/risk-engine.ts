// Deterministic risk engine: pure heuristic scoring with no model dependency.
// This engine serves three roles:
// 1. Safety floor — the fallback when models are unavailable or fail.
// 2. Baseline cross-check — the model prompt includes this assessment so the
//    AI path can agree, disagree, or refine rather than starting from scratch.
// 3. Eval anchor — the fixture eval suite runs against this engine because its
//    output is deterministic and reproducible across runs.
import { normalizeChangeRequest, type ChangeRequest, type EvidenceStrength, type RiskAssessment } from '@/lib/types';

const criticalSignals = [
  { pattern: 'drop', reason: 'The change includes destructive language.' },
  { pattern: 'delete', reason: 'The change includes destructive language.' },
  { pattern: 'truncate', reason: 'The change includes destructive language.' },
  { pattern: 'security group', reason: 'Security group changes can block valid traffic quickly.' },
  { pattern: 'route table', reason: 'Route changes can interrupt east-west or inbound traffic.' },
  { pattern: 'vpc peering', reason: 'Shared-network routing changes can affect multiple services.' },
  { pattern: 'ingress', reason: 'Ingress changes sit directly on user entry paths.' },
  { pattern: 'auth callback', reason: 'Authentication callback changes can break login flows.' },
  { pattern: 'schema migration', reason: 'Schema migrations can impact live writes and reads.' },
];

const elevatedSignals = [
  { pattern: 'database', reason: 'Database involvement raises write-path and rollback sensitivity.' },
  { pattern: 'postgres', reason: 'PostgreSQL changes can affect locks, replication, or query plans.' },
  { pattern: 'redis', reason: 'Cache layer changes can shift consistency and traffic patterns.' },
  { pattern: 'auth', reason: 'Authentication or authorization changes affect critical user flows.' },
  { pattern: 'login', reason: 'Login path changes raise customer-facing impact.' },
  { pattern: 'payments', reason: 'Payments paths have low tolerance for disruption.' },
  { pattern: 'primary database', reason: 'Primary-database work increases write-path sensitivity.' },
  { pattern: 'canary', reason: 'A phased rollout is present, which lowers execution risk.' },
  { pattern: 'feature flag', reason: 'A feature flag improves reversibility.' },
  { pattern: 'existing feature flag', reason: 'An existing flag provides fast rollback.' },
  { pattern: 'concurrent index', reason: 'The plan uses a safer concurrent index strategy.' },
  { pattern: 'daemonset', reason: 'A DaemonSet rollout expands infrastructure surface area across nodes.' },
  { pattern: 'read-only', reason: 'Read-only safeguards reduce blast radius.' },
  { pattern: 'internal users', reason: 'Internal-first rollout reduces exposure.' },
  { pattern: 'copy', reason: 'Copy-only changes usually limit technical blast radius.' },
  { pattern: 'wording', reason: 'Wording-only changes usually limit technical blast radius.' },
  { pattern: 'async', reason: 'Asynchronous processing can reduce direct user impact.' },
];

function escapeForRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function includesPattern(text: string, pattern: string) {
  const normalizedPattern = escapeForRegExp(pattern).replaceAll('\\ ', '\\s+');
  return new RegExp(`\\b${normalizedPattern}\\b`, 'i').test(text);
}

function addUnique(list: string[], value: string) {
  if (value && !list.includes(value)) {
    list.push(value);
  }
}

function buildSignalsUsed(request: ChangeRequest, signalText: string) {
  const signalsUsed: string[] = [];

  if (request.artifactType !== 'unknown') {
    addUnique(signalsUsed, request.artifactType.replace('_', ' '));
  }

  addUnique(signalsUsed, request.environment);

  if (request.category !== 'unknown') {
    addUnique(signalsUsed, request.category);
  }

  if (request.services.length > 0) {
    addUnique(
      signalsUsed,
      request.services.length === 1 ? 'single service scope' : 'multi-service scope',
    );
  }

  if (request.rollbackPlan) {
    addUnique(signalsUsed, 'rollback present');
  }

  if (request.rolloutPlan) {
    addUnique(signalsUsed, 'rollout present');
  }

  if (request.observabilityPlan) {
    addUnique(signalsUsed, 'observability present');
  }

  if (includesPattern(signalText, 'feature flag')) {
    addUnique(signalsUsed, 'feature flag');
  }

  if (includesPattern(signalText, 'canary')) {
    addUnique(signalsUsed, 'canary rollout');
  }

  if (includesPattern(signalText, 'auth') || includesPattern(signalText, 'login')) {
    addUnique(signalsUsed, 'auth');
  }

  if (
    includesPattern(signalText, 'database') ||
    includesPattern(signalText, 'postgres') ||
    includesPattern(signalText, 'schema')
  ) {
    addUnique(signalsUsed, 'database');
  }

  if (
    includesPattern(signalText, 'security group') ||
    includesPattern(signalText, 'route table') ||
    includesPattern(signalText, 'ingress') ||
    includesPattern(signalText, 'vpc')
  ) {
    addUnique(signalsUsed, 'network');
  }

  if (
    includesPattern(signalText, 'drop') ||
    includesPattern(signalText, 'delete') ||
    includesPattern(signalText, 'truncate')
  ) {
    addUnique(signalsUsed, 'destructive operation');
  }

  if (!signalsUsed.length) {
    addUnique(signalsUsed, 'limited scope evidence');
  }

  return signalsUsed;
}

function buildMissingEvidence(
  request: ChangeRequest,
  text: string,
  signalText: string,
  blastRadius: string[],
) {
  const missingEvidence: string[] = [];

  if (!request.services.length) {
    addUnique(missingEvidence, 'affected services not named');
  }

  if (!request.artifactText) {
    addUnique(missingEvidence, 'artifact text missing');
  }

  if (!request.rolloutPlan) {
    addUnique(missingEvidence, 'rollout plan missing');
  }

  if (!request.rollbackPlan) {
    addUnique(missingEvidence, 'rollback path missing');
  }

  if (!request.observabilityPlan) {
    addUnique(missingEvidence, 'observability plan missing');
  }

  if (!request.changeWindow) {
    addUnique(missingEvidence, 'change window unspecified');
  }

  if (
    (
      includesPattern(signalText, 'database') ||
      includesPattern(signalText, 'postgres') ||
      includesPattern(signalText, 'schema') ||
      includesPattern(signalText, 'drop')
    ) &&
    !includesPattern(text, 'rehears') &&
    !includesPattern(text, 'replica rehearsal')
  ) {
    addUnique(missingEvidence, 'backup or restore rehearsal not stated');
  }

  if (
    (
      includesPattern(signalText, 'security group') ||
      includesPattern(signalText, 'route table') ||
      includesPattern(signalText, 'ingress') ||
      includesPattern(signalText, 'vpc')
    ) &&
    !includesPattern(text, 'allowlist')
  ) {
    addUnique(missingEvidence, 'allowlist verification not stated');
  }

  if (
    blastRadius.length === 1 &&
    blastRadius[0]?.toLowerCase().includes('scope is still unclear')
  ) {
    addUnique(missingEvidence, 'blast radius unknown');
  }

  if (request.knownUnknowns && request.knownUnknowns.toLowerCase() !== 'none.') {
    addUnique(missingEvidence, request.knownUnknowns);
  }

  return missingEvidence;
}

function coverageToEvidenceStrength(request: ChangeRequest) {
  const filledSignals = [
    request.summary || request.artifactText,
    request.services.length > 0 ? 'services' : '',
    request.rolloutPlan,
    request.rollbackPlan,
    request.observabilityPlan,
    request.safeguards,
    request.changeWindow,
  ].filter(Boolean).length;
  const narrative = request.summary || request.artifactText;

  if (filledSignals >= 6 && narrative.length >= 80) {
    return 'strong' as EvidenceStrength;
  }

  if (filledSignals >= 4 && narrative.length >= 30) {
    return 'moderate' as EvidenceStrength;
  }

  return 'weak' as EvidenceStrength;
}

function buildBlastRadius(request: ChangeRequest, text: string) {
  const blastRadius: string[] = [];

  if (request.services.length > 0) {
    addUnique(
      blastRadius,
      `Primary touch points: ${request.services.join(', ')}.`,
    );
  }

  if (
    request.category === 'database' ||
    includesPattern(text, 'database') ||
    includesPattern(text, 'postgres') ||
    includesPattern(text, 'schema')
  ) {
    addUnique(
      blastRadius,
      'Application reads and writes that depend on the affected database paths.',
    );
    addUnique(
      blastRadius,
      'Downstream jobs, replicas, or analytics consumers fed by the same schema.',
    );
  }

  if (
    request.category === 'network' ||
    request.category === 'security' ||
    includesPattern(text, 'security group') ||
    includesPattern(text, 'route table') ||
    includesPattern(text, 'ingress') ||
    includesPattern(text, 'load balancer')
  ) {
    addUnique(
      blastRadius,
      'Inbound or east-west traffic for the affected services and adjacent dependencies.',
    );
  }

  if (
    includesPattern(text, 'auth') ||
    includesPattern(text, 'login') ||
    includesPattern(text, 'session')
  ) {
    addUnique(
      blastRadius,
      'User sign-in, session refresh, and privileged access flows.',
    );
  }

  if (includesPattern(text, 'cache') || includesPattern(text, 'redis')) {
    addUnique(
      blastRadius,
      'Latency, consistency, and origin traffic for cached application paths.',
    );
  }

  if (
    request.category === 'observability' ||
    includesPattern(text, 'logging') ||
    includesPattern(text, 'alert')
  ) {
    addUnique(
      blastRadius,
      'Production nodes running the logging agent and the log delivery pipeline.',
    );
    addUnique(
      blastRadius,
      'Incident detection quality, log availability, and on-call visibility.',
    );
  }

  if (blastRadius.length === 0) {
    addUnique(
      blastRadius,
      request.environment === 'production'
        ? 'Production impact is possible, but scope is still unclear.'
        : 'The blast radius is limited by the lack of concrete scope details.',
    );
  }

  return blastRadius;
}

function buildClarifyingQuestions(request: ChangeRequest, evidenceStrength: EvidenceStrength, text: string) {
  const questions: string[] = [];

  if (!request.services.length) {
    questions.push('Which services, tenants, or regions are actually in scope?');
  }

  if (!request.rolloutPlan) {
    questions.push('What is the rollout sequence, and is there a canary or phased step?');
  }

  if (!request.rollbackPlan) {
    questions.push('What is the exact rollback trigger, owner, and time-to-restore target?');
  }

  if (!request.observabilityPlan) {
    questions.push('Which dashboards, alerts, or abort thresholds will confirm success or failure?');
  }

  if (!request.changeWindow) {
    questions.push('When will the change run, and who will be online during the execution window?');
  }

  if (
    includesPattern(text, 'database') ||
    includesPattern(text, 'schema') ||
    includesPattern(text, 'postgres')
  ) {
    questions.push('Have backup, restore, and backward-compatibility checks been rehearsed for the database path?');
  }

  if (
    includesPattern(text, 'security group') ||
    includesPattern(text, 'route table') ||
    includesPattern(text, 'ingress') ||
    includesPattern(text, 'vpc')
  ) {
    questions.push('Do you have a verified allowlist and a last known-good network artifact ready to reapply?');
  }

  if (evidenceStrength === 'weak') {
    questions.push('What exactly is changing at the system boundary, and what customer or operator behavior could move?');
  }

  if (questions.length === 0) {
    questions.push('Have explicit abort thresholds and business owner signoff been confirmed for the chosen window?');
  }

  return questions;
}

function buildRollbackConsiderations(request: ChangeRequest, text: string) {
  const considerations: string[] = [];

  if (request.rollbackPlan) {
    considerations.push(`Use the stated rollback path: ${request.rollbackPlan}`);
  } else {
    considerations.push('Rollback is currently under-specified. Define a reversible path before execution.');
  }

  if (
    includesPattern(text, 'database') ||
    includesPattern(text, 'schema') ||
    includesPattern(text, 'drop')
  ) {
    considerations.push('Confirm backup freshness, backward compatibility, and the fastest practical restore path for data-impacting changes.');
  }

  if (
    includesPattern(text, 'security group') ||
    includesPattern(text, 'route table') ||
    includesPattern(text, 'vpc') ||
    includesPattern(text, 'ingress')
  ) {
    considerations.push('Keep the last known-good infrastructure artifact ready so network controls can be re-applied without rebuilding intent under pressure.');
  }

  if (
    includesPattern(text, 'feature flag') ||
    includesPattern(text, 'canary')
  ) {
    considerations.push('Tie rollback to concrete thresholds so the phased rollout can stop before the blast radius widens.');
  }

  if (!request.observabilityPlan) {
    considerations.push('Define the metrics or synthetic checks that determine whether to continue or abort the rollout.');
  }

  return considerations;
}

function buildExecutiveSummary(
  request: ChangeRequest,
  riskLevel: RiskAssessment['riskLevel'],
  evidenceStrength: EvidenceStrength,
  reasons: string[],
  blastRadius: string[],
) {
  const subject = request.title || 'This change';
  const mainReason =
    reasons[0]?.replace(/\.$/, '') || 'the available evidence is incomplete';
  const mainBlast =
    blastRadius[0]?.replace(/\.$/, '') || 'the likely blast radius is not yet clear';

  if (riskLevel === 'unknown') {
    return `${subject} should be treated as unknown risk because the evidence is ${evidenceStrength}. Proceed only after the missing scope, rollout, and rollback details are defined. Current best estimate suggests impact could involve ${mainBlast.toLowerCase()}.`;
  }

  return `${subject} is currently assessed as ${riskLevel} risk. The strongest signal is that ${mainReason.toLowerCase()}, and the most likely blast radius includes ${mainBlast.toLowerCase()}. Proceed only with the stated rollback path and live monitoring in place.`;
}

export function assessChangeRisk(input: Partial<ChangeRequest>) {
  const request = normalizeChangeRequest(input);
  const narrative = request.summary || request.artifactText;
  const text = [
    request.title,
    narrative,
    request.artifactText,
    request.artifactType,
    request.category,
    request.environment,
    request.services.join(' '),
    request.infrastructureAreas.join(' '),
    request.rolloutPlan,
    request.rollbackPlan,
    request.observabilityPlan,
    request.safeguards,
    request.changeWindow,
    request.knownUnknowns,
  ]
    .join(' ')
    .toLowerCase();
  const signalText = [
    request.title,
    narrative,
    request.artifactText,
    request.artifactType,
    request.category,
    request.environment,
    request.services.join(' '),
    request.infrastructureAreas.join(' '),
    request.rolloutPlan,
    request.safeguards,
    request.changeWindow,
    request.knownUnknowns,
  ]
    .join(' ')
    .toLowerCase();

  let score = 0;
  const reasons: string[] = [];

  const addScore = (points: number, reason: string) => {
    score += points;
    addUnique(reasons, reason);
  };

  if (request.environment === 'production') {
    addScore(18, 'The proposal targets production systems.');
  } else if (request.environment === 'staging') {
    addScore(6, 'The proposal affects a pre-production environment.');
  }

  const categoryWeights: Record<ChangeRequest['category'], number> = {
    application: 8,
    database: 18,
    infrastructure: 10,
    network: 18,
    security: 18,
    delivery: 10,
    observability: 8,
    platform: 14,
    unknown: 10,
  };

  addScore(
    categoryWeights[request.category],
    `${request.category.charAt(0).toUpperCase() + request.category.slice(1)} changes have non-trivial operational risk.`,
  );

  if (request.services.length >= 3) {
    addScore(8, 'Multiple services are in scope, which broadens the blast radius.');
  } else if (request.services.length === 1) {
    addScore(-3, 'The stated scope is concentrated in a single primary service.');
  }

  for (const signal of criticalSignals) {
    if (includesPattern(signalText, signal.pattern)) {
      addScore(15, signal.reason);
    }
  }

  for (const signal of elevatedSignals) {
    if (includesPattern(signalText, signal.pattern)) {
      const points =
        signal.pattern === 'canary' ||
        signal.pattern === 'feature flag' ||
        signal.pattern === 'existing feature flag' ||
        signal.pattern === 'concurrent index' ||
        signal.pattern === 'read-only' ||
        signal.pattern === 'internal users' ||
        signal.pattern === 'copy' ||
        signal.pattern === 'wording' ||
        signal.pattern === 'async'
          ? -6
          : 6;
      addScore(points, signal.reason);
    }
  }

  if (!request.rolloutPlan) {
    addScore(10, 'The rollout sequence is not documented.');
  }

  if (!request.rollbackPlan) {
    addScore(12, 'The rollback path is not documented.');
  }

  if (!request.observabilityPlan) {
    addScore(8, 'The observability plan is missing or vague.');
  }

  if (!request.changeWindow) {
    addScore(4, 'The execution window is not stated.');
  }

  if (!request.services.length) {
    addScore(8, 'The affected services or tenants are not identified.');
  }

  if (narrative.length < 45) {
    addScore(8, 'The proposal summary is too short to establish confidence.');
  }

  const evidenceStrength = coverageToEvidenceStrength(request);
  const hasCriticalSignal = criticalSignals.some(signal =>
    includesPattern(signalText, signal.pattern),
  );

  let riskLevel: RiskAssessment['riskLevel'];

  // Risk tier logic: weak evidence without a critical signal produces 'unknown'
  // rather than a conservative 'medium'. This is intentional — forcing a tier
  // when the evidence cannot support it would undermine trust in the output.
  // Enterprise reviewers need to know when the system genuinely cannot decide.
  if (evidenceStrength === 'weak' && !hasCriticalSignal) {
    riskLevel = 'unknown';
  } else if (score >= 55 || (hasCriticalSignal && request.environment === 'production')) {
    riskLevel = 'high';
  } else if (score >= 28) {
    riskLevel = 'medium';
  } else {
    riskLevel = 'low';
  }

  const blastRadius = buildBlastRadius(request, text);
  const signalsUsed = buildSignalsUsed(request, signalText);
  const missingEvidence = buildMissingEvidence(
    request,
    text,
    signalText,
    blastRadius,
  );
  const clarifyingQuestions = buildClarifyingQuestions(
    request,
    evidenceStrength,
    text,
  );
  const rollbackConsiderations = buildRollbackConsiderations(request, text);
  const executiveSummary = buildExecutiveSummary(
    request,
    riskLevel,
    evidenceStrength,
    reasons,
    blastRadius,
  );

  return {
    riskLevel,
    score,
    evidenceStrength,
    blastRadius,
    signalsUsed,
    missingEvidence,
    reasons,
    clarifyingQuestions,
    rollbackConsiderations,
    executiveSummary,
  } satisfies RiskAssessment;
}
