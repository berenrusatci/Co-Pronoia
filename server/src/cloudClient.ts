import type { CanvasBundle } from '@treemapper/shared';
import { parseCanvasBundle } from '@treemapper/shared';
import { cloudUrl } from './mode.js';

export interface CloudUser {
  id: string;
  username: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface CloudCanvasRef {
  id: string;
  name: string;
}

/**
 * Yerel kurulumun buluta yaptığı sunucu–sunucu çağrıları. `EmailSender`/`Llm` deseniyle
 * enjekte edilebilir: testler sahte bir istemciyle bulut app'ine `app.inject` üzerinden bağlanır.
 */
export interface CloudClient {
  /** Tek kullanımlık kodu kalıcı instance token'a çevirir. */
  exchange(input: { state: string; code: string; verifier: string }):
    Promise<{ user: CloudUser; instanceToken: string } | { error: string }>;
  /** Aktive eden hesabın buluttaki kanvasları. */
  listCanvases(instanceToken: string): Promise<CloudCanvasRef[]>;
  /** Bir kanvasın taşınabilir paketi (`GET /api/canvases/:id/export` ile aynı gövde). */
  exportCanvas(instanceToken: string, cloudCanvasId: string): Promise<CanvasBundle>;
}

async function cloudFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${cloudUrl()}${path}`, init);
}

export const defaultCloudClient: CloudClient = {
  async exchange(input) {
    const res = await cloudFetch('/api/activation/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => null)) as
      | { user?: CloudUser; instanceToken?: string; error?: string }
      | null;
    if (!res.ok || !body?.user || !body.instanceToken)
      return { error: body?.error ?? `bulut yanıtı geçersiz (HTTP ${res.status})` };
    return { user: body.user, instanceToken: body.instanceToken };
  },

  async listCanvases(instanceToken) {
    const res = await cloudFetch('/api/instance/canvases', {
      headers: { Authorization: `Bearer ${instanceToken}` },
    });
    if (!res.ok) throw new Error(`bulut kanvas listesi alınamadı (HTTP ${res.status})`);
    const body = (await res.json()) as { canvases?: CloudCanvasRef[] };
    return body.canvases ?? [];
  },

  async exportCanvas(instanceToken, cloudCanvasId) {
    const res = await cloudFetch(`/api/instance/canvases/${cloudCanvasId}/export`, {
      headers: { Authorization: `Bearer ${instanceToken}` },
    });
    if (!res.ok) throw new Error(`kanvas paketi alınamadı (HTTP ${res.status})`);
    return parseCanvasBundle(await res.json());
  },
};
