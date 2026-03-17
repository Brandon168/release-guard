import {
  createUIMessageStream,
  createUIMessageStreamResponse,
} from 'ai';
import type { AnalysisUIMessage } from '@/lib/analysis-ui-message';
import { getFixtureById } from '@/lib/fixtures';
import {
  buildDeterministicFallbackReview,
  buildReviewReport,
  reviewChangeRisk,
} from '@/lib/review';
import { normalizeChangeRequest, type ChangeRequest } from '@/lib/types';
import { chunkText, createTextResponse, createProgressChunk } from '@/lib/ui-stream';

export const maxDuration = 30;

type AnalyzeRequestBody = {
  messages?: AnalysisUIMessage[];
  request?: Partial<ChangeRequest>;
  fixtureId?: string;
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

      try {
        reviewResult = await reviewChangeRisk(request, {
          onProgress: progress => {
            writer.write(createProgressChunk(progress));
          },
        });
      } catch {
        reviewResult = buildDeterministicFallbackReview({
          request,
          fallbackReason: 'The model pipeline failed before a review could be completed.',
        });
      }

      const report = buildReviewReport(reviewResult);

      writer.write({
        type: 'data-review-result',
        data: reviewResult,
        transient: true,
      });
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
