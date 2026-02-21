/**
 * useUserStore – persisted user profile: username + avatar seed.
 *
 * Stored in AsyncStorage so it survives app restarts.
 * Components read from this; Settings screen writes to it.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface UserState {
  username: string;
  avatarSeed: string;

  setUsername: (name: string) => void;
  regenerateAvatar: () => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      username: 'Player',
      avatarSeed: randomSeed(),

      setUsername: (username) => set({ username: username.trim() || 'Player' }),
      regenerateAvatar: () => set({ avatarSeed: randomSeed() }),
    }),
    {
      name: 'goldenflop-user',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
