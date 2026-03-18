import { ChangeRiskWorkbench } from '@/components/change-risk-workbench';
import { getConfiguredReviewModels } from '@/lib/model';

export default function Page() {
  const { primaryModelId, escalationModelId } = getConfiguredReviewModels();

  return (
    <ChangeRiskWorkbench
      primaryModelId={primaryModelId}
      escalationModelId={escalationModelId}
    />
  );
}
