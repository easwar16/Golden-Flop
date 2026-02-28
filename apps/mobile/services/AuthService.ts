/**
 * AuthService – Sign-In With Solana (SIWS) client-side flow.
 *
 * Flow:
 *   1. getNonce(walletAddress)      → nonce string from server
 *   2. buildLoginMessage(nonce)     → plaintext message to sign
 *   3. signMessage via WalletContext
 *   4. verifySignature(...)         → JWT + user from server
 *
 * The JWT is stored in SecureStore by the AuthContext, not here.
 * This service is purely for API transport.
 */

const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL ?? 'http://localhost:4000';

export interface AuthUser {
  id: string;
  walletAddress: string;
  username: string | null;
  avatar: string | null;
}

export interface VerifyResponse {
  token: string;
  user: AuthUser;
}

// ─── Build the signable message ───────────────────────────────────────────────

export function buildLoginMessage(nonce: string): string {
  return `Sign this message to login to Golden Flop. Nonce: ${nonce}`;
}

// ─── Step 1: Request nonce ────────────────────────────────────────────────────

export async function getNonce(walletAddress: string): Promise<string> {
  const res = await fetch(`${SERVER_URL}/api/auth/nonce`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ walletAddress }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((body.error as string) ?? `Nonce request failed (${res.status})`);
  }

  const data = await res.json() as { nonce: string };
  return data.nonce;
}

// ─── Step 2: Sign message helper ──────────────────────────────────────────────

/**
 * Returns a base64-encoded signature ready to send to the server.
 * Calls the MWA `signMessage` from WalletContext.
 *
 * @param message   plaintext from buildLoginMessage()
 * @param signFn    wallet.signMessage from WalletContext
 */
export async function signLoginMessage(
  message: string,
  signFn: (msg: Uint8Array) => Promise<Uint8Array>,
): Promise<string> {
  const messageBytes = new TextEncoder().encode(message);
  const signatureBytes = await signFn(messageBytes);

  // Convert to base64 for JSON transport
  return Buffer.from(signatureBytes).toString('base64');
}

// ─── Step 3: Verify signature → JWT ──────────────────────────────────────────

export async function verifySignature(
  walletAddress: string,
  signatureB64: string,
): Promise<VerifyResponse> {
  const res = await fetch(`${SERVER_URL}/api/auth/verify`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ walletAddress, signature: signatureB64 }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error((body.error as string) ?? `Auth verification failed (${res.status})`);
  }

  return res.json() as Promise<VerifyResponse>;
}

// ─── Fetch current user (token refresh check) ─────────────────────────────────

export async function fetchMe(token: string): Promise<{ user: AuthUser; balance: string }> {
  const res = await fetch(`${SERVER_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) throw new Error('Token expired or invalid');
  return res.json() as Promise<{ user: AuthUser; balance: string }>;
}
