/**
 * Shared types for the poker animation system.
 * No game logic — purely visual coordinates and payloads.
 */

export interface Point {
  x: number; // absolute screen x
  y: number; // absolute screen y
}

/** Maps seat index → center point of that seat's avatar on screen */
export type SeatPositionMap = Record<number, Point>;

/** Center of the community card area (deck/pot origin) */
export interface TableLayout {
  deckOrigin: Point;   // where cards fly FROM
  potCenter: Point;    // where chips animate TO/FROM
  seats: SeatPositionMap;
}

export interface ChipAnimPayload {
  fromSeat: number;
  amount: number;
}

export interface WinnerAnimPayload {
  winningSeatIndex: number;
  winAmount: number;
}
