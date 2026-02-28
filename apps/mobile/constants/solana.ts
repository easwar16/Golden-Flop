/**
 * App identity shown to the user in the MWA wallet connection UI.
 */
export const APP_IDENTITY = {
  name: 'GoldenFlop',
  uri: 'https://goldenflop.app',
  icon: './assets/images/icon.png',
} as const;

export const CLUSTER = 'solana:devnet' as const;

/** Solana network for RPC connections — must match CLUSTER above */
export const SOLANA_NETWORK: 'devnet' | 'mainnet-beta' = 'devnet';
