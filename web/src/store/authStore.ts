import { create } from 'zustand';

export interface AuthUser {
  id: string;
  username: string;
}

interface AuthStore {
  user: AuthUser | null;
  checked: boolean;
  error: string | null;
  check: () => Promise<void>;
  login: (username: string, password: string) => Promise<boolean>;
  register: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  dropSession: () => void;
}

async function authPost(url: string, body: unknown): Promise<{ ok: boolean; user?: AuthUser; error?: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, user: data.user } : { ok: false, error: data.error ?? 'bilinmeyen hata' };
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  checked: false,
  error: null,

  check: async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const { user } = await res.json();
        set({ user, checked: true });
      } else {
        set({ user: null, checked: true });
      }
    } catch {
      set({ user: null, checked: true });
    }
  },

  login: async (username, password) => {
    const r = await authPost('/api/auth/login', { username, password });
    set(r.ok ? { user: r.user, error: null } : { error: r.error });
    return r.ok;
  },

  register: async (username, password) => {
    const r = await authPost('/api/auth/register', { username, password });
    set(r.ok ? { user: r.user, error: null } : { error: r.error });
    return r.ok;
  },

  logout: async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    set({ user: null });
  },

  dropSession: () => set({ user: null }),
}));
