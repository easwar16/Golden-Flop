/**
 * useLobbyStore – available tables list for the lobby screen.
 *
 * Populated by the `tables_list` socket event.
 * Kept separate from game state so lobby re-renders never affect the table screen.
 */

import { create } from 'zustand';

export interface LobbyTable {
  id: string;
  name: string;
  creator: string;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  playerCount: number;
  maxPlayers: number;
  phase: string;
  occupiedSeats: number[];
  reservedSeats?: number[];
}

interface LobbyState {
  tables: LobbyTable[];
  setTables: (tables: LobbyTable[]) => void;
}

export const useLobbyStore = create<LobbyState>()((set) => ({
  tables: [],
  setTables: (tables) => set({ tables }),
}));
