import type { UIMessage } from 'ai';
import type { ReviewProgressData } from '@/lib/review';
import type { ChangeReviewResult } from '@/lib/types';

export type AnalysisUIMessage = UIMessage<
  never,
  {
    'review-progress': ReviewProgressData;
    'review-result': ChangeReviewResult;
  },
  never
>;
