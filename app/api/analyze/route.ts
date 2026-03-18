import {
  createUIMessageStream,
  createUIMessageStreamResponse,
} from 'ai';
import type { AnalysisUIMessage } from '@/lib/analysis-ui-message';
import { buildGitHubCommentBody } from '@/lib/github-comment';
import { getFixtureById } from '@/lib/fixtures';
import {
  evaluatePullRequestRisk,
  type GitHubChangedFile,
} from '@/lib/github-risk';
import {
  buildDeterministicFallbackReview,
  buildReviewReport,
  reviewChangeRisk,
} from '@/lib/review';
import { evaluateRiskPolicy } from '@/lib/risk-policy';
import { normalizeChangeRequest, type ChangeRequest } from '@/lib/types';
import {
  chunkText,
  createGitHubPreviewChunk,
  createProgressChunk,
  createTextResponse,
} from '@/lib/ui-stream';

export const maxDuration = 30;

type AnalyzeRequestBody = {
  messages?: AnalysisUIMessage[];
  request?: Partial<ChangeRequest>;
  fixtureId?: string;
  pipeline?: {
    simulateModelFallback?: boolean;
  };
  github?: {
    title?: string;
    body?: string;
    baseRef?: string;
    headRef?: string;
    diff?: string;
    files?: GitHubChangedFile[];
  };
};

function extractLatestUserText(messages: AnalysisUIMessage[] = []) {
  const latestUserMessage = [...messages].reverse().find(
    message => message.role === 'user',
  );

  if (!latestUserMessage) {
    return '';
  }

  return latestUserMessage.parts
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join(' ')
    .trim();
}

export async function POST(req: Request) {
  let body: AnalyzeRequestBody;

  try {
    body = (await req.json()) as AnalyzeRequestBody;
  } catch {
    const request = normalizeChangeRequest({});
    const reviewResult = buildDeterministicFallbackReview({
      request,
      fallbackReason: 'The request body could not be parsed.',
    });

    return createTextResponse({
      text: buildReviewReport(reviewResult),
      reviewResult,
    });
  }

  const originalMessages = Array.isArray(body.messages) ? body.messages : [];
  const fixture =
    typeof body.fixtureId === 'string' ? getFixtureById(body.fixtureId) : undefined;
  const latestUserText = extractLatestUserText(originalMessages);
  const simulateModelFallback = body.pipeline?.simulateModelFallback === true;

  const request = normalizeChangeRequest({
    ...fixture?.request,
    ...body.request,
    summary:
      body.request?.summary?.trim() ||
      latestUserText ||
      fixture?.request.summary ||
      '',
  });

  const stream = createUIMessageStream<AnalysisUIMessage>({
    originalMessages,
    execute: async ({ writer }) => {
      let reviewResult;
      let githubPreview;

      try {
        if (body.github) {
          const githubResult = await evaluatePullRequestRisk({
            ...body.github,
            overrides: request,
            simulateModelFallback,
          });
          reviewResult = {
            baselineAssessment: githubResult.baselineAssessment,
            initialAssessment: githubResult.initialAssessment,
            assessment: githubResult.assessment,
            trail: githubResult.trail,
            toolActivity: githubResult.toolActivity,
          };
          githubPreview = {
            decision: githubResult.decision,
            commentBody: githubResult.commentBody,
          };
        } else {
          reviewResult = await reviewChangeRisk(request, {
            onProgress: progress => {
              writer.write(createProgressChunk(progress));
            },
            simulateModelFallback,
          });
          const decision = evaluateRiskPolicy({
            assessment: reviewResult.assessment,
            trail: reviewResult.trail,
          });
          githubPreview = {
            decision,
            commentBody: buildGitHubCommentBody({
              decision,
              assessment: reviewResult.assessment,
              trail: reviewResult.trail,
            }),
          };
        }
      } catch {
        reviewResult = buildDeterministicFallbackReview({
          request,
          fallbackReason: 'The model pipeline failed before a review could be completed.',
        });
        const decision = evaluateRiskPolicy({
          assessment: reviewResult.assessment,
          trail: reviewResult.trail,
        });
        githubPreview = {
          decision,
          commentBody: buildGitHubCommentBody({
            decision,
            assessment: reviewResult.assessment,
            trail: reviewResult.trail,
          }),
        };
      }

      const report = buildReviewReport(reviewResult);

      writer.write({
        type: 'data-review-result',
        data: reviewResult,
        transient: true,
      });
      writer.write(createGitHubPreviewChunk(githubPreview));
      writer.write({ type: 'start' });
      writer.write({ type: 'start-step' });
      writer.write({ type: 'text-start', id: 'text-1' });

      for (const chunk of chunkText(report)) {
        writer.write({
          type: 'text-delta',
          id: 'text-1',
          delta: chunk,
        });
        await Promise.resolve();
      }

      writer.write({ type: 'text-end', id: 'text-1' });
      writer.write({ type: 'finish-step' });
      writer.write({ type: 'finish' });
    },
  });

  return createUIMessageStreamResponse({ stream });
}
