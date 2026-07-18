import { create } from 'zustand';
import type { CanvasInfo, CanvasType } from '@treemapper/shared';
import { ApiError, canvasApi, setActiveCanvasId } from '../api/client';

interface CanvasStore {
  canvases: CanvasInfo[];
  listLoaded: boolean;
  /** Selected canvas — null shows the dashboard. */
  active: CanvasInfo | null;
  error: string | null;

  loadList: () => Promise<void>;
  createCanvas: (name: string, groupId: string, type?: CanvasType) => Promise<CanvasInfo | null>;
  open: (canvas: CanvasInfo) => void;
  /** Bağlı kanvası id ile açar (düğüm kartından geçiş); erişim yoksa error set edilir. */
  openById: (canvasId: string) => Promise<void>;
  close: () => void;
  /** Mints an invite token and returns the shareable URL. */
  inviteLink: (canvasId: string) => Promise<string | null>;
  joinByToken: (token: string) => Promise<CanvasInfo | null>;
  /** Owner-only: deletes the canvas and everything in it. */
  deleteCanvas: (canvasId: string) => Promise<void>;
  clearError: () => void;
  reset: () => void;
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  canvases: [],
  listLoaded: false,
  active: null,
  error: null,

  loadList: async () => {
    try {
      const { canvases } = await canvasApi.list();
      set({ canvases, listLoaded: true });
    } catch (err) {
      set({ error: err instanceof ApiError ? err.message : String(err), listLoaded: true });
    }
  },

  createCanvas: async (name, groupId, type) => {
    try {
      const { canvas } = await canvasApi.create(name, groupId, type);
      set((s) => ({ canvases: [canvas, ...s.canvases] }));
      return canvas;
    } catch (err) {
      set({ error: err instanceof ApiError ? err.message : String(err) });
      return null;
    }
  },

  open: (canvas) => {
    setActiveCanvasId(canvas.id);
    set({ active: canvas });
  },

  openById: async (canvasId) => {
    try {
      const { canvas } = await canvasApi.info(canvasId);
      get().open(canvas);
    } catch (err) {
      set({ error: err instanceof ApiError ? err.message : String(err) });
    }
  },

  close: () => {
    setActiveCanvasId(null);
    set({ active: null });
    get().loadList(); // refresh counts on return to the dashboard
  },

  inviteLink: async (canvasId) => {
    try {
      const { token } = await canvasApi.createInvite(canvasId);
      return `${window.location.origin}/?davet=${token}`;
    } catch (err) {
      set({ error: err instanceof ApiError ? err.message : String(err) });
      return null;
    }
  },

  joinByToken: async (token) => {
    try {
      const { canvas } = await canvasApi.acceptInvite(token);
      set((s) => ({
        canvases: s.canvases.some((c) => c.id === canvas.id) ? s.canvases : [canvas, ...s.canvases],
      }));
      return canvas;
    } catch (err) {
      set({ error: err instanceof ApiError ? err.message : String(err) });
      return null;
    }
  },

  deleteCanvas: async (canvasId) => {
    try {
      await canvasApi.deleteCanvas(canvasId);
      set((s) => ({
        canvases: s.canvases.filter((c) => c.id !== canvasId),
        active: s.active?.id === canvasId ? null : s.active,
      }));
    } catch (err) {
      set({ error: err instanceof ApiError ? err.message : String(err) });
    }
  },

  clearError: () => set({ error: null }),
  reset: () => {
    setActiveCanvasId(null);
    set({ canvases: [], listLoaded: false, active: null, error: null });
  },
}));
