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

export function hasGatewayAccess() {
  return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL);
}

export function isGatewayModelId(value: string): value is GatewayModelId {
  return gatewayModelIds.has(value as GatewayModelId);
}

export function getConfiguredReviewModels() {
  const primaryModelId = process.env.RISK_PRIMARY_MODEL?.trim();
  const escalationModelId = process.env.RISK_ESCALATION_MODEL?.trim();

  if (!primaryModelId) {
    throw new Error('Missing required env var: RISK_PRIMARY_MODEL');
  }

  if (!isGatewayModelId(primaryModelId)) {
    throw new Error(
      `Invalid RISK_PRIMARY_MODEL: ${primaryModelId}. Expected one of: ${REVIEW_MODEL_OPTIONS.map(option => option.id).join(', ')}`,
    );
  }

  if (!escalationModelId) {
    throw new Error('Missing required env var: RISK_ESCALATION_MODEL');
  }

  if (!isGatewayModelId(escalationModelId)) {
    throw new Error(
      `Invalid RISK_ESCALATION_MODEL: ${escalationModelId}. Expected one of: ${REVIEW_MODEL_OPTIONS.map(option => option.id).join(', ')}`,
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
