import { create } from 'zustand';

export type AppMode = 'local' | 'cloud';

interface ModeStore {
  mode: AppMode;
  /** Yerel kurulum bulut hesabıyla etkinleştirildi mi (bulutta her zaman true). */
  activated: boolean;
  /** Yerel kurulumun konuştuğu bulut adresi; bulutta null. */
  cloudUrl: string | null;
  checked: boolean;
  load: () => Promise<void>;
}

/**
 * `/api/mode` oturum gerektirmez: web, giriş ekranı mı yoksa aktivasyon ekranı mı
 * çizeceğini buradan öğrenir.
 */
export const useModeStore = create<ModeStore>((set) => ({
  mode: 'cloud',
  activated: true,
  cloudUrl: null,
  checked: false,

  load: async () => {
    try {
      const res = await fetch('/api/mode');
      if (res.ok) {
        const data = await res.json();
        set({ mode: data.mode, activated: !!data.activated, cloudUrl: data.cloudUrl ?? null, checked: true });
        return;
      }
    } catch {
      /* eski sunucu ya da ağ hatası: bulut varsayımıyla devam */
    }
    set({ checked: true });
  },
}));

/**
 * React dışından (store'lar) mod sorgusu. Yerel kurulumda üyelik/davet/rol uçları
 * sunucuda HİÇ register edilmez (bkz. `server/src/mode.ts`), o yüzden web de onlara
 * istek atmamalı — yoksa her kanvas açılışında boşuna bir 404 üretilir.
 */
export const isLocalMode = (): boolean => useModeStore.getState().mode === 'local';
