import { create } from 'zustand';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'tm-theme';

function apply(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function initial(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

interface ThemeStore {
  theme: Theme;
  toggle: () => void;
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: initial(),
  toggle: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    apply(next);
    set({ theme: next });
  },
}));

apply(useThemeStore.getState().theme);
