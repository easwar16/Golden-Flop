import type { CardValue } from '@/constants/poker';
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

type TableInfo = {
  id: string;
  creator: string;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  playerCount: number;
};

type GameState = {
  tableId: string | null;
  pot: number;
  currentBet: number;
  communityCards: CardValue[];
  holeCards: (CardValue | null)[];
  holeCardsRevealed: boolean[];
  isYourTurn: boolean;
  yourChips: number;
  phase: 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
};

type GameContextValue = {
  tables: TableInfo[];
  currentTable: TableInfo | null;
  game: GameState | null;
  joinTable: (tableId: string, buyIn: number, tableOverride?: TableInfo) => void;
  leaveTable: () => void;
  createTable: (smallBlind: number, bigBlind: number, minBuyIn: number, maxBuyIn: number) => TableInfo;
  setHoleCardsRevealed: (index: number, revealed: boolean) => void;
  performAction: (action: 'fold' | 'call' | 'raise' | 'all-in', amount?: number) => void;
  peekHoleCard: (index: number) => void;
  stopPeek: () => void;
};

const defaultGameState: GameState = {
  tableId: null,
  pot: 0,
  currentBet: 0,
  communityCards: [],
  holeCards: [null, null],
  holeCardsRevealed: [false, false],
  isYourTurn: false,
  yourChips: 0,
  phase: 'preflop',
};

const GameContext = createContext<GameContextValue | null>(null);

const MOCK_TABLES: TableInfo[] = [
  {
    id: '1',
    creator: 'Creator1',
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: 200,
    maxBuyIn: 2000,
    playerCount: 3,
  },
  {
    id: '2',
    creator: 'Creator2',
    smallBlind: 50,
    bigBlind: 100,
    minBuyIn: 1000,
    maxBuyIn: 10000,
    playerCount: 5,
  },
];

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [tables, setTables] = useState<TableInfo[]>(MOCK_TABLES);
  const [currentTable, setCurrentTable] = useState<TableInfo | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const nextTurnTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const createTable = useCallback(
    (smallBlind: number, bigBlind: number, minBuyIn: number, maxBuyIn: number): TableInfo => {
      const id = String(Date.now());
      const newTable: TableInfo = {
        id,
        creator: 'You',
        smallBlind,
        bigBlind,
        minBuyIn,
        maxBuyIn,
        playerCount: 0,
      };
      setTables((prev) => [...prev, newTable]);
      return newTable;
    },
    []
  );

  const joinTable = useCallback((tableId: string, buyIn: number, tableOverride?: TableInfo) => {
    const table =
      tableOverride ?? tables.find((t) => t.id === tableId) ?? MOCK_TABLES.find((t) => t.id === tableId);
    if (!table) return;
    setCurrentTable({ ...table, playerCount: table.playerCount + 1 });
    setGame({
      ...defaultGameState,
      tableId,
      pot: 0,
      yourChips: buyIn,
      holeCards: [null, null],
      holeCardsRevealed: [false, false],
      isYourTurn: true,
      communityCards: [],
      phase: 'preflop',
    });
  }, [tables]);

  const leaveTable = useCallback(() => {
    if (nextTurnTimeoutRef.current) {
      clearTimeout(nextTurnTimeoutRef.current);
      nextTurnTimeoutRef.current = null;
    }
    setCurrentTable(null);
    setGame(null);
  }, []);

  const setHoleCardsRevealed = useCallback((index: number, revealed: boolean) => {
    setGame((g) =>
      g
        ? {
            ...g,
            holeCardsRevealed: g.holeCardsRevealed.map((r, i) => (i === index ? revealed : r)),
          }
        : null
    );
  }, []);

  const peekHoleCard = useCallback((index: number) => {
    setGame((g) =>
      g
        ? {
            ...g,
            holeCardsRevealed: g.holeCardsRevealed.map((r, i) => (i === index ? true : r)),
          }
        : null
    );
  }, []);

  const stopPeek = useCallback(() => {
    setGame((g) =>
      g ? { ...g, holeCardsRevealed: [false, false] } : null
    );
  }, []);

  const performAction = useCallback(
    (action: 'fold' | 'call' | 'raise' | 'all-in', amount?: number) => {
      if (nextTurnTimeoutRef.current) {
        clearTimeout(nextTurnTimeoutRef.current);
        nextTurnTimeoutRef.current = null;
      }
      setGame((g) => {
        if (!g) return null;
        if (action === 'fold') {
          return { ...g, isYourTurn: false };
        }
        if (action === 'all-in') {
          return { ...g, yourChips: 0, pot: g.pot + g.yourChips, isYourTurn: false };
        }
        const amt = amount ?? g.currentBet;
        return {
          ...g,
          yourChips: g.yourChips - amt,
          pot: g.pot + amt,
          currentBet: amt,
          isYourTurn: false,
        };
      });
      // Mock: give turn back after brief delay so you can test buttons again
      nextTurnTimeoutRef.current = setTimeout(() => {
        nextTurnTimeoutRef.current = null;
        setGame((g) => (g ? { ...g, isYourTurn: true } : null));
      }, 100);
    },
    []
  );

  const value: GameContextValue = {
    tables,
    currentTable,
    game,
    joinTable,
    leaveTable,
    createTable,
    setHoleCardsRevealed,
    performAction,
    peekHoleCard,
    stopPeek,
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used within GameProvider');
  return ctx;
}
