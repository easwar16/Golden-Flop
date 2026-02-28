/**
 * useUserStore – user profile: username + avatar seed.
 *
 * Persisted to AsyncStorage via Zustand's persist middleware.
 * Data survives app restarts; on first launch defaults are used.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

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
      name: 'user-profile',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
