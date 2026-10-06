# Morph Native TanStack Start Hosting + Visual CMS 規劃（2026-10-06）

狀態：規劃，尚未實作。接續 [`ROADMAP.md`](../ROADMAP.md)「TanStack Start 原生相容」。
各層實際驗收仍以 [`docs/tanstack-start-compatibility.md`](tanstack-start-compatibility.md) 為準。

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
2. **建置執行客戶原本的 `vite.config.ts`。** AST 只服務 Design 讀寫、Monaco 提示，以及判斷
   「這段 Design 能不能改」；不決定建置實際怎麼跑。
3. **Morph 必要的部分以透明的平台入口設定加入，不改寫客戶檔案。** 沙箱內的
   `.morph/vite.config.ts` import 客戶設定，以 Vite 官方 `mergeConfig` 加上 Morph plugin
   （預覽：編輯器橋接、HMR 轉送、內容來源、SVG 隔離；正式建置：預先渲染的 CMS 內容來源），
   以 `vite build --config .morph/vite.config.ts` 執行。客戶檔案不變，Morph 加入的內容可完整
   列給使用者看。
4. **建置沙箱視為完全不可信。** 允許：讀寫 Theme 工作區、執行 subprocess、Vite plugin、loader、
   預先渲染。不允許：讀取 Morph secrets、其他商店資料、主機檔案系統、直接使用正式 D1／R2 綁定、
   任意外連、直接部署。產物在沙箱外檢查（manifest、入口、大小、禁止內容），通過才能成為 release。
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

- 共用路由也能逐頁設定：`ssr` 支援函式形式並收到 `params`，路由的 `headers` 也收到 `params`。
  Design 在路由檔內寫一般物件記錄各頁設定，以官方函式形式讀取；不 import Morph 模組。
- CMS 頁面新增、刪除、改 handle 時，Design 以同一次 OCC 寫入一併更新 `pages` 與路由檔中的頁面設定。
- 客戶的 `vite.config.ts` 是計算出來的（變數、函式、`loadEnv`），Design 的 SSG 設定為唯讀；
  建置仍照常執行。

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
- 套件快取在平台端，建置時放入沙箱；建置沙箱維持不能外連。

## 基礎設施對應（唯一無法零設定搬移的部分）

應用設定（`vite.config.ts`、routes、TanStack 設定、React 程式碼）原樣使用。
基礎設施（D1、KV、R2、Queues、Secrets、自訂網域）必須對應到 Morph：

```text
偵測到：DATABASE → D1、MEDIA → R2、CACHE → KV、STRIPE_SECRET → Secret

DATABASE      [ Morph Database ▼ ]
MEDIA         [ Morph R2 storage ▼ ]
STRIPE_SECRET [ 新增 Secret ]
```

- 對應結果寫入**沙箱內**產生的 `wrangler.jsonc`，客戶原檔不變；客戶的 `cloudflare()` plugin 照常讀取。
- 專案中的 `.env` 不以明文匯入；需要的值在對應步驟轉為 Morph Secrets，其餘忽略並告知。
- 建置時不能外連：預先渲染期間呼叫外部 API 的 loader 會失敗。與預覽外連允許清單一起設計，
  匯入檢查需偵測並說明原因。

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

## 匯出

程式碼可帶走，本地 `vite build` 符合官方行為。交給 Design 管理的內容與 CMS 頁面仍存在 Morph，
在執行時向 Morph 取得內容，與任何 headless CMS 相同；不宣稱「完全脫離 Morph」。

## 交付順序

每一步各自一個 PR，各自有本機驗收；任何一步都不宣稱 Cloudflare 驗收完成。

0. **官方 fixture 原樣匯入驗收（最高層級驗收）。** 固定保存未修改的官方 fixture：
   `official-basic`、`official-cloudflare`、`official-prerender`、`official-selective-ssr`、
   `official-spa`。同一份 source 分別以本地 `vite build` 與 Morph 匯入建置，比較行為：SSR、CSR、
   data-only、SSG、SPA、server functions、routes、自訂 Vite plugin、loader、middleware。
   尚未支援的部分寫成 `KNOWN GAP` 斷言，缺口修好斷言就會失敗。
1. **建置執行客戶設定**：`vite.config.ts`、`wrangler.jsonc` 改為作者擁有；平台入口設定以
   `mergeConfig` 加入 Morph 必要部分；沙箱外檢查產物。
2. **Theme 依賴快照**：lockfile 驅動的自動申請、三類政策、安裝腳本與原生套件政策；先支援 pnpm。
3. **基礎設施對應**：綁定、Secrets、`.env` 與建置外連偵測。
4. **Render Plan 由產物取得並凍結**，接著 SSG、全站 SPA、ISR 的正式供應。
5. **Design 寫入官方寫法**，含渲染方式選擇器；每個選項都要正式網站能送出才開放。

移除 #98 在 CMS 資料中可編輯的渲染設定，須先確認沒有呼叫者，於步驟 4 或 5 處理。

## 會改動的既有假設

- `vite.config.ts`、`wrangler.json(c)` 不再是平台擁有路徑。
- 依賴白名單從「平台 Vite 設定中的白名單 plugin」改為「每個 Theme 的依賴快照」。
- 預裝 toolchain image 改為「平台工具鏈 + 依快照從平台快取安裝」。

## 未決事項

- 匯入介面（上傳壓縮檔或連接 Git）。
- 建置期依賴（Vite plugin）的較高等級政策內容。
- 「執行時決定」路由的 ISR 是否進邊緣快取（建議只快取 Render Plan 明確宣告為 ISR 的網址）。
- 送給瀏覽器的 `Cache-Control` 改寫規則。
- 套件安全掃描的資料來源與更新頻率。
- 控制服務授權仍未確認（既有開放前條件），建置沙箱同樣適用。
