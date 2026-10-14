# 共用內容讀取核心與平台接線（設計草稿）

狀態：**草稿，尚未核准實作。** 本文取代原本只針對 Astro 的 `docs/astro-content-read-module-design.md`（已改名為本檔）。依據 ROADMAP 1.3（2026-10-13 確認的方向）：所有框架用同一套 Morph API 讀內容，讀取核心不依賴 React 或 Astro，框架接線由平台或 integration 處理。所述「現況」於 2026-10-13 對照 `main`（`c266b9c`）核對。§4.5–§4.8（正式接線位置、SDK 交付比較、作者自己電腦、隱藏區塊驗收）是同日追加的設計比較，只有文件，沒有實作。

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
| 作者自己電腦 | 無 | Start 接線以 DEV 限定的 `MORPH_CONTENT_ORIGIN` 補上（已發布內容）；Astro 延後，設計須保留這條路（§4.7） |

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

**替代之處**：測試支援把 integration 加進 Theme 的 `astro.config.mjs` 再交給 harness，只因 Morph 的 wrapper 是產品程式、這一輪不改。這是測試的權宜，**不是正式位置**：正式接線只放在 Morph 產生的 wrapper，絕不寫進作者的設定檔（§4.5）。**Morph 的 wrapper 本身還沒有這一行。**

### 4.3 Start

【已核對：真實 Start dev server】接線檔案安裝為 `src/morph/content.ts`，只回答核心的問題。Start 的 `getRequest()` 本身就是每次請求的上下文，不需要額外 middleware。

【已核對】Start Starter 目前的 `src/morph/content.ts` 是作者的檔案（Starter 種入，升級規則只替換位元組未改的副本），讀取邏輯寫在裡面。改為「核心 + 接線」時，Starter 怎麼遷移屬於正式 SDK 的交付（§4.6），本輪不改 Starter。

### 4.4 刷新

存檔後刷新沿用既有預覽管線：Core 寫入新的草稿快照，預覽 Worker 回答新內容，下一次渲染重新讀取。【已核對：真實執行】兩個框架寫入新快照後，下一次渲染都顯示新值（核心不快取）。

### 4.5 正式接線位置：Morph 產生的 wrapper，不是作者的設定檔

原則【提案】：平台接線一律先放進 Morph 產生的 wrapper。作者的 `astro.config.mjs`、`vite.config.ts`、`wrangler.jsonc`、`src/middleware.ts` 都不為讀取內容而改。

現有的 wrapper【已核對】：

| 路徑 | 產生的檔案 | 產生它的程式 | 現在的 integration 清單 |
|---|---|---|---|
| Astro Live Preview（`astro dev`） | `.morph/astro.preview.config.mjs`（`ASTRO_PREVIEW_CONFIG_PATH`），旁邊是 integration 檔 `ASTRO_PREVIEW_INTEGRATION_PATH` | `src/lib/storefront/theme-framework/astro-preview-workspace.ts` 的 `wrapperConfigSource`，由 `planAstroPreviewWorkspace` 寫入工作區 | `[...(own.integrations ?? []), morphAstroPreview()]`；`morphAstroPreview` 的 `astro:config:setup` 目前只呼叫 `updateConfig`（Vite plugins、import guard、server 設定） |
| Astro 建置 | `.morph/astro.build.config.mjs`（`ASTRO_WRAPPER_CONFIG_PATH`），integration 原始碼由 `astroBuildIntegrationSource` 產生 | `src/lib/storefront/theme-framework/astro-native-prerender.ts` 的 `astroWrapperConfigSource`，由 `astroPrerenderWorkspaceFiles` 寫入 | `[...(own.integrations ?? []), morphAstroBuild()]`；`morphAstroBuild` 的 `astro:config:setup` 目前只呼叫 `updateConfig` |
| Start 建置 | `.morph/vite.config.ts`（`NATIVE_WRAPPER_CONFIG_PATH`） | `src/lib/storefront/theme-framework/tanstack-start-native-wrapper.ts` 的 `nativeWrapperConfigSource` | 作者的 Vite config 原樣 import，加上 Morph 的 import guard 與 frozen-content plugin |

兩份 Astro wrapper 都「原樣 import 作者的 config，Morph 只在最後加自己的 integration」，`.morph/` 是 Morph 的目錄（`tanstack-start-native-wrapper.ts` 的註解：「Nothing here rewrites the project's files; the wrapper sits beside them in `.morph/`, which is Morph's.」）。

加入的位置【提案，未實作】：

- Astro：在 `morphAstroPreview()` 與 `morphAstroBuild()` 既有的 `astro:config:setup` hook 裡多呼叫一次 `addMiddleware({ order: "pre", entrypoint })`，entrypoint 是 Morph 寫在 `.morph/` 下的 middleware 檔（相當於 `content-read-core/astro/middleware.ts` 與 `request-context.ts`）。不新增第三個 integration，也就不改 wrapper 的清單形狀；兩條路徑（預覽、建置）同一份 middleware 原始碼。
- Start：不需要 middleware（§4.3）；接線只是 `src/morph/content.ts` 的解析對象（§4.6），wrapper 不必為讀取多做事。【未驗證：Start Live Preview 的 wrapper 是否也要配合 §4.6 的模組解析】
- import guard：`.morph/` 在工作區內，兩份 guard 都以「解析到工作區內或核准的套件」判斷，所以不必放寬允許清單【已核對：guard 規則見 `astro-preview-workspace.ts` 的 `previewImportGuardSource`；未驗證：實際把 middleware 放在 `.morph/` 時】。

驗收須證明「作者設定檔未改」【提案】：

1. 以 fixture 原樣的位元組啟動 `astro dev` 與 `astro build`（不經測試支援改寫 `astro.config.mjs`），讀取成功；測試斷言交給 harness 的作者檔案 sha256 等於 fixture 磁碟上的檔案。
2. 反向：同一組檔案，wrapper 不呼叫 `addMiddleware` 時，`astro dev` 回 500（`no_content_source`），建置失敗。
3. 工作區中除了 `.morph/` 與平台安裝的檔案（§4.6）之外，沒有任何檔案與作者的修訂不同；修訂本身（存進 Core 的 source revision）不含 `.morph/`。
4. 作者自己有 `src/middleware.ts`（含 `sequence()`）時兩者都執行，作者的 middleware 讀得到內容。
5. Theme 不是 Morph 管線執行時（作者自己電腦），作者設定檔一樣不必改（§4.7）。

目前的測試替代（§4.2）只滿足 2 的建置部分，不滿足 1、3、4、5。

### 4.6 SDK 交付：兩個做法的比較

兩個做法都必須滿足的硬性條件【提案】：

- **網站永遠不帶自己改過的核心**：核心的每一份副本都等於平台維護的某一版位元組。
- **升級永遠不覆寫作者改過的檔案**。

現況【已核對】：

- `src/morph/content.ts` 是作者的檔案（rule 01 §4.4；`src/lib/storefront/ast/theme-content-module.ts` 開頭註解：「Morph seeds it and the Starter upgrade replaces an untouched copy, but an author may edit or delete it」）。
- Starter 升級只替換位元組完全等於已知 Starter 世代的副本：`src/lib/storefront/starter-theme-files.ts` 以 `LEGACY_STARTER_THEME_CONTENT_MODULE_SOURCE`、`..._V12_`、`..._V13_`、`..._V14_SOURCE` 比對 `src/morph/content.ts`；其他檔案也一樣（`createStarterThemeWorkspaceUpgrade`：「replaced only when their bytes still exactly match the previous bootstrap」）。新 route 只在它的 import 都能滿足時寫入（`starterSourceImportsSatisfied`）。升級是可預覽的計畫，以 OCC 寫入。
- 升級只對 Start 工作區（`starterUpgradeApplies`）；目前沒有 Astro Starter，Astro 工作區的升級計畫是空的。
- 已有明確的「還原內容模組」指令（`RESTORE_THEME_CONTENT_MODULE_COMMAND`，`theme-content-module.ts`），由作者主動執行。

**(a) 平台維護核心 + 作者端的薄入口檔**

- 形狀：核心（與 Astro 的 request-context／middleware）不存進網站的原始碼修訂，由平台在每次預覽、建置時放進 `.morph/`（或以 wrapper 提供的模組解析，例如 Vite alias），版本由平台決定。作者擁有一個很薄的 `src/morph/content.ts`：只從平台模組 re-export `morph`（Start 版另含 `createIsomorphicFn` 的那幾行，或也一併移到平台）。
- 核心怎麼更新：平台換掉 `.morph/` 的內容即可，網站不需要任何寫入；每次建置記錄用了哪一版核心（建議放進建置的 input hash，讓重建可重現）。
- 作者修改怎麼偵測、保留：核心不在網站裡，作者無從改它，硬性條件一自然成立。薄入口檔沿用現行規則：位元組等於已知世代才替換，否則保留並列出。作者改了入口檔（例如包一層自己的函式）也不影響核心本身。
- 既有網站的遷移：Start Starter 的 `src/morph/content.ts` 若位元組等於已知世代，升級把它換成薄入口檔；改過的保留，舊介面（`loadContentSlots`、`content()`）在遷移期間要繼續可用，不能讓作者的頁面壞掉。
- 風險：
  - 作者在 Morph 之外（自己電腦、自己的 CI）也要拿得到同一版核心，否則薄入口檔解析不到（§4.7）。這需要一個平台提供的取得方式（例如本機同步工具寫入 `.morph/`，或可下載的固定版本），**不假設 npm**，屬待決。
  - 建置輸入多了一個平台提供的部分，回溯舊建置時要能取得當時那一版。
  - 編輯器的模組能力檢查（`confirmThemeContentModuleFunctionExport`）目前只認在 `src/morph/content.ts` 內宣告的函式，re-export 會被判為 unconfirmed；薄入口檔的寫法要與它對齊，或讓它認得平台模組。這會碰到產品程式，屬待決。

**(b) Starter 把檔案複製進網站**

- 形狀：Starter 種入 `src/morph/core.ts` 與接線檔，和現在種入 `src/morph/content.ts` 一樣，都在網站的原始碼修訂裡。
- 核心怎麼更新：Starter 升級，位元組等於已知世代才替換。
- 作者修改怎麼偵測、保留：沿用現行規則，作者改過的不覆寫。**但這正好違反硬性條件一**：作者改過 `core.ts` 之後升級不能碰它，網站從此帶著自己改過的核心。要同時滿足兩個條件，只能把 `core.ts` 定為「平台擁有、作者唯讀」的新類別（Code 模式拒絕寫入、建置拒絕不認得的位元組），這是所有權規則與契約的變更（rule 01 §4.4、#187 §3.2「SDK 是作者的檔案」）。
- 既有網站的遷移：升級新增 `core.ts`、替換未改的 `content.ts`；改過的保留，網站同時有新核心與舊讀取邏輯。
- 風險：上述衝突；每個網站都存一份核心，版本分散；Astro 目前沒有 Starter 也沒有升級路徑，Astro 網站要另建一套。

**建議【提案】：(a)。** 只有 (a) 能在不改所有權規則的前提下同時滿足兩個硬性條件：核心不在網站裡，作者改不到；作者擁有的只有薄入口檔，沿用現行「只換未改的副本」規則。代價是「平台以外的環境怎麼拿到同一版核心」必須設計（§4.7、§9），而且要在 (a) 定案時一起定，不能事後補。

### 4.7 作者在自己電腦執行（延後，但不得被設計排除）

產品目標【提案，依使用者 2026-10-13 指示】：作者能在自己電腦上以 `astro dev`、Start 的 `vite dev` 執行網站。可以之後才實作，但現在的設計不能讓它變得不可能。

已發布內容：

- 【已核對】Start：DEV 限定的 `MORPH_CONTENT_ORIGIN`（Starter 的 `localContentOrigin`，建置時被替換成常數），加上作者自願放進自己 `vite.config.ts` 的本機開發代理（`src/lib/storefront/local-dev/morph-dev-content-proxy.ts`，`docs/local-development.md`），讓用戶端導覽也讀得到。讀的是 Core 公開的 `/_morph/content`，即已發布快照，不帶 cookie。
- 【提案】Astro：同一個核心、同一個 `localOrigin` 欄位；差別只在 Astro 接線怎麼取得這個值。Astro 在 workerd 中執行，shell 的環境變數不會自動出現在 `process.env`【未驗證】，可能要由 integration 在 `astro:config:setup` 讀取後以 `define` 注入，或讀 `.dev.vars`。延後，但核心的 `MorphContentSource.localOrigin` 欄位必須保留，接線也不能假設「沒有 Morph 就沒有來源」。
- 必須保留的設計空間【提案】：(1) 核心不得寫死只認平台標頭；(2) 平台接線（§4.5）在 Morph 管線之外缺席時，作者端有另一個不改作者設定檔的取得方式（對 Astro 而言，這和 (a) 的「核心在平台以外怎麼取得」是同一個待決問題）；(3) 標頭存在但不可用時仍是 `invalid_content_origin`，絕不退回本機位址（現行行為，已核對）。

草稿內容（本機讀草稿）：

- 【提案】只在授權下：作者在 Morph 內明確發出一個預覽憑證，綁定網站與作者，可撤銷、有期限（與 #214 預覽權限規格同一套撤銷語意）。
- 憑證不進頁面輸出、不進網址、不進錯誤訊息：只放在本機開發伺服器的環境（與 `MORPH_CONTENT_ORIGIN` 同一處），由伺服器端的讀取帶上；核心目前 `credentials: "omit"` 且不轉送作者請求的標頭，這個規則保留，憑證是額外、明確的一個來源。用戶端導覽的讀取經本機開發代理代送，瀏覽器看不到憑證。
- 撤銷後下一次讀取就被拒（不是快取到期才失效），錯誤碼走共用集合；是否新增代碼屬待決（§9）。
- 這需要 Core 端的新端點或權限規則，是產品與契約（#214）的範圍，本文只列需求，不設計端點。

本文原本寫「Astro 尚無」「不採用」之處，都改為「延後」加上上面必須保留的設計空間。

### 4.8 隱藏區塊的驗收

驗收不只是「API 不回該區塊的值」，還要【提案】：

1. 頁面不顯示被隱藏區塊的**元件預設值**（作者在 Design 隱藏 hero，網站上就看不到 hero，不是看到 Starter 的佔位文字）。
2. 正常的 Astro frontmatter 計算在區塊不存在時不會崩潰：`const { hero } = home;` 以及常見的後續寫法（例如讀 `hero.title` 再做轉換）。
3. 不要求作者為此改寫頁面。

目前原型的行為【已核對：真實執行】：`hero` 是 `undefined`，`<Hero {...hero} />` 等於不給任何 prop，所以元件顯示自己的預設值（parity 測試的隱藏案例在 Astro 與 Start 都如此）。`const { hero } = home;` 不會崩潰；但 `hero.title` 這類存取在 `undefined` 上會丟錯【未驗證：沒有 fixture 這樣寫】。本輪依指示不改 fixture 或測試去「修正」它。

沒有作者程式碼或契約變更就做不到的部分（明列為缺口）：

- **缺口 1：不顯示預設值。** 頁面直接展開 `hero` 時，讀取核心無法讓元件不渲染：核心只能決定 `hero` 的值，不能取消 `<Hero />` 這個節點。#187 §3.2（隱藏區塊回 `{}`）解決的是「存取 `hero.title` 不崩潰」，**不**解決預設值，反而讓 `{...{}}` 照樣顯示預設值。要不顯示，只能 (i) 作者寫 `isHidden` 判斷（違反「不要求作者改寫」），或 (ii) 編譯時注入隱藏判斷（#187 §4；Astro 屬 L1.5 之後），或 (iii) 平台在渲染結果中移除該區塊（需要能在輸出中定位區塊，與 §8 的標記問題相關，未驗證）。
- **缺口 2：不崩潰。** 目前形狀下 `hero.title` 在 `undefined` 上會崩潰；#187 §3.2 若核准（回 `{}`）可讓一層的存取不崩潰，但 `hero.title.toUpperCase()` 這類更深的存取仍會在 `undefined` 上崩潰。完全不崩潰需要作者的防禦寫法或改變頁面形狀的契約，兩者都在本文範圍外。
- 兩個缺口都屬契約（#187）的決定，列入 §9。

## 5. 一份核心由兩個 fixture 共用：如何證明

【已核對】

- 核心只有一個檔案：`fixtures/morph/content-read-core/core.ts`。兩個 Theme 都不帶它；測試支援（`content-read-fixtures.test-support.ts` 的 `withPlatformWiring`）像安裝套件一樣，把**同一個檔案的位元組**放進工作區的 `src/morph/core.ts`，再加上該框架的接線。
- 結構測試：兩個工作區的 `src/morph/core.ts` 的 sha256 都等於該檔；每個工作區只有這一個檔案含讀取邏輯；各框架的 `src/morph/content.ts` 都從 `./core` import。反向：Theme 自帶一份讀取程式時會被測出。
- 真實執行：parity 測試在 `astro dev` 與 Start dev server 啟動後，讀取兩個預覽工作區磁碟上的 `src/morph/core.ts`，sha256 都等於該檔。

這不是「兩邊各寫一份再比對結果」：兩邊執行的是同一份位元組。正式交付如何做到同一份位元組（不假設 npm 套件）見 §4.6。

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

1. **正式接線的實作**：§4.5 建議在 `morphAstroPreview()`／`morphAstroBuild()` 既有的 hook 中呼叫 `addMiddleware`，middleware 放在 `.morph/`。這是產品程式變更，需另行授權；驗收條件見 §4.5。
2. **接線找不到請求時的錯誤碼**：目前沿用 `no_content_source`，訊息改為核心固定的一句。或所有框架一起新增一個代碼（會改變共用集合）。
3. **作者自己電腦（延後，不排除，§4.7）**：Astro 怎麼取得 DEV 限定的 `localOrigin`（workerd 中的環境變數，未驗證）；核心在 Morph 管線之外怎麼取得同一版（與待決 5 同一題）；本機讀草稿的授權憑證由 Core 的哪個端點發出、怎麼撤銷（屬 #214 與產品範圍）；撤銷後的錯誤是否用新代碼。`docs/astro-theme-plan.md` §4「不採用 `MORPH_CONTENT_ORIGIN`」已與 Start 現況不一致，該文件需要另行更新為「延後」（本輪只改本文）。
4. **轉址與大小限制**：是否在核心內 `redirect: "manual"` 並限制回應大小，讓 `redirect_refused`／`response_too_large` 不只來自本機代理。改在核心，所有框架一起生效。
5. **交付方式（§4.6，建議 (a)）**：是否採「平台維護核心 + 薄入口檔」；核心在平台以外的取得方式（不假設 npm）；建置記錄核心版本的方式；編輯器的模組能力檢查如何認得 re-export 的 `morph`（產品程式）；Start Starter 現有 `src/morph/content.ts`（含失敗回預設值的舊介面）的遷移期。若選 (b)，需要「平台擁有、作者唯讀」的新檔案類別，這是所有權規則與 #187 §3.2「SDK 是作者的檔案」的變更。
6. **隱藏區塊（§4.8）**：缺口 1（不顯示預設值）與缺口 2（深層存取不崩潰）都無法只靠讀取核心解決。需要 #187 決定：§3.2 的 `{}` 只解決一層存取；不顯示預設值要靠 §4 的編譯時注入、平台在輸出中移除區塊，或接受作者寫 `isHidden`。這是契約層級的決定。
7. **wrapper 與作者 middleware 的順序**：`order: "pre"` 讓平台 middleware 在作者的之前執行；作者若在自己的 middleware 中也要讀內容，這個順序是必要的，需在 §4.5 驗收第 4 點證明。

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
- `src/lib/storefront/compiler/content-read-isolation.workerd.test.ts`，**真實執行，建置後在 workerd**（2026-10-15）：
  - **建置與執行**：Astro 與 Start Theme 都經 build runner 建置。建置出的 Worker 以 Wrangler 的本機 runtime（workerd）執行，跟 `native-compat.test.ts` 一樣用 `runtime/server/wrangler.json`。
  - **請求方式**：每個請求像正式 runtime 那樣，自己帶 `x-morph-content-origin`（`theme-runtimes.ts` 的 `applyStorefrontContext`），指向兩個不同的本機內容服務 A、B。
  - **測試頁**：一個讀兩次的作者頁（`/isolation`：先讀 `/about`，再讀 `/`）。這是測試頁，不改 case A fixture。
  - **強制順序**：A 停在第一次讀取，直到 B 從頭到尾渲染完才放行。兩個方向各一次。
  - **驗證內容**：兩個請求都只顯示自己來源的內容；每個內容服務只收到自己那個請求的兩次讀取。沒有來源的請求在 A 等待時回 500，也沒有從任一服務讀取。
  - **反向檢查**：每一項都只讓預期的框架變紅，還原後 sha256 相同。
    - Astro 接線把請求存在模組變數：只有 Astro 紅，第二次讀取讀到 B。
    - 核心快取第一次的內容來源：兩者都紅，讀取被送到 A 的服務。
    - Start 接線快取內容來源：只有 Start 紅。

## 11. 未驗證

- 正式 Cloudflare：建置出的 Worker 在正式環境經 Core 轉送執行 SSR；Build Preview。（2026-10-15 已在 Wrangler 本機 workerd 執行建置出的 Worker，見 §10；不是正式環境，也沒有走 Core 的 `applyStorefrontContext`，標頭由測試直接帶入。）
- 預覽權限撤銷（#214），以及完整 Design 驗收（點選、Inspector、寫入、重新載入）。
- 真實框架中「兩個並行請求、不同預覽上下文」：
  - **2026-10-15 已證明**（§10 的 workerd 測試）：建置出的 Astro Worker（workerd 中的 ALS）與 Start Worker（`getRequest()`），在強制交錯的兩個並行請求下，各自讀自己標頭指向的內容服務。
  - **仍未證明**：
    - 正式 Cloudflare 與 Core 轉送；
    - 超過兩個請求或高負載；
    - 不同 Theme 共用同一個 isolate（每個 Theme 是自己的 Worker，這裡沒有測）；
    - 內容讀取以外的請求憑證。目前核心沒有可變的全域 client，§9 的待決 4、5 仍待決。
  - Live Preview 的 Worker 仍然對每個請求設定同一個 origin，所以預覽路徑本身無法給出不同上下文。
- 真實框架中的網路錯誤與上游拒絕（`content_not_found` 等）：只在核心原型測；真實執行只測了 `invalid_path`。
- Start 接線在 Node 中直接執行（需要 Start 編譯器處理 `createIsomorphicFn`），以及 Start 的用戶端導覽讀取（`same-origin` 分支）。
- Start 的建置：2026-10-15 已證明純 Start fixture 能經 build runner 建置，SSR 在 workerd 中讀取（§10）；用戶端導覽與預先渲染仍未測。
- Morph 自己的 wrapper 呼叫 `addMiddleware`（§4.5，目前是測試替代）；§4.5 驗收第 1、3、4、5 點；作者另有 `src/middleware.ts` 時的順序。
- SDK 交付（§4.6）：兩個做法都只是比較，沒有原型。
- 作者自己電腦執行 Astro 與本機讀草稿（§4.7）：延後，未驗證。
- 隱藏區塊不顯示預設值、深層存取不崩潰（§4.8 缺口 1、2）。
- Cloudflare Sandbox 容器 transport 的 Live Preview。
- 正式 SDK：本輪只有測試原型。
