/**
 * EconomyInterface – pluggable economy layer.
 *
 * Today: in-memory chips.
 * Tomorrow: swap the implementation for a Solana/smart-contract version
 * without touching GameEngine or Room.
 *
 * The GameEngine never imports this. Only Room / SocketHandler call it.
 */

export interface EconomyTransaction {
  playerId: string;
  tableId: string;
  amount: number;
  type: 'buy_in' | 'cash_out' | 'win' | 'loss' | 'refund';
  timestamp: number;
  handId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Interface – swap implementations without changing callers
// ─────────────────────────────────────────────────────────────────────────────

export interface IEconomy {
  /** Deduct chips from player's off-table balance for a buy-in. */
  debitBuyIn(playerId: string, tableId: string, amount: number): Promise<boolean>;

  /** Return chips to player's off-table balance on cash-out. */
  creditCashOut(playerId: string, tableId: string, amount: number): Promise<void>;

  /** Record a win allocation (post-showdown). */
  recordWin(playerId: string, tableId: string, amount: number, handId: string): Promise<void>;

  /** Return the player's off-table balance. */
  getBalance(playerId: string): Promise<number>;

  /** Full audit log for a player or table. */
  getTransactions(filter: { playerId?: string; tableId?: string }): Promise<EconomyTransaction[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory implementation  (replace with on-chain calls for Web3)
// ─────────────────────────────────────────────────────────────────────────────

export class InMemoryEconomy implements IEconomy {
  /** playerId → chip balance */
  private balances = new Map<string, number>();
  private transactions: EconomyTransaction[] = [];

  /** Seed a player's balance (used in tests / mock onboarding). */
  seed(playerId: string, amount: number): void {
    this.balances.set(playerId, (this.balances.get(playerId) ?? 0) + amount);
  }

  async debitBuyIn(playerId: string, tableId: string, amount: number): Promise<boolean> {
    const balance = this.balances.get(playerId) ?? 0;
    // In dev mode, allow unlimited buy-ins (remove this guard for production)
    this.balances.set(playerId, Math.max(0, balance - amount));
    this.log({ playerId, tableId, amount: -amount, type: 'buy_in' });
    return true;
  }

  async creditCashOut(playerId: string, tableId: string, amount: number): Promise<void> {
    this.balances.set(playerId, (this.balances.get(playerId) ?? 0) + amount);
    this.log({ playerId, tableId, amount, type: 'cash_out' });
  }

  async recordWin(playerId: string, tableId: string, amount: number, handId: string): Promise<void> {
    this.log({ playerId, tableId, amount, type: 'win', handId });
  }

  async getBalance(playerId: string): Promise<number> {
    return this.balances.get(playerId) ?? 0;
  }

  async getTransactions(filter: { playerId?: string; tableId?: string }): Promise<EconomyTransaction[]> {
    return this.transactions.filter(t =>
      (!filter.playerId || t.playerId === filter.playerId) &&
      (!filter.tableId || t.tableId === filter.tableId)
    );
  }

  private log(entry: Omit<EconomyTransaction, 'timestamp'>): void {
    this.transactions.push({ ...entry, timestamp: Date.now() });
  }
}

// Singleton for the in-memory implementation
export const economy = new InMemoryEconomy();
