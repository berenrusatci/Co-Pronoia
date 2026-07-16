import { create } from 'zustand';

/** Yönetim panelinin açık/kapalı durumu — App, pano yerine paneli gösterir. */
interface AdminStore {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useAdminStore = create<AdminStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
