import { z } from 'zod';

export const riskLevels = ['low', 'medium', 'high', 'unknown'] as const;
export type RiskLevel = (typeof riskLevels)[number];

export const evidenceStrengths = ['weak', 'moderate', 'strong'] as const;
export type EvidenceStrength = (typeof evidenceStrengths)[number];

export const expectedScopes = ['narrow', 'moderate', 'broad', 'unclear'] as const;
export type ExpectedScope = (typeof expectedScopes)[number];

export const recommendedActions = [
  'approve',
  'review',
  'block',
  'need-more-info',
] as const;
export type RecommendedAction = (typeof recommendedActions)[number];

export const artifactTypes = [
  'pr_diff',
  'terraform_plan',
  'change_ticket',
  'release_note',
  'config_change',
  'unknown',
] as const;

export type ArtifactType = (typeof artifactTypes)[number];

export const changeCategories = [
  'application',
  'database',
  'infrastructure',
  'network',
  'security',
  'delivery',
  'observability',
  'platform',
  'unknown',
] as const;

export type ChangeCategory = (typeof changeCategories)[number];

export const environments = [
  'development',
  'staging',
  'production',
  'unknown',
] as const;

export type Environment = (typeof environments)[number];

export const changeCategoryLabels: Record<ChangeCategory, string> = {
  application: 'Application',
  database: 'Database',
  infrastructure: 'Infrastructure',
  network: 'Network',
  security: 'Security',
  delivery: 'Delivery',
  observability: 'Observability',
  platform: 'Platform',
  unknown: 'Unknown / Mixed',
};

export const environmentLabels: Record<Environment, string> = {
  development: 'Development',
  staging: 'Staging',
  production: 'Production',
  unknown: 'Unknown',
};

export const artifactTypeLabels: Record<ArtifactType, string> = {
  pr_diff: 'PR Diff',
  terraform_plan: 'Terraform Plan',
  change_ticket: 'Change Ticket',
  release_note: 'Release Note',
  config_change: 'Config Change',
  unknown: 'Unknown',
};

export const changeRequestSchema = z.object({
  title: z.string().default(''),
  summary: z.string().default(''),
  artifactType: z.enum(artifactTypes).default('unknown'),
  artifactText: z.string().default(''),
  category: z.enum(changeCategories).default('unknown'),
  environment: z.enum(environments).default('unknown'),
  services: z.array(z.string()).default([]),
  infrastructureAreas: z.array(z.string()).default([]),
  rolloutPlan: z.string().default(''),
  rollbackPlan: z.string().default(''),
  observabilityPlan: z.string().default(''),
  safeguards: z.string().default(''),
  changeWindow: z.string().default(''),
  knownUnknowns: z.string().default(''),
});

export type ChangeRequest = z.infer<typeof changeRequestSchema>;

export type RiskAssessment = {
  riskLevel: RiskLevel;
  score: number;
  evidenceStrength: EvidenceStrength;
  blastRadius: string[];
  signalsUsed: string[];
  missingEvidence: string[];
  reasons: string[];
  clarifyingQuestions: string[];
  rollbackConsiderations: string[];
  executiveSummary: string;
};

export const reviewAssessmentSchema = z
  .object({
    riskLevel: z.enum(riskLevels),
    confidence: z.enum(evidenceStrengths),
    expectedScope: z.enum(expectedScopes),
    scopeSummary: z.string().min(1),
    reasoning: z.array(z.string().min(1)).min(1),
    missingInfo: z.array(z.string().min(1)).default([]),
    rollbackConsiderations: z.array(z.string().min(1)).default([]),
    recommendedAction: z.enum(recommendedActions),
    executiveSummary: z.string().min(1),
  })
  .transform(assessment => ({
    ...assessment,
    reasoning: assessment.reasoning.slice(0, 5),
    missingInfo: assessment.missingInfo.slice(0, 5),
    rollbackConsiderations: assessment.rollbackConsiderations.slice(0, 5),
  }));

export type ReviewAssessment = z.infer<typeof reviewAssessmentSchema>;

export type ReviewPath =
  | 'primary'
  | 'escalated'
  | 'deterministic-fallback'
  | 'policy-exempt';

export type ReviewTrail = {
  reviewPath: ReviewPath;
  gatewayAvailable: boolean;
  primaryModelId: string | null;
  escalationModelId: string | null;
  finalModelId: string | null;
  escalationTriggered: boolean;
  escalationCompleted: boolean;
  escalationReason: string | null;
  fallbackUsed: boolean;
  fallbackReason: string | null;
};

export type ReviewToolActivity = {
  stage: 'primary' | 'escalation';
  toolName: string;
  summary: string;
};

export type ChangeReviewResult = {
  baselineAssessment: RiskAssessment;
  initialAssessment: ReviewAssessment | null;
  assessment: ReviewAssessment;
  trail: ReviewTrail;
  toolActivity: ReviewToolActivity[];
};

export type EvaluationExpectation = {
  riskLevel: RiskLevel;
  blastRadiusKeywords: string[];
  minimumQuestions: number;
  expectRollbackGuidance: boolean;
  expectUnknownHandling?: boolean;
};

export type ChangeFixture = {
  id: string;
  title: string;
  description: string;
  request: ChangeRequest;
  expected: EvaluationExpectation;
};

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function firstMeaningfulLine(value: string) {
  return value
    .split('\n')
    .map(line => line.trim())
    .find(Boolean);
}

function cleanList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(entry => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

export function normalizeChangeRequest(
  input: Partial<ChangeRequest> = {},
): ChangeRequest {
  const parsed = changeRequestSchema.parse(input);
  const summary = cleanText(parsed.summary);
  const artifactText = cleanText(parsed.artifactText);
  const title =
    cleanText(parsed.title) ||
    firstMeaningfulLine(summary) ||
    firstMeaningfulLine(artifactText) ||
    summary.slice(0, 80) ||
    artifactText.slice(0, 80) ||
    'Untitled change';

  return {
    title,
    summary,
    artifactType: parsed.artifactType,
    artifactText,
    category: parsed.category,
    environment: parsed.environment,
    services: cleanList(parsed.services),
    infrastructureAreas: cleanList(parsed.infrastructureAreas),
    rolloutPlan: cleanText(parsed.rolloutPlan),
    rollbackPlan: cleanText(parsed.rollbackPlan),
    observabilityPlan: cleanText(parsed.observabilityPlan),
    safeguards: cleanText(parsed.safeguards),
    changeWindow: cleanText(parsed.changeWindow),
    knownUnknowns: cleanText(parsed.knownUnknowns),
  };
}
