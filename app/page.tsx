import { ChangeRiskWorkbench } from '@/components/change-risk-workbench';
import { getConfiguredReviewModels } from '@/lib/model';

// Thin entrypoint: resolve the configured models and hand off to the workbench.
export default function Page() {
  const { primaryModelId, escalationModelId } = getConfiguredReviewModels();

  return (
    <ChangeRiskWorkbench
      primaryModelId={primaryModelId}
      escalationModelId={escalationModelId}
    />
  );
}
