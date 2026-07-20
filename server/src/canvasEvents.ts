import { EventEmitter } from 'node:events';

/**
 * Sunucu-içi kanvas değişiklik sinyali. app.ts'teki WS broadcast choke point'inden beslenir
 * (commit / dal / öneri mesajları çıkarken) ve MCP `wait_for_changes` long-poll bekleyicilerini
 * uyandırır. Sinyal veri taşımaz: uyanan bekleyici durumu DB'den kendisi yeniden okur — böylece
 * yeni bir DB polling döngüsü doğmaz ve kaçırılan sinyal en fazla bir yeniden-okumaya mal olur.
 */
export class CanvasEvents {
  private emitter = new EventEmitter();

  constructor() {
    // Kanvas başına eşzamanlı long-poll bekleyici sayısı sınırsız olabilir.
    this.emitter.setMaxListeners(0);
  }

  notify(canvasId: string): void {
    this.emitter.emit(canvasId);
  }

  /** Kanvasın sinyallerine abone ol; dönen fonksiyon aboneliği kaldırır. */
  subscribe(canvasId: string, fn: () => void): () => void {
    this.emitter.on(canvasId, fn);
    return () => this.emitter.off(canvasId, fn);
  }
}
