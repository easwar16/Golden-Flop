/**
 * App identity shown to the user in the MWA wallet connection UI.
 */
export const APP_IDENTITY = {
  name: 'GoldenFlop',
  uri: 'https://goldenflop.app',
  icon: './assets/images/icon.png',
} as const;

/**
 * Cluster for MobileWalletProvider.
 * Must match the server's SOLANA_NETWORK env var.
 * Change to 'solana:mainnet-beta' for production.
 */
export const CLUSTER = 'solana:mainnet-beta' as const;

/**
 * Network name for @solana/web3.js clusterApiUrl().
 * Derived from CLUSTER so they stay in sync.
 */
export const SOLANA_NETWORK: 'devnet' | 'mainnet-beta' =
  CLUSTER === 'solana:mainnet-beta' ? 'mainnet-beta' : 'devnet';
