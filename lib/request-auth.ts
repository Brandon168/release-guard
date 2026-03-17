import { timingSafeEqual } from 'node:crypto';

function safeCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function hasRiskApiAccess(req: Request) {
  const expectedToken = process.env.RISK_API_KEY?.trim();

  if (!expectedToken) {
    return true;
  }

  const authorization = req.headers.get('authorization');
  const bearerToken = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : null;
  const headerToken = req.headers.get('x-risk-api-key')?.trim() ?? null;
  const providedToken = bearerToken || headerToken;

  if (!providedToken) {
    return false;
  }

  return safeCompare(providedToken, expectedToken);
}
