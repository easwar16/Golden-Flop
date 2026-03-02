/**
 * InviteService — API client for invite link generation and validation.
 */

import type { GenerateInviteResponse, ValidateInviteResponse } from '@goldenflop/shared';

const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL ?? 'http://localhost:4001';

/**
 * Generate an invite link for a room (requires auth).
 */
export async function generateInvite(
  roomId: string,
  jwtToken: string,
): Promise<GenerateInviteResponse> {
  const res = await fetch(`${SERVER_URL}/api/invite/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwtToken}`,
    },
    body: JSON.stringify({ roomId }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to generate invite (${res.status})`);
  }

  return res.json();
}

/**
 * Validate an invite token (public, no auth required).
 */
export async function validateInviteToken(
  token: string,
): Promise<ValidateInviteResponse> {
  const res = await fetch(`${SERVER_URL}/api/invite/validate/${encodeURIComponent(token)}`);

  if (!res.ok) {
    return { valid: false, error: `Validation failed (${res.status})` };
  }

  return res.json();
}
