/**
 * Minimal shim for @solana/kit.
 * Only devnet/mainnet/testnet URL helpers are used by @wallet-ui/core in the
 * react-native bundle. They are simple identity wrappers around RPC URL strings.
 */
module.exports = {
  devnet: (url) => url,
  mainnet: (url) => url,
  testnet: (url) => url,
};
