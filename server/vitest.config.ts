import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Her buildApp bir Prisma bağlantı havuzu açar ve suite'in afterAll'una dek tutar;
    // test dosyaları paralel koşunca Postgres max_connections (100) aşılıp rastgele
    // 500'ler üretiyor. Dosyaları sırayla çalıştır.
    fileParallelism: false,
  },
});
