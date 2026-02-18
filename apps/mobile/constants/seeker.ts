/**
 * Seeker Name Service: resolve names like rahul.skr to pubkey.
 * When Seeker ID / SNS is available, replace this with the actual resolver.
 */
export const SEEKER_ID_PLACEHOLDER = 'you.skr';

export function formatPlayerId(pubkeyOrName: string | null | undefined): string {
  if (!pubkeyOrName) return SEEKER_ID_PLACEHOLDER;
  if (pubkeyOrName.endsWith('.skr') || pubkeyOrName.length < 20) return pubkeyOrName;
  return `${pubkeyOrName.slice(0, 4)}…${pubkeyOrName.slice(-4)}`;
}
