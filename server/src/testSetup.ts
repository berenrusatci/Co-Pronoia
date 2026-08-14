/**
 * Vitest kurulum dosyası (`vitest.config.ts` → `setupFiles`). Her test dosyasında bir kez koşar.
 *
 * `app.inject` (light-my-request) gerçek socket yerine bir `MockSocket` verir; o mock
 * yalnız `remoteAddress` taşır, `net.Socket` API'sini uygulamaz. MCP ucunun kullandığı
 * `@hono/node-server` (>=1.19.17) ise okunmamış gövdeyi boşaltma zaman aşımında
 * `socket.destroySoon()` çağırıyor → zamanlayıcıdan gelen, hiçbir teste bağlanamayan ve
 * `vitest run`u sıfırdan farklı çıkış koduna düşüren `TypeError`.
 *
 * Gerçek çalışmada socket bir `net.Socket`tir ve metot vardır, yani eksik olan yalnız test
 * mock'udur. Inject bağlantısı zaman aşımı ateşlendiğinde zaten kapanmış olduğu için no-op
 * doğru davranıştır. `MockSocket` dışa aktarılmadığından prototipine bir örnek üzerinden
 * ulaşıyoruz.
 */
// ESM import ŞART: `createRequire` Vite'ın modül grafiğini atlar ve Fastify'ın inject
// içinde kullandığından FARKLI bir modül örneği (dolayısıyla farklı bir `MockSocket`
// sınıfı) döner — yama sessizce tutmaz. Alt yol `.d.ts` taşımadığı için tip bastırılıyor.
// @ts-expect-error - light-my-request/lib/request.js için tip bildirimi yok
import Request from 'light-my-request/lib/request.js';

const probe = new (Request as unknown as new (opts: { url: string }) => { socket: object })({ url: '/' });
const mockSocketProto = Object.getPrototypeOf(probe.socket) as { destroySoon?: () => void };
if (typeof mockSocketProto.destroySoon !== 'function') mockSocketProto.destroySoon = () => {};
