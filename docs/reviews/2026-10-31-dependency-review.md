# Bağımlılık incelemesi ve Node 24 geçişi — 31 Ekim 2026

Codex'in 30 Ekim 2026 tarihli ön raporunun bağımsız doğrulaması ve doğrulanan güncellemelerin uygulanması. İnceleme mevcut çalışma ağacı (HEAD `3abbe67` + bu değişiklikler) üzerinde yapıldı.

## Özet

- **Node 20 → Node 24.** Node 20'nin desteği 30 Nisan 2026'da bitti. Node 24 bakım LTS'inde ve 30 Nisan 2028'e kadar destekleniyor. Docker (builder + runner), CI, devcontainer, `engines` ve `@types/node` birlikte geçirildi.
- **Üretim bağımlılık ağacında `pnpm audit --prod`: 41 advisory (3 critical, 18 high) → 0.** Dev araçları dahil 148 benzersiz GHSA → 14 kayıt. Kalanların hepsi dev araçlarında ve bizim kullanımımızda erişilemez.
- **En ciddi bulgu body-parser GHSA-27r3:** Kimliksiz tek bir istek, varsayılan `json()`/`urlencoded()` kullanan beş HTTP servisinden herhangi birini çökertebiliyordu.
- **pnpm 10.32.1'in kendisi 19 advisory'den etkileniyordu.** Codex bunu "bakım" olarak sınıflamıştı; aslında bir güvenlik güncellemesi. 10.34.8'e geçildi.
- **Hiçbir ana sürüm geçişi yok.** Tek istisna, Vitest'i 3.2.4'te kalan dört paket için diğerlerinin kullandığı 4.1.12'ye hizalamak (Codex'in önerisi). Override kullanılmadı. Bütün çözümlemeler 7 günlük yayın bekleme kuralıyla yapıldı: `--config.minimumReleaseAge=10080`, Dependabot cooldown'u ile tutarlı.

## Yöntem

- **Envanter:** Bütün `package.json` dosyaları, `pnpm list -r`, `pnpm-lock.yaml`, Dockerfile'lar, CI ve devcontainer okundu. Kilitte gerçekten çözülen sürümler ve zincirler `pnpm why -r` ile çıkarıldı.
- **Advisory'ler:** `pnpm audit --prod` ve `pnpm audit` kullanıldı; veri kaynağı GitHub Advisory Database üzerinden npm advisory API'si. Önemli GHSA'ların açıklamaları ve ön koşulları GitHub Advisory API'den okundu.
- **Sürüm hedefleri:** npm registry'den mevcut ana sürüm içindeki en yeni sürüm, yayın tarihi, `engines` ve bağımlılık aralıkları alındı.
- **Node:** Takvim `nodejs/Release` `schedule.json`'dan, güncel sürümler `nodejs.org/dist/index.json`'dan alındı.
- **pnpm:** `minimumReleaseAge` ve geçişli güncelleme davranışı Context7 üzerinden pnpm dokümanından doğrulandı.
- **Erişilebilirlik:** İlgili yükleyiciler, middleware ve ayarlar kodda okundu (dosya/satır aşağıda).
- **Codex'ten yöntem farkı:** Kilit dosyası üzerinde özel bir yürüyüş yerine `pnpm audit` kullanıldı; bağımlılık yollarını kendisi veriyor ve tekrarlanabilir. Sayımlar benzersiz GHSA üzerinden.

## Codex ile aynı ve farklı düşündüğüm noktalar

**Aynı fikirdeyim:**
- Node 20'nin EOL olduğu.
- Express 5.3.0'ın tek başına body-parser açığını kapatmadığı; kilitte 2.4.0 çözülmesi gerektiği. Kilitte 2.4.0 çözüldü.
- compression, multer, zod ve Socket.IO zinciri.
- i18next backend/middleware yamalarının çekirdek 26 geçişinden ayrı olduğu.
- Mongoose'un minör sürümle güncellenebileceği.
- İki "critical" i18next advisory'sinin bizde erişilemez olduğu: repoda hiç `saveMissing`/`missingKeyHandler` yok.
- proxy-addr açığının ön koşulunun bizde olmadığı.
- GHSA-c3h8'in i18next 19.5.0'dan eski bir sürüm gerektirdiği.
- multer'ın async `fileFilter` advisory'lerinin bizde erişilemez olduğu.
- Mongoose 9'un en az Node 20.19.0 istediği.
- Node 26'ya şimdi geçilmemesi.

**Düzelttiğim ya da eklediğim noktalar:**

1. **pnpm "bakım" değil, güvenlik güncellemesi.** 10.32.1, 10.x hattındaki 19 advisory'den etkileniyor; hepsi 10.34.5'te kapanıyor. Bizi özellikle ilgilendirenler:
   - [GHSA-fr4h-3cph-29xv](https://github.com/advisories/GHSA-fr4h-3cph-29xv): Hoisted kurulumda kilitteki bir takma ad `node_modules` dışına yazabiliyor. Docker build'leri `node-linker=hoisted` kullanıyor.
   - [GHSA-q6j5-fjx5-2mc3](https://github.com/advisories/GHSA-q6j5-fjx5-2mc3) ve [GHSA-54hh-g5mx-jqcp](https://github.com/advisories/GHSA-54hh-g5mx-jqcp): Kilit bütünlük kontrolü atlatılabiliyor.
2. **Sayımlar.** Codex "39 paket adında eşleşme, 17'si çalışma zamanında" demişti. `pnpm audit` sonucu: tümünde 41 paket ve 148 benzersiz GHSA, üretimde 17 paket ve 41 benzersiz GHSA. Üretimdeki 17 paket sayısı doğru.
3. **ws 8.18.3 nereden geliyor.** `socket.io` → `socket.io-adapter@2.5.6` (`ws ~8.18.3`) zincirinden. Default in-memory adapter `require("ws")` ile bu kopyayı gerçekten yüklüyor. `socket.io-adapter` 2.5.8 (`ws ~8.21.0`) ile kapandı.
4. **ip-address'in ikinci zinciri.** Codex yalnız Mongoose zincirini görmüştü; telemetry'nin üretim bağımlılığı olan `mqtt` → `socks` → `ip-address` zinciri de var. `socks` 2.8.10 ile ikisi birden kapandı.
5. **engine.io advisory'lerinin üçü de bizde erişilemez.** Polling ([GHSA-r635](https://github.com/advisories/GHSA-r635-g3xr-vw7x)) ve WebTransport ([GHSA-gr94](https://github.com/advisories/GHSA-gr94-w7qr-f4j3)) açıkları, çünkü sunucu `transports: ['websocket']` ile kurulu (`realtime/src/gateway/socket.ts:47-49`). [GHSA-2gc4](https://github.com/advisories/GHSA-2gc4-cqfq-p2gv) transport upgrade gerektiriyor; yalnız websocket olduğu için upgrade yok. Yine de `ws` için engine.io 6.6.11 gerekiyordu.
6. **Zod advisory'sinin ön koşulu.** GHSA açıklaması "uzunluk kısıtı olmayan dizi şeması" diyor. Ayrıca Zod 4.5'ten itibaren object ve record ayrıştırıcıları `__proto__` anahtarını düşürüyor; bu, Mongoose GHSA-664h yolunu Zod katmanında da daraltıyor.
7. **Vitest.** 3.2.4'teki paketler için en küçük düzeltme 3.2.6 olurdu, ama tinypool'daki iki "critical" advisory 3.x'te kalıyordu. Vitest 4.1'de tinypool bağımlılığı hiç yok. Dört paket 4.1.12'ye hizalandı; testlerde değişiklik gerekmedi.
8. **`@types/node` stratejisi.** Servisler 25'te, ortak paketler 20'deydi. 25, runtime'da olmayan API'lere derleme izni veriyordu; 20 ise Node 24 API'lerini eksik tanıyordu. Hepsi `^24.19.2` oldu.

## Karar tablosu — üretim bağımlılıkları

Erişilebilirlik sütunu kodda gördüğüm kanıta dayanıyor; "çıkarım" diye işaretlenenler kod okumasından çıkardığım ama çalıştırarak kanıtlamadığım sonuçlar.

| Paket (kullanan) | Kilit (önce) | Doğrulanmış bulgu ve ön koşul | Bizde erişilebilir mi | Hedef (kilit) | Karar |
|---|---|---|---|---|---|
| body-parser (5 HTTP servisi, Express üzerinden) | 2.2.2 | [GHSA-27r3](https://github.com/advisories/GHSA-27r3-jxmh-p828) high: sıkıştırılmış gövdenin arkasındaki baytlar süreci çökertiyor; varsayılan ayarlar, kimlik doğrulama ve route gerekmiyor. [GHSA-v422](https://github.com/advisories/GHSA-v422-hmwv-36x6) low: geçersiz `limit` değeri. | **Evet**, GHSA-27r3: varsayılan `json()`/`urlencoded()` (ör. `user/src/core/loaders/express.ts:54-55`). GHSA-v422: hayır, `limit` vermiyoruz. | 2.4.0 | Uygula (acil) |
| express (5 HTTP servisi) | 5.2.1 | Kendi advisory'si yok; 5.3.0 `body-parser ^2.3.0`, `qs ^6.16.0`, `proxy-addr ^2.0.8` alt sınırlarını garanti ediyor | — | 5.3.0 | Uygula |
| compression (5 HTTP servisi) | 1.8.1 | [GHSA-vc2v](https://github.com/advisories/GHSA-vc2v-76pw-4v95) high: istemci yanıt bitmeden bağlantıyı kesince zlib belleği sızıyor | **Evet**: `app.use(compression())` | 1.8.2 | Uygula |
| multer (user) | 2.1.1 | [GHSA-wc9g](https://github.com/advisories/GHSA-wc9g-mqfw-jrwm), [GHSA-535w](https://github.com/advisories/GHSA-535w-7cp7-47q4), [GHSA-72gw](https://github.com/advisories/GHSA-72gw-mp4g-v24j) high: alan adlarıyla süreç çökmesi ya da DoS. [GHSA-3p4h](https://github.com/advisories/GHSA-3p4h-7m6x-2hcm) moderate. [GHSA-q7qp](https://github.com/advisories/GHSA-q7qp-rjg7-q26m) ve [GHSA-qvfw](https://github.com/advisories/GHSA-qvfw-j98x-7q72): async `fileFilter`. | **Evet** alan adı açıkları için (`PATCH /users/me/avatar`, `upload.single('photo')`). Async filtre açıkları: hayır, filtre senkron (`user/src/core/middleware/upload.ts`). | 2.5.0 | Uygula |
| ws (realtime, engine.io ve socket.io-adapter üzerinden) | 8.18.3 | [GHSA-96hv](https://github.com/advisories/GHSA-96hv-2xvq-fx4p) high: küçük fragment'larla bellek tüketme. [GHSA-58qx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx) moderate | **Evet**: websocket transport, uygulama kimlik doğrulamasından önce | 8.21.3 | Uygula |
| socket.io-parser (realtime) | 4.2.6 | [GHSA-2m8v](https://github.com/advisories/GHSA-2m8v-j782-fhvr) high: ek (attachment) sayısıyla bellek tüketme | **Evet** | 4.2.7 | Uygula |
| engine.io (realtime) | 6.6.6 | GHSA-r635, GHSA-gr94, GHSA-2gc4 (yukarıda) | **Hayır** (yalnız websocket, upgrade yok) | 6.6.11 | Uygula (ws için gerekli) |
| socket.io / socket.io-adapter (realtime) | 4.8.3 / 2.5.6 | Taşıyıcı paketler | — | 4.8.4 / 2.5.8 | Uygula |
| i18next-fs-backend (5 servis) | 2.6.1 | [GHSA-2933](https://github.com/advisories/GHSA-2933-q333-qg83) critical: eksik anahtar yazarken prototype pollution. [GHSA-8847](https://github.com/advisories/GHSA-8847-338w-5hcj) high: `lng`/`ns` ile yol dolaşımı | **Hayır**: `saveMissing` yok; `supportedLngs: ['en','tr']` ve `preload` (çıkarım: desteklenmeyen dil yüklenmiyor) | 2.6.9 | Uygula (ucuz patch, derinlemesine savunma) |
| i18next-http-middleware (5 servis) | 3.9.2 | [GHSA-f49m](https://github.com/advisories/GHSA-f49m-vf83-692w) critical: `missingKeyHandler`. [GHSA-jfgf](https://github.com/advisories/GHSA-jfgf-83c5-2c4m), [GHSA-5fgg](https://github.com/advisories/GHSA-5fgg-jcpf-8jjw) high: `lng`/`ns`. [GHSA-c3h8](https://github.com/advisories/GHSA-c3h8-g69v-pjrg) high: i18next < 19.5.0 gerektiriyor | **Hayır**: `missingKeyHandler` yok, `supportedLngs` var, i18next 25.8.17 | 3.9.10 | Uygula (ucuz patch). 3.9.11 dört günlüktü, bekleme kuralı dışında kaldı |
| mongoose (5 servis + ortak paketler) | 9.2.4 | [GHSA-664h](https://github.com/advisories/GHSA-664h-wqgq-64gw) moderate: kullanıcının belirlediği update anahtarında `__proto__.` | Düşük olasılık (çıkarım): `$set` her zaman Zod'dan geçmiş veriyle çağrılıyor ve bilinmeyen üst anahtarlar düşüyor; `props` record'ları iç içe | 9.11.4 | Uygula (minör; 9.11.4'te ek prototype pollution sıkılaştırmaları var) |
| zod (5 servis + ortak paketler) | 4.3.6 | [GHSA-mrhx](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) high: uzunluk kısıtı olmayan dizilerde hata nesnesi birikmesi | **Kısmen**: `.max()` olmayan `z.array` şemaları var; 100 KB gövde sınırı bunu sınırlıyor | 4.6.7 | Uygula |
| proxy-addr (Express üzerinden) | 2.0.7 | [GHSA-jqcg](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) critical: `::ffff:10.0.0.0/8` gibi bir trust subnet her IPv4'ü eşliyor | **Hayır**: `app.enable('trust proxy')` subnet değil, "hepsine güven" (bu ayrı bir konu, aşağıda) | 2.0.8 | Uygula (kilit) |
| qs (body-parser ve Express üzerinden) | 6.15.0 | Dört moderate advisory: stringify, `comma` seçeneği, `isBuffer` | **Hayır** (çıkarım): `urlencoded` `comma` seçeneği vermiyor; stringify kullanılmıyor; Express 5'in query parser'ı varsayılan olarak qs değil | 6.16.1 | Uygula (kilit) |
| path-to-regexp (router üzerinden) | 8.3.0 | [GHSA-j3q9](https://github.com/advisories/GHSA-j3q9-mxjg-w52f) high ve GHSA-27v5 moderate: route tanımındaki opsiyonel grup ve wildcard'lar | **Hayır**: hiçbir route'ta opsiyonel grup ya da wildcard yok | 8.4.2 | Uygula (kilit) |
| ip-address (mongodb ve mqtt → socks üzerinden) | 10.1.0 | Altı advisory (1 high) | **Hayır**: SOCKS proxy (`proxyHost`) kullanılmıyor | 10.7.4 | Uygula (kilit) |
| moment (winston-daily-rotate-file → file-stream-rotator üzerinden) | 2.30.1 | [GHSA-4p3w](https://github.com/advisories/GHSA-4p3w-j4w9-5jqw) moderate: locale adıyla yol dolaşımı | **Hayır**: locale'e kullanıcı girdisi gitmiyor | 2.31.0 | Uygula (kilit) |
| morgan (5 servis) | 1.10.1 | Üç moderate log forging advisory'si | **Hayır** (üretimde): `NODE_ENV === 'production'` iken winston HTTP logger devrede | 1.12.1 | Uygula (ucuz) |
| uuid (core, user) | 13.0.0 | [GHSA-w5hq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) moderate: v3/v5/v6'da buffer sınırı | **Hayır**: yalnız `v4` kullanılıyor | 13.0.2 | Uygula (ucuz patch) |

"Ucuz patch" kararları için ilkem şu: aynı ana sürüm içinde ve riski düşük olan güncellemeler, açık erişilemez olsa bile uygulandı. Böylece `pnpm audit --prod` sıfırda kalıyor ve ileride gelen gerçek bir uyarı gürültüde kaybolmuyor.

## Karar tablosu — araçlar ve runtime

| Aday | Önce | Bulgu | Hedef | Karar |
|---|---|---|---|---|
| Node.js (Docker, CI, devcontainer) | 20 (EOL 2026-04-30); yerel 24.14.1 | Destek bitti. Node 24 hattının son güvenlik sürümü 24.22.1 ([duyuru](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)) | `node:24-alpine`, CI `24`, devcontainer `5-24-bookworm` | Uygula |
| pnpm (packageManager, 6 Dockerfile) | 10.32.1 | 10.x'te 19 advisory ([liste](https://github.com/advisories?query=pnpm)), hepsi 10.34.5'te kapanıyor | 10.34.8 | Uygula |
| `engines.node` (kök + 8 ortak paket) | `>=20.0.0` (Mongoose 9 için zaten yanlıştı) | — | `>=24.0.0` | Uygula |
| `@types/node` (16 paket) | 20 ve 25 karışık | Runtime ile tip uyumsuzluğu | `^24.19.2` | Uygula |
| vitest / @vitest/coverage-v8 | 3.2.4 + 4.0.18 | [GHSA-5xrq](https://github.com/advisories/GHSA-5xrq-8626-4rwp): UI/API sunucusu (bizde yok); tinypool'da iki critical | 4.1.12 | Uygula (dev) |
| testcontainers, @testcontainers/mongodb | 11.12.0 | undici, protobufjs, grpc-js, tmp, lodash zincirleri | 11.14.0 | Uygula (dev) |
| @faker-js/faker, turbo, commitlint 20, lint-staged 16, tsx, supertest | — | Aynı ana sürüm içinde, geçişli advisory'ler | Ana sürüm içinde en yeni (≥7 gün) | Uygula (dev) |
| BullMQ | 5.70.4 (`@mes/health`, dev) | Hiçbir yerde import edilmiyor | — | Gereksiz: güncelleme yerine kaldırılmalı (ayrı öneri) |
| ioredis | 5.10.0 / 5.9.3 | Advisory yok | — | Ertele |
| Biome | 2.4.6 | Advisory yok; yeni sürüm biçim kurallarını değiştirip bütün depoyu yeniden formatlayabilir | — | Ertele |
| TypeScript 7, Vitest 5, testcontainers 12, ioredis 6, zod-openapi 6, i18next 26, uuid 14, dotenv 18, commitlint 21, lint-staged 17 | — | Ana sürüm geçişleri | — | Ertele (ayrı değerlendirme) |
| Node 26 | — | 28 Ekim 2026'da LTS oldu; destek Nisan 2029'a kadar (24'ünki Nisan 2028) | `node:26-alpine`, CI `26`, devcontainer `5-26-bookworm` | Önce ertelendi, aynı gün uygulandı (aşağıdaki not) |

**Node 26 notu (aynı gün):** İlk karar yeni LTS'in oturmasını beklemekti. Ürün henüz sahada olmadığı ve yerel geliştirme 26'ya geçtiği için değişti: ilk müşteri kurulumunda 26 zaten aylardır LTS olacak, desteği de bir yıl daha uzun. Tek kırıcı değişiklik, Node 25'ten beri Corepack'in dağıtılmaması; Dockerfile'lar pnpm'i artık `npm install -g` ile kuruyor. 25.0.0 ve 26.0.0'ın semver-major değişiklikleri bağımlılıklara karşı tarandı: `writeHeader` yalnız socket.io'nun kullanılmayan uWebSockets yolunda geçiyor, `_stream_*` modüllerini kullanan bağımlılık yok, `module.register` uyarısı hiçbir çalıştırmada çıkmadı.

## Uygulanan değişiklikler

**Runtime ve araçlar:**
- 6 Dockerfile: `FROM node:20-alpine` → `FROM node:24-alpine` (builder ve runner); `corepack prepare pnpm@10.32.1` → `pnpm@10.34.8`.
- `.github/workflows/ci.yml`: dört işte `node-version: 24`.
- `.devcontainer/docker-compose.dev.yml`: `typescript-node:1-20-bookworm` → `5-24-bookworm` (Node 24 için `1-24-*` etiketi yok). `.devcontainer/devcontainer.json`: node feature `"20"` → `"24"`.
- `package.json`: `packageManager` `pnpm@10.34.8`; `engines.node` `>=24.0.0` (kök ve 8 ortak paket).

**Bağımlılıklar** (manifest; geçişli olanlar yalnız kilitte):
- express `^5.3.0`, compression `^1.8.2`, multer `^2.5.0`, socket.io `^4.8.4`, i18next-fs-backend `^2.6.9`, i18next-http-middleware `^3.9.10`, mongoose `^9.11.4`, morgan `^1.12.1`, uuid `^13.0.2`, zod `^4.6.7`.
- Geçişli, yalnız kilitte: body-parser 2.4.0, qs 6.16.1, proxy-addr 2.0.8, path-to-regexp 8.4.2, engine.io 6.6.11, socket.io-adapter 2.5.8, socket.io-parser 4.2.7, ws 8.21.3, socks 2.8.10, ip-address 10.7.4, moment 2.31.0, mongodb 7.7.0.
- Dev: vitest ve coverage-v8 `^4.1.12`, testcontainers ve @testcontainers/mongodb `^11.14.0`, @faker-js/faker `^10.6.0`, turbo `^2.11.10`, commitlint `^20.5.3`, lint-staged `^16.4.0`, tsx `^4.23.15`, supertest `^7.3.1`, @types/supertest `^7.2.1`, @types/multer `^2.3.0`, `@types/node` `^24.19.2`.
- pnpm, manifestleri yazarken bağımlılık anahtarlarını alfabetik sıraladı. Bu bir içerik değişikliği değil, ama diff'te satır taşımaları olarak görünüyor.

**Yükseltmenin gerektirdiği küçük kod uyarlamaları** (Mongoose 9.11'in daha katı tipleri):
- `performance/src/modules/reason/reason.service.ts`: `findIds` parametresi `string[]` → `ReasonUsage[]`. Filtre artık alanın enum tipini istiyor; tek çağıran zaten bu üç değeri geçiyor.
- `production/src/modules/production-plan/production-plan.service.ts`: `getJobOrderModel()`'in açık `mongoose.Model<any>` dönüş tipi kaldırıldı, çıkarıma bırakıldı. Şemasız `mongoose.model(name)` artık `Model<any, unknown, …>` döndürüyor.

**Yük altında kararsız çıkan testler** (Vitest 4.1'in kendisi yavaş değil, aşağıda ölçüm var):
- `performance/src/app.smoke.test.ts`: Uygulama modüllerinin yüklenmesi test gövdesinden `beforeAll`'a taşındı (hookTimeout 120 s).
- `realtime/src/config/config.test.ts` ve `telemetry/src/config/config.test.ts`: Config modülü geçerli bir env ile `beforeAll`'da bir kez yükleniyor. Testler yine her seferinde `resetModules` sonrası yeniden import ediyor.

## Doğrulama

- `pnpm install --frozen-lockfile`: geçti. Kilit manifestlerle tutarlı; Docker build'leri aynı kilidi kullanıyor.
- `pnpm audit --prod`: **0**. `pnpm audit` (dev dahil): 14 kayıt:
  - vite 7.3.1: 10 kayıt. Vitest'in auto-installed peer'ı; `vitest run` vite dev sunucusunu açmıyor.
  - esbuild 0.27.7: vite'ın bağımlılığı.
  - minimatch ve glob: testcontainers → archiver; düzeltmesi ana sürüm atlayarak geliyor.
  - uuid 10.0.0 (dockerode) ve uuid 11.1.0 (kullanılmayan bullmq).
- `pnpm typecheck`: 23/23 (yukarıdaki iki tip uyarlamasından sonra).
- `biome ci --diagnostic-level=error`, temiz checkout üzerinde: geçti.
- **Yerel (Windows, Node 24.14.1):**
  - Cache'siz unit suite: 820/820 (18/18 task).
  - Cache'siz contract: 13/13 task; performance 34/34 dahil.
  - e2e: 10/10.
- **Kararsızlık ölçümleri:**
  - Güncellemeden sonraki ilk iki tam koşuda iki ayrı test zaman aşımına düştü: performance smoke 34,9 s / 30 s limit, realtime config 5,9 s / 5 s limit.
  - Aynı testler tek başına, eski ve yeni Vitest ile aynı sürede koşuyor:

    | Test | Eski Vitest | Yeni Vitest (4.1.12) |
    |---|---|---|
    | realtime config | 114–264 ms (3.2.4) | 134–151 ms |
    | performance smoke | 2068–2393 ms (4.0.18) | 2332–2899 ms |

  - Yani sebep, test gövdesinde yapılan soğuk import'un tam paralel yük altında 15–40 katına uzaması. Düzeltmeden sonra iki test, 14 çekirdekte 28 CPU yakıcı altında 5/5 geçti; tam suite yeniden 820/820.
- **Üretim başlangıç süresi:** Performance servisinin build edilmiş Express loader'ının soğuk import'u, güncelleme öncesi ve sonrası dönüşümlü dörder ölçümde aynı kaldı:

  | | Ölçümler |
  |---|---|
  | Eski | 1072–2142 ms |
  | Yeni | 1212–1993 ms |

  Zod 4.6, Express 5.3 ve Mongoose 9.11 başlangıcı yavaşlatmıyor.
- **Docker imajları (`node:24-alpine`):** Altı Dockerfile da build oldu. Bu, şunların çalıştığını gösteriyor: corepack ile pnpm 10.34.8 kurulumu, Alpine'da `--frozen-lockfile` ile kurulum, tsc build'i ve `pnpm deploy --prod`. Her imaj Mongo, Redis ve MQTT'ye karşı e2e ile aynı ortam değişkenleriyle çalıştırıldı:
  - Altısı da **Node v24.22.2** ile başladı ve `/health/ready` 200 döndü.
  - Loglarda **0 hata** var. realtime'daki tek uyarı, açılışta Redis bağlantısı hazır olmadan gelen bir readiness yoklaması; sonraki yoklama hazırdı.
  - Üretim bağımlılık yollarında native ya da build script'i olan paket yok (`pnpm why --prod`), yani runtime imajlarına musl binary sorunu taşıyacak paket girmiyor.
  - İmajlar yalnız üretim bağımlılıklarıyla kurulduğu için, eksik bir üretim bağımlılığını yakalayabilen tek kontrol bu. e2e harness'i servisleri dev bağımlılıklarıyla birlikte çalıştırıyor.
- **Linux + Node 24 provası (`node:24-bookworm`, Node v24.22.2, pnpm 10.34.8, CI ile aynı adımlar):** Temiz bir container'da, `.env` olmadan, kilitten sıfır kurulumla çalıştırıldı:
  - Kurulum: geçti.
  - `biome ci`: geçti.
  - Typecheck: 23/23.
  - Unit: 820/820 (cache'siz).
  - Contract: 13/13 task (cache'siz).
  - e2e: 10/10.

  Tek prova-özel değişiklik: performance contract setup'ı Redis'e sabit `127.0.0.1` ile bağlanıyor ve bu adres container içinde Docker host'u değil. Satır yalnız prova container'ında `getHost()` ile değiştirildi. GitHub runner'ında testler host üzerinde koştuğu için bu adres doğru; repodaki kod değişmedi.
- **Çalıştırılamayanlar:**
  - GitHub Actions'ta gerçek koşu (push yapılmadı).
  - Devcontainer build'i (yaklaşık 1 GB imaj indirmesi gerekiyordu).
  - Traefik, Loki ve Grafana dahil tam `docker compose` yığını.

Sıfır audit sonucu ve geçen testler "hatasız" garantisi değildir. Erişilebilirlik sütunundaki "çıkarım"lar kod okumasına dayanıyor, istismar denemesine değil.

## Ayrı öneriler (kapsam dışı)

İlk üçü aynı gün ayrıca ele alındı; sonuçları maddelerin altında.

1. **Avatar yüklemede içerik doğrulaması yok.** Filtre yalnız istemcinin gönderdiği `mimetype`'a bakıyor; uzantı `originalname`'den alınıyor (`user/src/core/middleware/upload.ts`). `image/png` ile bir `.html` dosyası yüklenebilir. Yüklenenler doğrudan servis ediliyorsa bu, kalıcı XSS demek. Öneri: magic byte kontrolü yapmak ve uzantıyı izinli listeden üretmek.
   **Sonuç: uygulandı.** Dosya bellekte tutuluyor. Yalnız ilk byte'ları JPEG, PNG ya da WebP olan dosya diske yazılıyor; uzantısı da içerikten geliyor. Resim olmayan dosya ve 5 MB üstü dosya artık 500 değil, 400 dönüyor. Bugün Traefik `/uploads`'u yönlendirmiyor, yani açık dışarıdan istismar edilemiyordu; ama avatarları göstermek için bu yolun açılması gerekecek.
2. **`trust proxy` `true`.** Bu ayar `X-Forwarded-For`'a koşulsuz güveniyor; servislere Traefik'i atlayarak erişilebiliyorsa `req.ip` sahtelenebilir. Öneri: Traefik'in hop sayısı ya da ağıyla sınırlamak.
   **Sonuç: gereksiz.** Traefik v2.11, bu depodaki entrypoint ayarlarıyla, istemcinin gönderdiği `X-Forwarded-For`'u siliyor ve yerine bağlanan adresi yazıyor. Bu, gerçek bir Traefik ve whoami denemesiyle doğrulandı. Servislerin portları da dışarı açık değil. Ayar ancak Traefik'in önüne, başlıklarına güvenilen bir proxy eklenirse yeniden ele alınmalı.
3. **BullMQ kullanılmıyor.** `@mes/health`'teki dev bağımlılığı ve `bullmqProbe` export'u kaldırılmalı. Bu, `uuid@11.1.0` kopyasını da götürür.
   **Sonuç: uygulandı.** `bullmq`, `@mes/health`'te zorunlu peer dependency olduğu için pnpm onu otomatik kuruyordu. Bu yüzden yalnız dev'de değil, altı üretim imajının hepsinde vardı: 5.81.5, yaklaşık 3,4 MB, native `msgpackr-extract` ile birlikte. Kilitten 12 paket çıktı.
4. **`minimumReleaseAge: 10080`'i kalıcı yapmak** (`pnpm-workspace.yaml`). Bu incelemede yalnız komut satırından kullanıldı; kalıcı hali Dependabot cooldown'u ile aynı ilkeyi yerel kurulumlara da getirir.
   **Sonuç: uygulandı.** Bir deneme projesinde doğrulandı: ayar yokken `@types/node@^26.6.0` 3 günlük 26.6.6'ya, ayarla 7 günden eski 26.6.5'e çözülüyor. pnpm 10 kilitteki sürümleri yeniden denetlemiyor; kilitten kurulum (CI, imajlar) etkilenmiyor, ayar yalnız yeni çözümlemeleri sınırlıyor. pnpm 12 kilidi de denetliyor; o yükseltmede bu fark akılda tutulmalı. Acil bir yama gerekirse paket ya da sürüm `minimumReleaseAgeExclude`'a yazılır.
5. **Docker base imajlarını tam sürüme sabitlemek** ve Dependabot'a `docker` ekosistemini eklemek. Şu an `node:24-alpine`, her build'de o anki 24.x'i çekiyor.
   **Sonuç: uygulandı.** Altı Dockerfile `node:26.13.0-alpine@sha256:c6ad9e9c…` kullanıyor; bu, test edilen `node:26-alpine` ile aynı çok mimarili (amd64, arm64) imaj. Sürüm etiketi okunurluk için, digest yeniden üretilebilirlik için: Docker resmî imajları aynı etiketle yeniden yayımlandığında bile build aynı imajdan başlıyor. Etikette Alpine sürümü bilerek yazılmadı; Alpine yükseltmeleri de digest değişikliği olarak Dependabot'un aylık, 7 gün bekleyen ve CI'dan geçen pull request'iyle geliyor. `docker-compose.yml`'deki altyapı imajları aynı gün ayrıca sabitlendi (10. madde).
6. **Yerel Node'u güncellemek.** Yerel 24.14.1, Ekim 2026 güvenlik yamasından (24.22.1) önceki bir sürüm.
   **Sonuç:** Yerel Node 26.13.0'a geçti; imajlar, CI ve devcontainer de Node 26'ya taşındı.
7. **CI'a `pnpm audit --prod` adımı eklemek** (opsiyonel). Üretim ağacı sıfırda tutulsun diye.
   **Sonuç: uygulandı.** CI'da ayrı bir "Production dependency audit" işi var; yalnız kilit dosyasını okuduğu için kurulum yapmıyor. Temiz bir Linux checkout'unda kurulumsuz çalıştığı ve bugünkü üretim ağacında açık bulmadığı doğrulandı. Boşuna geçmediği de denendi: bilinen açığı olan bir çalışma zamanı bağımlılığıyla 1 ile çıkıyor, dev bağımlılıklarını saymıyor. Kabul edilen bir açık `pnpm-workspace.yaml`'daki `auditConfig`'e yazılır.
8. **realtime'da `cors: { origin: '*' }`** (`realtime/src/gateway/socket.ts:49`). JWT ile birlikte kabul edilebilir, ama gözden geçirilmeli.
   **Sonuç: gözden geçirildi, değişiklik gerekmiyor.** Token yalnız Socket.IO'nun bağlantı paketindeki `auth.token`'dan okunuyor; cookie'den ya da URL'den okunmuyor. Yabancı bir sayfa soket açabilir, ama kullanıcının token'ını bilmediği için kimlik doğrulamadan geçemez (Cross-Site WebSocket Hijacking için tarayıcının kendiliğinden gönderdiği bir kimlik bilgisi gerekir). Token URL'de olmadığı için Traefik'in erişim loglarına da düşmüyor. Sunucu yalnız WebSocket kullanıyor; `cors` ayarı HTTP long-polling isteklerini ilgilendirdiği için bu kurulumda fiilen etkisiz.
9. **İmajlar kilit dosyasıyla kurulmuyor** (BullMQ'yu kaldırırken bulundu). Dockerfile'lardaki `pnpm deploy --legacy`, pnpm 10'da paylaşılan kilidi kullanmıyor; servisin bağımlılıklarını build anında yeniden çözüyor. Node 26 provası için build edilen user imajında `ioredis` 5.11.1 ve `qs` 6.17.1 var; kilitte 5.10.0 ve 6.16.1. Yani testlerden geçen sürümlerle üretime giden sürümler ayrışabiliyor, ve bu incelemedeki audit ile 7 günlük bekleme kuralı imajlara yansımıyor. Ayrı bir iş olarak ele alınmalı.
   **Sonuç: uygulandı.** Ölçüm: altı imajın her birinde kilit dosyasında olmayan 15–28 paket sürümü vardı (örneğin hepsinde `i18next` 25.10.10, kilitte 25.8.17). Çözüm: `injectWorkspacePackages: true` ve `--legacy` olmadan `pnpm deploy`. Kilitte yalnız bir ayar satırı değişti; workspace paketleri geliştirmede yine symlink. Bu, gizli bir hatayı da ortaya çıkardı: `@mes/auth` `jsonwebtoken`'ı, `@mes/logger` da `morgan`'ı yalnız peer olarak tanımlıyordu ve servislerin çoğu bunları kendi bağımlılığı olarak tanımlamıyordu. Eski deploy bu eksik peer'ları her build'de registry'den o anki sürümle tamamlıyordu; kilide göre kurulumda beş servis `Cannot find package 'jsonwebtoken'` ile açılışta çöktü. İkisi de ilgili paketin normal bağımlılığı yapıldı. Sonrasında altı imajda da kilit dışında paket kalmadı ve altısı da hatasız ayağa kalktı.
10. **Altyapı imajları yüzen etiketlerde** (5. maddeden sonra eklendi). `traefik:v2.11`, `mongo:7`, `redis:7-alpine` ve `eclipse-mosquitto:2` her çekişte o anki sürümü getiriyordu; Grafana imajlarında digest yoktu. Örneğin `eclipse-mosquitto:2` bu yıl 2.0'dan 2.1'e geçti.
   **Sonuç: uygulandı.** Yedi imaj, bugün çözüldükleri tam sürüm ve digest ile sabitlendi: `traefik:v2.11.61`, `mongo:7.0.45`, `redis:7.4.12-alpine`, `eclipse-mosquitto:2.1.2-alpine`, `grafana/loki:3.4.1`, `grafana/promtail:3.4.1`, `grafana/grafana:11.6.0`. Dependabot `docker-compose` ekosistemiyle ayda bir yama ve minör sürümleri önerecek; ana sürümler hem burada hem Node imajında bilerek dışarıda, çünkü onlar bir geçiş işi. Bütün yığın bu imajlarla ayağa kaldırıldı: on üç container'dan on ikisi sağlıklı, Traefik beş servise doğru yönlendiriyor, Grafana ve Loki hazır, servis loglarında hata yok. Promtail çalışıyor ama compose'daki sağlık kontrolü imajda olmayan `wget`'i çağırdığı için hep "unhealthy"; bu sabitlemeden önce de böyleydi.
   **Yaşam döngüsü (ayrı kararlar):** Traefik'in resmî tablosuna göre 2.11'in güvenlik desteği 7 Eylül 2026'da bitti; yamalar hâlâ çıksa da taahhüt yok, v3.7'ye geçiş planlanmalı. Promtail 2 Mart 2026'da EOL oldu; yerini Grafana Alloy alıyor. MongoDB 7.0'ın desteği 31 Ağustos 2027'de bitiyor; 8.0 geçişi o tarihten önce yapılmalı.
   **Traefik sonucu: v3.7.16'ya geçildi** (bir güvenlik açığını kapatan, 7 günden eski en yeni yama; 3.7.17'de güvenlik düzeltmesi yok). Geçiş rehberi bizim ayarlarla karşılaştırıldı: kullanılan kurallar (`PathPrefix` ve `||`), middleware'ler (compress, headers, ratelimit, buffering) ve metrik ayarları v3'te değişmeden geçerli; yalnız imaj değişti. Aynı yığında önce v2.11.61, sonra yalnız Traefik değiştirilerek v3.7.16 ölçüldü: 13 HTTP route aynı servislere gidiyor ve aynı güvenlik başlıklarını taşıyor, sıkıştırma, 25 MB sınırı ve giriş rate limit'i aynı davranıyor, WebSocket (`/socket.io`) açılıyor. v3.7.16 de sahte `X-Forwarded-For`'u siliyor (2. maddenin sonucu geçerli). Başlangıçta görülen iki uyarı (kodlanmış karakterler, `aliasHeadersStrategy`) Node arka uçlarımız için bir açık değil; varsayılanlar bırakıldı.
   **Promtail sonucu: Grafana Alloy'a (v1.21.2) geçildi.** Alloy'un kendi dönüştürücüsü (`alloy convert --source-format=promtail`) aynı yapıyı üretti; ayar elle sadeleştirildi. Aynı yığında Promtail ve Alloy yan yana ölçüldü: üretimdeki gibi JSON log yazan bir serviste ikisi de `level` etiketini çıkarıyor ve aynı satırları taşıyor (3.000 isteklik bir yükte Traefik'ten ikisi de 3.055 satır). Bilinçli farklar: etiketler CLAUDE.md'deki tasarıma indirildi (`service` ve `level`; Promtail ayarında ayrıca `container` vardı), Alloy'un kendi logları gerçekten dışarıda (Promtail'in kendini dışlayan kuralı regex tam eşleşmediği için hiç çalışmamıştı), sağlık kontrolü artık gerçek (imajda `wget` olmadığı için `bash` ile yazıldı; Promtail'inki hep başarısızdı). Bellek yük altında en fazla 69 MiB; Promtail'in 128 MB sınırı korundu. Not: yerel `.env` dosyaları servisleri `development` modunda çalıştırdığı için yerel yığındaki loglar JSON değil ve orada `level` etiketi oluşmuyor; bu iki araçta da aynı.
   **MongoDB sonucu: 8.0 değil 9.0'a geçildi** (kullanıcının kararıyla). 9.0 Eylül 2026'da çıktı ve 31 Ekim 2031'e kadar destekli; 8.0'ın desteği 31 Ekim 2029'da bitiyor. Ürün sahada olmadığı için ilk kuruluma kadar olgunlaşacak ve sahada ikinci bir 8→9 veri geçişi gerekmeyecek. Kullanılan mongodb sürücüsü (7.7) resmî tabloya göre 9.0'ı tam destekliyor; 9.0'ın uyumluluk değişiklikleri (`$group`'ta boş alan adı, ppc64le'de sunucu tarafı JavaScript, change stream ve `renameCollection` davranışları) bu kodu etkilemiyor. Sabitlenen sürüm 9.0.2: 7 günden eski en yeni yama; 9.0.4'ün düzeltmeleri replica set ve sharding'e özgü. Testler artık imajı `docker-compose.yml`'den okuyor (`MONGO_IMAGE`, `@mes/testing`); Dependabot compose'u yükselttiğinde testler de aynı imajla koşuyor. Unit ve contract testleri aynı sürümü digest'siz alıyor: Testcontainers'ın MongoDB modülü, kabuğunu etiketteki sürüme göre seçiyor ve `ad:etiket@digest` biçimini sürümsüz okuyup 9.0'da olmayan eski kabuğa düşüyor (container hiç sağlıklı olmuyor). E2E tam digest'le koşuyor. Yerel veri resmî yoldan taşındı: önce dosya yedeği, sonra 8.0.34'te uyumluluk sürümü 8.0, 9.0.2'de 9.0; her adımda bütün koleksiyonların belge sayıları 7.0'daki ile aynı.
11. **realtime'ın hazır olma kontrolü aralıklı başarısız oluyor** (Traefik geçişini doğrularken bulundu). `redisProbe(streamClient)`, stream tüketicisinin `XREADGROUP BLOCK 5000` ile meşgul ettiği bağlantıya PING atıyor; PING engellenmiş komutun arkasında bekliyor ve 1500 ms'lik süreyi aşıyor. Sağlıklı bir yığında son beş Docker sağlık denemesinden dördü başarısızdı. Container `starting` ya da `unhealthy` durumundayken Traefik (v2 de, v3 de) onu route'tan çıkarıyor; WebSocket istemcileri o arada bağlanamıyor. Diğer beş servis sorunsuz: onlar engellenmeyen önbellek bağlantısını yokluyor. Öneri: realtime'ın sağlık kontrolü ayrı, engellenmeyen bir bağlantıyı yoklasın.
   **Sonuç: düzeltildi.** Sağlık kontrolü artık realtime'ın zaten açık olan, engellenmeyen `sharedClient` bağlantısını yokluyor (aynı Redis). Önce hatayı gösteren bir test yazıldı: gerçek bir Redis container'ında tüketici beklemedeyken `/health/ready` 503 dönüyordu; düzeltmeden sonra art arda üç deneme 200. Working tree'den build edilen imajda on denemenin onu da 200 döndü ve Docker'ın sağlık denemeleri sürekli başarılı.
