# GoldenFlop Anchor Program

Solana program for GoldenFlop poker: table state, session keys, and in-game actions.

## Prerequisites

- [Rust](https://rustup.rs/)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools)
- [Anchor CLI](https://www.anchor-lang.com/docs/installation) (v0.30.x)

## Build

From this directory:

```bash
anchor build
```

From repo root (if Anchor is installed):

```bash
cd apps/program && anchor build
```

## Deploy (devnet)

```bash
anchor deploy --provider.cluster devnet
```

## Instructions

- **create_table** – Create a table with blinds and stake limits (signed by creator).
- **join_table** – Buy in and join the table (signed by player main wallet).
- **create_session** – Register a session key for in-game actions (signed by main wallet once).
- **action** – Bet, fold, call, raise, or all-in (signed by session key).
- **leave_table** – Leave and settle (signed by main wallet).
- **revoke_session** – Revoke a session (signed by authority).

## Accounts

- **Table** – Creator, blinds, pot, state, player slots, deck_seed (placeholder for VRF).
- **Session** – Authority, ephemeral_signer, table, expiry.

## VRF / deck seed

`Table.deck_seed` is a placeholder. Integrate [Switchboard VRF](https://docs.switchboard.xyz/product-documentation/randomness) to set a verifiable random seed per hand.
