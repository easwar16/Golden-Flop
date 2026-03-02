/**
 * InviteService — generate, validate, and consume invite tokens.
 *
 * Tokens are 24-byte random hex + 16-char HMAC signature, stored in the DB
 * with a 10-minute expiry and single-use flag.
 */

import crypto from 'crypto';
import { prisma } from '../db/prisma';

const INVITE_EXPIRY_MS = 10 * 60 * 1_000; // 10 minutes
const APP_SCHEME = 'goldenflop';
const APP_DOMAIN = 'goldenflop.app';

function getSecret(): string {
  return process.env.INVITE_SECRET ?? process.env.JWT_SECRET ?? 'default-invite-secret';
}

/**
 * Generate a signed token: 24 random bytes (hex) + 16-char HMAC.
 */
export function generateToken(): string {
  const random = crypto.randomBytes(24).toString('hex'); // 48 chars
  const hmac = crypto
    .createHmac('sha256', getSecret())
    .update(random)
    .digest('hex')
    .slice(0, 16);
  return `${random}${hmac}`; // 64 chars total
}

/**
 * Create an invite record in the database.
 */
export async function createInvite(
  roomId: string,
  inviterUserId: string,
): Promise<{ token: string; deepLink: string; httpsLink: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_MS);

  await prisma.invite.create({
    data: {
      token,
      roomId,
      inviterUserId,
      expiresAt,
    },
  });

  const deepLink = `${APP_SCHEME}://invite?token=${token}`;
  const httpsLink = `https://${APP_DOMAIN}/invite/${token}`;

  return { token, deepLink, httpsLink, expiresAt };
}

/**
 * Validate an invite token. Returns the invite record if valid, or null.
 */
export async function validateInvite(token: string) {
  const invite = await prisma.invite.findUnique({
    where: { token },
    include: {
      room: { select: { id: true, name: true, smallBlind: true, bigBlind: true, maxPlayers: true } },
      inviter: { select: { username: true, walletAddress: true } },
    },
  });

  if (!invite) return null;
  if (invite.used) return null;
  if (invite.expiresAt < new Date()) return null;

  return invite;
}

/**
 * Mark an invite as used (single-use consumption).
 */
export async function markInviteUsed(token: string): Promise<void> {
  await prisma.invite.update({
    where: { token },
    data: { used: true },
  });
}
