# Astro 內容讀取模組（設計草稿）

狀態：**草稿，尚未核准實作。** 本文是內容綁定契約（#210，`docs/content-binding-contract-design.md`）§6 案例 A 前置的第一、二項：Astro 可用的讀取模組，以及驗收用的純 Astro Theme。所述「現況」於 2026-10-13 對照 `main`（`48330aa`）核對。

標示方式：**【已核對】** 是在程式碼或測試中確認的事實，附檔案位置；**【提案】** 是本文的設計，待核准；**【未驗證】** 是尚未用測試證明的部分。

範圍外：L1.5（`.astro` 點選定位、欄位綁定、解析 Worker）、編輯器、Starter 與產品執行期程式。本文不改 #210 與 #187 的契約。

## 1. 現況（已核對）

### 1.1 Start 版讀取模組

【已核對】Starter 的 `src/morph/content.ts`（`src/lib/storefront/starter-theme-v3-files.ts` 的 `STARTER_THEME_CONTENT_MODULE_SOURCE`）：

- `morph.pages.get(path)`：路徑不是字串、不以 `/` 開頭或超過 500 字元時，以 `invalid_path` 拒絕；其餘交給 `createIsomorphicFn()` 的 `getPage`。
- 伺服器分支：以 `getRequest()`（`@tanstack/react-start/server`）讀 `x-morph-content-origin`；沒有標頭時，**只在** `import.meta.env.DEV === true` 才讀 `MORPH_CONTENT_ORIGIN`；兩者都沒有就丟 `no_content_source`。標頭存在但不可用（不是網址、不是 http/https）丟 `invalid_content_origin`，不會改用本機位址。只取 `origin`，路徑忽略。
- 用戶端分支：向同源 `/_morph/content?path=` 讀取。
- `fetchPage`：`credentials: "omit"`、15 秒逾時；連不上 → `store_unreachable`；非 2xx 時，回應若帶有上述代碼之一的 `code` 就用它，否則 404 → `content_not_found`、其餘 → `store_error`；不是 JSON 或形狀不對 → `invalid_response`；`slots` 內有 `_hidden` → `reserved_slot`。
- 頁面形狀：`{ ...slots, _hidden: hiddenSlots }`。隱藏的區塊不在 `slots`，所以 `page.hero` 是 `undefined`（#187 §2.1）。
- 錯誤：`MorphContentError`，`code` 為封閉集合 `MorphContentErrorCode`（10 個），訊息是模組內寫死的字句，不取自上游回應；細節只寫伺服器 log。
- `morph.pages.isHidden(page, slotId)`。
- 另有 React context 的 `content()`、`isSectionHidden()`、`loadContentSlots`（失敗時退回預設值的舊介面）。

【已核對】兩個細節：

- `fetchPage` 沒有設定 `redirect: "manual"`，所以 `fetch` 預設會**跟隨**轉址；`redirect_refused` 與 `response_too_large` 只有在上游（本機開發代理 `src/lib/storefront/local-dev/morph-dev-content-proxy.ts`，它用 `redirect: "manual"` 並限制大小）以 `code` 命名時才會出現，模組本身不產生。
- Start 版之所以能放進 Start 專案，是因為 `getRequest` 與 React context；這兩者在純 Astro 專案都沒有。這就是 #210 §6 說「不能假設原樣放進純 Astro 專案」的原因。

### 1.2 內容來源位址：誰設定標頭

【已核對】所有路徑都只用 `x-morph-content-origin` + `GET <origin>/_morph/content?path=`，與框架無關：

| 情境 | 誰設定標頭 | 程式位置 |
|---|---|---|
| 正式店面（SSR） | Core 轉送給 Theme Worker 時 `set`（不是 merge），值為 Core 被呼叫的 origin | `src/lib/storefront/service/theme-runtimes.ts` `applyStorefrontContext` |
| Build Preview | Core 驗證權杖後設定 | `src/lib/storefront/service/build-preview/build-preview-request.ts` |
| Live Preview（`astro dev`） | 預覽 Worker entry 對每個請求設定，指向只有它回答的 `http://morph-preview-content.invalid`，資料來自草稿快照 | `src/lib/storefront/compiler/theme-preview-start-runtime.ts` `themePreviewStartWorkerSource`（Astro 以 `ASTRO_PRERENDER_ENTRY` 為 server entry，`astro-preview-workspace.ts`） |
| 建置時預先渲染 | Morph 建置 integration 的 prerender 包裝，對 `/__astro_prerender` 的請求設定，指向建置程序內只回答封存快照的 loopback server；讀取被記錄，失敗讓建置失敗 | `src/lib/storefront/theme-framework/astro-native-prerender.ts` |
| 作者自己電腦（Morph 外） | 無 | Start 版以 `MORPH_CONTENT_ORIGIN`（僅 DEV）補上；Astro 尚無 |

【已核對】`docs/astro-theme-plan.md` §4 寫「`MORPH_CONTENT_ORIGIN` 並未實作，這裡也不採用」；但 Start 版模組與 `docs/local-development.md` 現在已有 DEV 限定的 `MORPH_CONTENT_ORIGIN`。計畫文件這一句已過時（見 §10 待決）。

### 1.3 既有 Astro 測試讀內容的方式

【已核對】`astro-native-prerender.fixtures.ts` 與 `e2e/astro-preview-container.spec.ts` 的讀取函式都把 `Astro.request` 傳進去，任何失敗都回 `undefined`／`null`（也就是退回元件預設值）。它們是建置與預覽管線的測試，不是讀取契約；之後的讀取模組不應沿用「失敗就回預設值」。

## 2. 模組要做的事【提案】

1. 在 frontmatter（伺服器端）讀取一個頁面的已發布內容（或預覽中的草稿）：`const home = await morph.pages.get("/");`。
2. 內容來源位址只取自**這次請求**的 `x-morph-content-origin`（§4）；不從模組層變數、不從前一個請求、不從使用者可控的輸入取得。
3. 回傳與 Start 版相同的頁面形狀，以相同的錯誤碼與字句失敗（§5）。
4. 讀不到就丟錯，讓頁面或建置明確失敗；不以元件預設值或空頁面掩蓋（§6）。
5. 在 SSR、預先渲染、Live Preview、Build Preview 四種情境行為一致，不偵測自己在哪個情境。

非目標：用戶端（island）讀取、草稿授權、快取、隱藏判斷的注入（#187 §4）。

## 3. API 形狀【提案】

作者端的呼叫與 Start 版逐字相同，讓 #210 案例 A 的寫法與案例 B 的追蹤規則（「`morph` 是從 Theme 內容模組具名 import 的」）可以共用：

```astro
---
import Hero from "../components/Hero.astro";
import { morph } from "../morph/content";

const home = await morph.pages.get("/");
const { hero } = home;
---
<Hero {...hero} />
```

模組匯出：`morph`（`pages.get`、`pages.isHidden`）、`MorphContentError`、`MorphContentErrorCode`、`MorphPage`，以及 Astro 專用的 `onRequest`。

**難處：Astro 的模組拿不到「目前的請求」。** frontmatter 有 `Astro.request`，但它呼叫的一般模組沒有，Astro 也沒有 `getRequest()` 這種公開 API。三個做法：

| 做法 | 呼叫 | 優點 | 代價 |
|---|---|---|---|
| **A（建議）middleware + `AsyncLocalStorage`** | `morph.pages.get("/")` | 與 Start 逐字相同；#210 案例 A 原樣成立；綁定追蹤不必為 Astro 多一種形狀 | Theme 需要 `src/middleware.ts`：`export { onRequest } from "./morph/content";`；作者已有 middleware 時要用 `sequence()` 串起來；需要 `node:async_hooks`（Cloudflare 需 `nodejs_compat` 或 `nodejs_als`） |
| B 明確傳入請求 | `morph.pages.get("/", Astro.request)` | 不需要 middleware 與 ALS；`docs/astro-theme-plan.md` §4 原本的方向 | 與 Start 簽名不同；案例 A 的寫法要改；綁定追蹤要多認一個參數 |
| C 每頁建立 | `const morph = createMorph(Astro)` | 同 B | `morph` 不再是具名 import，案例 B 的追蹤規則不適用 |

做法 A 的規則：

- `onRequest(context, next)` 只做 `als.run(context.request, next)`，不讀內容、不改請求與回應。
- `morph.pages.get` 在 ALS 沒有請求時（沒有 middleware，或在請求之外呼叫），丟 `no_content_source`，訊息說明要在 `src/middleware.ts` 匯出 `onRequest`。**不新增錯誤碼**（見 §10 待決）。
- 請求只存在 ALS，不存模組層變數：Worker isolate 會重用，一個請求的 origin 不得回答另一個請求的讀取（`docs/astro-theme-plan.md` §4 的要求）。

【已核對，限 fixture 的替代實作】做法 A 在本機真實 `astro dev`（workerd，經 Morph 預覽 Worker entry）與 `astro build` 的預先渲染（workerd 內，經 Morph prerender 包裝）都能讀到正確的標頭；`credentials: "omit"` 在 workerd 可用。Node 中兩個交錯的請求各自讀到自己的 origin。見 §9。

## 4. 內容來源位址【提案，現況部分已核對】

| 情境 | 位址從哪裡來 | 模組行為 |
|---|---|---|
| Live Preview（`astro dev`） | 預覽 Worker entry 設定的標頭（草稿快照） | 讀標頭；與正式相同的程式路徑【已核對：fixture】 |
| 建置（預先渲染的頁面） | Morph prerender 包裝設定的標頭（封存快照）；讀取由包裝記錄 | 讀標頭；被拒（404 → `content_not_found`）就丟錯，建置由記錄判定失敗【已核對：fixture】 |
| 建置（SSR 的頁面） | 建置時不執行 | 無 |
| 正式店面 SSR | Core 以 `set` 設定，值為 Core 被呼叫的 origin | 讀標頭【未驗證：Astro 產物在 Theme Worker 執行】 |
| Build Preview | Core 驗證權杖後設定 | 讀標頭【未驗證】 |
| 作者自己電腦 | 無標頭 | 待決：沿用 Start 的 DEV 限定 `MORPH_CONTENT_ORIGIN`，或第一版只丟 `no_content_source`（§10） |

不論哪個情境：標頭存在但不可用時丟 `invalid_content_origin`，不退回其他位址；只取 `origin`；只呼叫 `/_morph/content?path=<encodeURIComponent(path)>`。

## 5. 與 Start 共用的頁面形狀與錯誤碼【提案】

- **頁面形狀**：`{ ...slots, _hidden: hiddenSlots }`，與 Start 目前完全相同。#187 §3.2 若核准（隱藏的區塊改為 `{}`），兩版同一個 Starter 版本一起改，不讓 Astro 先行或落後。
- **錯誤碼**：Start 的 10 個代碼，同順序、同字句：`no_content_source`、`invalid_content_origin`、`invalid_path`、`store_unreachable`、`content_not_found`、`store_error`、`redirect_refused`、`invalid_response`、`response_too_large`、`reserved_slot`。
- **判定方式**：與 Start `fetchPage` 相同（§1.1）。`redirect_refused`／`response_too_large` 目前兩版都只在上游命名時出現；是否在模組內改為 `redirect: "manual"` 並限制大小，要兩版一起決定（§10）。
- 兩份模組無法互相 import（不同框架、都是作者的檔案）。一致性由測試保證：比對 Start 原始碼與 Astro 模組原始碼的代碼集合與字句（本次 fixture 已有此測試，§9）。

## 6. 不得做的事【提案】

- 不把內容來源位址、請求標頭、權杖、上游回應本文或 stack 放進頁面輸出或錯誤訊息；錯誤訊息只用模組內寫死的字句，細節只寫伺服器 log。
- 不讀任何 secret、不帶 cookie（`credentials: "omit"`）、不轉送作者請求的其他標頭。
- 不以元件預設值、空物件或空頁面回答失敗的讀取；不 `catch` 後回 `{}`。失敗就丟 `MorphContentError`。
- 不在模組層快取讀取結果或請求。
- 不偵測情境（預覽、建置、正式）而改變行為；也不在建置時改讀其他位址。
- 不 import Start、React 或 Astro toolchain 以外的套件。

## 7. 與 #187 的關係

- #187 §3.1（Core 公開回應不變）：本模組只讀 Core 的回應，不需要 Core 改變。
- #187 §3.2（SDK 補 `{}`）：待核准；核准後兩版同時改（§5）。
- #187 §3.2「SDK 是作者的檔案」：Astro 模組同樣屬於作者，升級規則沿用 Starter（只替換位元組未改的副本）。目前沒有 Astro Starter（`src/lib/storefront/starter-*.ts` 沒有 Astro 的 Starter 檔案；`e2e/astro-preview-container.spec.ts` 以 SQL 把網站改成 `astro`），所以還沒有升級路徑。
- #187 §4（編譯流程注入隱藏判斷）：與本模組無關；`.astro` 的注入屬於 L1.5 之後。
- #187 §5（嚴格讀取）：`morph.pages.get` 本來就是失敗即丟錯，與 Start 相同。

## 8. 純 Astro Theme 如何引用【提案】

- 路徑沿用 `src/morph/content.ts`：既有的內容模組能力檢查（`ast/theme-content-module.ts`）與綁定辨識（`ast/theme-content-binding.ts`）都以這個路徑認 `morph`。Astro Live Preview 寫入的檔案（`src/morph/preview-bridge.ts`、`src/morph/preview-content.ts`、`src/morph/preview-content-snapshot.ts`、`src/morph/preview/…`）與它不衝突【已核對：fixture 的預覽計畫沒有 `NATIVE_RESERVED_PATH`】。
- 另加 `src/middleware.ts`：`export { onRequest } from "./morph/content";`。
- 交付方式待決（§10）：未來的 Astro Starter 種入（與 Start 相同，屬於作者）、文件中可複製的檔案，或套件。套件需要放進 Astro toolchain 與允許清單，本文不提議修改允許清單。

## 9. 驗收用 fixture 與本次測試（已核對）

`fixtures/morph/astro-case-a/`：純 Astro Theme。`fixtures/astro/`、`fixtures/tanstack/` 是逐位元組的上游副本（`SOURCES.json`），這份是 Morph 自己寫的，所以放在 `fixtures/morph/`。

| 檔案 | 內容 |
|---|---|
| `astro.config.mjs` | `output: "server"`、`@astrojs/cloudflare`（`imageService: "passthrough"`）、`session: false`；沒有 integrations |
| `wrangler.jsonc` | `nodejs_compat` |
| `package.json` | 只依賴 `astro`、`@astrojs/cloudflare` |
| `src/middleware.ts` | 轉出 `onRequest` |
| `src/morph/content.ts` | **測試用替代實作**，第一行標明；照 §3 做法 A 與 §5 的形狀、錯誤碼。不是產品、Starter 或正式模組 |
| `src/components/Hero.astro`、`Hero.fields.ts` | `title`、`subtitle` 兩個欄位，有元件預設值；sidecar 宣告欄位 |
| `src/pages/index.astro` | SSR；#210 案例 A 的寫法逐字 |
| `src/pages/about.astro` | 預先渲染；同樣寫法讀 `"/about"`（自己的 route，符合 #210 §5.1 第 5 點） |

測試：

- `src/lib/storefront/theme-framework/astro-case-a-fixture.test.ts`：檔案清單與案例 A 寫法；純 Astro 檢查（只 import 自己的檔案、`node:`、`astro:`、`astro`、`@astrojs/cloudflare`；副檔名限 `.astro/.ts/.mjs/.json/.jsonc`；比允許清單嚴格，因為 Astro toolchain 也含 React）與它的反向案例；原樣通過建置 materializer、`planNativeAstroBuild`、`planAstroPreviewWorkspace`（唯一的警告是預覽不沿用 `imageService`）；sidecar 可解析；替代實作的錯誤碼與字句和 Start 原始碼一致（含反向案例）；替代實作的讀取、每個錯誤碼、請求外呼叫被拒、交錯請求各讀各的 origin。
- `src/lib/storefront/compiler/local-vite-preview-server.astro-case-a.test.ts`：真實 `astro dev`（本機 transport）渲染草稿的 hero；頁面不含內容來源位址或標頭名稱；新草稿在下一次渲染出現；讀取被拒的頁面回 500 並顯示 `invalid_path` 的字句，不顯示元件預設值。
- `src/lib/storefront/compiler/native-astro-case-a.build.test.ts`：經 build runner 的真實 `astro build`；第一次無內容的 pass 被 `/about` 的讀取擋下（`contentDependency: "dependent"`），`/about` 的 HTML 是封存值；反向：fixture 的元件 import 未核准的套件（`zod`）時被同一個 import guard 拒絕。

## 10. 待使用者決定

1. **API 形狀**：§3 做法 A（middleware + ALS，`morph.pages.get("/")` 與 Start 相同）或做法 B（`morph.pages.get("/", Astro.request)`）。A 需要 Theme 有 `src/middleware.ts`。
2. **缺少 middleware 時的錯誤碼**：沿用 `no_content_source`（目前做法，只改訊息），或兩版一起新增一個代碼。新增代碼會改變共用集合。
3. **作者自己電腦的內容來源**：Astro 是否也支援 DEV 限定的 `MORPH_CONTENT_ORIGIN`。Astro 在 workerd 中執行，shell 的環境變數不會自動出現在 `process.env`，做法要另外驗證；`docs/astro-theme-plan.md` §4「不採用 `MORPH_CONTENT_ORIGIN`」需要更新為與 Start 現況一致的說法。
4. **轉址與大小限制**：是否兩版都在模組內 `redirect: "manual"` 並限制回應大小，讓 `redirect_refused`／`response_too_large` 不只來自本機代理。
5. **交付方式**：Astro Starter 種入、文件複製或其他（§8），以及何時有 Astro Starter。
6. **#187 §3.2**：核准後兩版同時改頁面形狀。

## 11. 未驗證

- 正式店面與 Build Preview：Astro 產物在 Theme Worker 中經 Core 轉送執行 SSR 頁面（本次只建置，沒有執行建置出的 Worker）。
- Cloudflare Sandbox 容器 transport 的 Live Preview。
- workerd 中多個同時請求下 ALS 的隔離（只在 Node 測過交錯請求）。
- 作者已有 middleware、以 `sequence()` 串接的情況。
- 隱藏區塊在 Astro 頁面的行為（目前形狀下 `hero` 是 `undefined`，`{...hero}` 會顯示元件預設值）。
- 用戶端 island 的讀取。
- 正式讀取模組本身：本次只有 fixture 內的替代實作。
