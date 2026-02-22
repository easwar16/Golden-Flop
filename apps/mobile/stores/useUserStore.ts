/**
 * useUserStore – user profile: username + avatar seed.
 *
 * Uses an in-memory store (no native module required).
 * Data persists within the app session; resets on full restart.
 */

import { create } from 'zustand';

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface UserState {
  username: string;
  avatarSeed: string;

  setUsername: (name: string) => void;
  regenerateAvatar: () => void;
}

export const useUserStore = create<UserState>()((set) => ({
  username: 'Player',
  avatarSeed: randomSeed(),

  setUsername: (username) => set({ username: username.trim() || 'Player' }),
  regenerateAvatar: () => set({ avatarSeed: randomSeed() }),
}));
