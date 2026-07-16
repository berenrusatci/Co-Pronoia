import { create } from 'zustand';

/** Yönetim panelinin açık/kapalı durumu — App, pano yerine paneli gösterir.
 * `?yonetim=1` URL parametresiyle senkron tutulur ki panel doğrudan linklenebilsin
 * (yalnızca isAdmin kullanıcılarda render edilir; App.tsx kapıyı tutar). */
interface AdminStore {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const paramOpen = () => new URLSearchParams(window.location.search).has('yonetim');

const syncParam = (open: boolean) => {
  const params = new URLSearchParams(window.location.search);
  if (open) params.set('yonetim', '1');
  else params.delete('yonetim');
  const qs = params.toString();
  window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
};

export const useAdminStore = create<AdminStore>((set) => ({
  open: paramOpen(),
  setOpen: (open) => {
    syncParam(open);
    set({ open });
  },
}));
