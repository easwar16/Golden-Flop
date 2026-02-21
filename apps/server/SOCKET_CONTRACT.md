# GoldenFlop – Socket Contract & Frontend Integration Guide

## Connection

```ts
import { io } from 'socket.io-client';

const socket = io('http://localhost:4000', {
  transports: ['websocket'],
  auth: {
    playerId: 'user-uuid',      // your persistent player ID
    playerName: 'DEGENKING',
  },
});
```

---

## Client → Server Events

| Event | Payload | Notes |
|-------|---------|-------|
| `create_table` | `CreateTablePayload` | ACK returns `tableId: string` |
| `join_table` | `JoinTablePayload` | ACK returns `err: string \| null` |
| `leave_table` | `{ tableId }` | |
| `player_action` | `PlayerActionPayload` | fold / check / call / raise / all-in |
| `request_tables` | *(none)* | Server responds with `tables_list` |

### PlayerActionPayload
```ts
{
  tableId: string;
  action: 'fold' | 'check' | 'call' | 'raise' | 'all-in';
  amount?: number;   // required only for 'raise'
}
```

---

## Server → Client Events

| Event | When | Notes |
|-------|------|-------|
| `table_state` | After every state change | Filtered per player (opponents' cards hidden) |
| `tables_list` | After any room created/destroyed | Lobby list |
| `game_started` | New hand begins | `{ tableId, handId }` |
| `hand_result` | Showdown / last player folds | Full result + seed for provable fairness |
| `player_joined` | Room broadcast | New arrival |
| `player_left` | Room broadcast | Departure |
| `turn_start` | Sent only to the active player | Includes `timeoutAt` (UTC ms), min/max raise |
| `action_ack` | Echo back to acting player | Confirms action landed |
| `reconnect_state` | On reconnect | Same shape as `table_state` |
| `error` | On bad input | `{ code, message }` |

---

## table_state payload (what replaces your current GameState)

```ts
interface TableStatePayload {
  tableId: string;
  phase: 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

  seats: (SeatView | null)[];      // length = maxPlayers (6)
  communityCards: (CardValue | null)[];  // always length 5, null = undealt
  pot: number;
  sidePots: SidePot[];
  currentBet: number;
  minRaise: number;
  maxRaise: number;                // your remaining chips

  activePlayerSeatIndex: number | null;
  dealerSeatIndex: number;
  smallBlindSeatIndex: number;
  bigBlindSeatIndex: number;
  turnTimeoutAt: number | null;    // UTC ms – only non-null when it's YOUR turn

  // Your own data
  mySeatIndex: number | null;
  myHand: (CardValue | null)[];
  isMyTurn: boolean;
  myChips: number;

  smallBlind: number;
  bigBlind: number;
}
```

---

## One full betting round – example flow

```
Client A (dealer, SB=10, BB=20)
Client B

1. Server deals hole cards
   → emit game_started { handId }
   → emit table_state  (each player sees own cards only)
   → emit turn_start   → Client B (first to act preflop)

2. Client B emits player_action { action: 'call', amount: 20 }
   ← action_ack to B
   ← table_state to all

3. Client A emits player_action { action: 'raise', amount: 60 }
   ← action_ack to A
   ← table_state to all
   ← turn_start to B

4. Client B emits player_action { action: 'call', amount: 60 }
   ← action_ack to B
   Betting round complete → server deals flop
   ← table_state to all (3 community cards visible)
   ← turn_start to next active player

...continues through turn, river, showdown...

5. Showdown:
   ← hand_result { winners, allPlayers, pot, seed, actionLog }
   ← table_state (waiting phase)
   After 3s:
   ← game_started (new hand)
```

---

## Reconnection strategy

On reconnect, the server automatically:
1. Finds the player's existing seat by `playerId` from `handshake.auth`
2. Restores their socket to the room
3. Emits `reconnect_state` (same shape as `table_state`) with full current game state

Frontend: just call `socket.connect()` – no manual re-join needed.

---

## Hiding opponent cards

`table_state.seats[i].holeCards` is always `[null, null]` for opponents.
It is only populated with real cards:
- For your own seat (`mySeatIndex`)
- At showdown (all active players' cards are revealed)

Your existing `myHand` field maps directly to `table_state.myHand`.

---

## Wiring into game-context.tsx

Replace the mock `performAction` / `joinTable` etc. with:

```ts
// Connect once on app start
socket.on('table_state', (payload) => {
  setGame({
    tableId: payload.tableId,
    pot: payload.pot,
    currentBet: payload.currentBet,
    communityCards: payload.communityCards.filter(Boolean) as CardValue[],
    holeCards: payload.myHand,
    holeCardsRevealed: [false, false],
    isYourTurn: payload.isMyTurn,
    yourChips: payload.myChips,
    phase: payload.phase === 'waiting' ? 'preflop' : payload.phase,
  });
  // For the full table view: store payload in separate useState
  setTableState(payload);
});

const performAction = (action, amount) => {
  socket.emit('player_action', { tableId: game.tableId!, action, amount });
};

const joinTable = (tableId, buyIn) => {
  socket.emit('join_table', { tableId, buyIn, playerName }, (err) => {
    if (err) console.error(err);
  });
};
```

---

## Provable Fairness

After each hand, `hand_result.seed` is revealed.
Players can independently verify the shuffle:

```ts
import { buildShuffledDeck } from '@goldenflop/server/engine/Deck';
const deck = buildShuffledDeck(handResult.seed);
// deck[0], deck[1] = hole cards for player 0, etc.
```
