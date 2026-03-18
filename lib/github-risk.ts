import { buildChangeRequestFromDraft } from '@/lib/artifact-ingestion';
import { buildGitHubCommentBody } from '@/lib/github-comment';
import {
  isNonRuntimePath,
  loadRepoRiskPolicy,
} from '@/lib/repo-risk-policy';
import {
  evaluateRiskPolicy,
  type RiskDecision,
  type RiskPolicy,
} from '@/lib/risk-policy';
import { reviewChangeRisk } from '@/lib/review';
import type {
  ChangeRequest,
  ChangeReviewResult,
  ReviewAssessment,
  RiskAssessment,
} from '@/lib/types';

export type GitHubChangedFile = {
  filename: string;
  status?: string;
  additions?: number;
  deletions?: number;
  patch?: string;
};

export type PullRequestRiskInput = {
  title?: string;
  body?: string;
  baseRef?: string;
  headRef?: string;
  diff?: string;
  files?: GitHubChangedFile[];
  overrides?: Partial<ChangeRequest>;
  policy?: Partial<RiskPolicy>;
};

export type PullRequestRiskResult = {
  artifactText: string;
  request: ChangeRequest;
  assessment: ChangeReviewResult['assessment'];
  initialAssessment: ChangeReviewResult['initialAssessment'];
  baselineAssessment: ChangeReviewResult['baselineAssessment'];
  trail: ChangeReviewResult['trail'];
  toolActivity: ChangeReviewResult['toolActivity'];
  decision: RiskDecision;
  commentBody: string;
};

function renderFileSummary(files: GitHubChangedFile[]) {
  if (!files.length) {
    return '';
  }

  return files
    .map(file => {
      const counts =
        typeof file.additions === 'number' || typeof file.deletions === 'number'
          ? ` (+${file.additions ?? 0}/-${file.deletions ?? 0})`
          : '';
      const status = file.status ? ` [${file.status}]` : '';

      return `- ${file.filename}${counts}${status}`;
    })
    .join('\n');
}

function renderFilePatches(files: GitHubChangedFile[]) {
  const withPatch = files.filter(file => file.patch?.trim());

  if (!withPatch.length) {
    return '';
  }

  return withPatch
    .map(file => [`File: ${file.filename}`, file.patch?.trim() ?? ''].join('\n'))
    .join('\n\n');
}

function extractDiffFilenames(diff: string) {
  return [...diff.matchAll(/^diff --git a\/(.+?) b\/.+$/gm)]
    .map(match => match[1]?.trim() ?? '')
    .filter(Boolean);
}

function collectChangedFilenames(input: PullRequestRiskInput) {
  const filenames = [
    ...(input.files ?? []).map(file => file.filename.trim()).filter(Boolean),
    ...(input.diff ? extractDiffFilenames(input.diff) : []),
  ];

  return [...new Set(filenames)];
}

function buildPolicyExemptAssessment(changedFiles: string[]): {
  baselineAssessment: RiskAssessment;
  assessment: ReviewAssessment;
} {
  const scopeSummary =
    changedFiles.length === 1
      ? `Only ${changedFiles[0]} changed, and repo policy marks it as non-runtime.`
      : `Only non-runtime files changed: ${changedFiles.join(', ')}.`;
  const reason =
    'All changed files match repo-defined non-runtime paths or extensions, so operational rollout and rollback requirements do not apply.';
  const rollbackNote =
    'Operational rollback is not required for repo-defined non-runtime changes; a normal git revert is sufficient if the content should be undone.';

  return {
    baselineAssessment: {
      riskLevel: 'low',
      score: 0,
      evidenceStrength: 'strong',
      blastRadius: ['Non-runtime documentation-only scope.'],
      signalsUsed: ['repo policy exemption', 'non-runtime files only'],
      missingEvidence: [],
      reasons: [reason],
      clarifyingQuestions: [],
      rollbackConsiderations: [rollbackNote],
      executiveSummary:
        'The PR only changes repo-defined non-runtime files, so it should bypass operational change-risk requirements.',
    },
    assessment: {
      riskLevel: 'low',
      confidence: 'strong',
      expectedScope: 'narrow',
      scopeSummary,
      reasoning: [reason],
      missingInfo: [],
      rollbackConsiderations: [rollbackNote],
      recommendedAction: 'approve',
      executiveSummary:
        'Repo policy exempts this PR from operational risk review because the changed files are non-runtime only.',
    },
  };
}

export function buildPullRequestArtifactText(input: PullRequestRiskInput) {
  const sections = [
    input.title?.trim() ? `Pull request title: ${input.title.trim()}` : '',
    input.body?.trim() ? `Pull request body:\n${input.body.trim()}` : '',
    input.baseRef?.trim() ? `Base ref: ${input.baseRef.trim()}` : '',
    input.headRef?.trim() ? `Head ref: ${input.headRef.trim()}` : '',
  ].filter(Boolean);

  const fileSummary = renderFileSummary(input.files ?? []);

  if (fileSummary) {
    sections.push(`Changed files:\n${fileSummary}`);
  }

  const renderedPatches = renderFilePatches(input.files ?? []);

  if (renderedPatches) {
    sections.push(`GitHub file patches:\n${renderedPatches}`);
  }

  if (input.diff?.trim()) {
    sections.push(`Git diff:\n${input.diff.trim()}`);
  }

  return sections.join('\n\n').trim();
}

export async function evaluatePullRequestRisk(
  input: PullRequestRiskInput,
): Promise<PullRequestRiskResult> {
  const artifactText = buildPullRequestArtifactText(input);
  const changedFiles = collectChangedFilenames(input);
  const request = buildChangeRequestFromDraft({
    artifact: {
      title: input.title,
      artifactType: 'pr_diff',
      artifactText,
    },
    overrides: input.overrides,
  });
  const repoPolicy = await loadRepoRiskPolicy();

  if (
    changedFiles.length > 0 &&
    repoPolicy.available &&
    changedFiles.every(filename => isNonRuntimePath(filename, repoPolicy))
  ) {
    const { baselineAssessment, assessment } =
      buildPolicyExemptAssessment(changedFiles);
    const decision = evaluateRiskPolicy({
      assessment,
      trail: {
        reviewPath: 'policy-exempt',
        gatewayAvailable: false,
        primaryModelId: null,
        escalationModelId: null,
        finalModelId: null,
        escalationTriggered: false,
        escalationCompleted: false,
        escalationReason: null,
        fallbackUsed: false,
        fallbackReason: repoPolicy.sourceFile
          ? `Matched non-runtime PR exemption rules from ${repoPolicy.sourceFile}.`
          : 'Matched non-runtime PR exemption rules from repo policy.',
      },
      policy: input.policy,
    });

    return {
      artifactText,
      request,
      assessment,
      initialAssessment: null,
      baselineAssessment,
      trail: {
        reviewPath: 'policy-exempt',
        gatewayAvailable: false,
        primaryModelId: null,
        escalationModelId: null,
        finalModelId: null,
        escalationTriggered: false,
        escalationCompleted: false,
        escalationReason: null,
        fallbackUsed: false,
        fallbackReason: repoPolicy.sourceFile
          ? `Matched non-runtime PR exemption rules from ${repoPolicy.sourceFile}.`
          : 'Matched non-runtime PR exemption rules from repo policy.',
      },
      toolActivity: [],
      decision: {
        ...decision,
        summary: 'PR is within the configured risk policy.',
        reasons: [
          `Skipped operational review because only repo-defined non-runtime files changed: ${changedFiles.join(', ')}.`,
        ],
      },
      commentBody: buildGitHubCommentBody({
        decision: {
          ...decision,
          summary: 'PR is within the configured risk policy.',
          reasons: [
            `Skipped operational review because only repo-defined non-runtime files changed: ${changedFiles.join(', ')}.`,
          ],
        },
        assessment,
        trail: {
          reviewPath: 'policy-exempt',
          gatewayAvailable: false,
          primaryModelId: null,
          escalationModelId: null,
          finalModelId: null,
          escalationTriggered: false,
          escalationCompleted: false,
          escalationReason: null,
          fallbackUsed: false,
          fallbackReason: repoPolicy.sourceFile
            ? `Matched non-runtime PR exemption rules from ${repoPolicy.sourceFile}.`
            : 'Matched non-runtime PR exemption rules from repo policy.',
        },
      }),
    };
  }

  const review = await reviewChangeRisk(request);
  const decision = evaluateRiskPolicy({
    assessment: review.assessment,
    trail: review.trail,
    policy: input.policy,
  });

  return {
    artifactText,
    request,
    assessment: review.assessment,
    initialAssessment: review.initialAssessment,
    baselineAssessment: review.baselineAssessment,
    trail: review.trail,
    toolActivity: review.toolActivity,
    decision,
    commentBody: buildGitHubCommentBody({
      decision,
      assessment: review.assessment,
      trail: review.trail,
    }),
  };
}
