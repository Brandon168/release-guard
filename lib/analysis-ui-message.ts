import type { UIMessage } from 'ai';
import type { GitHubPreviewData } from '@/lib/github-comment';
import type { ReviewProgressData } from '@/lib/review';
import type { ChangeReviewResult } from '@/lib/types';

export type AnalysisUIMessage = UIMessage<
  never,
  {
    'github-preview': GitHubPreviewData;
    'review-progress': ReviewProgressData;
    'review-result': ChangeReviewResult;
  },
  never
>;
