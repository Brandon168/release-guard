import {
  createUIMessageStream,
  createUIMessageStreamResponse,
} from 'ai';
import type { AnalysisUIMessage } from '@/lib/analysis-ui-message';
import type { ReviewProgressData } from '@/lib/review';
import type { ChangeReviewResult } from '@/lib/types';

export function chunkText(text: string, size = 120) {
  const chunks: string[] = [];

  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }

  return chunks.length > 0 ? chunks : [''];
}

export function createTextResponse({
  text,
  reviewResult,
  originalMessages,
}: {
  text: string;
  reviewResult: ChangeReviewResult;
  originalMessages?: AnalysisUIMessage[];
}) {
  const stream = createUIMessageStream<AnalysisUIMessage>({
    originalMessages,
    execute: async ({ writer }) => {
      writer.write({
        type: 'data-review-result',
        data: reviewResult,
        transient: true,
      });
      writer.write({ type: 'start' });
      writer.write({ type: 'start-step' });
      writer.write({ type: 'text-start', id: 'text-1' });

      for (const chunk of chunkText(text)) {
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

export function createProgressChunk(progress: ReviewProgressData) {
  return {
    type: 'data-review-progress' as const,
    data: progress,
    transient: true,
  };
}
