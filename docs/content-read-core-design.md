# 共用內容讀取核心與平台接線（設計草稿）

狀態：**草稿，尚未核准實作。** 本文取代原本只針對 Astro 的 `docs/astro-content-read-module-design.md`（已改名為本檔）。依據 ROADMAP 1.3（2026-10-13 確認的方向）：所有框架用同一套 Morph API 讀內容，讀取核心不依賴 React 或 Astro，框架接線由平台或 integration 處理。所述「現況」於 2026-10-13 對照 `main`（`c266b9c`）核對。

標示方式：**【已核對】** 是在程式碼或測試中確認的事實，附檔案位置；**【提案】** 是本文的設計，待核准；**【未驗證】** 是尚未用測試證明的部分。

範圍外：正式 SDK 的交付、產品程式、Starter、編輯器、L1.5（`.astro` 點選定位與欄位綁定）、資料來源標記的實作。本文不改內容綁定契約（#210）與讀取契約（#187）。

## 0. 驗證層級

本文與測試把三個層級分開記錄，不互相代替：

| 層級 | 證明什麼 | 不證明什麼 |
|---|---|---|
| **核心原型測試**（Node 直接執行 `core.ts`） | 共用設計可行：同一份核心、同一個 API、同樣的頁面形狀與錯誤碼 | 任何框架的接線 |
| **真實 Astro／Start 執行**（本機 `astro dev`、Start dev server、`astro build`） | 各框架的接線可行 | 正式 Cloudflare、Build Preview、預覽撤銷 |
| 以上兩者 | — | 正式 Cloudflare 環境、預覽權限撤銷（#214）、完整 Design 驗收（點選、Inspector、寫入、重新載入） |

## 1. 方向與分工【已核對：ROADMAP 1.3】

- Morph 的運作像前後端分離的 CMS。作者照原生 Astro、React、Vue 等框架的寫法撰寫網站，每個框架都用同一個呼叫讀內容：`const home = await morph.pages.get("/")`。Design 編輯這些內容，不要求作者改用 Morph 指定的寫法。
- 統一的是讀取呼叫，不是「完全不需要接線」。預覽憑證、每次請求的上下文、存檔後刷新，仍需要少量框架接線；這些由平台或 integration 提供，**作者不寫**，也不變成每個頁面都要配合的寫法。
- 讀取共用，寫入權限分開（§6）。程式碼管呈現，Document 管內容值（§7）。

## 2. 共用讀取核心【提案；原型已核對】

### 2.1 一份核心，不依賴框架

【提案】讀取邏輯只有一份：取得頁面、驗證回應、組成頁面形狀、命名錯誤。它不 import React、Astro、Start 或任何 `node:` 模組，只用 `fetch`、`URL`、`AbortSignal`。框架只回答核心的一個問題：**這次讀取的內容從哪裡來**（`MorphContentSource`），而且每次讀取都問一次，不快取。

```ts
type MorphContentSource =
  | { kind: "forwarded"; origin: string | null; localOrigin?: string | null } // 伺服器端：本次請求的平台標頭
  | { kind: "same-origin" };                                                   // 瀏覽器：頁面自己的 /_morph/content
function createMorph(source: () => MorphContentSource | undefined): {
  pages: { get(path: string): Promise<MorphPage>; isHidden(page: MorphPage, slotId: string): boolean };
};
```

`source()` 回傳 `undefined` 表示接線找不到目前的請求。

【已核對：原型】`fixtures/morph/content-read-core/core.ts`（標明 TEST PROTOTYPE，不被產品程式 import；測試 `content-read-core.test.ts` 檢查它第一行的標示、它沒有任何 import、`src/` 下沒有模組 import `fixtures/morph`）。

### 2.2 作者端的 API

```ts
import { morph } from "../morph/content";
const home = await morph.pages.get("/");
const { hero } = home;
```

各框架的頁面寫法（皆為 #210 的案例原文）：

- Astro frontmatter：`const home = await morph.pages.get("/"); const { hero } = home;` → `<Hero {...hero} />`（案例 A）。
- Start：`createServerFn().handler(() => morph.pages.get("/"))` → `loader` → `Route.useLoaderData()` → `<Hero {...hero} />`（案例 B）。

`morph` 從 `src/morph/content.ts` 具名 import。這個路徑沿用既有的內容模組辨識（`src/lib/storefront/compiler/theme-route-sections.ts` 以 `src/morph/content.ts` 認 `morph`）【已核對】。

### 2.3 頁面形狀

【已核對：與 Start Starter 相同】`{ ...slots, _hidden: hiddenSlots }`。隱藏的區塊不在 `slots`，所以 `page.hero` 是 `undefined`；`morph.pages.isHidden(page, "hero")` 為 true。Start Starter 的 `src/morph/content.ts`（`src/lib/storefront/starter-theme-v3-files.ts` 的 `STARTER_THEME_CONTENT_MODULE_SOURCE`）是同一形狀。#187 §3.2（隱藏的區塊改為 `{}`）若核准，核心只改一處，所有框架一起變。

### 2.4 共用錯誤碼

【已核對：原型與 Starter 逐字相同】封閉集合 `MorphContentErrorCode`，10 個，同順序、同字句（測試比對兩份原始碼，並反向確認改字或刪碼會被看出）：

| 代碼 | 何時 |
|---|---|
| `no_content_source` | 接線找不到請求（`source()` 為 `undefined`，訊息為核心固定的「ran outside a request the platform wired」），或請求沒有平台標頭且沒有開發用位址 |
| `invalid_content_origin` | 標頭存在但不是 http/https 網址；**不**改用開發用位址 |
| `invalid_path` | 路徑不是字串、不以 `/` 開頭、或超過 500 字元 |
| `store_unreachable` | 連不上（網路錯誤、逾時 15 秒） |
| `content_not_found` | 非 2xx 且未命名代碼，狀態 404 |
| `store_error` | 非 2xx 且未命名代碼，其他狀態 |
| `redirect_refused`、`response_too_large` | 只在上游以 `code` 命名時出現（本機開發代理 `src/lib/storefront/local-dev/morph-dev-content-proxy.ts`）；核心本身不產生（§9 待決 4） |
| `invalid_response` | 不是 JSON，或形狀不對 |
| `reserved_slot` | `slots` 內有 `_hidden` |

錯誤訊息只用核心內寫死的字句，不含位址、上游回應或 stack；細節只寫伺服器 log【已核對：原型測試確認網路錯誤的訊息不含位址與底層錯誤字串，而 log 有】。

### 2.5 失敗不退回預設值

【提案；原型已核對】讀不到就丟 `MorphContentError`，讓頁面或建置明確失敗。不回元件預設值、不回 `{}`、不回空頁面、不 `catch` 後吞掉。

【已核對】Start Starter 另有舊介面 `loadContentSlots`（以及 `content()`、`isSectionHidden()`），失敗時回空內容、讓元件顯示預設值；既有 Astro 管線測試（`astro-native-prerender.fixtures.ts`、`e2e/astro-preview-container.spec.ts`）的讀取函式也是失敗回 `undefined`。它們不是本核心的做法，也不應沿用。

## 3. 每個框架如何取得每次請求的上下文與內容來源

### 3.1 內容來源位址：誰設定標頭【已核對】

所有路徑都只用 `x-morph-content-origin` + `GET <origin>/_morph/content?path=`，與框架無關：

| 情境 | 誰設定標頭 | 程式位置 |
|---|---|---|
| 正式店面（SSR） | Core 轉送給 Theme Worker 時 `set`，值為 Core 被呼叫的 origin | `src/lib/storefront/service/theme-runtimes.ts` `applyStorefrontContext` |
| Build Preview | Core 驗證權杖後設定 | `src/lib/storefront/service/build-preview/build-preview-request.ts` |
| Live Preview（Start dev、`astro dev`） | 預覽 Worker entry 對每個請求 `set`，指向只有它回答的 `http://morph-preview-content.invalid`，資料來自草稿快照 | `src/lib/storefront/compiler/theme-preview-start-runtime.ts` |
| 建置時預先渲染（Astro） | Morph 建置 integration 的 prerender 包裝，指向只回答封存快照的 loopback server | `src/lib/storefront/theme-framework/astro-native-prerender.ts` |
| 作者自己電腦 | 無 | Start 接線以 DEV 限定的 `MORPH_CONTENT_ORIGIN` 補上；Astro 尚無（§9 待決 3） |

核心只取標頭的 `origin`，路徑忽略；位址不從模組層變數、前一個請求或使用者可控的輸入取得。

### 3.2 每次請求的上下文

| 框架 | 上下文從哪裡來 | 接線（平台提供，作者不寫） | 層級 |
|---|---|---|---|
| Start | Start 自己的 `getRequest()`（`@tanstack/react-start/server`）；`createIsomorphicFn` 讓伺服器分支與其 import 不進用戶端 bundle | `content-read-core/start/content.ts` → 工作區的 `src/morph/content.ts`：伺服器回 `{ kind: "forwarded", origin: 標頭, localOrigin: DEV 限定 MORPH_CONTENT_ORIGIN }`，瀏覽器回 `same-origin` | 【已核對：真實 Start dev server】 |
| Astro | frontmatter 有 `Astro.request`，但它呼叫的模組沒有，Astro 也沒有 `getRequest()`。由平台的 middleware 以 `AsyncLocalStorage` 在一次渲染期間保存請求 | `content-read-core/astro/`：`request-context.ts`（ALS）、`middleware.ts`（`onRequest` 只做 `als.run(request, next)`，不讀內容、不改請求與回應）、`content.ts`（從 ALS 取標頭）、`integration.mjs`（以 `addMiddleware` 加入 middleware） | 【已核對：真實 `astro dev`、`astro build`】 |

兩者的頁面都只寫 `morph.pages.get(...)`。Astro 需要 middleware，但不是作者寫的：見 §4。

## 4. 平台接線與作者寫的東西

### 4.1 作者寫什麼

只有讀取呼叫：`import { morph } from "../morph/content"` 與 `await morph.pages.get(path)`。不寫 middleware、不寫讀取模組、不寫請求上下文、不碰預覽憑證。

【已核對】兩個 fixture 只含作者會寫的檔案：`fixtures/morph/astro-case-a/` 沒有 `src/middleware.ts`、沒有 `src/morph/`；`fixtures/morph/start-content-read/` 沒有 `src/morph/`。測試確認兩者都不含讀取邏輯（訊息表、`MorphContentError`、`fetch(`、`/_morph/content`）。

### 4.2 Astro：平台以 integration 注入 middleware

【已核對】Astro 7.3.5 的 integration hook `astro:config:setup` 提供 `addMiddleware({ order: "pre" | "post", entrypoint })`（`sandbox/toolchains/astro-7.3/node_modules/astro/dist/types/public/integrations.d.ts`；實作在 `dist/integrations/hooks.js`，把 entrypoint 加入 `settings.middlewares[order]`）。`order: "pre"` 會在作者自己的 middleware 之前執行，所以作者已有 `src/middleware.ts` 時也不必用 `sequence()` 串接【未驗證：作者另有 middleware 的情況沒有測】。

【已核對：真實執行，但接線位置是替代】

- `astro dev`（Morph 預覽 Worker entry、wrapper config、import guard，皆未修改）：Theme 沒有 `src/middleware.ts`，頁面讀到草稿（`local-vite-preview-server.content-read-parity.test.ts`）。
- `astro build`（Morph build runner 與 prerender 包裝，未修改）：`/about` 的預先渲染讀到封存值。反向：同一組檔案**不加** integration 時，核心拿不到請求，丟 `no_content_source`，`/about` 預先渲染失敗、建置失敗（`native-astro-case-a.build.test.ts`）。所以讓讀取成功的是 integration 的 `addMiddleware`，不是 Theme 寫的東西。

**替代之處**：正式做法是由 Morph 自己的 wrapper config 加入這個 integration（`astro-preview-workspace.ts` 的 `integrations: [...own.integrations, morphAstroPreview()]`、`astro-native-prerender.ts` 的 `morphAstroBuild()` 同一行）。那是產品程式，這一輪不改；測試支援改為把 integration 加進 Theme 的 `astro.config.mjs` 再交給 harness。效果相同（integration 進入同一份清單），但**Morph 的 wrapper 本身還沒有這一行**。

### 4.3 Start

【已核對：真實 Start dev server】接線檔案安裝為 `src/morph/content.ts`，只回答核心的問題。Start 的 `getRequest()` 本身就是每次請求的上下文，不需要額外 middleware。

【已核對】Start Starter 目前的 `src/morph/content.ts` 是作者的檔案（Starter 種入，升級規則只替換位元組未改的副本），讀取邏輯寫在裡面。改為「核心 + 接線」時，Starter 怎麼遷移屬於正式 SDK 的交付（§9 待決 5），本輪不改 Starter。

### 4.4 刷新

存檔後刷新沿用既有預覽管線：Core 寫入新的草稿快照，預覽 Worker 回答新內容，下一次渲染重新讀取。【已核對：真實執行】兩個框架寫入新快照後，下一次渲染都顯示新值（核心不快取）。

## 5. 一份核心由兩個 fixture 共用：如何證明

【已核對】

- 核心只有一個檔案：`fixtures/morph/content-read-core/core.ts`。兩個 Theme 都不帶它；測試支援（`content-read-fixtures.test-support.ts` 的 `withPlatformWiring`）像安裝套件一樣，把**同一個檔案的位元組**放進工作區的 `src/morph/core.ts`，再加上該框架的接線。
- 結構測試：兩個工作區的 `src/morph/core.ts` 的 sha256 都等於該檔；每個工作區只有這一個檔案含讀取邏輯；各框架的 `src/morph/content.ts` 都從 `./core` import。反向：Theme 自帶一份讀取程式時會被測出。
- 真實執行：parity 測試在 `astro dev` 與 Start dev server 啟動後，讀取兩個預覽工作區磁碟上的 `src/morph/core.ts`，sha256 都等於該檔。

這不是「兩邊各寫一份再比對結果」：兩邊執行的是同一份位元組；正式 SDK 的對應做法是兩邊安裝同一個套件版本。

## 6. 讀取共用，寫入權限分開【提案，依 ROADMAP 1.3】

- 公開網站：只讀指定 release 的已發布快照，不讀最新草稿。
- 預覽：讀草稿，權限受控且可撤銷（規格草稿 #214）。核心不持有任何憑證：它只照平台給的 origin 讀，`credentials: "omit"`，不轉送作者請求的其他標頭。
- Design 存檔：走授權過的寫入 API，保留版本檢查與 OCC。讀取核心沒有寫入介面。
- 畫面上的任何標記只是定位線索，不是寫入許可。

## 7. 程式碼與 Document 的分工

- 【已核對】路由頁面上有哪些區塊、區塊的順序屬於程式碼：Design 移動區塊時改寫路由的 JSX（`reorderThemeRouteSections`，`src/lib/storefront/compiler/theme-route-sections.ts`）；執行期以區塊 id 對應值，回應的 `slots` 是以 id 為鍵的物件，不帶順序（`resolveStorefrontContent`，`src/lib/storefront/service/storefront-content-runtime.ts`）。
- 【已核對】Document 管區塊的值與隱藏狀態（同上，`enabled === false` → `hiddenSlots`）。
- 【未驗證】導覽項目、商品列這類「內容陣列」的項目與順序是否屬於 Document，尚未逐一核對，不一概而論。

## 8. 資料來源標記（未驗證的選項，不是計畫）

【未驗證】在預覽回傳的內容中附上欄位來源，讓畫面上的文字能對回欄位。這只是一個待做受控實驗的選項：必須比較有無標記時作者程式的字串比較、長度、條件分支、網址與序列化結果；若作者必須到處清除標記，就等於換一種方式限制寫法；圖片、數字等非文字內容不能靠文字標記。實驗前不定為正式方案，也不取代現有的原始碼辨識。本輪沒有實作。

## 9. 待使用者決定

1. **正式接線放在哪裡**：Astro integration 是否加入 Morph 的 wrapper config（預覽與建置各一行，§4.2），或以 Morph 套件的 integration 交付。這是產品程式變更，需另行授權。
2. **接線找不到請求時的錯誤碼**：目前沿用 `no_content_source`，訊息改為核心固定的一句。或所有框架一起新增一個代碼（會改變共用集合）。
3. **作者自己電腦的內容來源**：Astro 是否也支援 DEV 限定的 `MORPH_CONTENT_ORIGIN`。Astro 在 workerd 中執行，shell 的環境變數不會自動出現在 `process.env`，做法要另外驗證；`docs/astro-theme-plan.md` §4「不採用 `MORPH_CONTENT_ORIGIN`」已與 Start 現況不一致，需要更新。
4. **轉址與大小限制**：是否在核心內 `redirect: "manual"` 並限制回應大小，讓 `redirect_refused`／`response_too_large` 不只來自本機代理。改在核心，所有框架一起生效。
5. **交付方式**：正式 SDK 是套件，或 Starter 種入的作者檔案；Start Starter 現有的 `src/morph/content.ts`（含失敗回預設值的舊介面）如何遷移。
6. **隱藏區塊**：目前形狀下，案例 A／B 的頁面直接展開 `hero`，隱藏時 `hero` 是 `undefined`，元件顯示自己的預設值（真實執行在兩個框架都如此，§10）。這不是讀取失敗，但也不是終點；由 #187 §3.2（`{}`）與 §4（編譯時注入隱藏判斷）決定，兩者都不要求作者改寫。

## 10. Fixture 與測試

| 檔案 | 內容 |
|---|---|
| `fixtures/morph/content-read-core/core.ts` | **TEST PROTOTYPE** 共用核心 |
| `fixtures/morph/content-read-core/astro/*` | **TEST PROTOTYPE** Astro 接線（content、request-context、middleware、integration） |
| `fixtures/morph/content-read-core/start/content.ts` | **TEST PROTOTYPE** Start 接線 |
| `fixtures/morph/astro-case-a/` | 純 Astro Theme：`astro.config.mjs`（`output: "server"`、`@astrojs/cloudflare`、`session: false`）、`wrangler.jsonc`（`nodejs_compat`，ALS 需要）、`Hero.astro` + `Hero.fields.ts`、`index.astro`（SSR，案例 A）、`about.astro`（預先渲染） |
| `fixtures/morph/start-content-read/` | 純 Start/React Theme：`router.tsx`、`__root.tsx`、`index.tsx`（案例 B）、`Hero.tsx`（與 Astro 版相同的標記與預設值） |

測試與層級：

- `src/lib/storefront/theme-framework/content-read-core.test.ts`
  - 結構（一份核心、兩個 Theme 都不帶、sha256 相同、純度、錯誤碼與 Starter 一致、無產品 import）。
  - **核心原型**：讀取成功、隱藏區塊、每個共用錯誤碼、網路錯誤、兩個並行請求以不同預覽上下文（ALS）各讀各的且不快取、請求外被拒。
  - **Astro 接線（Node）**：接線的真實模組，三個並行請求經 middleware，各讀自己的標頭；沒有標頭的請求被拒，不借用別的請求的。
- `src/lib/storefront/theme-framework/astro-case-a-fixture.test.ts`：Astro Theme 只含作者的檔案、純 Astro 與反向案例、加上平台檔案後原樣通過建置 materializer、`planNativeAstroBuild`、`planAstroPreviewWorkspace`、sidecar 可解析。
- `src/lib/storefront/compiler/local-vite-preview-server.content-read-parity.test.ts`，**真實執行**：同一份草稿下 `astro dev` 與 Start dev server：兩邊工作區的核心 sha256 相同；讀取成功且兩邊 hero 相同；頁面不含內容來源位址或標頭名稱；新草稿在下一次渲染出現；隱藏時兩邊都不顯示儲存的值且結果相同；讀取被拒（`invalid_path`）時兩邊都回 500、顯示該代碼的字句、不顯示元件預設值。
- `src/lib/storefront/compiler/native-astro-case-a.build.test.ts`，**真實執行**：經 build runner 的 `astro build`；`/about` 預先渲染為封存值；反向一，不加 integration 時建置因 `no_content_source` 失敗；反向二，元件 import 未核准的套件時被同一個 import guard 拒絕。

## 11. 未驗證

- 正式 Cloudflare：建置出的 Worker 在正式環境經 Core 轉送執行 SSR（本輪只建置，沒有執行建置出的 Worker）；Build Preview。
- 預覽權限撤銷（#214），以及完整 Design 驗收（點選、Inspector、寫入、重新載入）。
- 真實框架中「兩個並行請求、不同預覽上下文」：Live Preview 的 Worker 對每個請求設定同一個 origin，harness 無法給出不同上下文。並行隔離只在核心原型與 Astro 接線（Node 的 ALS）證明；workerd 中的 ALS、Start `getRequest()` 的並行隔離都未直接測。
- 真實框架中的網路錯誤與上游拒絕（`content_not_found` 等）：只在核心原型測；真實執行只測了 `invalid_path`。
- Start 接線在 Node 中直接執行（需要 Start 編譯器處理 `createIsomorphicFn`），以及 Start 的用戶端導覽讀取（`same-origin` 分支）。
- Start 的建置（本輪只有 dev server）。
- Morph 自己的 wrapper config 加入 integration（§4.2 的替代）；作者另有 `src/middleware.ts` 時的順序。
- Cloudflare Sandbox 容器 transport 的 Live Preview。
- 正式 SDK：本輪只有測試原型。
