# Morph Native TanStack Start Hosting + Visual CMS 規劃（2026-10-06）

狀態：規劃，1a 已完成（#102），1b–1d 依多框架規劃的交付順序進行。接續 [`ROADMAP.md`](../ROADMAP.md)「TanStack Start 原生相容」。
各層實際驗收仍以 [`docs/tanstack-start-compatibility.md`](tanstack-start-compatibility.md) 為準。

> 2026-10-06 起，TanStack Start 是 Morph 多種 Theme 框架之一，總體規劃見
> [`docs/multi-runtime-theme-plan.md`](multi-runtime-theme-plan.md)。本文件中的建置沙箱、工具鏈三級相容、
> Theme 依賴快照、基礎設施對應、外連政策、Design 修改流程與匯出適用所有框架；其餘為 TanStack Start 專屬。

## 產品目標

Morph 匯入的是**原生 TanStack Start 專案**，不是「轉換成 Morph 專案」。

```text
本地 TanStack Start 專案（照官方文件寫）
→ 原樣匯入 Morph
→ 同一份 source，建置時執行客戶自己的設定
→ Code 可以編輯全部
→ Design 可以視覺修改其中看得懂的部分
→ 可以匯出回本地，vite build 行為仍符合官方
```

只要某個官方正常寫法匯入後需要客戶「先改寫成 Morph 格式」，就是相容性缺口。
**不新增 Morph 專用的設定語言。**

## 已定原則

1. **Theme 程式碼是唯一設定來源，使用官方寫法。** Code 直接編輯；Design 以 AST 只修改看得懂的
   官方寫法，看不懂的顯示「由程式碼控制」且唯讀。CMS 資料庫不另存一份可編輯的渲染設定。
2. **正式建置執行 Theme 自己的建置流程，不注入 Morph 的 Vite plugin。**

   > Production builds execute the Theme's own build pipeline without Morph Vite-plugin
   > injection. Morph supplies only deployment-environment inputs—mapped Cloudflare
   > configuration, approved environment values and frozen content access—and validates the
   > resulting artifact outside the untrusted build sandbox. Live Preview remains a separate
   > Morph-instrumented development environment.

   本地 `pnpm build` 與 Morph 的 `pnpm build` 是同一份程式、同一份 `vite.config.ts`、同一個
   build script；差異只在本來就應因部署平台而不同的東西：資源綁定、環境變數、網路政策、沙箱限制與
   發布前驗證。AST 只服務 Design 讀寫、Monaco 提示，以及判斷「這段 Design 能不能改」，不決定建置
   實際怎麼跑。

3. **Live Preview 才注入 Morph plugin。** Morph 執行 `vite dev`，以沙箱內的平台入口設定
   （`.morph/vite.config.ts` import 客戶設定，以 `mergeConfig` 加上編輯器橋接、HMR 轉送、內容來源、
   SVG 隔離）啟動，客戶檔案不變，加入內容可完整列出。**能不能發布由 Build Preview 決定**
   （與正式發布完全相同的建置路徑），不看 `vite dev` 預覽，避免「預覽靠 Morph plugin 正常、
   正式建置其實有問題」。
4. **建置沙箱視為完全不可信。** 允許：讀寫 Theme 工作區、執行 subprocess、Vite plugin、loader、
   預先渲染。不允許：讀取 Morph secrets、其他商店資料、主機檔案系統、直接使用正式 D1／R2 綁定、
   任意外連、直接部署（「不允許任意外連」目前尚未落實：建置容器可以外連，2026-10-08 確認，見 Astro 計畫 7.1
   與 `TODO.md` 的部署前阻擋項）。產物在沙箱外檢查（manifest、入口、大小、禁止內容），通過才能成為 release。
   Cloudflare 也提醒不要把 credential 放進 sandbox（[Sandbox security](https://developers.cloudflare.com/sandbox/sdk/concepts/security/)）。
   本機開發用的建置程式（`local-vite-theme-build-runner`）不是安全沙箱，只供開發者測試自己的專案；
   執行客戶設定的正式建置只在 Cloudflare Sandbox。
5. **發布時凍結 Render Plan，由實際產物取得。** 建置後實際產生的 HTML 即 SSG 清單；CSR／ISR 由
   路由分析取得，看不懂的記為「執行時決定」。Rollback、快取清除、release 身分、SSG 資產分派、
   ISR 快取鍵與除錯都依當時的 Render Plan。#98 的 immutable publication、sealed content 與
   release binding 保留。
6. **網站預設不對應 `defaultSsr: false`。** TanStack 的 `ssr` 只能由父往子更嚴格，父層為 `false`
   時子路由無法改回 SSR。TanStack 父層維持 `true`，由各路由的 `ssr()` 依頁面算出結果。
7. **全站 SPA 與頁面 CSR 分開**，介面上也分成兩處。

## 渲染模式對應（Design 寫入的官方寫法）

| Design 選擇      | 修改的程式碼                                                                                        | Cloudflare 上的執行                      |
| ---------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| SSR              | 路由 `ssr` 為 `true`（預設）                                                                        | Worker 即時渲染                          |
| CSR              | 路由 `ssr` 回傳 `false`                                                                             | 伺服器送 pending shell，瀏覽器渲染       |
| ISR              | 路由 `ssr` 為 `true`，`headers()` 回傳 `Cache-Control: public, max-age=N, stale-while-revalidate=M` | Workers Cache（見下）                    |
| SSG              | `vite.config.ts` 的 `tanstackStart({ pages: [{ path, prerender: { enabled: true } }] })`            | 建置時產生 HTML，由 Workers 靜態資產送出 |
| 全站 SPA（進階） | `tanstackStart({ spa: { enabled: true } })`                                                         | `_shell.html`，平台依官方規則改寫請求    |

- 共用路由也能逐頁設定：`ssr` 支援函式形式並收到 `params`，路由的 `headers` 也收到 `params`
  （官方 `RouteOptions` 型別）。Design 在路由檔內寫一般物件記錄各頁設定，以官方函式形式讀取；
  不 import Morph 模組。`ssr` 收到的 `params` 帶 `status`（`success`／`error`），標準寫法先檢查它，
  驗證失敗時回傳 `true`，讓錯誤頁照常以 SSR 顯示：

  ```ts
  ssr: ({ params }) =>
    params.status !== "success" ? true : pagePolicies[params.value.handle] !== "csr",
  ```

- CMS 頁面新增、刪除、改 handle 時，Design 以同一次 OCC 寫入一併更新 `pages` 與路由檔中的頁面設定。
- 客戶的 `vite.config.ts` 是計算出來的（變數、函式、`loadEnv`），Design 的 SSG 設定為唯讀；
  建置仍照常執行。

## Design 修改程式碼的流程

Design 改的是真的程式碼，所以先讓人看到改了什麼，再存檔：

```text
Design 修改 → AST patch → 白話摘要 + 程式碼 diff → 確認 → 以 OCC 存成 revision → 預覽建置
```

- **看得懂才改，看不懂就唯讀。** `ssr: false`、Morph 標準寫法的 `pagePolicies` 可以改；
  使用者自訂的函式邏輯（實驗分流、讀 `process.env` 等）顯示「由程式碼控制」，不碰。
- patch 以**最新已存 revision** 為基準，經既有 OCC／CAS 寫入；Code 已存了新版就重新產生 diff。
- 同一檔案在 Monaco 有**未存修改**時拒絕套用，請使用者先在 Code 處理（沿用發布等待遇到未存
  修改即停止的規則）。
- diff 分兩層：白話摘要（例如「『關於我們』改為發布時預先產生，需重新建置才生效」）給不寫程式
  的人；可展開的程式碼差異（`- ssr: true` / `+ ssr: false`）給開發者。
- 「畫面元素 → 原始碼位置」Morph 已有（預覽 DOM 的 `data-morph-loc`，文字升級即依此以 AST 改碼），
  渲染方式延伸同一套機制到路由設定與 `vite.config.ts`。

## Cloudflare 執行要點

- **SSG**：預先渲染的 HTML 由 Theme Worker 靜態資產送出；Core 依 Render Plan 分派。
- **ISR**：Workers Cache 只開在文件 entrypoint；server function、API、個人化與寫入走不快取的
  runtime entrypoint。
  - 預設快取鍵不含 hostname，只差 `Cookie`／`Authorization` 的請求會拿到同一份快取
    （[Cache keys](https://developers.cloudflare.com/workers/cache/cache-keys/)）。Core 以可信的
    `storefrontId + releaseId（含內容發布）+ pathname + 正規化 query` 組成 `cf.cacheKey` 或 `ctx.props`。
  - 帶顧客 session／購物車 cookie 的請求繞過快取；有 `Set-Cookie` 的回應不快取（實際行為待實測）；
    Theme 回 `private`／`no-store` 一律遵守。
  - 不使用 `s-maxage`（會停用 `stale-while-revalidate`）。
  - `Cache-Tag: storefront:{id}`、`release:{id}`；新 release 自然 MISS，內容更新以 purge／invalidate。
  - `max-age` 也會被瀏覽器快取；Core 需改寫送給瀏覽器的 `Cache-Control`。
  - 開啟 Workers Cache 後 service binding 呼叫按一般請求計費，另一個只開文件 entrypoint 的理由。
- **全站 SPA**：靜態檔優先 → `/_serverFn/*` 與 server routes 放行 → 其餘回 `_shell.html`。

## 工具鏈版本：Theme 擁有版本，平台認證相容

Theme-owned versions, platform-certified compatibility.

- **Morph 自己的工具鏈 ≠ Theme 的工具鏈。** CMS、Editor、Main Worker 固定 Morph 自己的版本；
  只有 Theme 建置沙箱依 Theme 的 lockfile 執行。Morph 不替換、不降級 Theme 的 Vite／Start 版本。
  （`@tanstack/react-start` 的 peer 是 `vite >= 7`，Vite 7 與 8 可以並存於不同 Theme。）
- **Theme Build Environment Snapshot**：Node、`packageManager`、lockfile 與依賴雜湊、Vite、
  TanStack Start、Router、React、Cloudflare plugin、Wrangler。與 build 及 release 綁定。
  Theme 沙箱的 Node 政策不沿用 Morph 應用的 `>=18`（最新 Start 與 Vite 8 要求 Node 22.12+）。
- **三級相容狀態**（依相容版本矩陣）：

  | 狀態                                                | Live Preview | Build Preview | Publish |
  | --------------------------------------------------- | ------------ | ------------- | ------- |
  | Certified                                           | ✅           | ✅            | ✅      |
  | Unverified                                          | ✅           | ✅            | ❌      |
  | Known incompatible／Blocked（已知會壞或有安全問題） | ❌           | ❌            | ❌      |

- **認證範圍包含 Morph 的預覽 plugin**：Vite 8 改用 Rolldown／Oxc，部分 plugin API 行為不同；
  組合要連同 Morph plugin 一起實測才算認證。Cloudflare plugin 須達支援
  `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH` 的最低版本。
- **建置來源紀錄（provenance）**：每次 build 記錄工具鏈快照雜湊、矩陣版本與當時認證狀態。
  Unverified 時產生的 build 之後**不能直接升格**為 release；組合轉為 Certified 後須重新建置、
  重新檢查才可發布。
- 未驗證版本的失敗只記工具鏈版本、階段、成功／失敗與 Morph 邊界錯誤代碼，不上傳客戶原始碼、
  CMS 資料或任意 stderr。介面標示「未經 Morph 驗證的工具鏈」，讓預覽失敗與 Morph 的錯誤可以區分。
- 矩陣驗證：一般 PR 只跑最新的認證組合；排程 CI 跑完整矩陣；上游新 patch 先在排程中通過再加入。

## 建置流程

| 環境          | 執行                              | Morph 注入                                    | 用途                         |
| ------------- | --------------------------------- | --------------------------------------------- | ---------------------------- |
| Live Preview  | Morph 執行 `vite dev`             | 平台入口設定（橋接、HMR、內容來源、SVG 隔離） | Design 與 Code 即時編輯      |
| Build Preview | 專案自己的 build script           | 不注入 Vite plugin                            | 判斷能否發布；與正式建置相同 |
| Publish       | 專案自己的 build script，重新建置 | 不注入 Vite plugin                            | 產物檢查後部署               |

- **專案腳本與依賴套件的安裝腳本分開。** 專案自己的 `prebuild`／`build`／`postbuild` 在沙箱中
  允許（沙箱本來就假設 Theme 能執行任意程式，只放行 `vite.config.ts` 卻擋 build script 安全收益
  有限）；`node_modules` 套件的 `preinstall`／`install`／`postinstall` 仍受依賴政策控制。
- 第 0 步的 fixture 暫時由 Morph 執行 `vite build` 打通工具鏈，標為
  `KNOWN GAP: project-defined build scripts are not executed yet`，不是長期產品規則。

## 依賴：Theme 依賴快照

延伸既有 `storefront_theme_dependencies`（`requested → building → ready / failed / rejected`，
以 `storefrontId + themeId + packageName + packageVersion` 為鍵）與編輯器 Theme packages 介面，
不另開放行路徑。

```text
匯入專案
→ 讀 package.json + lockfile
→ 依 lockfile 的版本與 integrity 自動建立依賴申請（不用 range）
→ 在沙箱外準備與檢查
→ ready
→ 原專案直接 build
```

- **自動提出 ≠ 自動信任。** 使用者不必逐個啟用，但每個套件仍完成 lockfile 驗證、integrity、
  套件政策、生命週期腳本政策、Workers 相容性與產物準備，才轉為 `ready`。
- **三類套件、三種政策**：
  - 執行期依賴（React 函式庫、zod、UI 套件）；
  - 會進入 Theme Worker 的依賴；
  - 建置期依賴（Vite plugin、Tailwind plugin）：等同授權它在建置沙箱執行任意程式，需較高等級政策。
- **安裝腳本不隨套件自動信任**：一般 JS 套件可自動準備；需要 `postinstall` 的另走政策；原生
  addon／binary 另做相容性檢查（[pnpm supply-chain security](https://pnpm.io/supply-chain-security)）。
- **每個 Theme 有自己的依賴快照**，例如「Theme A 快照 #482：framer-motion@12.23.26、zod@4.2.0、
  vite-plugin-foo@3.2.1」。不修改 `cms.config.ts` 的全域清單；Theme B 不會因 Theme A 匯入而取得任何套件。
  長期由「平台工具鏈（TanStack Start、React、Vite、Cloudflare plugin）+ Theme 依賴快照」取代單一預裝清單。
- **沿用客戶的 package manager**：`packageManager` + lockfile + 依賴雜湊 + Node 相容性構成
  Theme Build Environment Snapshot。第一階段只支援 pnpm（frozen install），npm／yarn／bun 之後再開。
- 套件快取在平台端，建置時放入沙箱；建置沙箱維持不能外連（目標；目前尚未落實，見 Astro 計畫 7.1）。

## 基礎設施對應（唯一無法零設定搬移的部分）

應用設定（`vite.config.ts`、routes、TanStack 設定、React 程式碼）原樣使用。
基礎設施（D1、KV、R2、Queues、Secrets、自訂網域）必須對應到 Morph：

```text
偵測到：DATABASE → D1、MEDIA → R2、CACHE → KV、STRIPE_SECRET → Secret

DATABASE      [ Morph Database ▼ ]
MEDIA         [ Morph R2 storage ▼ ]
STRIPE_SECRET [ 新增 Secret ]
```

- 對應結果寫入**沙箱內**產生的 Wrangler 設定，客戶原檔不變。`@cloudflare/vite-plugin` 依序讀
  `cloudflare({ configPath })`、`CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH`、專案根目錄的
  `wrangler.jsonc`（[API reference](https://developers.cloudflare.com/workers/vite-plugin/reference/api/)），
  所以正式建置以該環境變數指向 Morph 產生的設定，客戶的 `cloudflare()` plugin 照常讀取，不改
  `vite.config.ts`。
- 客戶自己寫了 `configPath` 時優先權高於環境變數；匯入前檢查辨識這種情況，只在沙箱內那份設定
  替換 D1／R2／KV／service binding 的實際資源 ID，不修改客戶 repository。
- **預先渲染時的 CMS 內容**：環境變數只放 `MORPH_CONTENT_ORIGIN`、`MORPH_CONTENT_PUBLICATION`，
  不放內容本身；實際內容從此次建置專用、唯讀、已凍結的內容快照讀取。讀取環境變數發生在 loader／
  handler 執行時，不在 module scope（TanStack 對 Cloudflare runtime 的建議）。
- 專案中的 `.env` 不以明文匯入；需要的值在對應步驟轉為 Morph Secrets，其餘忽略並告知。

## 外連政策

正常的 TanStack Start 專案常在 loader 或 server function 呼叫外部 API，長期不能一律拒絕。

- 預設拒絕；使用者宣告目的地（例如 `api.stripe.com`），經 Morph 政策核准後只允許 HTTPS 與
  hostname 允許清單。
- **建置（含預先渲染）與執行期各一份允許清單。**
- 匯入檢查偵測建置期外連需求並說明原因；在允許清單完成前記為 `KNOWN GAP`。

## 程式碼裡何時會出現 Morph 的寫法

| 範圍                                                   | Code 裡看到的程式碼                                                         |
| ------------------------------------------------------ | --------------------------------------------------------------------------- |
| 匯入的專案本身                                         | 原樣，不加任何 Morph 檔案或寫法                                             |
| 渲染方式（SSR／SSG／ISR／CSR、全站 SPA）               | Design 寫入純官方寫法                                                       |
| Morph 必要接點（預覽橋接、CMS 內容來源、基礎設施對應） | 不在客戶程式碼中；只存在沙箱內的平台入口設定與 `wrangler.jsonc`，可完整列出 |
| **交給 Design 編輯的頁面內容**（文字、圖片等欄位）     | **會加入 Morph 的內容讀取寫法，不是 TanStack 官方寫法**                     |

最後一列是視覺 CMS 本質上的取捨：元件要從 CMS 讀取內容，Design 才能修改它（TinaCMS 同樣需要在
元件上加 `data-tina-field`）。界線：

- 只在使用者**主動**把某段內容交給 Design 管理時加入（例如「固定文字升級成欄位」）；匯入時不自動加入。
- 加入的寫法在 Code 中完整可見、可閱讀，不使用隱藏或虛擬模組。
- 沒有交給 Design 的元件維持官方寫法，Design 對它們只讀或不顯示可編輯欄位。

2026-10-09 補充（見 [ROADMAP](../ROADMAP.md) 1.2）：這一列是要縮小的過渡做法，不是終點。
- 就資料載入與傳遞方式而言，必要的只有內容的讀取呼叫（例如 `morph.pages.get()`），與任何 headless CMS 相同。讀到之後的資料流由作者用框架原本的寫法決定，Design 要能跟上：解構、別名、route `loader`、server function、`useLoaderData()`。不要求固定的取值形狀、手寫標記或特定 wrapper。
- 可視覺寫入的欄位仍須由 `contentFields`／`.fields.ts` 宣告欄位與型別、限制；這是欄位契約，不是資料流的限制。元件的預設值留在元件程式裡，不在宣告中重複。
- 目標由內容綁定契約文件定義：常見寫法逐步自動辨識，複雜寫法可選用明確的綁定出口；認不出時程式照常執行與編輯，Design 不猜、不寫回。

## 匯出

程式碼可帶走，本地 `vite build` 符合官方行為。交給 Design 管理的內容與 CMS 頁面仍存在 Morph，
在執行時向 Morph 取得內容，與任何 headless CMS 相同；不宣稱「完全脫離 Morph」。

## 交付順序

每一步各自一個 PR，各自有本機驗收；任何一步都不宣稱 Cloudflare 驗收完成。

0. **官方 fixture 原樣匯入驗收（最高層級驗收）。** 固定保存未修改的官方範例：
   `fixtures/tanstack/<example>/` 放上游原始碼（不改）、`LICENSE`、`SOURCE.json`（repo、commit、
   範例路徑、lockfile 產生日期、Node 與 package manager），以及由 fixture 框架產生的
   `pnpm-lock.yaml`（官方範例在 monorepo 中沒有自己的 lockfile；fixture 證明的是「這份官方原始碼
   不經改寫可被 Morph 接受」）。最優先的目標是目前官方 Cloudflare starter
   `start-basic-cloudflare`；之後補 `start-basic-static`（預先渲染 + SPA），selective SSR 與 SPA
   官方沒有範例專案，依官方文件補。同一份原始碼以本地建置與 Morph 匯入建置比較行為；尚未支援的
   部分寫成 `KNOWN GAP` 斷言（例如需要未認證的 Vite 8 工具鏈、專案 build script 尚未執行、
   `vite.config.ts`／`wrangler.jsonc` 仍為平台擁有、套件不在白名單、建置期外連被拒、安裝腳本政策），
   缺口修好斷言就會失敗。
1. **建置執行客戶設定**，分四個 PR，新舊兩條建置路線並存（沒有自己 `vite.config.ts` 的 Theme
   繼續走平台設定）：
   - 1a：`vite.config.ts`、`wrangler.json(c)`、`src/routeTree.gen.ts` 可留在原始碼、可由作者建立；
     Morph 建置的工作區仍用平台的版本。帶有自己建置設定的 Theme 明確拒絕建置
     （`NATIVE_START_BUILD_UNAVAILABLE`），不以不同的設定默默建置。
   - 1b：原生建置（先用 Vite 7 工具鏈）：工作區放客戶原檔，以 `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH`
     與內容環境變數提供部署環境，不注入 Vite plugin；依 `.wrangler/deploy/config.json` 找產物，
     在沙箱外整理成部署端的結構並檢查。開始前須決定是否移除編輯器標記（建議移除，列為 Morph 對原始碼
     的唯一轉換）。
     - **1b-1（已完成，未啟用）**：TanStack Start adapter 的 `build.native.plan`／`collect`
       （`src/lib/storefront/theme-framework/tanstack-start-native-build.ts`）。採用建議：移除編輯器標記，
       為 Morph 對原始碼唯一的轉換（使用者可再決定）。`vite.config.ts`、`wrangler.jsonc` 原樣使用；
       Morph 的設定副本放 `.morph/wrangler.json`，以 `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH` 指向它。
       拒絕：沒有或多份設定檔、`cloudflare({ configPath })`、宣告了尚無法對應的綁定（D1、KV、R2 等）。
       產物依 `.wrangler/deploy/config.json` → Worker 設定的 `main`／`assets.directory` 找到，移到
       Morph 既有的 `runtime/server`、`runtime/client` 配置。真實建置測試（`native-start-build.test.ts`）：
       starter 以官方寫法的設定、固定的 Vite 7 工具鏈建置，Worker 回應頁面 200、未知頁 404、靜態資源可取，
       確認建置讀的是 Morph 的設定副本，產物中沒有編輯器標記。
     - **1b-2**：原生建置沒有 `preview/index.html`，Build Preview 改為執行建置後的 Worker。已決定
       （2026-10-07）的做法與順序：
       1. **隔離式 Build Preview**：沿用現有容器與代理機制，但每個 build 一個獨立實例，不與 Live
          Preview 共用（Live Preview 有可變原始碼、HMR 與開發程序）。只載入該 build 的不可變產物，不重新
          建置、不改寫產物（也不為選取功能注入標記）。
          - 產物讀取（已完成）：`service/build-preview/build-preview-artifact.ts` 與發布用同一個
            `planThemeWorkerDeployment`、同一個 `wranglerDeployConfig`、同一個產物前綴，作者的 `name`、
            `vars` 與發布一樣被丟棄，禁止的綁定一樣被拒；每個檔案比對 manifest 記錄的 sha256。
          - 本機實例（已完成）：`service/build-preview/local-build-preview-worker.ts` 以 workerd 在
            loopback 執行；Worker 環境為空、對外連線預設 403（只允許 Core 的內容來源）、閒置自動回收。
            只能在本機輔助程序中使用，`check-local-preview-sidecar.mjs` 確保它不進部署產物。
          - 存取權杖（已完成）：`service/build-preview/build-preview-capability.ts`。權杖是隨機值，
            以預覽主機的第一個標籤呈現：`bp-<token>.<THEME_PREVIEW_HOSTNAME>`，文件與所有子資源自動帶著它，
            不需 cookie，也不需 Morph 的 session（session 不會送到預覽主機）。用單一標籤而非路徑，因為路徑
            會被 Theme 當成自己的路由，而預覽主機的憑證只涵蓋一層標籤。D1 只存雜湊
            （`storefront_build_preview_capabilities`，migration 0072），記錄使用者、商店、Theme、build
            與期限。每個請求以一次查詢重新檢查：未撤銷、未過期、使用者仍是未被停權的 admin、build 仍為成功
            且仍屬於該 Theme、Theme 未刪除。同一使用者對同一 build 只有一個有效權杖，發新的即撤銷舊的；
            build 刪除時權杖一併刪除。
          - 內容端點（已完成）：`service/build-preview/build-preview-content.ts`，只回應該 build 綁定的內容
            發布版本（不是草稿，也不是線上版本），回應為 `private, no-store`。
          - 執行器與 Core 路由（已完成，本機）：
            - 合約 `BuildPreviewServer`（`fetch`／`start`／`stop`，`build-preview-server.types.ts`）。Core 不保存
              跨請求狀態：請求轉給執行器，執行器回答「沒有實例」時，Core 從 R2 讀取並驗證產物後啟動，再送一次；
              第一個請求與閒置回收後的請求走同一條路。執行器不取得 R2 權限。
            - 每個權杖一個實例（不是每個 build 一個）：實例只能連到它被服務的那個預覽主機，兩位使用者預覽同一
              build 各有自己的實例；仍然只是該 build 的產物，不是 Live Preview 的程序。
            - 本機傳輸：沿用同一個本機輔助程序、同一組 token。協定新增 `buildPreviewStart`、`buildPreviewFetch`、`buildPreviewStop`，
              對應新合約（協定測試已更新為兩個合約）；啟動時檔案以 base64 放在 JSON 中，受輔助程序 64 MB
              上限約束。實例的內容來源是預覽主機本身；Node 無法解析 `bp-….preview.localhost`，所以本機的
              外連改連到 Core 的 loopback（`localhost:<port>`）並保留原本的 Host。
            - Core 路由（`src/server.ts` → `src/server/build-preview-request.ts`）：`bp-` 主機的所有路徑
              （包含 `/api/store/`）都先驗證權杖；`/_morph/content` 由 Core 回應，其餘轉送實例。去除瀏覽器
              送來的平台 cookie 與 `x-morph-*`，由 Core 寫入 build 的身分標頭；回應去除平台名稱的 cookie、
              隔離 SVG、加 `x-robots-tag: noindex`。每一跳都去除連線層標頭（hop-by-hop、長度與編碼），因為
              `fetch` 讀取時已解碼內容。開發時 `bp-` 主機也繞過 Morph 自己的 Vite。
            - 發權杖的 server function `openBuildPreview`（admin，限定該商店與 Theme 的 build），回傳網址。
            - 驗證：`build-preview-chain.test.ts` 以真實的輔助程序與 workerd 跑完整鏈：瀏覽器請求 → Core 驗證
              → 啟動實例 → 回應；Theme 程式經外連政策回呼內容端點，再由 Core 驗證權杖並回應凍結內容。
          - 容器版本（已完成，以替身測試）：
            - 獨立的 Durable Object 類別 `BuildPreviewSandbox`（`src/server/build-preview-sandbox.ts`），與 Live
              Preview 的 `PreviewSandbox`、建置用的 `Sandbox` 分開；同一映像，`enableInternet = false`、攔截 HTTPS。
              `wrangler.jsonc` 新增綁定、容器與 migration `v3`（未部署）；`local_preview_e2e` 環境照舊不含容器。
            - 每個權杖一個容器，名稱 `bp-<capability id>`。產物依發布的配置寫入，以映像內既有的 `wrangler dev`
              執行；行程只拿到 `WRANGLER_SEND_METRICS`、`NODE_ENV`，沒有 Morph 的任何環境變數或憑證；閒置 10 分鐘
              休眠，下一個請求經 Core 重新啟動。
            - 容器的對外請求由 Worker 中的外連政策（`build-preview-egress.ts`）處理：只回應「自己的」
              `/_morph/content`。主機中的權杖照常驗證，且該權杖對應的容器 id
              （`idFromName("bp-<capability id>")`，與 `ctx.containerId` 比對）必須是發出請求的容器；
              內容由 Core 的解析器直接回應，不經過網路。其餘一律 403 `PREVIEW_EGRESS_DENIED`，訊息不含路徑與查詢字串。
            - 工廠：綁定 `BuildPreviewSandbox` 時用容器；有其他容器綁定但沒有此類別時以
              `BUILD_PREVIEW_SANDBOX_UNBOUND` 拒絕（不用其他類別的政策，也不退回本機傳輸）。
            - 注意：一般開發機有容器綁定，所以本機輔助程序傳輸只在 `local_preview_e2e` 環境使用；一般
              `pnpm dev` 會走容器版本。
            - 尚未以真實容器驗證：`wrangler dev` 在無網路容器中的啟動、就緒訊息、`containerFetch` 與外連攔截。
          - 編輯器（已完成）：建置成功後先呼叫 `openBuildPreview`；環境有執行器時，預覽框載入 `bp-` 主機，
            並以與 user-code Live Preview 相同的規則（必須跨來源）給 `allow-same-origin allow-scripts`；沒有執行器時
            （server function 以 `BUILD_PREVIEW_EXECUTOR_UNAVAILABLE` 拒絕）照舊顯示靜態預覽。網址與 build id
            綁定，之後顯示的其他 build 不會沿用前一個 build 的網址。
          - 真實容器驗證（2026-10-07，本機 Docker，`MORPH_E2E_TRANSPORT=cloudflare-sandbox`）：
            `e2e/build-preview-isolated.spec.ts` 通過。過程中找到並修正兩個替身測試看不到的問題：
            - 容器內背景程序的輸出不保證在請求等待時送達（Live Preview 也記錄過），只等 `Ready on` 會逾時；
              改以 `waitForPort(8788, { mode: "tcp" })` 判斷就緒（不用 HTTP 探測，避免執行 Theme 程式），
              失敗時讀回程序自己的記錄放進錯誤訊息。
            - 容器的外連攔截只涵蓋 80／443；本機內容來源帶開發伺服器的連接埠時，Theme 的內容請求被網路直接
              拒絕、政策看不到、頁面默默顯示預設值。容器版本的內容來源改用預覽主機的預設連接埠
              （請求在 Worker 內由政策直接回應，不需要可連線）。
            - 外連政策逐筆記錄決定（只有 scheme 與主機，每個容器最多 20 行）。驗證時記錄顯示：容器內 Worker 的
              內容請求 `answered: own content`；wrangler 自己對 npm 與 Cloudflare 的請求被拒。
          - 工具列建置封存目前草稿（2026-10-07 決定採用 (a)）：建置前先送出待存的欄位修改，再以發布時同一段
            程式（`prepareContentDraftForBuild`，由發布流程抽出、行為不變）確認該頁的內容 Document 並準備該頁與
            外框的草稿，交給建置封存成內容快照；Build Preview 因此顯示發布這一頁會送出的內容，而不是 Theme
            預設值。發布重用 build 的條件多一項：build 帶有內容快照時，只有封存的草稿仍是目前的草稿才重用，
            否則先重建（`resolvePublishBuildPlan` 的 `buildContentCurrent`）；伺服器端的內容比對
            （`PUBLISH_BUILD_CONTENT_MISMATCH`）仍是最終把關。
          - 待做：
            - 本機 E2E（sidecar）：`local_preview_e2e` 用 `127.0.0.1` 作預覽主機，無法有子網域，需改用
              `*.localhost` 或另設主機。
            - 已發布媒體（`/_morph/media/`）在 Build Preview 主機上依 build 的內容版本提供。
       2. **Sandbox 建置程式接上原生建置與內容快照**：預先渲染只讀該次建置綁定的凍結內容快照。
          設計（2026-10-07；可再調整）：
          - **輸入**：materializer 目前略過 Theme 自己的 `vite.config.*`、`wrangler.json(c)` 並拒絕建置。原生模式
            改為把它們留在建置輸入與 `inputHash` 裡，輸入加上 `buildMode: "native"`；建置紀錄的 compiler 身分用
            `tanstack-start-native` 與固定工具鏈版本，與平台建置分開，凍結後不可改。
          - **開關**：只由伺服器端設定 `MORPH_NATIVE_START_BUILD=1` 開啟（預設關閉，正式環境一律拒絕），直到
            第 3 步驗收通過、第 4 步解除。關閉時行為與現在完全相同（`NATIVE_START_BUILD_UNAVAILABLE`）。
          - **工具鏈相容**：容器內不安裝套件，`node_modules` 一律來自固定工具鏈。沿用現有的
            `validateThemeStartPackageContract`（`package.json` 的 Start、React、Vite、Cloudflare 外掛等必須等於
            固定版本），不另寫一套版本規則；materializer 對 Start Theme 本來就會檢查，不符時以現有的
            `INVALID_START_PACKAGE` 拒絕並列出診斷。工具鏈沒有的其他套件沿用現有的依賴核准機制。接受 `^`／`~` 範圍屬於「Theme 依賴快照與工具鏈矩陣」那一步。
          - **包裝設定檔**（`theme-framework/tanstack-start-native-wrapper.ts`）：一律產生 `.morph/vite.config.ts`，
            以 `import` 載入 Theme 原本的 `vite.config.*`（不修改），以 `vite build --config .morph/vite.config.ts`
            建置。包裝檔只加兩個外掛：
            - **匯入防護**：依匯入「解析後的位置」判斷（先經過專案自己的別名）：在工作區內，或在允許的套件內
              （固定工具鏈實際安裝的套件，`GENERATED_SANDBOX_DEPENDENCY_VERSIONS`，加上核准的依賴）；其他一律拒絕
              （`UNAPPROVED_DEPENDENCY`、`WORKSPACE_PATH_ESCAPE`）。平台建置的防護是依匯入文字與 Morph 產生的別名判斷，
              原生專案帶自己的別名，文字無法判斷實際落點，所以沒有沿用；平台建置改用同一規則是之後的工作。
            - **凍結內容**：Morph 現有的 `themePrerenderContentPluginSource`，只在 Node 預覽伺服器、
              `TSS_PRERENDERING` 時作用，不進 Worker 產物。要預先渲染哪些頁由專案自己的設定決定；內容快照要求的
              頁面若沒有產生，建置以產物驗證失敗。
              2026-10-07 修正：原本只有 CMS 標為 SSG 的頁面拿得到凍結內容，專案自己預先渲染、CMS 為 SSR 的頁面
              讀內容失敗後，Theme 退回元件預設值，建置照樣成功（真實建置重現過），發布後店面會送出預設值的靜態頁。
              現在原生建置一律帶此外掛：有快照時封存每個靜態路由的內容（`createNativePrerenderContent`，與 Core 用同一個
              內容解析器，只讀快照）；沒有快照、或快照無法代表的路徑（例如需要 Core 才能判斷的舊資料），讀取一律拒絕並
              記錄到 `.morph/prerender-refused-reads.ndjson`，由兩個建置程式共用的 `nativeBuildResult` 以
              `NATIVE_PRERENDER_CONTENT_UNAVAILABLE` 讓建置失敗。判定依據是「預先渲染時讀了拿不到的內容」，不是看 HTML：
              不讀內容的靜態頁照常建置；快照存在但欄位沒有值時，照既有的欄位預設規則。CMS 指定 SSG 的發布限制
              （`PUBLISH_RENDER_POLICY_NOT_READY`）不變；能發布的靜態頁目前只有「專案自己預先渲染、CMS 為 SSR」這一種。
          - **產物**：沿用 1b-1 的 `collectNativeStartArtifact` 轉成 `runtime/server`、`runtime/client`。原生產物沒有
            `preview/index.html`，所以 adapter 有自己的 `native.artifactEntry`（Worker 入口）、`native.verifyArtifact`
            （Worker 入口、client 資產、內容要求的預先渲染頁）與 `native.manifestMetadata`（`build: "native"`、
            無 `previewEntry`），只以隔離式 Build Preview 預覽；之後的發布路徑與平台建置相同。
          - **本機建置程式會在本機以 Node 執行專案的 `vite.config.*`**：與本機 Live Preview sidecar 在本機執行 Theme
            的開發伺服器同一等級，只在開關開啟的開發與測試環境；程序只拿到 PATH、HOME（暫存目錄）、NODE_ENV 等
            執行所需的變數。真正的隔離由 Sandbox 建置程式提供。
          - **拆分**：N1 materializer／輸入／開關（已完成：開關開啟時保留 Theme 的設定檔、在排入建置前以
            `native.plan` 拒絕無法建置的設定、compiler 身分 `tanstack-start-native`；兩個建置程式收到原生輸入時以
            `NATIVE_START_BUILD_RUNNER_PENDING` 明確拒絕，不會改用平台設定建置）→ N2 本機建置程式（已完成：
            包裝檔與匯入防護、原生產物規則、真實建置測試——專案自己的設定預先渲染 `/landing`，HTML 含凍結內容、
            不含預設值；快照、包裝檔與 `.morph/` 不進產物；Worker 不含內容；設定沒有預先渲染內容要求的頁面時被拒；
            防護在真實建置中放行專案別名與核准套件，拒絕已安裝但未核准的套件與工作區外的檔案）→ N3 Sandbox 建置程式
            （已完成，以替身測試：原生計畫的檔案與 `public/` 二進位檔以現有的 `materializeThemeSandboxWorkspace` 寫入
            `/workspace`，`node_modules` 是映像連到固定工具鏈的那份；以映像的 Vite 執行
            `vite build --config .morph/vite.config.ts`，環境只有 `NODE_ENV`、`NODE_OPTIONS` 與計畫的
            `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH`。讀回時列出 `node_modules` 以外的檔案，先以原始碼上限加產物上限
            檢查總量才讀內容。收集、產物上限、原生驗證與 manifest 由兩個建置程式共用的 `nativeBuildResult` 負責）→
            第 3 步驗收（同時是 Sandbox 原生建置的真實容器驗證）。
       3. **完整發布驗收（本機）**：Code 儲存 → 原生建置 → Build Preview → 發布同一 build（比對產物雜湊）→
          店面驗證 → 回滾；涵蓋 SSR、靜態資產、server functions、404 與首次發布。
          已通過（2026-10-07，本機 Docker，`MORPH_NATIVE_START_BUILD=1`）：`e2e/native-publish-acceptance.spec.ts`。
          以 Code 存入專案自己的 `vite.config.ts`、`wrangler.jsonc` 與一個 loader 呼叫 server function 的路由 →
          工具列建置在 Sandbox 容器以專案設定建置（Sandbox 原生建置的第一次真實容器執行）→ 隔離式 Build Preview
          中該路由回 200 並含標記 → 發布只送出一次建置請求（重用預覽過的 build），build 的 compiler 為
          `tanstack-start-native`、manifest 入口為 Worker 且沒有 `previewEntry` → 店面（第一次發布）：SSR 頁面含標記、
          建置後的資產 200、不存在的頁面為 Theme 自己的 404 → 改為第二版並發布，店面顯示第二版 → 回滾到第一版，
          生效 release 的 build 回到第一次那個，店面回到第一版。產物皆由驗證程式從該次執行的 R2 依 manifest 重建後執行。
          已知的本機限制（原有，非本步驟造成）：本機店面的 Theme Worker 回呼店面主機名稱取內容時，workerd 無法解析
          `*.localhost`（`DNS lookup failed`），需要內容的頁面在本機店面拿不到內容；驗收的路由不讀內容。
          （2026-10-07 已解決：驗收啟動 Theme Worker 時，以本機 Build Preview worker 的外連對應，把店面主機名稱這一個
          origin 保留 Host 接回 Core；產品程式不變，Core 仍依主機名稱與生效 release 回答。）
          **內容配對驗收（G0，2026-10-07 本機真實容器通過）**：只保證「有封存內容的 build」（工具列建置與發布觸發的建置
          都封存草稿）。`e2e/native-publish-acceptance.spec.ts`（SSR 加上專案自己預先渲染、讀內容的靜態頁；build 記為
          依賴）：Build Preview 只顯示封存草稿；舊 build 的預覽重開也不會讀到新草稿；指名舊 build 的發布以
          `PUBLISH_BUILD_CONTENT_MISMATCH` 拒絕且 D1 不變；改字後的工具列發布會重建；送出前草稿被改，由最後的 OCC
          以 `TEMPLATE_DRAFT_CONFLICT` 拒絕，D1 不變、不重試；回滾後程式與內容一起回到原版。SSR、SSG 與
          `/_morph/content` 分別斷言，沒有新舊混搭。`e2e/native-content-dependency.spec.ts`（只有 SSR；build 證明為
          不依賴）：重新整理後純內容發布不建置、店面顯示新內容；回滾恢復原內容；依賴未知的 build 被伺服器拒絕、
          前端改走重建。處理途中改草稿以 DAL 測試涵蓋（最後的 OCC）。未驗：Cloudflare 部署環境。
          **建置的內容依賴（三種狀態）**：build 成功時記下 `content_dependency`，由平台建置流程證明，不採信 Theme 宣告。
          平台建置只有拿到預先渲染內容才是 `dependent`，否則 `independent`（內容只會以這個方式進入平台建置）。原生建置
          第一次在建置程序完全沒有內容的情況下建置：成功即 `independent`；預先渲染讀了內容（被拒並記錄）就從清空的工作區
          帶封存內容再建一次，記為 `dependent`。NULL 為未知（所有舊 build）。發布時伺服器只重用生效 release 自己的 build
          （不再挑同原始碼最新的 build），內容比對對 `dependent` 與未知照舊要求一致，只有 `independent` 可帶不同內容；
          編輯器的建置計畫同一規則，伺服器仍為最後裁決者。
          **回滾後重新發布**：「已上線」改為以生效 release 的內容發布是否含這一版草稿判斷。原本以 template 的已發布紀錄
          判斷，回滾後重新發布被回滾掉的草稿會回「已發布」而什麼都沒寫。
          **已知、另行處理**：Live Preview 在原始碼變更後被平台「更新 sandbox runtime」打斷時，有時不會重新啟動
          （#139 已修）；`publish.spec.ts` 中 Release history 對話框一次 Escape 未關閉（#136 加了診斷，原因未明）。
          **發布後的預覽**：發布觸發的建置成功時不再開啟 Build Preview（發布仍可能被拒，建置結果不能被當成已上線）；
          發布成功後才開啟該 release 的預覽，標示「Published」，店面有網域時附「Open live site」。預覽的權限
          （`storefront_build_preview_capabilities.release_id`，migration 0074）綁定 release：同一個 build 的產物，
          以 release 自己的內容發布回答 `/_morph/content`，每次請求都重新確認 release 仍存在、屬於同一個商店與 Theme，
          而且就是這個 build 的 release。因此只發布內容、重用 `independent` build 時，預覽顯示新 release 的內容，
          不是該 build 封存的舊內容。Build Preview 照舊只代表建置驗收的結果（封存內容）。沒有隔離式預覽的環境不開啟。
       4. 驗收通過後才解除 `NATIVE_START_BUILD_UNAVAILABLE`（限定與固定工具鏈相同的版本）。啟用是獨立的 PR：
          限定已認證的工具鏈組合、確認「有設定檔」不會誤判既有 Theme、未認證版本有清楚診斷；Cloudflare 部署環境的
          內容配對驗收仍未完成。
   - 1c：原生 Theme 的 Live Preview（平台入口設定注入）。
   - 1d：以同一組請求比較 Morph 原生建置與本地基準（需一個仍用 Vite 7 的官方 commit 作 fixture）。
2. **Theme 依賴快照與工具鏈矩陣**：lockfile 驅動的自動申請、三類政策、安裝腳本與原生套件政策、
   三級相容狀態與建置來源紀錄；先支援 pnpm。
3. **基礎設施對應與外連政策**：綁定、Secrets、`.env`、建置與執行期兩份允許清單。
4. **Render Plan 由產物取得並凍結**，接著 SSG、全站 SPA、ISR 的正式供應。
5. **Design 寫入官方寫法**，含渲染方式選擇器；每個選項都要正式網站能送出才開放。
6. **Starter Theme 轉為原生專案，移除舊建置路線。** 原生路線穩定後，starter 本身改為帶有自己
   `vite.config.ts`、`wrangler.jsonc` 與 lockfile 的原生 TanStack Start 專案，現有頁面與測試一併
   搬過去成為原生路線的回歸測試；再移除平台產生的 `vite.config.ts`、覆寫 `package.json` 與單一固定
   版本等舊路線。在那之前保留現有頁面：它們是 Design／CMS 功能唯一的回歸保障。尚未部署，轉換時
   不需顧慮既有客戶資料。

移除 #98 在 CMS 資料中可編輯的渲染設定，須先確認沒有呼叫者，於步驟 4 或 5 處理。

## 啟用原生建置前的阻擋項

- **已修正（#131）：Workers for Platforms 派送路線未帶店面情境標頭。** `DispatchNamespaceThemeRuntime`
  直接把訪客的原始請求交給 Theme Worker，沒有經過 service binding 與本機路線共用的
  `applyStorefrontContext`，因此缺少 `x-morph-storefront-host`、`x-morph-content-origin`、
  `x-morph-storefront-id`、`x-morph-release-id`、`x-morph-theme-build-id`、
  `x-morph-content-publication-id` 六個標頭。影響的是內容與授權鏈：Theme 沒有內容來源，SSR 頁面
  全部顯示元件預設值而非已發布內容；更嚴重的是訪客自帶的標頭會原樣送達 Theme，自訂的
  `x-morph-content-origin` 會讓內容載入改向攻擊者的來源取得「已發布內容」並渲染（內容注入），
  店面、release、build 與 publication 識別也可被偽造。當時尚無法觸及（`wrangler.jsonc` 未綁定
  `THEME_DISPATCHER`，正式環境走 service binding），但派送路線一啟用就會生效。現在派送與其他路線
  共用同一個 `applyStorefrontContext`（設定而非合併，release 沒有 publication 時刪除該標頭），
  內容來源取自 Morph Core 被呼叫的 origin，並有單元測試覆蓋這三點。

## 第 0 步結果（2026-10-06，本機）

Fixture：`fixtures/tanstack/start-basic-cloudflare/`，TanStack/router `9595b97` 的
`examples/react/start-basic-cloudflare`，47 個檔案逐一以 git blob 雜湊核對與上游相同；另加由
pnpm 10.34.5 產生的 `pnpm-lock.yaml`（vite 8.3.3、`@tanstack/react-start` 1.168.60、
`@cloudflare/vite-plugin` 1.62.5、wrangler 4.147.0、react 19.3.0）。來源與每檔雜湊記在
`fixtures/tanstack/SOURCES.json`，授權在 `fixtures/tanstack/LICENSE`。

**本地基準**（`node scripts/official-fixture-baseline.mjs`，不在 CI）：以 fixture 自己的 lockfile
安裝（`--frozen-lockfile --ignore-scripts`，7.9 秒）、自己的 Vite 8.3.3 建置（4.2 秒）、
`vite preview` 於 workerd 執行，四項全部通過：`/` 200（server function 於 SSR 讀到 wrangler var）、
`/customScript.js` 200（server route、JavaScript content type）、`/redirect` 307 → `/posts`、
`/api/users` 200（呼叫外部 API；Morph 沙箱目前會拒絕）。

**Morph 匯入前檢查**（`src/lib/storefront/compat/official-start-import.test.ts`，CI）：

- 已相容：檔案與上游逐位元相同（改一個字元即失敗，已做反向對照）；所有路徑符合 Morph 的檔案路徑規則；
  Code 模式的路由表能讀懂官方路由樹，**沒有任何診斷錯誤**（含 `customScript[.]js.ts`、pathless layout）。
- `KNOWN GAP`：
  - `package.json` 必須等於 Morph 固定版本，官方的版本範圍被拒絕；
  - 需要未認證的 Vite 8 工具鏈（Morph 固定 Vite 7.3.5、Start 1.168.32）；
  - ~~`vite.config.ts`、`wrangler.jsonc` 為平台擁有路徑，專案自己的無法匯入~~：1a 已關閉，連同當時
    漏掉的 `src/routeTree.gen.ts`（官方專案會提交它）。原本的斷言檢查的是「工作區由平台擁有」這個
    意思沒變的函式，缺口關閉時不會失敗；1a 改為檢查作者能否保留這些檔案，並新增下一項；
  - Morph 建置讀到帶有自己建置設定的專案時明確拒絕（`NATIVE_START_BUILD_UNAVAILABLE`），1b 關閉；
  - 宣告的套件超出核准的 Theme 依賴（例如 `@tanstack/react-router-devtools`）。
- 尚無 Morph 元件可對照、先記為 `it.todo`：專案 build script 尚未執行；生命週期腳本政策
  （本專案 `postinstall` 執行 `wrangler types`）；建置與執行期外連允許清單；`wrangler.jsonc`
  的 vars 與綁定對應。

Morph 匯入後的實際建置尚未比較：目前在匯入前檢查就被擋下，待步驟 1 打通後再以同一組請求對照基準。

## 會改動的既有假設

- `vite.config.ts`、`wrangler.json(c)` 不再是平台擁有路徑。
- 依賴白名單從「平台 Vite 設定中的白名單 plugin」改為「每個 Theme 的依賴快照」。
- 容器內固定的 `/opt/morph-toolchain` 從單一版本改為依相容版本矩陣選擇；Theme 沙箱的 Node
  版本與 Morph 應用分開。
- 正式建置不再使用平台產生的 `vite.config.ts`。

## 定位與先例

| 產品                 | 做法                                                      | 與 Morph 的差異                                                |
| -------------------- | --------------------------------------------------------- | -------------------------------------------------------------- |
| Onlook               | 既有 React／Next 專案，視覺修改寫回 JSX，程式碼為唯一來源 | 最接近 Code ↔ Design 共用一份程式碼；不處理 CMS 內容與渲染設定 |
| TinaCMS／CloudCannon | 既有專案上的編輯層，內容存 repo，視覺編輯寫回檔案         | 需要自己的 schema／client／`data-tina-field` 接線              |
| Plasmic              | 註冊既有 React 元件，視覺模型 + 產生的程式碼              | 程式碼加上 Plasmic 視覺模型，不是單一來源                      |

Morph 的組合是：原生框架專案直接匯入、原始碼是唯一來源、Design 直接改真實程式碼、CMS 內容與
渲染策略也能視覺控制。以 Design 視覺修改框架層設定（`ssr`、`pages`、`headers`）並寫回官方語法，
目前沒有查到主流 CMS 這樣做；但尚未完整調查，對外宣稱前須再確認 Nuxt Studio、Builder.io、Vercel
等的最新功能。要避免的方向是 `TanStack source → Morph schema → Morph config → 再轉回 TanStack`，
那會逐漸變成另一個 framework。

## 未決事項

- 匯入介面（上傳壓縮檔或連接 Git）。
- 建置期依賴（Vite plugin）的較高等級政策內容。
- 「執行時決定」路由的 ISR 是否進邊緣快取（建議只快取 Render Plan 明確宣告為 ISR 的網址）。
- 送給瀏覽器的 `Cache-Control` 改寫規則。
- 套件安全掃描的資料來源與更新頻率。
- 控制服務授權仍未確認（既有開放前條件），建置沙箱同樣適用。
- 專案 build script 政策的細節（逾時、輸出位置、允許的指令）。
- 相容版本矩陣的資料來源、Known incompatible／Blocked 清單與安全公告的來源。
- 支援 `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH` 的 Cloudflare plugin 最低版本（1.62.4 已確認支援）。
