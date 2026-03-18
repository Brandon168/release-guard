import { gateway } from 'ai';

export const REVIEW_MODEL_OPTIONS = [
  {
    id: 'amazon/nova-micro',
    label: 'Amazon Nova Micro',
    summary: 'Ultra-cheap first pass for straightforward changes.',
  },
  {
    id: 'google/gemini-3-flash',
    label: 'Gemini 3 Flash',
    summary: 'Escalation model for ambiguous changes and long artifacts.',
  },
  {
    id: 'openai/gpt-5.4-mini',
    label: 'GPT-5.4 mini',
    summary: 'Balanced fallback option when you want stronger default quality.',
  },
] as const;

export type GatewayModelId = (typeof REVIEW_MODEL_OPTIONS)[number]['id'];

const gatewayModelIds = new Set<GatewayModelId>(
  REVIEW_MODEL_OPTIONS.map(option => option.id),
);

const DEFAULT_PRIMARY_MODEL: GatewayModelId = 'amazon/nova-micro';
const DEFAULT_ESCALATION_MODEL: GatewayModelId = 'google/gemini-3-flash';

export function hasGatewayAccess() {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL);
}

export function isGatewayModelId(value: string): value is GatewayModelId {
  return gatewayModelIds.has(value as GatewayModelId);
}

export function getConfiguredReviewModels() {
  const configuredPrimaryModelId = process.env.RISK_PRIMARY_MODEL?.trim();
  const configuredEscalationModelId = process.env.RISK_ESCALATION_MODEL?.trim();
  const allowedIds = REVIEW_MODEL_OPTIONS.map(option => option.id).join(', ');

  const primaryModelId =
    configuredPrimaryModelId && isGatewayModelId(configuredPrimaryModelId)
      ? configuredPrimaryModelId
      : DEFAULT_PRIMARY_MODEL;
  const escalationModelId =
    configuredEscalationModelId && isGatewayModelId(configuredEscalationModelId)
      ? configuredEscalationModelId
      : DEFAULT_ESCALATION_MODEL;

  if (configuredPrimaryModelId && !isGatewayModelId(configuredPrimaryModelId)) {
    console.warn(
      `Invalid RISK_PRIMARY_MODEL: ${configuredPrimaryModelId}. Falling back to ${DEFAULT_PRIMARY_MODEL}. Expected one of: ${allowedIds}`,
    );
  }

  if (
    configuredEscalationModelId &&
    !isGatewayModelId(configuredEscalationModelId)
  ) {
    console.warn(
      `Invalid RISK_ESCALATION_MODEL: ${configuredEscalationModelId}. Falling back to ${DEFAULT_ESCALATION_MODEL}. Expected one of: ${allowedIds}`,
    );
  }

  return {
    primaryModelId,
    escalationModelId,
  };
}

export function getModelLabel(modelId: string | null) {
  if (!modelId) {
    return 'Deterministic fallback';
  }

  return (
    REVIEW_MODEL_OPTIONS.find(option => option.id === modelId)?.label ?? modelId
  );
}

export function getGatewayModel(modelId: GatewayModelId) {
  return gateway(modelId);
}
