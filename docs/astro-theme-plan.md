# Morph Astro Theme 接入設計（2026-10-07）

狀態：設計草案，供審查，尚未實作，Morph 程式碼未修改。這是 [`docs/multi-runtime-theme-plan.md`](multi-runtime-theme-plan.md)
交付順序第 4 步（Astro 接入）的設計。總體原則以該文件為準；建置、Build Preview、發布與回滾沿用
[`docs/start-native-import-plan.md`](start-native-import-plan.md) 的原生 TanStack Start 路線，本文件只寫
Astro 與它不同的地方。

更新（2026-10-07）：記錄 R1、R2 的結果與使用者對其待決事項的決定（0.4）。
更新（2026-10-07）：G0 已在本機真實 Sandbox 容器中驗收（#137），涵蓋範圍與未涵蓋的部分記錄於 8.2；Cloudflare 部署環境未驗。

更新（2026-10-08）：記錄 M1 的結果：解析器放不進 Morph 主 Worker 的 isolate，M1 不通過，A1 之前停下，
等使用者在 0.3 的選項中決定（3.1、8.2）。

更新（2026-10-08）：記錄使用者對解析器位置的決定（0.3：專用解析器 Worker 為首選，Sandbox 容器中的官方 Node 解析器
為備案），以及 M1c 的本機結果（3.1）。M1c 在本機通過**不開啟 L2**：部署後的解析器 Worker 的雲端驗證是 L2 使用它之前
的必要閘門（8.2 的 M1c-C）。

更新（2026-10-08）：記錄 M1c-C 的雲端結果：以使用者核准的測試資源部署、執行、清理，M1c 的負載模式下每一種合法
負載至少 3 輪逐請求對帳完整、平台 outcome 全為 `ok`，`exceededMemory` 為 0，**M1c-C 通過**（3.1、8.2）。這只代表
這些負載模式與這一輪，不是永久安全保證；128 MB 如何計算、毒化 isolate 何時回收等仍未回答（3.1）。正式使用解析器
Worker 仍要使用者另外核准新的部署單位。

更新（2026-10-08）：A1 實作（8.2 的 A1 列記錄結果）。build 記錄框架，adapter 依紀錄選擇；`astro` 只是 id，
選到時以 `THEME_FRAMEWORK_UNAVAILABLE` 拒絕；Start 原生建置中屬於 Cloudflare 部署目標的部分搬到
`theme-framework/cloudflare-native-build.ts`。

**本文件合併不代表核准實作，也不解除 G0**（第 8 節）。文中的解法很多仍是待驗假設，各自以閘門驗證後才定稿。
文中以三種標記區分：

- **【事實】**：已由原型實測，或已讀程式碼、產物確認；證據寫在該處。
- **【待驗】**：本文件提出的解法，可行性尚未證明；對應的閘門寫在該處。
- **【待決】**：產品選擇，需要決定，不是技術上能驗證出來的。

第 0 節是三類的總表。

依據：

- `~/projects/astro-spike/LIVE-PREVIEW-REPORT.md`（2026-10-07 Live Preview 原型，以下稱「預覽報告」，
  阻礙編號 B1–B11 沿用該報告）與同目錄的建置原型（2026-10-06）。
- 本文件撰寫時另外讀了 spike 中 `@astrojs/cloudflare` 14.3.3 的原始碼與建置產物，結果列在各節的「證據」中。
  這些都是讀程式碼得到的結論，沒有另外執行。
- `~/projects/astro-spike/r1-parser/R1-REPORT.md`（2026-10-07，以下稱「R1 報告」）：`.astro` 解析器在 workerd
  中的可行性與位置精度。
- `~/projects/astro-spike/r2-prerender/R2-REPORT.md`（2026-10-07，以下稱「R2 報告」）：Astro 預先渲染讀封存內容，
  以及 `session: false`、`imageService` 的產物。
- `~/projects/astro-spike/m1-morph-memory/M1-REPORT.md`（2026-10-08，以下稱「M1 報告」）：解析器與 Morph 主
  Worker 在同一個 isolate 中的記憶體、bundle 大小與啟動時間。Morph 為 `main` @ `6ea0886` 未修改的 `pnpm build`。
- `~/projects/astro-spike/m1c-parser-worker/M1C-REPORT.md`（2026-10-08，以下稱「M1c 報告」）：專用解析器 Worker
  經 service binding 呼叫的本機實驗（本機 workerd 中兩個 Worker，沒有部署）：admission、大小與巢狀形狀、並行、
  連續請求、trap 後的行為、經過 binding 的大小與時間，以及解析器 isolate 自己的記憶體。
- R1、R2 的原始結果（腳本、log、產物）留在 `~/projects/astro-spike`，直到本文件已記錄結論，**而且** A2 的
  Sandbox 驗證完成（第 8 節）；在那之前不刪除、不搬移。M1、M1c 的原始結果同樣保留。
- 2026-10-07 使用者對 R2 待決事項的決定（第 0.4 節）。
- Morph `main` @ `0f832bd`：`src/lib/storefront/theme-framework/`、`compiler/theme-prerender-content.ts`、
  `compiler/theme-preview-start-runtime.ts`、`compiler/theme-preview-bridge-entry.ts`、
  `service/theme-worker-deployment-plan.ts`、`compiler/native-build-result.ts`。

版本基準（spike 實際解析到的版本）：Astro 7.3.5、`@astrojs/cloudflare` 14.3.3、`@cloudflare/vite-plugin`
1.62.5、Vite 8.3.3、wrangler 4.147.0、`@astrojs/react` 7.0.0、`@astrojs/vue` 7.0.3、`@astrojs/compiler-rs` 0.5.1。

A2b（2026-10-09）把工具鏈的 `@astrojs/cloudflare` 升到 14.3.4（7.2.1）。本文件引用的 adapter 原始碼位置是 14.3.3 的；
14.3.4 的 `dist/` 與 14.3.3 逐檔比對過：`prerenderer.js` 只改了 preview server 的網址（多一行 import，之後的行號加 1，
例如 `164-167` 成為 `165-168`，內容相同），`index.js` 把 `process.env` banner 改為只加在 `ssr` 與 `prerender` 環境，
另有 frontmatter plugin 與 image binding 的修正。其他版本不變。

## 0. 事實、待驗解法與待決選擇

### 0.1 【事實】

| 事實                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 證據                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Astro 7.3.5 與 `@astrojs/cloudflare` 14.3.3 要求 Vite `^8.0.13`；Morph 唯一的工具鏈固定 Vite 7.3.5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 預覽報告 B1                                                                                                                                |
| Astro 的 Cloudflare 預先渲染另起 `vite.preview({ configFile: false })`，Start 的 `configurePreviewServer` 外掛不會生效。adapter 對 preview server 的 POST 只指定 `Content-Type`；Worker 端把這個 POST 的全部標頭原樣複製給頁面的 `Request`（method 改成 GET），所以頁面另外還會看到 Node `fetch` 與 miniflare 加上的標頭（`accept*`、`user-agent: node`、`host`、`x-forwarded-host`、`cf-connecting-ip`），以及 POST 本身的 `content-length` 與 `content-type: application/json`。不加包裝時頁面看到的請求**沒有** `x-morph-content-origin`                                                                                 | 讀 `@astrojs/cloudflare` 的 `dist/prerenderer.js:158-163`、`dist/utils/prerender.js:49-59`；R2 報告 §2.1（`probe`、`noshim` 兩個情境實測） |
| 只套用在 Vite `prerender` 環境的 plugin 能以 `resolveId` 攔截 adapter 寫死的入口 `@astrojs/cloudflare/entrypoints/server`（`dist/index.js:149`），包住它，設定 `x-morph-content-origin`；頁面能讀到這個標頭，可部署的 bundle 中沒有包裝。入口以裸模組名、`importer: null` 進來，每次建置只命中一次                                                                                                                                                                                                                                                                                                                          | R2 報告 §2.1、§2.2（本機 miniflare）                                                                                                       |
| 預先渲染 Worker（本機 miniflare／workerd）連得到建置程序在 `127.0.0.1` 上開的 HTTP server；連不到時 workerd 回報 `Network connection lost.`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | R2 報告 §2.3。**Sandbox 容器未驗**                                                                                                         |
| Theme 的讀取函式吞掉錯誤時，無快照、內容伺服器回 500、連線被拒、拿掉標頭送達四種失敗，`astro build` **全部以 exit 0 結束**，並產出含元件預設值的 HTML；只有讀取記錄判得出失敗                                                                                                                                                                                                                                                                                                                                                                                                                                               | R2 報告 §3                                                                                                                                 |
| 預先渲染成功後，Astro core 自己刪除 `dist/server/.prerender/`；預先渲染失敗時這個目錄會留下，內含包裝與完整的 prerender bundle（`prerender-entry.*.mjs`、`entry.mjs`、`wrangler.json`）                                                                                                                                                                                                                                                                                                                                                                                                                                     | `astro/dist/core/build/static-build.js:109-120`；R2 報告 §2.2                                                                              |
| 預先渲染的 preview server 預設開 inspector port（9229，被占用時改用下一個）；只有 Theme 自己在 `cloudflare({...})` 設定 `inspectorPort: false` 時才消失                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `prerenderer.js:106-122`、`index.js:171`；R2 報告 §4                                                                                       |
| 預設建置產物的 Worker 設定含 `kv_namespaces: SESSION`、`images: IMAGES`；設定 `cacheCloudflare()` 時含 `cache.enabled`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 讀 spike 的 `dist/server/wrangler.json`                                                                                                    |
| 現有部署規則以 `FORBIDDEN_BINDING` 拒絕 KV；`images`、`cache` 不在禁止清單中，部署時被丟掉                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `theme-worker-deployment-plan.ts`                                                                                                          |
| Theme 設定 `session: false` 加上 adapter 的 `imageService: "passthrough"` 或 `"compile"` 時，產物 Worker 設定的 `kv_namespaces` 為 `[]`、沒有 `images`、`previews` 為 `{}`，建置成功。兩項都不設時，頂層與 `previews` 欄位**都**有 `SESSION` 與 `IMAGES`。建置期的圖片處理（`compile`）沒有被執行到：測試 Theme 沒有使用圖片                                                                                                                                                                                                                                                                                                | R2 報告 §2.4（`normal`、`img-compile`、`baseline-default` 三個情境的 `dist/server/wrangler.json`）；`dist/wrangler.js:21-42`               |
| `@astrojs/compiler-rs` 0.5.1 在 Node 中經 `@astrojs/compiler-binding-<平台>` 載入原生 binding；官方另有 `@astrojs/compiler-binding-wasm32-wasi`（`binding/browser.js` 就是匯出它）                                                                                                                                                                                                                                                                                                                                                                                                                                          | spike 的 `node_modules`；R1 報告 §1                                                                                                        |
| `@astrojs/compiler-rs` 0.5.1 加官方 `wasm32-wasi` binding 能在本機 workerd 中載入並解析；9 個樣本（含 369 KB 大檔）的 AST 與 Node 原生 binding 逐位元組相同，位置檢查 0 失敗，解析錯誤回傳診斷而不丟例外。Wasm 模組宣告最少 981 頁（約 61 MiB）的 shared 線性記憶體，只增不減                                                                                                                                                                                                                                                                                                                                               | R1 報告 §2                                                                                                                                 |
| Morph 主 Worker 本身（`main` @ `6ea0886` 的 build，本機 workerd，GC 後的 V8 heap 加 ArrayBuffer）：剛載入、尚無請求 52.4 MiB；處理過公開 SSR 請求後 72.8 MiB；680 個伺服器 chunk 全部 evaluate 後 84.5 MiB。SSR 請求後、GC 之前的 heap total 為 101–109 MiB                                                                                                                                                                                                                                                                                                                                                                 | M1 報告 §2.1（各 3–5 次，次數之間差距 < 0.1 MiB）                                                                                          |
| 解析器與 Morph 主 Worker 在同一個 isolate 中**超過 128 MB**：SSR 請求後實例化解析器即 135.2 MiB；100 KB 檔案的 AST 存活時 147.7 MiB；369 KB 檔案 181.7 MiB（GC 後的 V8 heap ＋ ArrayBuffer ＋ Wasm `byteLength`）。128 MB 減去 Morph 的 72.8 MiB 只剩約 49 MiB，少於 61.3 MiB 的 Wasm 底線。本機 workerd 不強制上限                                                                                                                                                                                                                                                                                                         | M1 報告「結論」、§2.2（3 次；`full` 序列另 5 次）                                                                                          |
| 同一個 100 KB 檔案連續解析 200 次，GC 後的 isolate 與 Wasm 不再成長；但一個請求中連續解析 20 次時，GC 前累積約 40 MiB 垃圾。Wasm 線性記憶體隨解析過的最大檔案成長（369 KB 後 79.9 MiB），不縮回                                                                                                                                                                                                                                                                                                                                                                                                                             | M1 報告 §2.3、§2.4（5 次）                                                                                                                 |
| 丟棄解析器實例（`reset`）並強制完整 GC 後，workerd 程序的位址空間不減少：每建立一個實例 +4 GiB，5 次重建 +20 GiB。舊實例的記憶體是否釋放沒有得到確認                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | M1 報告 §2.5（`parser-only` 3 次、`morph-parser` 5 次）                                                                                    |
| 加入解析器後 bundle 為 27.9 MiB（Morph 21.3 MiB ＋ 解析器 6.5 MiB，wrangler dry-run 的 Total Upload），在 64 MiB 未壓縮上限內；本機 `wrangler check startup` 的 global scope CPU，Morph 155–259 ms、加上解析器 128–262 ms，差異小於次數之間的變動                                                                                                                                                                                                                                                                                                                                                                           | M1 報告 §2.6（大小 1 次，啟動各 5 次）                                                                                                     |
| 專用解析器 Worker 的 isolate（本機 workerd，經 service binding；GC 後的 V8 heap ＋ ArrayBuffer ＋ Wasm `byteLength`）：實例化 63.8 MiB；100 KB 頁面的 AST 與回應存活時 71.9 MiB；100 KB 的「大量小節點」或深層物件檔案讓 Wasm 永久停在約 84 MiB、GC 後 87 MiB；369 KB 為 94.9 MiB。GC 前的取樣在單一 slot 的並行（N = 2 最高 committed 138.9 MiB、used 102.7 MiB）、60 個 100 KB 連續請求（used 約 121 MiB、committed 約 155 MiB）、369 KB 連續 10 次（used 147–164 MiB）下超過 122.1 MiB。shared Wasm memory 不在 `getHeapUsage` 的任何欄位中（加上 `byteLength` 不會重複計算）；實例化讓 workerd 程序的 RSS 增加約 80 MiB | M1c 報告 §3.1–3.7（各 3 次）                                                                                                               |
| fetch 形式的 handler 先取得 slot 再讀 body 時，排隊的請求不在解析器或 core 的 isolate 中持有 body（8 × 369 KB 排隊時兩者 +0.0 MiB；`ReadableStream` 參數的 RPC 相同）；字串參數的 RPC 在 admission 之前就把字串反序列化進解析器 isolate（+5.2 MiB）                                                                                                                                                                                                                                                                                                                                                                         | M1c 報告 §3.5（各 3 次）                                                                                                                   |
| compiler-rs 0.5.1 沒有深度或資源上限的選項。本機 workerd 中 frontmatter 巢狀陣列約 790 層（1.6 KB 的檔案）、物件約 760 層、運算式括號約 1000 層、`<div>` 約 2410 層就 stack overflow；門檻也受同一檔案中其他內容影響（900 層的括號運算式 1、2、10 份都成功，50 份 trap）                                                                                                                                                                                                                                                                                                                                                    | M1c 報告 §3.3（3 次；括號重複的探測 1 次）                                                                                                 |
| trap 後沿用同一個解析器實例：3 次 run 都在第 94 次 trap 開始失效，之後連正常檔案也回 `memory access out of bounds`。丟棄並重建實例：結果正確，但每次重建 workerd 程序的 RSS 增加約 13–22 MiB、VmSize +4 GiB，強制 GC 後都不減少                                                                                                                                                                                                                                                                                                                                                                                             | M1c 報告 §3.8（各 3 次）                                                                                                                   |
| Astro 7.3.5 本身依賴 `@astrojs/compiler-rs ^0.5.0`；`@astrojs/compiler`（Go → Wasm）是 Astro 6 以前的編譯器                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `node_modules/astro/package.json`；R1 報告「結論」、§3.3                                                                                   |
| `.astro` 修改會整頁重新載入；`.tsx` island 修改是局部 HMR                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 預覽報告 Run A／B                                                                                                                          |
| `.astro` 頁面沒有實例識別，`request-structure` 回報 `nodes: []`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 預覽報告 B5                                                                                                                                |
| bridge 的內容更新與導覽在沒有 TanStack Router 時不做任何事                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `theme-preview-bridge-entry.ts`                                                                                                            |
| relay 的 `applied` 不代表「這次寫入造成的更新已顯示」                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 預覽報告第 2 節                                                                                                                            |
| Live Preview 中 adapter 預設會寫 `.wrangler/state`、開 inspector port；以 Morph 的 adapter 設定覆寫後這兩項消失（建置期的 inspector port 見上方 R2 那一列）                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 預覽報告 Run A／B                                                                                                                          |
| Live Preview 與 Build Preview 容器本來就是 `enableInternet = false`，對外請求一律交給拒絕政策                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `src/server/preview-sandbox.ts`、`build-preview-sandbox.ts`                                                                                |

### 0.2 【待驗】解法與對應閘門

| 解法                                                                                                                                                                                                                                                                                                         | 節  | 閘門                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- | -------------------------------------- |
| 預先渲染：封存內容伺服器，加上只在 `prerender` 環境補標頭。三項前提在本機 miniflare 已由 R2 實測成立（0.1）；**Sandbox 容器中 workerd 連到建置程序 loopback 未驗**                                                                                                                                           | 4.3 | A2、A3                                 |
| fail-fast 加建置後檢查、每次建置的 nonce、stamp 數等於預先渲染頁數（0.4 第 1、4 項）                                                                                                                                                                                                                         | 4.3 | A3                                     |
| 內容鍵對應：依 Astro 的路由、`trailingSlash`、`build.format` 產生，與 Core 執行期用同一個正規化函式（0.4 第 3 項）                                                                                                                                                                                           | 4.3 | A3、A4                                 |
| adapter 相容性檢查：入口存在、包裝恰好命中一次，否則 `ASTRO_ADAPTER_INCOMPATIBLE`（0.4 第 4 項）                                                                                                                                                                                                             | 4.3 | A3、A4                                 |
| 建置期 inspector port：找官方停用方式，或證明殘餘風險可接受（0.4 第 2 項）                                                                                                                                                                                                                                   | 7.2 | A2、A4                                 |
| ~~`.astro` 解析器（compiler-rs + 官方 `wasm32-wasi` binding）放得進 Morph 主 Worker 的 128 MB isolate~~ **M1 已量：放不進**（0.1）。解析器的位置已決定（0.3）                                                                                                                                                | 3.1 | M1（不通過）                           |
| 專用解析器 Worker（service binding，0.3 已決定）留在它自己的 isolate 的 128 MB 內：先取得 slot 再讀 body、等待數與等待時間有上限、串流讀取時強制位元組上限、回應在 slot 內序列化並有上限、trap 毒化實例不重建。本機機制已驗證，GC 後在限內，GC 前的取樣在多個條件下超過（0.1）；**本機結果不能代替雲端驗證** | 3.1 | M1c（本機，完成）、M1c-C（雲端，通過） |
| 解析器 trap 的處理：事前無法可靠偵測巢狀深度（0.1），只能在 trap 後毒化該實例並回傳明確錯誤；毒化的 isolate 在雲端何時被回收未知                                                                                                                                                                             | 3.1 | M1c-C                                  |
| 實例識別在工作區規劃時改寫文字（解析器這一側由 R1 確認；解析器在專用 Worker 中執行，0.3）                                                                                                                                                                                                                    | 3.3 | M1c-C、A7                              |
| Live Preview 沿用 Start 的預覽 Worker entry，包住 Astro 入口，而且不改變 Astro 的回應行為                                                                                                                                                                                                                    | 2.5 | R3、A6                                 |
| `imageService: "compile"` 的建置期圖片處理在 Morph 建置中實際執行（產物不含 `SESSION`、`IMAGES` 已是事實）                                                                                                                                                                                                   | 5.2 | A4                                     |
| 整頁重新載入後恢復選取與捲動                                                                                                                                                                                                                                                                                 | 6.1 | A6                                     |
| 一個映像放多個工具鏈根目錄                                                                                                                                                                                                                                                                                   | 2.2 | A2                                     |

### 0.3 【待決】產品選擇

- 第一版不提供 Sessions：要求作者設定 `session: false`，還是等基礎設施對應提供每個商店自己的 KV（9.2）。
- 圖片：第一版要求 `imageService: "passthrough"` 或 `"compile"`，還是對應 Cloudflare Images。
- ~~解析器在哪裡執行（3.1）~~ **已決定（2026-10-08，使用者）**，M1 量出放不進 Morph 主 Worker 之後：
  1. **首選：專用的解析器 Worker，經 service binding 呼叫。** 它是新的部署單位，部署需要使用者另外核准。
     設計條件（使用者訂定，M1c 已在本機實作並量測，3.1）：
     - admission 限制的是記憶體，不只是解析數：處理 slot 在讀 request body **之前**取得；等待者數與等待時間都有
       上限，超過時以明確錯誤拒絕；body 以串流讀取並在讀取中強制位元組上限，不信任 `Content-Length`；回應的序列化
       也受保護。WorkerEntrypoint 的 RPC 參數在方法執行前就已反序列化，所以介面是 fetch 形式的 handler（或接收
       `ReadableStream` 的 RPC）；
     - 大小上限從 100 KB 開始，是起始值，不是安全保證；369 KB 只作為繞過正式入口的壓力實驗；
     - 不假設能事前偵測巢狀深度，不另寫解析器；trap 後若無法可靠恢復，停用該實例、回傳明確錯誤，絕不循環重建；
     - 回應只含需要的資訊（節點位置、欄位資訊或編輯建議），不傳整個 AST；這個 Worker 沒有 D1、R2 或部署相關的
       binding，不對外開放；Core 保留授權、來源版本檢查、OCC 與最終寫入。
  2. **備案：在 Sandbox 容器中執行官方 Node 解析器**（首選在雲端驗證不通過時）。
  3. **不做**：自行 fork 或重建 compiler-rs；為此重新設計內容或發布流程。

  M1c 在本機通過**不開啟 L2**；L2 使用解析器 Worker 之前，必須先通過部署後的雲端驗證（8.2 的 M1c-C）。
  **M1c-C 已通過（2026-10-08，3.1）**；正式部署解析器 Worker 仍要使用者另外核准。

- 是否向 Astro 上游提出「預先渲染請求可以帶標頭」的選項。
- `output: "static"` 的網站要不要支援。
- 預先渲染頁看到的多餘標頭（`content-length`、`content-type: application/json`、`user-agent: node`）要不要由包裝
  清掉（R2 報告 §6）。
- `NATIVE_PRERENDER_CONTENT_ORIGIN_MISSING` 是否要區分「封存內容伺服器不在」與「標頭沒送到」（4.3）。

### 0.4 已決定（2026-10-07，使用者）

1. **fail-fast 與建置後檢查兩者都保留。**
   - 內容讀取被拒或失敗時，該頁的預先渲染當場失敗，並帶明確原因。作法是 adapter 既有的
     `x-astro-prerender-error` 錯誤路徑（`prerenderer.js:164-167`），不是新的管道。
   - `nativeBuildResult` 的建置後檢查仍然要求：每一次內容讀取都成功，每一個預先渲染頁都有 stamp。
   - 記錄以 Morph 為每次建置產生的 nonce 綁定到這次建置；缺少記錄一律不通過。
   - 不讀 CMS 內容的預先渲染頁不要求有讀取，只要求有 stamp。
   - Start 使用的共用 request handler 之後也要套用同樣的 nonce 綁定。
2. **inspector port。** 「外部連不到」不是安全理由，因為容器內的其他程序連得到 localhost。依序：
   1. 找官方的停用方式，而且不改作者的產品設定。只影響建置工具、不改變產物的設定可能可以接受，要先驗證才下結論；
   2. 必須保留時，確認監聽位址、這個 port 絕不被對應或轉發、容器中沒有任何祕密、建置後容器即銷毀；
   3. 記錄殘餘風險。

   驗收標準是「列出實際的監聽 socket，每一個都有已知用途」，不是「沒有其他 port 在聽」。

3. **路徑。** 不一律去掉結尾斜線。依 Astro 的路由、`trailingSlash` 與 `build.format` 建立一致的內容鍵對應；封存的
   鍵必須使用 Core 執行期使用的同一個正規化函式。測試至少包含：首頁、有無結尾斜線、`trailingSlash` 三種設定、
   動態路由、中文與百分比編碼的路徑，以及兩個不同的路徑絕不會對應到同一個鍵。
4. **建置前的 adapter 相容性檢查。**
   - 預期的 adapter 入口不存在，或包裝沒有恰好命中一次：以 `ASTRO_ADAPTER_INCOMPATIBLE` 失敗。
   - stamp 數不等於預先渲染頁數：建置失敗。
   - 失敗的建置一律不整理成產物。
   - 成功的產物主動檢查 `.prerender/`、包裝標記與 `.morph/` 診斷檔，不依賴 Astro 自己的清理。

## 摘要：關鍵決定

1. **Astro 是第二個 `ThemeFrameworkAdapter`，不另建架構。** 權限、OCC、內容文件、發布、release、回滾與
   preview write fence 留在原本的服務，adapter 介面上仍然沒有這些方法（`theme-framework.test.ts` 的規則不變）。
2. **框架在建立網站時決定，並凍結在每一次 build 的輸入裡。** 現在的 `themeFramework()` 對所有 Theme 回傳
   同一個 adapter，`nativeBuildResult` 也直接呼叫它，這兩處要改成依 build 記錄的框架選擇 adapter。
3. **工具鏈依「框架 × 版本」分開。** Astro 7 需要 Vite 8；Start 的固定工具鏈（Vite 7.3.5）保持不變，
   兩者不共用 `node_modules`。
4. **內容沒有新管道。** SSR、Live Preview、預先渲染都走 `x-morph-content-origin` 標頭加
   `GET /_morph/content?path=`。預先渲染只回答 build 封存的快照，回答不了的讀取讓建置失敗。
   **Start 的作法不能直接搬到 Astro**（見第 4.3 節）：Astro 的 Cloudflare 預先渲染另起一個不載入專案設定的
   preview server，請求也不帶任何標頭。如果什麼都不做，頁面會讀不到內容、默默使用元件預設值，建置照樣成功。
   這正是 #130 為 Start 修掉的那一類錯誤。補救方案在本機 miniflare 已由 R2 證明可行（Sandbox 容器未驗），
   驗收標準是「HTML 中是封存的內容」，不只是「標頭有送到」。內容讀取失敗時預先渲染當場失敗（fail-fast），
   建置後的檢查仍然保留（0.4 第 1 項）。
5. **建置、Build Preview、發布、回滾走同一條原生路線**：同一個產物整理、同一個部署規則、同一個隔離式
   Build Preview、同一個 `PUBLISH_BUILD_CONTENT_MISMATCH` 最終把關。Astro 只多了幾條產物拒絕規則，
   每一條都寫明拒絕的是哪個設定、怎麼偵測：adapter 加入的 `SESSION`、`IMAGES`，Workers Cache 設定，
   以及 `.prerender/`。
6. **`.astro` 解析器選定 `@astrojs/compiler-rs` 加官方 `wasm32-wasi` binding，實例識別比照 TSX 在工作區規劃時
   改寫文字**（理由見 3.3）。R1 證明這個解析器能在 workerd 中執行且位置精準，`@astrojs/compiler`（Go）被否決。
   **M1（2026-10-08）量出它放不進 Morph 主 Worker 的 128 MB isolate**：Morph 處理過 SSR 請求後本身就有
   72.8 MiB，加上解析器實例化即 135.2 MiB。使用者已決定（0.3）：解析在專用解析器 Worker 中執行（service binding），
   備案是 Sandbox 容器中的官方 Node 解析器。M1c 在本機完成；部署後的雲端驗證（8.2 的 M1c-C）是 L2 使用它之前的
   必要閘門，**2026-10-08 已通過**（3.1）。
7. **Live Preview 中的 `.astro` 修改與內容更新一律重新載入整頁**（第一版）。bridge 的路由能力改由
   adapter 宣告，不再自己探測 `window.__morphPreviewRouter`。
8. **預覽橋接注入與外連隔離是兩件事。** 安全邊界是容器的網路政策；Worker entry 中的外連檢查只負責提供
   明確的錯誤訊息，不是安全邊界（2.5、7.1）。
9. **G0 阻擋的是接入與開放，不阻擋研究。** 原生 Start 的內容配對驗收（Build Preview、發布、過期發布拒絕、
   並行、回滾，真實容器）必須先通過，Astro 才能接進 `main`；本機真實容器驗收已完成（2026-10-07，#137），未涵蓋的部分見 8.2。解析器與預先渲染機制的小型實驗
   （R1–R3）可以先做：這些實驗不接 `main`，也不宣稱 Astro 已支援（第 8 節）。R1、R2 已完成（2026-10-07），
   R3 尚未進行。

## 1. 範圍

| 包含                                                  | 不包含（之後另案）                                |
| ----------------------------------------------------- | ------------------------------------------------- |
| `astro` + `@astrojs/cloudflare`，`output: "server"`   | `output: "static"` 而沒有 Worker 的整站靜態輸出   |
| `.astro` 元件，加上 React 元件（island 或伺服器渲染） | Vue 的 Design 支援（第一版 Vue 只有來源位置）     |
| 頁面以 `export const prerender = true` 預先渲染       | `getStaticPaths` 產生的動態頁讀 Morph 內容（4.3） |
| Live Preview、原生建置、Build Preview、發布、回滾     | Astro 的 Content Collections 接 Morph 內容        |
| `.fields.ts` 欄位，與 `.tsx` 相同的規則               | `server islands`、Actions、Sessions 的實際供應    |

React 與 Vue 混用維持 multi-runtime 計畫的判定（Unverified，vite-plugin-vue #798）。

## 2. 框架接入層（Runtime adapter）

### 2.1 偵測與框架身分

- `ThemeFrameworkId` 改為 `"tanstack-start" | "astro"`。
- 判定依據是 `package.json` 的依賴，加上 lockfile 實際解析到的版本（不是 range）：
  - `astro` 加 `@astrojs/cloudflare`，並且恰好有一份 `astro.config.{mjs,ts,mts,js}`，判為 Astro；
  - 同時符合 Start 與 Astro，以 `THEME_FRAMEWORK_AMBIGUOUS` 拒絕，不猜；
  - 有 `astro` 但沒有 `@astrojs/cloudflare`，以 `ASTRO_CLOUDFLARE_ADAPTER_REQUIRED` 拒絕。
- `detect` 的回傳值從 `boolean` 改為 `{ version, status: "certified" | "unverified" | "blocked" } | null`。
  `status` 查的是「框架 × 版本」矩陣（start-native-import-plan 的三級相容），不由 adapter 自己判斷。
- **偵測只在匯入時使用。** 框架記在網站上（建立時決定，不轉換），並在 materialize 時寫進 build 輸入，
  算進 `inputHash`，凍結後不能修改。之後的建置、Build Preview、發布與回滾都讀 build 上記錄的框架，
  不重新偵測。所以 Code 模式把 `package.json` 改成另一個框架時，只會得到診斷，不會悄悄換建置路線。
- 要改的兩處：
  - `themeFramework()`：改為依網站或 build 選擇 adapter；
  - `nativeBuildResult` 中的 `themeFramework().build.native`：改為使用 build 輸入記錄的 adapter。
- 預覽報告第 17 項：Live Preview 的 runtime 由環境變數 `MORPH_THEME_PREVIEW_RUNTIME` 決定。這要改成由網站的
  框架決定，並且 `ThemePreviewRuntime`（`"client" | "start"`）併入 adapter id。

### 2.2 工具鏈：框架 × 版本各一套

阻礙 B1：Astro 7.3.5 與 `@astrojs/cloudflare` 14.3.3 都要求 `vite ^8.0.13`；Morph 的
`/opt/morph-toolchain` 只有一套，固定在 Vite 7.3.5。本機的 `toolchainProblem` 也會拒絕。

- 改成每個「框架 × 版本」一個工具鏈根目錄，例如 `/opt/morph-toolchain/tanstack-start-1.168/`、
  `/opt/morph-toolchain/astro-7.3/`。每一套有自己的 package.json 與 lockfile，各自由產生器輸出
  `*-dependencies.generated.ts`。這些產生檔不手動修改。
- Start 的工具鏈內容與版本完全不變；把它搬到新路徑時，以雜湊比對確認內容相同。
- Astro 工具鏈的第一組認證組合就是上面列的版本基準，渲染器只放 `@astrojs/react`（Vue 為 Unverified）。
- 容器內不安裝套件，工作區的 `node_modules` 連到「該 build 記錄的工具鏈」。套件契約比照
  `validateThemeStartPackageContract`，新增 Astro 版：`package.json` 中的 `astro`、`@astrojs/cloudflare`、
  渲染器、Vite 與 wrangler 必須等於固定版本，不符時以 `INVALID_ASTRO_PACKAGE` 列出診斷。
  接受 `^`／`~` 範圍屬於「Theme 依賴快照與工具鏈矩陣」那一步，不在這裡做。
- 映像有兩個選擇：一個映像放多個工具鏈根目錄，或每個框架一個映像。**建議一個映像、多個根目錄**：
  Durable Object 類別與容器綁定不必加倍，代價是映像變大。實際大小與冷啟動時間要在 A2 量測後才定。
- Node：`@astrojs/compiler-rs` 要求 `>=22.12.0`，Vite 8 也有同樣等級的要求。映像中的 Node 版本須經 A2 確認；
  Theme 沙箱的 Node 版本與 Morph 應用分開（沿用 start-native-import-plan 的規則）。
- 工具鏈中 Astro 自己使用的 `@astrojs/compiler-rs` 透過 `@astrojs/compiler-binding-linux-<arch>-<libc>` 載入原生
  binding，所以映像的架構與 libc 必須在認證組合中寫明。這與 Morph Worker 中用的 `wasm32-wasi` binding（3.1）
  是同一個套件的兩種 binding。A2 加一項檢查：Morph 鎖定的 compiler-rs 版本與 Astro 工具鏈中 `astro` 依賴的
  版本一致或相容（R1 報告 §5）。

### 2.2.1 工具鏈識別與 `inputHash` 的版本格式（2026-10-08，A2a 實作）

**問題。** A1 讓框架「不是 Start 時才進雜湊」，以保留既有 build 的雜湊。若工具鏈也用「目前工具鏈就省略」的
規則，日後「目前」改變時，相同輸入可能換了工具鏈卻得到相同雜湊。現有的 `compilerId`／`compilerVersion` 也不足以
當工具鏈身分：原生建置的版本只是 `@tanstack/react-start` 的版本，間接依賴、Node 與映像都不在其中。

**格式欄位。** `storefront_theme_builds.input_hash_format`（整數，可為 NULL）：

- NULL：legacy（第 1 版）。序列化與今天完全相同，包括 A1 的框架規則。只用於重新產生與驗證既有 build；
  新 build 不再寫入這個格式。
- 2：新格式。框架與完整工具鏈識別**一律**進雜湊，沒有依「目前版本」省略的條件。
- 重新產生 build 輸入時依記錄的格式選擇序列化方式；不認得的格式一律拒絕（`INPUT_HASH_FORMAT_UNKNOWN`），
  不退回其他格式。
- 影響：相同輸入在第 2 版下的雜湊與 legacy 不同。切換後，legacy build 仍能照原格式驗證、預覽、發布；
  新 build 不會與 legacy build 視為同一份而被重用。

**工具鏈清單與識別。** 每套工具鏈在映像建置時寫入一份清單（例如
`/opt/morph-toolchain/<root>/toolchain.manifest.json`），內容：

- 框架、精確的直接依賴組合；
- lockfile 的完整 SHA-256；
- 實際安裝的套件樹（名稱、版本、integrity）的 SHA-256；
- Node 版本、npm 版本；
- 基礎映像的 digest；
- `os`／`arch`／`libc`。

**工具鏈識別 = 清單正規化後的完整 SHA-256。** 資料庫存完整值；短前綴只供顯示與 log。

**可信對照表。** 產生器輸出 `theme-toolchains.generated.ts`：識別 → 框架、根目錄、清單雜湊。build 記錄框架與
工具鏈識別；建置程式只從對照表取得根目錄，不接受 Theme 或請求提供的路徑。對照表中沒有的識別一律拒絕
（`THEME_TOOLCHAIN_UNKNOWN`）。

**建置前核對。** 建置程式在寫入工作區之前，讀取容器中該根目錄的清單並計算雜湊；與 build 記錄不符時建置失敗
（`THEME_TOOLCHAIN_MISMATCH`），不改用其他工具鏈。`node_modules` 連結在該次建置的工作區內建立，指向對照表給的
根目錄；不在映像層建立共用連結，也不動其他工作區。Live Preview 沒有 build 記錄，使用對照表中該框架的工具鏈，
啟動前做同樣的核對與連結。

**平台工具不屬於 Theme 工具鏈。** 部署（`wrangler deploy`）與 Build Preview（`wrangler dev`）使用平台固定的
Wrangler（`/opt/morph-platform`），獨立目錄與 lockfile，不因 Theme 的框架切換。Theme 工具鏈裡的 Wrangler 只供
該框架的建置流程使用。這是工具版本的分離，**不是同一容器內的安全邊界**；帶憑證的部署容器仍不能執行 Theme 程式
（目前程式碼：部署容器的 id 是 `deploy-<storefront>-<release>`，絕不與建置共用；部署設定由 Morph 依發布計畫產生；
`--env-file /dev/null`）。

**Legacy 與遷移。** 既有 build（`input_hash_format` 為 NULL）沒有工具鏈識別，記為「legacy、未記錄工具鏈」，
不推定它用的是哪一套。工具鏈搬到新目錄後，legacy build 若需要重建，以新格式建立新的 build，不改寫舊記錄。

**清單的固定序列化。**

- JSON 正規化：物件鍵依 Unicode 碼位排序，無多餘空白，UTF-8；雜湊對這個位元組序列計算。
- 套件樹以「安裝位置」為單位（npm lockfile 的 `packages` 鍵，例如 `node_modules/a/node_modules/b`），
  每筆記錄名稱、版本、`resolved`、`integrity`、依賴關係（`dependencies`／`optionalDependencies`／
  `peerDependencies` 的名稱與範圍）、`optional`、`os`／`cpu`／`libc` 限制。依安裝位置排序。
- 缺少的欄位一律寫成 `null`，不省略，也不以空字串代替。
- 路徑一律為相對於工具鏈根目錄的 POSIX 路徑。排除時間戳、絕對路徑、快取路徑、`.package-lock.json` 的
  `lockfileVersion` 以外的 metadata 等不穩定資料。
- 序列化規則本身有版本號（`manifestFormat: 1`），改規則就換版本，不靜默改變既有識別的意義。

**產生順序（不互相依賴）。**

1. `Dockerfile.sandbox` 以 digest 固定基礎映像，每套工具鏈以自己的 lockfile 執行 `npm ci`（安裝腳本照常執行，
   原生套件需要）；
2. 映像建置的最後一步，在映像內產生每套工具鏈的清單與識別；
3. 一個平台腳本以明確的 tag 建置映像、從映像讀出清單，產生 `theme-toolchains.generated.ts`（不手動修改）；
4. 才建置 Morph。

映像建置不讀 registry，registry 只從映像產生，所以兩者沒有循環。重建映像時，固定的基礎映像與 lockfile 應得到
相同的清單（實測：不使用快取重建，三套識別都相同；映像 ID 不同，所以識別不能用映像 ID）；若不同，建置前核對會
讓建置失敗，而不是程式碼拿新表去對舊映像而不自知。產生器並核對 repo 中的 `package.json`、lockfile 與映像內的相同。
lockfile 只消除版本解析的漂移，不是完整的環境重現；Node、npm 與基礎映像另外固定並記入清單。

**核對的範圍：相容性與來源核對，不是防竄改。** 清單只證明 **Theme 執行前，容器宣告的工具鏈符合預期**；不保證
整次建置一直使用未修改的工具鏈。容器內的程序以 root 執行（2026-10-08 實測：root 可寫入 `chmod a-w` 的檔案與
目錄），所以工具鏈目錄**不設為唯讀**，檔案權限對 root 不構成阻擋。

- 每次建置使用新的容器（實例 id 為 `buildId`，結束即銷毀）：能限制跨 build 的殘留，是有效的一道防線，但不能取代
  外連與權限隔離。
- 核對在寫入工作區、執行任何 Theme 設定之前完成。
- 不能說「修改只影響這次產物」：這需要確認沒有共用的工作區、掛載、快取或其他控制能力；而且建置容器目前可以外連，
  副作用不一定只限於產物。沙箱外的產物檢查也不能證明任意程式碼安全。
- Theme 降權（非 root）、容器控制服務的可達性與能力、工具鏈保護與可寫工作區／快取的分離，是獨立的安全閘門
  （`TODO.md` 部署前阻擋項），不隨 A2 完成。真正的唯讀掛載待確認平台是否支援，不先承諾。
- Vite 的快取目前寫在工具鏈目錄下（`node_modules/.vite`，未設定 `cacheDir`），與 A2 之前相同。移到每次工作區
  會改變建置與預覽的行為，列入規劃，另做回歸驗證，不在 A2 一起改。

**第 2 版貫穿所有流程。** 建立、排隊、執行、重用、發布驗證都只讀 build 記錄上的格式與工具鏈識別，途中不重新
取「目前版本」。必須有的測試：缺少工具鏈識別、未知格式、未知識別、清單與記錄不符、新舊格式的雜湊不同，
以及重新產生時依記錄的格式選擇序列化方式。

**Legacy 的驗證與重用分開。**

- 驗證：既有 build 依 legacy 格式重新產生並比對雜湊，規則不變。
- 重用：已成功的 legacy 產物能否發布與回滾，沿用既有規則；這次的 migration 不能改變它。必須驗證歷史 release
  的回滾在 migration 後仍可運作（release 指向的 build 與產物不受影響）。
- 新建置一律使用新格式與已記錄的工具鏈，不假裝使用舊工具鏈。

### 2.3 工作區規劃：保留哪些 Theme 設定檔

阻礙 B3：規劃器（`isThemeSourceOnlyPath`、`planThemeSandboxWorkspace`）會丟掉 Theme 的 `wrangler.json(c)`，
並換掉 `package.json`。Astro adapter 的 `planWorkspace` 規則如下：

| 路徑                                                      | 處理                                                                                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `astro.config.*`（恰好一份）                              | 原樣保留，由 `.morph/` 中的包裝設定檔 import，不改寫                                     |
| `wrangler.jsonc`／`wrangler.json`（恰好一份）             | 原樣保留；Morph 的副本寫到 `.morph/wrangler.json`，規則與 Start 相同（綁定未對應時拒絕） |
| `package.json`、`pnpm-lock.yaml`                          | 保留在原始碼中，只用於偵測與契約檢查；不在工作區安裝                                     |
| `tsconfig.json`、`src/env.d.ts`、`public/**`、`src/**`    | 原樣保留（Astro 從 `tsconfig.json` 讀路徑別名）                                          |
| `.morph/**`                                               | Morph 擁有。Theme 在這裡的檔案會被取代，不會被使用（與 Start 原生建置相同）              |
| `.astro/**`、`dist/**`、`.wrangler/**`、`node_modules/**` | 產生物或狀態，不進工作區，不算進指紋；Theme 提交了也忽略並顯示診斷                       |
| `.env*`、`.dev.vars*`                                     | 不進工作區（start-native-import-plan：`.env` 不以明文匯入）                              |

拒絕條件（建置與預覽相同，在排入之前就檢查）：

- 沒有 `astro.config.*`，或有多份；
- `cloudflare({ configPath })`：與 Start 的 `NATIVE_CUSTOM_CONFIG_PATH` 相同，因為 Morph 的設定副本
  會被它蓋過；
- `wrangler.json(c)` 宣告了 Morph 尚無法對應的綁定（`NATIVE_BINDINGS_UNMAPPED`，與 Start 共用同一份清單）；
- 沒有 Cloudflare adapter，或 `output` 不是 `"server"`。

Start 原生建置中與框架無關的部分（wrangler 副本、綁定檢查、產物整理）從
`tanstack-start-native-build.ts` 搬到一個共用的 Cloudflare 原生建置模組，兩個 adapter 共用。
不複製第二份。

### 2.4 Live Preview 的啟動

阻礙 B2：容器命令寫死為 `${VITE_BIN} --config /workspace/vite.config.ts`，判斷程序是否已在服務用的是
`process.command.includes(VITE_BIN)`，本機子程序也直接呼叫 Vite `createServer`。

- adapter 提供 `preview.launch(ctx) → { argv, env }`。Astro 用 Morph 工具鏈中的啟動程式
  （`<toolchain>/morph-preview-launcher.mjs`，不在工作區）呼叫 Astro 的 `dev()`，傳入包裝設定檔與
  host、port。容器與本機 sidecar 都走同一個啟動程式。
- 程序身分改為比對啟動程式的路徑與 preview id，不再比對 `VITE_BIN` 字串。
- **base 一律為 `/`，在獨立 origin 上**（阻礙 B9）。在 `/__morph-theme-preview__/` 下，Astro 輸出的
  `/@vite/client`、`/@id/astro:scripts/*`、CSS、island URL 與頁面連結都不帶 base。`framePath` 回傳 `/`。
- 健康檢查沿用 `previewHealthPlugin`（`/_morph/preview-health`，回 204 與 `x-morph-preview-id`），
  預覽報告的 Run A、Run B 都通過。
- 包裝設定檔 `.morph/astro.preview.config.mjs` import Theme 的設定，再加上：
  - Morph 的框架中性 plugin：`previewHttpHmrPlugin`、`previewHealthPlugin`、`themePreviewServerSourcePlugin`、
    SVG 隔離、`server.fs.strict` 與 `fs.allow`、`hmr.path`、watch 設定。這些在 Vite 8 上原樣可用，
    但 `server.hmr.path` 會出現 deprecation 警告（B10）；
  - dependency enforcer 的 Astro 放行規則（B8）：`astro:*` 虛擬模組、`/@id/astro:*`、`@astrojs/*` 渲染器、
    以工作區內絕對路徑請求的 island。規則要先在 dev 中記錄所有 `resolveId(source, importer)`，再逐條決定；
  - `devToolbar: { enabled: false }`；
  - adapter 覆寫（第 7 節）。
- 冷啟動約 15–16 秒，期間 optimizer 因「vite config has changed」重跑三次（B11）。這要在 A6 量測並與 Start
  比較。如果重跑是因為包裝設定改了 config，應該先找出原因再談快取。

**adapter 覆寫的作法。** Theme 的設定在 `cloudflare({...})` 的閉包中建立 integration，事後拿不到原本的
選項。預覽報告 Run B 用的作法是：包裝檔以 Morph 自己呼叫的
`cloudflare({ inspectorPort: false, persistState: false, remoteBindings: false })` 取代 `adapter`。
代價是 Theme 傳給 adapter 的其他選項（`imageService`、`sessionKVBindingName`、`imagesBindingName`、
`prerenderEnvironment`）會遺失。

處理方式：以 AST 從 `astro.config.*` 讀取 `cloudflare()` 的參數。參數是靜態物件字面值時，以允許清單
帶入上述四個選項；不是靜態值，或含有清單外的選項時，預覽照常啟動，並顯示「預覽使用預設 adapter 設定」
的診斷。這只影響 Live Preview。**正式建置執行 Theme 自己的 adapter 設定，不覆寫**（第 5 節）。

### 2.5 Bridge 注入

Start 的 Live Preview 在 Worker entry 中包住 Start 的 `server-entry`
（`themePreviewStartWorkerSource(previewId, serverEntry)`），在同一個地方做三件事：

1. 請求加上 `x-morph-content-origin`，指向只有這個 entry 回答的 origin（草稿快照）；
2. Theme 伺服器端的 `fetch` 經過 `previewOutboundRefusal`；
3. 以 `HTMLRewriter` 把診斷腳本與 client module 放在 `<head>` 最前面。

這三件事中，第 1、3 件是**預覽橋接注入**（本節），第 2 件屬於**外連隔離**（7.1）。兩者分開設計：
橋接採用哪個方案，不影響安全邊界在哪裡。

【待驗】**首選：Astro 沿用同一個 entry，`serverEntry` 傳 `@astrojs/cloudflare/entrypoints/server`。**
作法是把 Morph 預覽 wrangler 副本中的 `main` 指向它，以 `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH` 提供
（adapter 沒有傳 `configPath` 時，Cloudflare plugin 讀這個環境變數）。理由是內容標頭與 HTML 注入都在
同一處完成，和 Start 只有一條注入路徑。預覽報告用的 Astro integration `injectScript` 只處理 HTML 注入。

沿用 Start 的 entry，**不代表它自動與 Astro 相容**。包裝層除了加內容標頭、在 HTML 前面插入腳本之外，不得改變
Astro 的回應。R3（獨立實驗）與 A6 要逐項比對「有包裝」與「沒有包裝」的同一組請求：

| 項目     | 要確認的事                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| 串流     | Astro 的串流 HTML 仍然逐段送達，`HTMLRewriter` 不會把整份回應緩衝住（量第一個位元組的時間）                      |
| 重新導向 | `Astro.redirect`、middleware 的 3xx 狀態碼與 `Location` 不變；包裝層不跟隨重新導向                               |
| Cookie   | 多個 `Set-Cookie` 標頭都保留，不被合併；`Astro.cookies` 讀寫正常                                                 |
| 錯誤頁   | 404、500 與 Astro 的錯誤覆蓋頁的狀態碼與內容不變；非 HTML 回應不被改寫                                           |
| HMR      | `@vite/client` 與 relay 改寫（`__morphApplyViteHmrPayload`）在這條路徑下仍然成立；`.astro` 的 `full-reload` 正常 |
| 其他     | 請求本文（POST、Actions）原樣轉送；`Content-Length`、`Content-Encoding` 與改寫後的 body 一致                     |

- 備案：若 A6 證明 Astro dev 不經過 `main`，或上表任一項無法保持，就改用 `injectScript`，加上預覽專用的
  Vite middleware 補內容標頭。這個備案同樣要通過上表。
- Client module 分兩種：Start 版等 `window.__TSR_ROUTER__` 才載入 bridge；Astro 版在 `DOMContentLoaded`
  載入，不設定 `__morphPreviewRouter`。由 adapter 宣告使用哪一種（2.6 的 `preview.navigation`）。

### 2.6 介面變更（草稿）

在現有 `ThemeFrameworkAdapter` 上擴充，不另起一個介面：

```ts
export type ThemeFrameworkId = "tanstack-start" | "astro";

export type ThemeFrameworkAdapter = Readonly<{
  id: ThemeFrameworkId;
  detect(
    files: readonly ThemeFrameworkSourceFile[],
  ): ThemeFrameworkMatch | null;
  /** 這個框架 × 版本使用的工具鏈；由產生的矩陣提供，不在 adapter 內寫死版本。 */
  toolchain(match: ThemeFrameworkMatch): ThemeToolchainRef;
  planWorkspace(input: PlanThemeWorkspaceInput): PrepareThemeWorkspaceResult;
  preview: Readonly<{
    framePath(): "/";
    launch(ctx: ThemePreviewLaunchContext): Readonly<{
      argv: readonly string[];
      env: Readonly<Record<string, string>>;
    }>;
    /** bridge 的能力宣告，取代 bridge 自行探測 router。 */
    navigation: "router" | "document";
    contentRefresh: "router-invalidate" | "document-reload";
    /** 這些副檔名的修改會使文件被取代（Astro：.astro）。 */
    documentReloadExtensions: readonly string[];
    /** dependency enforcer 對開發基礎設施的放行規則（B8）。 */
    devInfrastructureAllowances: readonly ThemeImportAllowance[];
  }>;
  build: Readonly<{
    // 現有平台建置欄位（只有 Start 有；Astro 沒有平台建置）
    native: Readonly<{
      plan(files, options): NativeThemeBuildPlan; // 由 NativeStartBuildPlan 改名，結構不變
      collect(outputs): NativeThemeArtifact; // 共用的 Cloudflare 產物整理
      artifactEntry: string;
      verifyArtifact(input): void; // 4.3、5.2 的 Astro 規則
      manifestMetadata(routeRegistry): Record<string, unknown>;
      compilerId: "tanstack-start-native" | "astro-native";
    }>;
  }>;
  /** 路由清單，給內容封存與 Render Plan 使用。Start 仍由共用路由模組提供。 */
  routes(files: readonly ThemeFrameworkSourceFile[]): ThemeRouteRegistry | null;
}>;
```

Astro 沒有「平台建置」：沒有自己設定的 Astro 專案不存在，所以 `build.artifactEntry`、`verifyArtifact`、
`manifestMetadata` 這組平台欄位改成可選，只有 Start 提供。

## 3. 檔案語言接入層：`.astro`

以 `src/lib/storefront/source-language/astro-source-language.ts` 實作，形狀與
`tsx-source-language.ts` 相同：一個給 Live Preview 的準備函式，一個給建置的函式。
一種檔案語言的 Design 支援，必須驗完整條鏈才算完成：**選取實例 → 顯示欄位 → 文件儲存（權限、文件版本、
OCC）→ 該實例更新、其他實例不變**。

### 3.1 解析

- 解析結果是 JSX 形式的 ESTree，位置為 UTF-16 offset。spike 以 `@astrojs/compiler-rs` 0.5.1 驗證過，
  插入中文與 emoji 後位置仍然精準。compiler-rs 直接把 frontmatter 解析成 TypeScript ESTree
  （`AstroFrontmatter.program`），不必再交給 Babel；props 型別從這裡讀（R1 報告 §2.4）。
- Design 的讀取與改寫，以及工作區規劃（3.3），由 Morph 的 Worker 負責（授權、來源版本檢查、OCC、最終寫入）；解析本身
  在專用解析器 Worker 中執行（0.3）。兩者都是 Worker，Node 原生 binding 在那裡不能載入。
  R1 對三類候選的結論（R1 報告「結論」）：
  1. **選定：`@astrojs/compiler-rs` 0.5.1 加官方 `@astrojs/compiler-binding-wasm32-wasi` 0.5.1。** 【事實】在本機
     workerd 中載入並解析成功；所有樣本的 AST 與 Node 原生 binding 逐位元組相同，位置檢查 0 失敗（中文、emoji、
     ZWJ、組合字元、CRLF、BOM、frontmatter、動態屬性、運算式中的 JSX、`<slot>`、`<Fragment>`、`<style>`、
     `<script>`）；17 個錯誤樣本與 581 個不完整輸入都回傳診斷，沒有例外，Worker 不失效。它也是 Astro 7.3.5
     自己使用的編譯器，所以「Morph 與工具鏈的編譯器不同」縮小成「同一套件的版本差」（2.2 的版本檢查）。
  2. **否決：`@astrojs/compiler` 4.0.0（Go → Wasm）。** 記憶體隨檔案大小超線性成長（74 KB 檔案 266 MiB、
     147 KB 超過 1.8 GiB，369 KB 的檔案 out of memory），不完整的輸入會讓 Go runtime panic；位置是 UTF-8 byte offset，運算式、註解、`<>` 的起點
     有誤，屬性沒有結束位置；而且它不是 Astro 7 使用的編譯器。
  3. 最後手段（不採用，除非 0.3 的首選與備案都不行）：`.astro` 的 Design 不開放，Live Preview 只提供來源位置，
     改用預覽容器內的 Vite plugin。這條路線的結果不能作為儲存的依據。
- **採用條件**（R1 的結果，不是可選的最佳化）：
  1. **自己寫 binding 載入器。** 官方瀏覽器載入器（`astro.wasi-browser.js`）在 workerd 中不能原樣使用：它從 bytes
     編譯 `.wasm`（workerd 禁止：`Wasm code generation disallowed by embedder`），並準備 Web Worker 執行緒池
     （workerd 沒有）。Morph 的載入器以 wrangler 的 CompiledWasm 規則匯入預先編譯的模組，其餘
     （`@napi-rs/wasm-runtime`、WASI preview1、shared memory）與官方載入器相同，再以 bundler alias 讓
     compiler-rs 的公開入口使用它。只用同步 API（`parse`）；非同步 API 需要執行緒。
  2. **記憶體底線、檔案大小上限、trap 後毒化實例。** Wasm 模組最少約 61 MiB 線性記憶體（981 頁），只增不減；
     官方載入器要求的 `initial: 4000` 頁（250 MiB）本身就超過 128 MB，必須改用模組自己的最小值。一般檔案
     （≤ 37 KB）實測約 64 MiB 加 AST 約 3 MiB；369 KB 檔案為 85 MiB 加 26 MiB。因此：
     - 設定檔案大小上限，超過的檔案在 Design 中唯讀（「由程式碼控制」）。從 100 KB 開始；M1 量出 100 KB 的檔案
       讓 Wasm 成長到約 66 MiB、AST 在 JS 端約 6.6 MiB，369 KB 的檔案為 79.9 MiB 與約 24 MiB（M1 報告 §2.2）。
       100 KB 是起始值，不是安全保證：M1c 量出同樣大小的檔案因形狀不同，解析器 isolate 的 Wasm 從 61.4 到 84.4 MiB
       不等（「大量小節點」與深層物件最高），GC 前的取樣多出 21–40 MiB（M1c 報告 §3.2）。最終值依解析器 Worker 的
       雲端驗證（8.2 的 M1c-C）訂；
     - 解析發生 trap（stack overflow 等）時，**毒化該實例**：這個請求與之後的每個請求都回傳明確錯誤
       （`parser-trapped`、`parser-unavailable`），**不重建、更不循環重建**。M1c 的實測（M1c 報告 §3.8，各 3 次）：
       - trap 後沿用同一個實例不可靠：前 93 次 trap 後結果都正確，第 94 次開始連正常檔案也回
         `memory access out of bounds`，Wasm 在 100 次 trap 中成長 15.9 MiB；
       - 丟棄並重建實例會留下實際記憶體：每次重建 workerd 程序的 RSS 增加約 13–22 MiB、VmSize +4 GiB，強制 GC 後都
         不減少（M1 只看到 VmSize；VmSize 本身不是洩漏的證據，RSS 是）。所以「重建實例」不能當成回收記憶體的手段；
       - 毒化的 isolate 要等 runtime 回收才會恢復；雲端何時回收仍未知：M1c-C 只在最後跑一輪 trap，之後隨 Worker 刪除，
         沒有量到回收時間。雲端中被 trap 的 isolate 對之後每個到達它的請求都回 `parser-unavailable`（M1c-C 報告）。
  3. **輸入先 `toWellFormed()`。** 含孤立 surrogate 的字串在 Wasm 版與原生版結果不同；先轉換後一致。
     從 UTF-8 檔案解碼的字串不會有孤立 surrogate，所以這是低成本的防禦。
  4. **巢狀深度沒有可靠的事前檢查。** compiler-rs 0.5.1 沒有深度或資源上限的選項（`parseAstroSync(sourceText)`
     只有一個參數）；這是**未解風險**，不另寫解析器。trap 門檻依語法而不同，而且不是固定數字：本機 workerd 中
     frontmatter 巢狀陣列約 790 層（1.6 KB 的檔案）、物件約 760 層、運算式括號約 1000 層、`<div>` 約 2410 層；
     900 層的括號運算式 1、2、10 份都能解析，50 份就 trap（M1c 報告 §3.3）。`.astro` 混合 HTML、JS、字串與註解，
     單純的括號計數會誤判，所以不以事前檢查代替第 2 點的毒化。trap 的檔案在 Design 中唯讀。同樣的輸入在 Node 原生
     binding 中會 `SIGSEGV`（R1），雲端的 stack 大小可能讓門檻不同。
  5. **安裝。** `@astrojs/compiler-binding-wasm32-wasi` 宣告 `"cpu": ["wasm32"]`，在 x64 上 npm 以
     `EBADPLATFORM` 拒絕。Morph 要在 pnpm 設定 `supportedArchitectures`（cpu 加入 `wasm32`），不能靠強制安裝。
     R1 只確認了 npm 會拒絕，沒有在 Morph 的 pnpm workspace 中試。
- **【事實】Morph 主 Worker 的記憶體預算（閘門 M1，2026-10-08）：放不進。** M1 把 compiler-rs、`wasm32-wasi`
  binding 與 R1 的載入器加進 Morph `main` @ `6ea0886` 未修改的 build，在本機 `wrangler dev`（workerd）中以 CDP
  量 isolate（GC 後的 V8 heap ＋ ArrayBuffer ＋ Wasm `memory.buffer.byteLength`），每個條件 3–5 次，次數之間差距
  小於 0.1 MiB（M1 報告）：

  | 狀態                                    | isolate   |
  | --------------------------------------- | --------- |
  | Morph，剛載入，尚無請求                 | 52.4 MiB  |
  | Morph，處理過公開 SSR 請求              | 72.8 MiB  |
  | Morph，680 個伺服器 chunk 全部 evaluate | 84.5 MiB  |
  | Morph（SSR 後）＋ 解析器實例化          | 135.2 MiB |
  | 同上，100 KB 檔案的 AST 存活時          | 147.7 MiB |
  | 同上，369 KB 檔案的 AST 存活時          | 181.7 MiB |

  128 MB 是 122.1 MiB；減去 Morph 處理過請求後的 72.8 MiB，只剩約 49 MiB，少於 Wasm 的 61.3 MiB 底線，還沒有解析
  任何檔案。bundle 從 21.3 MiB 增加到 27.9 MiB（64 MiB 上限內）；本機啟動時間看不出差異（global scope CPU
  128–262 ms 對 155–259 ms，各 5 次），解析器不在 global scope 實例化。
  沒有量的部分（M1 報告 §4）：正式 Cloudflare 環境如何計算與強制 128 MB（本機 workerd 不強制）；登入後的編輯器
  與 Design 請求（Theme 工作區也在同一個 isolate 中，只會更高）；並行請求；真實的大型 `.astro` 語料（大檔是合成的）。
  放不下之後的決定見 0.3：首選專用解析器 Worker，備案 Sandbox 容器中的官方 Node 解析器，不自行 fork compiler-rs。

- **【事實，本機】專用解析器 Worker（M1c，2026-10-08）。** 本機 workerd 中 core 與解析器兩個 Worker 以 service
  binding 連接，依 0.3 的設計條件實作，每個條件 3 次（M1c 報告）：
  - 機制如預期：slot 先於讀 body；4 個等待者、2 秒等待之外以 `503 parser-busy`／`parser-wait-timeout` 拒絕；串流
    讀取時強制 100 KB 上限（謊報 `Content-Length` 的 369 KB 請求照樣 413）；回應在 slot 內序列化，超過 256 KiB 在
    建構途中以 422 拒絕；trap 毒化實例。排隊的 fetch 請求不在兩個 isolate 中持有 body（+0.0 MiB），字串參數的 RPC
    則在 admission 之前就把字串放進解析器 isolate（+5.2 MiB）。
  - 解析器 isolate（GC 後的 V8 heap ＋ ArrayBuffer ＋ Wasm `byteLength`；Wasm 不在 `backingStorageSize` 中，沒有
    重複計算）：實例化 63.8 MiB；100 KB 頁面的 AST 與回應存活時 71.9 MiB；100 KB 形狀在 AST 存活時 GC 後最高 91.7 MiB；
    369 KB（壓力入口）94.9 MiB。**GC 前的取樣**在單一 slot 的 2 個並行請求（committed 138.9 MiB）、60 個連續 100 KB 請求
    （used 約 121 MiB、committed 約 155 MiB）與連續 369 KB（used 147–164 MiB）下超過 122.1 MiB。序列化降低峰值，
    但控制不了 GC 時機。
  - 回應只含位置與欄位資訊：100 KB 頁面的 AST JSON 2,370,493 字元，outline 34,687 bytes，指定位置的欄位資訊
    390 bytes；binding 的往返開銷在本機 0–3 ms。
  - **本機通過不代表部署後留在上限內。** 128 MB 是每個 isolate 的上限，由該 isolate 中所有並行請求共用，並包含
    JS heap 與 Wasm；本機 workerd 不強制上限。L2 使用解析器 Worker 之前，必須先通過 8.2 的 M1c-C。
- **【事實，雲端】專用解析器 Worker（M1c-C，2026-10-08，`~/projects/astro-spike/m1c-cloud/M1C-C-REPORT.md`）。** 使用者核准後，在
  `Yuho0298@gmail.com's Account` 部署測試資源 `morph-m1c-parser`（沒有 workers.dev、預覽或版本網址，只經 service
  binding）、`morph-m1c-driver`（唯一入口，權杖加 24 小時期限）與額度用的 `M1cBudget` Durable Object（原子扣額，
  總上限 5000 次）；每次執行後都已刪除，既有 Worker 經連接器確認未變。解析器設定與 M1c 相同（100 KB 上限、單一 slot、
  4 個等待者、2 秒等待、串流位元組上限、回應上限、trap 毒化）。判定以 Workers Logs（100% 取樣）的每次 invocation
  outcome 為準，以請求標頭 `x-m1c-rid` 逐請求對帳（Workers Logs 會遮蔽網址路徑與查詢字串中的 ID，保留標頭）：
  - 第 1 次只用 `wrangler tail`：429 個請求只收到 152 筆（tail 在負載下取樣、並遮蔽查詢字串），無法判定；
  - 第 2 次（Workers Logs）：429 個請求有 422 筆 invocation 事件，全部 `ok`；17 輪中 15 輪逐請求完整。`legal-conc`
    n=2 #1 少 3 筆、n=4 #1 少 4 筆，這 7 個請求都回傳與 golden 逐位元組相同的結果，但平台紀錄不完整，**不計入**；
  - 補驗（一次、事先定下停止條件）：全新部署，熱身請求出現在 Workers Logs 之後才送計數的請求；`legal-conc` n=2、
    n=4 各 3 輪，預期 90 個 ID 加熱身 1 個，91/91 都有 invocation 事件，全部 `ok`；
  - 合計：每一種合法負載（60 個連續 100 KB、12 種形狀輪流；單一 slot 下並行 2、4、8）都至少 3 輪逐請求完整，
    `exceededMemory` 為 0；driver 端沒有失敗或無效結果，每個被接受的結果與本機 golden 逐位元組相同，拒絕都是明確的
    （admission 的 `parser-busy`、`n-tiny-elements` 的 `result-too-large`、trap 的 `parser-trapped`／`parser-unavailable`）；
    369 KB 壓力 3 輪也逐請求完整、全部 `ok`；
  - CPU（Workers Logs 的 `cpuTimeMs`）：第 2 次 422 次 invocation p50 65 ms、p95 283 ms、最高 455 ms（369 KB）；
    補驗 p50 30 ms、p95 83 ms、最高 172 ms。原先「每次約 30 ms」的估計偏低。費用都在 Workers Paid 的內含額度內；
  - shared `WebAssembly.Memory` 在 Cloudflare 上與本機相同可用；Wasm 最大 83.2 MiB（合法）、84.5 MiB（369 KB）。
  - **沒有回答的**：Cloudflare 如何計算 128 MB（GC 前或後、committed 或 used、shared Wasm memory 如何計入；沒有讀到
    任何平台的記憶體數字，判定只依 invocation outcome）、毒化 isolate 何時回收、雲端 trap 門檻（只有兩個樣本，與本機
    相同會 trap）、冷啟動與實例化時間、正式流量下與其他請求共用 isolate 的情形、真實的大型 `.astro` 檔案。
  - **這只代表這些負載模式與這一輪，不是永久安全保證**；100 KB 上限、admission、串流位元組上限、回應上限與 trap 毒化
    都保留。

- R1、M1、M1c、M1c-C 都沒有驗證的項目：正式 Cloudflare 環境的 128 MB 如何計算（M1c-C 只依 invocation outcome 判定）、
  Wasm 編譯快取、
  以這些位置產生 patch 再解析的往返（3.5）、props 型別推斷（3.4）。詳見 R1 報告 §6。
- Morph 解析失敗、超過大小或深度上限的檔案，在 Design 中只能唯讀（「由程式碼控制」），Code 照常可以編輯；
  建置不受影響。

### 3.2 來源位置

- 格式與 TSX 相同：每個一般 HTML 元素帶 `data-morph-loc="src/<file>:<line>:<column>"`，位置取自原始檔
  （插入之前）。元件標籤（大寫開頭）不標記，由元件自己的檔案標記。
- Astro 內建的 `data-astro-source-*` 只在開發工具列開啟時產生，並會被工具列移除，不作為依據
  （multi-runtime 計畫已決定）。

### 3.3 實例與內容識別（與來源位置分開）

現況：`.astro` 頁面沒有任何 `data-storefront-*`，bridge 的 `request-structure` 回報 `nodes: []`（B5）。

- 屬性名稱沿用 `data-storefront-section-id`、`data-storefront-item-id`、`data-storefront-field`、
  `data-storefront-field-path`。分析規則與 `inject-preview-bindings` 相同：表達式讀取的是 `.fields.ts`
  宣告過的 prop 時，就是欄位；迴圈中依 key 表達式決定 item；section 的邊界放在元件的呼叫處。
  被呼叫的 `.astro` 元件不知道自己是哪一個實例，所以由呼叫處以 TSX 現有的同一套 wrapper 規則
  （`display: contents` 及該檔案註解列出的間距注意事項）標記。
- 【待驗，依賴 0.3 的決定】**注入時機：工作區規劃時改寫文字，與 TSX 相同；不採用預覽報告第 5 節第 2 點的
  Vite `load` plugin。** R1 已證明解析器這一側成立（3.1），不需要退回容器內的 Vite plugin。M1 量出解析器放不進
  Morph 主 Worker（3.1），所以剩下的前提是 0.3 選定的執行位置。理由：
  1. 實例識別必須與 Design 儲存時的分析完全一致。在 Morph 中執行，保證程式碼與解析器版本相同；
     在容器內執行的 plugin 做不到這點。
  2. Live Preview 的檔案同步本來就在 Morph 端呼叫 `prepareSourcesForLivePreview`，`.astro` 走同一處，
     不必額外處理 Astro 編譯器 `enforce: "pre"` 的排序問題。
  3. 預覽報告也指出兩套 TSX 注入不能並存。TSX 繼續使用規劃時改寫，spike 中的 TSX transform 不帶進產品。
- 代價：前提是 3.1 的解析器能在 Morph 控制的 Worker 中執行。M1 已量出放不進主 Worker；若改用另一個 Worker（service binding），
  解析與改寫仍由 Morph 的程式碼與同一版解析器執行，上面的理由 1 仍然成立；只有退回第 3 個候選方案時，
  這一節才要重新設計。
- 3.5 的改寫可以直接使用 compiler-rs 給的屬性值範圍（`Literal`、`JSXExpressionContainer`），不必自己掃描原始文字
  （R1 報告 §5）。
- 建置：`.astro` 的標記只存在於預覽工作區，不寫回 Theme 原始碼，所以建置不必移除任何東西。
  TSX 照舊經過 `prepareSourcesForBuild`。
- island 內的 React 元件由現有 TSX 注入處理。Vue 元件第一版沒有實例識別：可以在樹上選取並定位原始碼，
  但不能編輯欄位。

### 3.4 Props 與內容傳入

- 欄位名稱即 prop 名稱。`.fields.ts` 由 `parseColocatedContentFields` 讀取（spike 已驗證可原樣讀取）。
  元件內宣告的相容規則只為既有的 TSX 元件保留；`.astro` 一開始就只接受 `.fields.ts`。frontmatter 中出現
  `export const contentFields` 時，不讀取，在 Code 模式顯示診斷，請作者搬到 `.fields.ts`。
- props 型別讀 frontmatter 的 `interface Props` 或 `type Props`。沒有 `.fields.ts` 時依型別推斷，
  規則與 TSX 相同。欄位沒有對應的 prop 時，Code 模式顯示診斷。
- 傳入 island 的內容必須可序列化。複合欄位（連結、清單）的傳遞方式沿用 multi-runtime 計畫的未決事項。

### 3.5 改寫

- 文字與 class：以解析器給的位置，加上現有的 `patchTailwindClasses`，產生 patch。之後走既有流程：
  AST patch → 白話摘要 + diff → OCC 存成 revision。Monaco 中有未存修改時拒絕套用。
- 「文字升級成欄位」要寫入 `.fields.ts`，而這件事目前連 TSX 都還是 Code only（`fields-in-sidecar`）。
  `.astro` 跟著同一個 PR 處理，不另做一套。

## 4. 內容

契約：Theme 伺服器端的程式從請求標頭 `x-morph-content-origin` 取得 origin，再呼叫
`GET <origin>/_morph/content?path=<pathname>`。**Astro 不新增任何管道**：不新增環境變數（start-native
計畫早期草稿提到的 `MORPH_CONTENT_ORIGIN` 並未實作，這裡也不採用）、不用虛擬模組、不用 `Astro.locals`。

Astro Theme 在原始碼中有一個看得到的讀取函式（例如 `src/morph/content.ts`），以
`Astro.request.headers.get("x-morph-content-origin")` 取得 origin，形狀與 starter Theme 的
`getRequest().headers` 版本相同。這屬於 start-native 計畫中「交給 Design 編輯的頁面內容」那一列：
會加入 Morph 的寫法，但寫法在 Code 中完整可見。讀取結果不能放在 module scope，Worker isolate 會被重用。

### 4.1 伺服器渲染的頁面

- 店面：Core 在轉送給 Theme Worker 時設定 `x-morph-content-origin` 與 release 相關標頭
  （`theme-runtimes.ts`）。這段與框架無關，不需要修改。
- Build Preview：Core 驗證權杖後設定同樣的標頭，`/_morph/content` 由 Core 以 build 綁定的內容發布版本回答
  （`build-preview-request.ts`、`build-preview-content.ts`）。同樣不需要修改。
- 要驗證的只有 Astro 端：`Astro.request.headers` 能讀到 Core 設定的標頭（經由 service binding 與
  `@astrojs/cloudflare` 的 `handle`）。

### 4.2 Live Preview

第 2.5 節的 Worker entry 回答 `CONTENT_ORIGIN` 的草稿快照，與 Start 是同一份程式。
`themePreviewContentPlugin` 在 Astro 下的行為未驗證（預覽報告第 4 節）。

### 4.3 預先渲染的頁面：只讀封存快照，讀不到就讓建置失敗

**Start 現在怎麼做**：包裝設定檔中的 `morph:frozen-prerender-content` 掛在 `configurePreviewServer`。
Start 透過 Vite preview server 預先渲染（`TSS_PRERENDERING`），這個 middleware 為每個請求補上標頭，並以
`.morph/` 中的 `NativePrerenderContent` 回答 `/_morph/content`。回答不了的讀取記錄到
`.morph/prerender-refused-reads.ndjson`，再由 `nativeBuildResult` 以 `NATIVE_PRERENDER_CONTENT_UNAVAILABLE`
讓建置失敗。

**為什麼不能直接搬到 Astro**（證據：spike 中 `@astrojs/cloudflare` 14.3.3 的 `dist/prerenderer.js`、
`dist/utils/prerender.js`、`dist/index.js`）：

1. `prerenderEnvironment` 預設是 `"workerd"`。adapter 在 `astro:build:start` 中以 `setPrerenderer` 換掉
   Astro 的預先渲染器，自己呼叫 `vite.preview({ configFile: false, plugins: [cfVitePlugin(...)] })`。
   `configFile: false` 表示專案與包裝檔的 Vite plugin（包括 `configurePreviewServer`）都不會進入這個 server。
2. 每一頁的渲染是對這個 server 發出 `POST /__astro_prerender`，body 只有 `url` 與 `routeData`，
   adapter 只指定 `Content-Type`。在 Worker 中，頁面的 `Request` 是把這個 POST 的全部標頭原樣複製過來重建的
   （`utils/prerender.js:49-59`），所以頁面另外還會看到 Node `fetch` 與 miniflare 加上的標頭，以及 POST 的
   `content-length`，但**沒有 `x-morph-content-origin`**（R2 的 `noshim` 情境實測確認）。`Astro.url` 來自 POST
   body 的 `url`，與 `host` 標頭（preview server 的隨機 port）不同。
3. adapter 的 `experimental.prerenderWorker.config` 把 `main` 寫死為
   `@astrojs/cloudflare/entrypoints/server`，所以 Morph 也不能透過 wrangler 設定換掉預先渲染 Worker 的入口。

如果什麼都不做，頁面讀不到 origin，Theme 退回元件預設值，建置成功，發布出去的就是預設值的靜態頁。
而且因為根本沒有發出讀取，refused-reads 也不會有任何記錄。

**設計**（本機 miniflare 已由 R2 證明可行；【待驗】Sandbox 容器與 Morph 程式碼，閘門 A2、A3）：

- **封存內容伺服器**：Morph 的建置 integration（5.1 的包裝設定檔加入）在 `astro:build:start` 時於建置
  程序中啟動一個只聽 loopback 的 HTTP server，`astro:build:done` 時關閉。
  - 它只回答 `GET /_morph/content`，資料只來自 `.morph/` 中的 `NativePrerenderContent`（檔名、格式、
    產生函式 `createNativePrerenderContent` 都與 Start 相同）。
  - 回答不了的讀取追加到同一個 `.morph/prerender-refused-reads.ndjson`，由同一個 `nativeBuildResult` 讓建置失敗。
  - 回答與拒絕的邏輯從 `themePrerenderContentPluginSource` 抽成共用的 request handler，Start 的 preview
    middleware 與 Astro 的 server 共用它，不寫第二份。
- **每次建置的 nonce**（0.4 第 1 項）：Morph 為每一次建置產生一個 nonce，交給封存內容伺服器與包裝。
  refused-reads 與 stamped 記錄都帶這個 nonce，`nativeBuildResult` 只接受 nonce 等於這次建置的記錄；
  缺少記錄、nonce 不符或格式不對，一律不通過。這讓工作區中殘留的舊記錄、或其他程序寫入的記錄不會被算進來。
  Start 使用的共用 request handler 之後也要套用同樣的 nonce 綁定（另一個 PR，不在 Astro 接入中順便改）。
- **標頭送達**：在 Vite 的 `prerender` 環境中（且只在這個環境），包住 `@astrojs/cloudflare/entrypoints/server`：
  - 鉤點：`applyToEnvironment` 只對 `prerender` 回傳 true，`resolveId` 攔截 adapter 寫死在
    `experimental.prerenderWorker.config` 的 `main`（裸模組名 `@astrojs/cloudflare/entrypoints/server`，
    `dist/index.js:149`）。adapter 換版時這個值或解析方式可能改變，包裝會默默不生效，所以需要下面的相容性檢查；
  - 為進入的頁面請求設定 `x-morph-content-origin`，值為上面那個 server 的 origin；
  - 在這一頁渲染期間，記錄每一次對內容 origin 的讀取結果：成功、被拒（404）、連線失敗、非 2xx、
    回應無法解析；
  - 其他外連一律拒絕，只為了讓錯誤訊息明確；建置期的外連隔離由 Sandbox 的網路政策負責（7.1）。包裝攔截的是
    `globalThis.fetch`，Theme 以其他方式（例如 `connect()`）發出的請求不在記錄範圍內；
  - 頁面渲染完成後，把「nonce、pathname、讀取次數、失敗次數」送回封存內容伺服器
    （loopback 上的另一個路徑），由伺服器寫入 `.morph/prerender-stamped.ndjson`。workerd 不能寫檔，
    所以記錄一律經由這個伺服器。
- **adapter 相容性檢查**（0.4 第 4 項）：
  - 建置開始前：預期的 adapter 入口不存在（解析不到 `@astrojs/cloudflare/entrypoints/server`）時，以
    `ASTRO_ADAPTER_INCOMPATIBLE` 失敗，不執行預先渲染；
  - 建置中：包裝在 `prerender` 環境的 `resolveId` 沒有命中，或命中不只一次，同樣以 `ASTRO_ADAPTER_INCOMPATIBLE`
    失敗。這讓「adapter 升級後包裝不再生效」有明確的錯誤訊息，而不是只表現為 `ORIGIN_MISSING`（R2 報告 §4）；
  - 建置後：stamp 數不等於預先渲染頁數時，建置失敗（見下方的建置失敗條件）。
- **fail-fast**（0.4 第 1 項）：內容讀取被拒、失敗，或 stamp 送不回去時，包裝讓這一頁的預先渲染當場失敗：回傳帶
  `x-astro-prerender-error` 的 500。adapter 既有的錯誤路徑（`prerenderer.js:164-167`）會丟出
  `Failed to prerender <url>: <原因>`，`astro build` 以非 0 結束，不產出這一頁的 HTML。錯誤訊息要寫出原因
  （`refused`、`non-2xx` 與狀態碼、`connect-failed`、`unparseable`），R2 的 fail-fast 情境中這些都出現在 log 裡。
  這只是把錯誤原因經由 adapter 既有的錯誤標頭帶回建置程序，不傳內容，不是內容管道。
- **建置失敗條件**（fail-fast 之外，`nativeBuildResult` 在建置後檢查；判斷依據是讀取記錄，不是 HTML）：
  - 有被拒的讀取：`NATIVE_PRERENDER_CONTENT_UNAVAILABLE`（與 Start 相同）；
  - 有任何一頁的內容讀取失敗（連線失敗、非 2xx、無法解析）：`NATIVE_PRERENDER_CONTENT_READ_FAILED`。
    Theme 的讀取函式通常會 `catch` 錯誤並退回預設值，所以「頁面照常產生」不能當作讀取成功的證據；
  - 產物中任何一個預先渲染的 HTML 沒有這次建置的 stamped 記錄，或 stamp 數不等於預先渲染頁數：
    `NATIVE_PRERENDER_CONTENT_ORIGIN_MISSING`。封存內容伺服器停掉或連不到時，記錄也送不回來，所以這種情況
    一樣會失敗，不會因為「沒有讀取」而通過。不讀 CMS 內容的預先渲染頁不要求有讀取，只要求有 stamp；
    能證明標頭有送到的，只有這份記錄。
  - **這個錯誤碼同時涵蓋「封存內容伺服器不在」與「標頭沒送到」**，記錄上無法區分：讀取失敗的細節與 stamp
    走同一個伺服器，伺服器不在時一起遺失（R2 報告 §3 觀察 3）。fail-fast 的錯誤訊息中仍看得到 `connect-failed`。
    是否要在記錄上區分兩者，列在 0.3。
- **為什麼兩者都要。** R2 實測：在只看記錄的設計下，四種失敗情境的 `astro build` 都以 exit 0 結束，並產出含預設值
  的 HTML。所以 **Astro 原生建置的成功判定不能只看 `astro build` 的 exit code**；fail-fast 讓失敗發生在當下並帶
  原因，建置後的檢查則不依賴包裝一定有執行（例如包裝根本沒有命中時，fail-fast 也不會發生）。
- **標頭有送到，不等於頁面讀到正確內容。** 驗收以 HTML 的實際內容為準（見下方 A3 的三值測試）。
- **不進產物**：上面的包裝只存在於 `prerender` 環境的 bundle 裡。R2 中可部署的 bundle 沒有包裝標記；`.prerender/`
  在預先渲染成功後由 Astro core 自行刪除，**但預先渲染失敗時會留下**，內含包裝與完整的 prerender bundle。因此：
  - 失敗的建置一律不執行產物整理，不產生產物；
  - 成功的產物，Astro 的 `verifyArtifact` 主動檢查，不依賴 Astro 自己的清理：`runtime/server/**` 中出現包裝標記
    （`NATIVE_PRERENDER_SHIM_LEAKED`）、任何 `.prerender/` 路徑、任何 `.morph/` 診斷檔（refused-reads、stamped
    等記錄），都拒絕（5.2）。

**前提的驗證狀態**（R2 為獨立實驗；A3 是接入 `main` 前的真實建置測試）：

1. Astro core 在 workerd 預先渲染時，會把請求標頭原樣交給頁面，而不是另外清空或警告：**R2 成立**。Astro 的
   「`Astro.request.headers` is not available on prerendered pages」只出現在 Node 端的 `createRequest`，那個請求
   不進入 workerd；R2 的建置 log 沒有這類警告。
2. 只套用在 `prerender` 環境的 plugin 能夠包住那個入口：**R2 成立**。
3. workerd 中的預先渲染 Worker 連得到建置程序的 loopback：**本機 miniflare 由 R2 成立；A2b 在 Docker 與本機
   Sandbox 路徑成立（2026-10-09，7.2.1）；Cloudflare 上未驗，要等部署**。建置程序與 workerd 在同一個容器、同一個
   網路命名空間；`@astrojs/cloudflare` 14.3.3 在有網路的容器中會因上游錯誤連不到自己的 preview server，工具鏈
   因此升到 14.3.4。

**任何一項在 Sandbox 中不成立，Astro 接入就停在這裡**，回到設計層決定，不悄悄改成新的資料管道。

**A3 的三值測試**（形式同 `src/lib/storefront/compiler/native-start-runner.test.ts`，真實建置）：同一個欄位準備三個不同的值，
元件預設值 D、封存快照中的 A、建置後才改的目前草稿 B。R2 以簡化的 harness 跑過同一組情境（R2 報告 §3）；
A3 改用 Morph 自己的 `createNativePrerenderContent`、共用 request handler 與 `nativeBuildResult`。

fail-fast 與建置後檢查**各自**要被證明有效：每一個失敗情境跑兩次，一次是正常的建置（fail-fast 生效），一次在
測試中關閉 fail-fast，只靠建置後檢查。兩道防線任一道單獨存在時，都必須擋得住每一個失敗情境（0.4 第 1 項）。

| 情境                               | fail-fast 生效                                           | 只靠建置後檢查                                      |
| ---------------------------------- | -------------------------------------------------------- | --------------------------------------------------- |
| 正常建置                           | 預先渲染的 HTML 含 A，不含 D、不含 B                     | 同左                                                |
| 沒有快照                           | 預先渲染失敗，訊息含 `refused`；沒有產物                 | `NATIVE_PRERENDER_CONTENT_UNAVAILABLE`，沒有產物    |
| 封存內容伺服器回 500               | 預先渲染失敗，訊息含 `non-2xx` 與 500；沒有產物          | `NATIVE_PRERENDER_CONTENT_READ_FAILED`，沒有產物    |
| 封存內容伺服器沒有啟動（連線被拒） | 預先渲染失敗，訊息含 `connect-failed`；沒有產物          | `NATIVE_PRERENDER_CONTENT_ORIGIN_MISSING`，沒有產物 |
| 拿掉標頭送達（包裝沒有命中）       | `ASTRO_ADAPTER_INCOMPATIBLE`；沒有產物                   | `NATIVE_PRERENDER_CONTENT_ORIGIN_MISSING`，沒有產物 |
| 記錄的 nonce 與這次建置不符        | —                                                        | 建置失敗，沒有產物                                  |
| 不讀內容的預先渲染頁               | 建置成功，該頁有 stamp、0 次讀取                         | 同左                                                |
| 失敗的建置                         | `dist/server/.prerender/` 留在工作區，但沒有產生任何產物 | 同左                                                |
| 成功建置的 Worker 產物             | 不含包裝的標記、`.prerender/`、`.morph/` 診斷檔          | 同左                                                |

任何一種失敗情境下，如果建置成功並產生含 D 的 HTML，A3 就不通過。

**被否決的作法**：

- 包裝檔把 `prerenderEnvironment` 改成 `"node"`：這等於改變專案自己的建置方式，SSR 程式碼也會在 Node
  而不是 workerd 中預先渲染，違反「建置執行 Theme 自己的設定」。
- 讓 Theme 讀環境變數或 `Astro.locals`：新的資料管道。
- 以 HTML 有無預設值判斷：Start 已經決定判定依據是讀取，不是 HTML。

**路由與封存範圍**：

- `createNativePrerenderContent` 需要 `ThemeRouteRegistry`。Astro adapter 的 `routes` 從 `src/pages/**`
  的檔名產生：`[param]`、`[...rest]` 是動態路由，其餘是靜態路由。
- **路徑與內容鍵的對應**（0.4 第 3 項）。【事實】R2：預設 `build.format: "directory"`、`trailingSlash: "ignore"`
  時，預先渲染中 `Astro.url.pathname` 是 `/about/` 形式，首頁是 `/`；快照鍵寫成 `/about` 時 `/about/` 被拒，
  建置由 `UNAVAILABLE` 擋下（R2 報告 §3 觀察 4，`path-noslash` 情境）。判定機制是對的，但鍵不一致時每個非首頁
  的頁面都會建置失敗。規則：
  - **不一律去掉結尾斜線。** 依 Astro 的路由、`trailingSlash`（`"always"`、`"never"`、`"ignore"`）與
    `build.format` 建立一份一致的內容鍵對應：`ThemeRouteRegistry` 的路徑、`createNativePrerenderContent` 的鍵、
    Theme 讀取時送出的 `path`、預先渲染 HTML 的輸出路徑，都經過同一個對應。
  - 封存的鍵必須使用 **Core 執行期使用的同一個正規化函式**，也就是店面與 Build Preview 回答
    `/_morph/content?path=` 時，`resolveStorefrontContent`（`storefront-content-runtime.ts`）解析 path 所用的
    那一個。函式要抽出來共用，不在建置端另寫一份；否則預先渲染讀到的內容可能與同一路徑在 SSR 時讀到的不同。
  - 測試（A3、A4）至少包含：首頁；同一頁有無結尾斜線；`trailingSlash` 三種設定；動態路由；中文與百分比編碼的
    路徑；以及**兩個不同的路徑絕不會對應到同一個鍵**。
  - 這一項與 A4 的「`assertThemePrerenderArtifacts` 的路徑對應」（5.2）合併處理。R2 只測了預設值。
- 動態路由經 `getStaticPaths` 產生的頁面，路徑在建置前無法得知，讀內容時會被拒絕
  （`NATIVE_PRERENDER_PATH_NOT_SEALED`），規則與 Start 相同。這列為已知缺口：第一版中讀 Morph 內容的動態
  頁面不能預先渲染，要改用 SSR。
- CMS 指定 SSG 的發布限制（`PUBLISH_RENDER_POLICY_NOT_READY`）不變。

### 4.3.1 A3 結果（2026-10-09，本機真實建置；不是 Sandbox 或 Cloudflare 驗收）

**實作**（`src/lib/storefront/theme-framework/astro-native-prerender.ts`）：

- 包裝設定檔 `.morph/astro.build.config.mjs`：import Theme 的 `astro.config.mjs` 不修改，只在 `integrations` 最後加上
  Morph 的 integration（`.morph/astro-build-integration.mjs`）。匯入防護與 5.2 的規則屬於 A4，這裡還沒有。
- 封存內容伺服器：`astro:build:start` 起、`astro:build:done` 關，只聽 `127.0.0.1`，port 由系統指定（不用固定
  port，並行的建置不互相占用）。回答一律經過共用的 `answerSealedContentRead`（從 `themePrerenderContentPluginSource`
  抽出，Start 的 middleware 改用同一個函式，行為不變），讀取的鍵一律經過 Core 的 `normalizeRoutePath`
  （`theme-template-routes.ts`，`routeTemplatePathForRequest` 用的就是它）。兩個函式都以 `toString` 嵌入產生的原始碼，
  不另寫一份；單元測試確認產生的原始碼含有這兩個函式本身。
- 包裝：只在 `prerender` 環境，`resolveId` 攔截 `@astrojs/cloudflare/entrypoints/server`。每頁送出一個 stamp
  （路徑、讀取次數、失敗次數、被拒次數）；讀取失敗、被拒或 stamp 送不出去時，以 `x-astro-prerender-error` 讓該頁
  當場失敗，訊息寫出 `refused`、`non-2xx <狀態碼>`、`connect-failed`、`unparseable` 或 `stamp-lost`。
- `ASTRO_ADAPTER_INCOMPATIBLE`：建置前解析不到 adapter 入口；或 `prerender` 環境的 bundle 結束時，入口被攔截的
  次數不是 1。
- 紀錄：refused-reads、stamped，以及 `astro:build:done` 回報的預先渲染頁清單（`.morph/prerender-pages.ndjson`，
  最後一行是結束標記）。每一行都帶這次建置的 nonce。建置後的判定是 `astroPrerenderRecordsFailure`：
  - 有被拒的讀取：`NATIVE_PRERENDER_CONTENT_UNAVAILABLE`；
  - 有失敗的讀取：`NATIVE_PRERENDER_CONTENT_READ_FAILED`；
  - stamp 與預先渲染頁不是一對一：`NATIVE_PRERENDER_CONTENT_ORIGIN_MISSING`；
  - 頁清單或結束標記缺少、任何一行格式不對或 nonce 不符：`NATIVE_PRERENDER_RECORD_INVALID`。
- 產物檢查 `astroArtifactLeaks`：`dist/` 中出現包裝標記、`.prerender/` 或 Morph 的紀錄就列出來。
- Astro 的路由登錄 `astroRouteRegistry`：從 `src/pages/` 的檔名產生，路徑是 URL 形式（中文經百分比編碼，與
  `Astro.url.pathname` 相同）；`_` 開頭不是路由。

**決定：`build.format` 只支援預設的 `"directory"`。** 實測在 `"file"` 下，預先渲染頁讀取時送出的是 `/about.html`，
而 Core 對同一頁的鍵是 `/about`。要對上就得在 Core 的正規化之外另加一條去掉 `.html` 的規則，這違反上面「同一個
正規化函式」的要求，也會讓 `about.astro` 與 `about.html.astro` 兩條路由對應到同一個鍵。所以 `"file"` 與
`"preserve"` 在 `astro:config:done` 以 `ASTRO_BUILD_FORMAT_UNSUPPORTED` 拒絕，訊息說明可改用預設值。
`trailingSlash` 三種設定都支援：讀取的 `/about/` 與 `/about` 經 Core 的函式是同一個鍵。

**測試**（`astro-native-prerender*.test.ts`，以 `sandbox/toolchains/astro-7.3` 的 lockfile 安裝的工具鏈實際執行
`astro build`；CI 先以 `pnpm toolchain:astro` 安裝，CI 中沒有安裝就失敗，本機沒有安裝則跳過並提示）：

- 三值：正常建置下，讀內容的頁面 HTML 含封存的 A，不含預設值 D 與草稿 B；不讀內容的頁面有 stamp、0 次讀取；
  stamp 帶這次的 nonce。關閉 fail-fast、只靠紀錄判定時結果相同。
- 4.3 表的四種失敗（無快照、500、連線被拒、包裝沒有命中）各跑兩次。fail-fast 生效時，`astro build` 失敗，
  訊息含對應的原因，該頁沒有 HTML。只靠紀錄時，`astro build` 以 0 結束、HTML 是預設值 D，由紀錄判定得到
  `UNAVAILABLE`、`READ_FAILED`、`ORIGIN_MISSING`、`ORIGIN_MISSING`。兩道防線各自都擋得住。
- 失敗的建置留下 `dist/server/.prerender/`（含包裝），`astroArtifactLeaks` 會找到它；成功的建置沒有任何洩漏。
- 紀錄：同一份紀錄以別的 nonce 讀取、工作區殘留別次建置的 stamp、少一個 stamp、多一個 stamp、沒有頁清單，
  都不通過。
- 路徑：`trailingSlash` 為 `"ignore"`、`"always"`、`"never"` 時，首頁、`/about`、中文路徑都拿到 A；
  `build.format` 為 `"file"`、`"preserve"` 時被拒；讀內容的動態路由（`getStaticPaths`）以
  `NATIVE_PRERENDER_PATH_NOT_SEALED` 失敗（已知缺口）。「兩個不同的路徑不會對應到同一個鍵」以單元測試涵蓋。
- 另外試過 Theme 的 `wrangler.jsonc` 沒有 `nodejs_compat`：建置與紀錄判定都通過（包裝使用 `node:async_hooks`）。
  這是一次性的檢查，沒有寫成測試。

**還沒做的**（A4）：

- 接入兩個建置程式與 `nativeBuildResult`：在 runner 中產生 nonce、呼叫 `astroPrerenderRecordsFailure`、
  不整理失敗的建置、以 `astroArtifactLeaks` 檢查整理後的產物；
- 包裝設定檔的匯入防護；5.2 的規則；inspector port（7.2）。

A3 的測試直接執行 `astro build` 與上面的函式，沒有經過 runner。Start 的共用 request handler 加上 nonce 綁定，
仍是另一個 PR（上方「每次建置的 nonce」）。

## 5. 建置、Build Preview、發布、回滾

與原生 Start 同一條路線。下表只列 Astro 不同或需要確認的地方：

| 環節          | 共用（不改）                                                                                       | Astro 專屬                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 輸入          | materializer、`buildMode: "native"`、`inputHash`、開關預設關閉、正式環境拒絕                       | 輸入記錄 `framework: "astro"` 與工具鏈 id；compiler 身分為 `astro-native`                                                                |
| 執行          | 兩個建置程式、只拿到必要環境變數、Sandbox 不外連（目標；目前未落實，見 7.1）                     | 命令為 `astro build --config .morph/astro.build.config.mjs`；`ASTRO_TELEMETRY_DISABLED=1`                                                |
| 產物          | `.wrangler/deploy/config.json` → Worker 設定 → `runtime/server`、`runtime/client`；manifest 與雜湊 | 只整理成功的建置；排除 `prerenderWorkerConfigPath` 指向的目錄；adapter 自動加入的綁定（5.2）；不能只看 `astro build` 的 exit code（4.3） |
| Build Preview | 每個權杖一個隔離實例、只載入該 build 的產物、外連政策只回答自己的 `/_morph/content`                | 無                                                                                                                                       |
| 發布          | 重用預覽過的 build、`buildContentCurrent`、`PUBLISH_BUILD_CONTENT_MISMATCH`、只有 Certified 能發布 | 無                                                                                                                                       |
| 回滾          | release 指回舊 build，部署該 build 的產物                                                          | 拒絕產物 Worker 設定中的 `cache.enabled`（5.2）；Theme 程式自行使用的快取不在偵測範圍內                                                  |

### 5.1 包裝設定檔

`.morph/astro.build.config.mjs` import Theme 的 `astro.config.*`（不修改），保留它的 `integrations` 並在最後
加上 Morph 的建置 integration。這個 integration 只做三件事：

1. **匯入防護**：沿用 `nativeImportGuardPluginSource`（依解析後的位置判斷）。Astro 的虛擬模組
   （`astro:*` 解析成 `\0` 開頭的 id）是否已被既有的「略過 `\0`／`virtual:`」規則涵蓋，要在 A4 確認；
   不夠的部分以 adapter 的 `devInfrastructureAllowances` 補，不在防護中寫死 Astro 字串。
2. **封存內容伺服器**與 **`prerender` 環境的標頭送達**（4.3）。
3. 沒有其他事。不覆寫 adapter，不改 `output`，不加任何進入 Worker 的程式。

不覆寫 adapter 的後果：adapter 起的預先渲染 preview server 預設開 inspector port（R2 報告 §4），而 Theme 的
`cloudflare({ inspectorPort: false })` 是作者的產品設定，包裝檔替作者改它違反第 3 點。處理方式見 7.2。

Wrangler 設定副本與 Start 相同，以 `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH=.morph/wrangler.json` 提供。
adapter 在 `astro:config:setup` 中會呼叫 `loadWranglerEnv(config.root, configPath)`，它讀哪些檔案、會不會讀到
工作區中的 `.dev.vars`／`.env` 要在 A4 確認。工作區本來就不放這些檔案（2.3），所以確認的目的是讓規則有依據。

### 5.2 Astro 的產物規則

【事實】spike 建置後，`dist/server/wrangler.json` 中有以下內容（證據：spike 的 `dist/server/wrangler.json`
與 `.wrangler/deploy/config.json`；R2 報告 §2.4）。

**`previews` 欄位也要檢查。** 預設設定下，adapter 除了頂層的 `kv_namespaces`、`images`，還在 `previews` 欄位
寫入同樣的 `SESSION` 與 `IMAGES`（`dist/wrangler.js:42`）。Morph 不使用 Cloudflare 的 preview 部署，但下表的
`SESSION`、`IMAGES` 規則**同時讀頂層與 `previews`**，任一處出現就拒絕：理由是這兩處都來自同一個作者設定，
只看頂層的話，規則的正確性就依賴「adapter 永遠同時寫兩處」這個沒有保證的實作細節，而多讀一個欄位的成本很低。

原則：Morph 不支援的項目，**在建置時明確拒絕，並說明拒絕的是哪個設定、作者可以怎麼改**；不在部署時才拒絕，
也不默默丟掉。每一條規則只檢查「產物 Worker 設定中的某個欄位」，所以寫得出確切的偵測方法；
Theme 程式碼中的行為不在這個範圍內。

| 產物 Worker 設定中的欄位                                                              | 來源                                                                                                                                                                     | 現有部署規則的結果                                                                         | 設計（偵測方式：讀 `.wrangler/deploy/config.json` 指向的 Worker 設定）                                                                                                                                    |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kv_namespaces` 或 `previews.kv_namespaces` 含 `SESSION`（或 `sessionKVBindingName`） | Theme 沒有設定 `session: false`，也沒有指定其他 driver 時，adapter 自動加入                                                                                              | `planThemeWorkerDeployment` 以 `FORBIDDEN_BINDING` 拒絕，但要到 Build Preview 或發布才發現 | 建置時以 `ASTRO_SESSION_BINDING_UNSUPPORTED` 拒絕，訊息說明可在 `astro.config` 設定 `session: false`                                                                                                      |
| `images` 或 `previews.images`（Images 綁定）                                          | adapter 的 `imageService` 為預設的 `"cloudflare-binding"`                                                                                                                | 不在禁止清單中，部署時被默默丟掉；之後執行期的圖片端點會失敗                               | 建置時以 `ASTRO_IMAGES_BINDING_UNSUPPORTED` 拒絕，訊息說明可改用 `imageService: "passthrough"` 或 `"compile"`。另外建議把 `images` 加入部署的禁止清單（部署規則的修改，另開 PR）                          |
| `cache.enabled === true`                                                              | Astro 設定 `cache.provider: cacheCloudflare()`                                                                                                                           | 部署時被丟掉，`Astro.cache` 的實際效果未知                                                 | 建置時以 `ASTRO_WORKER_CACHE_UNSUPPORTED` 拒絕。ISR 快取由 Core 以 storefront 與 release 為鍵；這個設定開啟的是 Theme Worker 自己的 Workers Cache，鍵中沒有 release                                       |
| `prerenderWorkerConfigPath` 指向的目錄（`dist/server/.prerender/`）                   | adapter 的 workerd 預先渲染。Astro core 在預先渲染成功後自行刪除（`astro/dist/core/build/static-build.js:120`）；預先渲染失敗時會留下，內含包裝與完整的 prerender bundle | 共用的產物整理會把 server 目錄下的所有檔案都帶入                                           | 產物整理**不在失敗的建置上執行**。成功的建置在整理時仍然排除這個目錄，並主動驗證：任何檔案出現在 `runtime/server/.prerender/`、任何包裝標記、任何 `.morph/` 診斷檔，都讓驗證失敗；不依賴 Astro 自己的清理 |
| `main: "entry.mjs"`、`no_bundle: true`、`rules`                                       | adapter                                                                                                                                                                  | 部署規劃把 server 目錄的每個檔案當作 module 上傳                                           | 預期可用，未驗證：在 A5 以 Build Preview 與店面實際執行確認                                                                                                                                               |
| `_headers`（client 資產）                                                             | Astro                                                                                                                                                                    | 在 `ASSET_EXCLUSIONS` 中，不會送出                                                         | 不拒絕；Theme 寫的回應標頭不生效。與 Start 相同，但 Astro 專案較常使用，所以在 Code 模式顯示診斷                                                                                                          |

**快取規則的範圍。** `ASTRO_WORKER_CACHE_UNSUPPORTED` 只拒絕上表那一個設定欄位，**不代表 Morph 能找出 Theme
所有自行使用快取的程式碼**。例如 Theme 程式直接呼叫 Cache API（`caches.default`、`caches.open`），或其他
Astro 快取 provider，都不會被這條規則發現。這些情況下，回滾是否仍然只等於「換 build」，要由執行期的隔離
（例如 Theme Worker 的快取範圍是否以 release 區分）來保證，列為 9.2 的待決事項。Start 也有同樣的問題，
不是 Astro 特有的。

**官方停用方式（【事實】R2 報告 §2.4）**：Astro 的設定 schema 接受 `session: false`，adapter 這時不加入
`SESSION`；`imageService` 為 `"passthrough"` 或 `"compile"` 時，adapter 不要求正式環境的 `IMAGES`（`"compile"`
在 dev 時仍會加入，它的 runtime 是 `passthrough`）。R2 以真實建置確認：最簡單的 Astro Theme 只加上這兩項設定，
產物的 `kv_namespaces` 為 `[]`、沒有 `images`、`previews` 為 `{}`，建置成功；兩項都不設時，上表的兩條規則正確觸發。
仍然【待驗】的是 `"compile"` 的建置期圖片處理：R2 的 Theme 沒有使用 `<Image>` 或 `astro:assets`，這段沒有被執行到，
A4 要用一個實際使用圖片的 fixture 確認。

這兩項設定是作者要寫進自己 `astro.config` 的官方寫法，Morph 不在包裝檔中替作者覆寫。因此官方範例**原樣**
匯入時會被拒絕，fixture 驗收（A4）把它記為 `KNOWN GAP`，直到 Sessions 有對應。

`native.verifyArtifact`：Worker 入口、client 資產、內容要求的預先渲染頁（沿用 `assertThemePrerenderArtifacts`；
Astro 的輸出格式是 `about/index.html`，路徑對應依 4.3「路徑與內容鍵的對應」，在 A4 確認），加上上表的拒絕與
4.3 的檢查（包裝標記、`.prerender/`、`.morph/` 診斷檔）。
`manifestMetadata` 為 `{ framework: "astro", runtime: "cloudflare-worker", build: "native", workerEntry,
clientAssetsDirectory, routes }`，沒有 `previewEntry`。

### 5.3 Build Preview、發布、回滾

- Build Preview 執行器以 `wrangler dev` 執行產物，與框架無關。Astro 只需要確認一件事：Astro 的 Worker
  在無網路容器中能啟動（就緒判定沿用 `waitForPort`）。
- 發布：工具列建置，以及發布時必須先建置所觸發的建置，都封存它所服務的那份草稿；發布重用 build 的條件
  （`resolvePublishBuildPlan` 的 `buildContentCurrent`）與伺服器端的 `PUBLISH_BUILD_CONTENT_MISMATCH` 都不改。
  Astro 不會有另一條發布路徑。
- 回滾不改。拒絕 `cache.enabled`（5.2）是為了讓回滾仍然只等於「換 build」；Theme 程式自行使用的快取不在
  這條規則的範圍內（見 5.2「快取規則的範圍」）。
- 建置來源紀錄包含工具鏈快照與當時的認證狀態。Unverified 組合產生的 build 不能升格為 release。

## 6. Live Preview 行為

| 情況                    | 行為                                                                                                 | 依據            |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | --------------- |
| 修改 `.tsx`（island）   | 局部 HMR，文件保留                                                                                   | 預覽報告 Run A  |
| 修改 `.astro`           | 整頁重新載入：relay 收到 `full-reload`，bridge 回 `applied` 之後文件被取代，再送一次 `preview-ready` | 預覽報告 B7     |
| 修改 CSS                | `update`，文件保留                                                                                   | 預覽報告        |
| Design 修改內容欄位     | 第一版重新載入整頁（`contentRefresh: "document-reload"`）                                            | 本設計          |
| 切換頁面（`set-route`） | `location.assign(path)`；目前路由讀 `location.pathname`，不讀 `router.state.matches`                 | 本設計          |
| 修改 `.vue`             | 未驗證                                                                                               | 預覽報告第 4 節 |

### 6.1 整頁重新載入時的編輯器狀態

`.astro` 修改或內容更新後，選取、捲動位置與 island 狀態都會重設。

- bridge 在送出 `applied` 之前，先把「要恢復的選取」寫進以 preview session 為鍵的 `sessionStorage`：
  記錄來源位置與實例識別，不記錄 DOM 參照，捲動位置也一起記錄。新文件載入的 bridge 讀回並恢復，
  恢復完才回報結構。
- 編輯器把「`applied` 之後收到 `preview-ready`」視為同一次修改的延續，不當作預覽重啟。真實編輯器
  （`preview.tsx`）能不能正確處理這個順序未驗證，列為 A6 閘門。
- island 狀態（例如購物車數量）會歸零，在介面上說明，不嘗試保存。

### 6.2 「applied」不代表因果

relay 的 `applied` 表示「游標之後有 payload，而且都已套用」，不表示「這一次寫入造成的 payload」
（預覽報告第 2 節：harness 的一次誤判就是這樣來的）。如果編輯器以外有任何寫入（Code 模式、其他分頁、
外部工具），下一次 `applied` 可能來自不相干的 payload。**這在 Start 也一樣**，不是 Astro 特有的問題。

- 第一版：Astro 不改變這個語意，文件與介面不宣稱 `applied` 代表「這次修改已顯示」。
- 建議（框架無關，另開 PR）：`theme-files-written` 帶上這次寫入的路徑，relay 記錄每個 payload 牽涉的路徑
  （`update` 的 `path`、`full-reload` 的觸發檔），bridge 只在 payload 涵蓋這次寫入的路徑時才回 `applied`。
  Vite 的 payload 不一定附帶觸發檔，可行性要先確認。

### 6.3 內容更新與導覽目前依賴 TanStack Router

`refreshPreviewContent` 呼叫 `window.__morphPreviewRouter.invalidate()`，`set-route` 呼叫 `router.navigate`；
沒有 router 時兩者都不做任何事（B6）。在 Astro 上，內容修改不會出現在畫面上，也不會有任何錯誤。

- 改為依 adapter 宣告的 `contentRefresh`、`navigation` 分支，不再探測 router。
- Astro 第一版的內容更新是重新載入整頁，所以要合併觸發：在欄位提交或停止輸入後才重新載入，不是每個按鍵
  都載入。重新載入期間，畫面上保留目前的內容。
- 之後可以改成片段替換或 server islands，屆時只改 adapter 的宣告與 bridge 的對應分支。

## 7. 安全預設

`@astrojs/cloudflare` 與 Cloudflare Vite plugin 的預設，是為作者自己的電腦設計的。在 Morph 的預覽與建置中：

| 項目                                | adapter 預設                                                              | Morph 的處理                                                             | 驗證狀態                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| miniflare 狀態持久化                | 寫入工作區 `.wrangler/state`（Run A 寫了 6.2 MB 的 kv/d1/r2/do/images）   | 預覽：`persistState: false`；工作區不同步、不算指紋、不讀回 `.wrangler/` | Run B 通過（沒有寫入）                                                       |
| inspector（除錯 port）              | 開啟（Run A 為 9230）；建置時預先渲染的 preview server 也開（R2 報告 §4） | 預覽：`inspectorPort: false`；建置：不覆寫作者設定，依 7.2 處理          | 預覽 Run B 通過（沒有警告）；容器中實際的監聽 socket 未列出；建置見 7.2      |
| 遠端綁定                            | 綁定設定 `remote: true` 時連到 Cloudflare                                 | 預覽：`remoteBindings: false`；建置：沙箱沒有網路，也沒有憑證            | **未驗證**實際效果                                                           |
| `SESSION` KV、`IMAGES` 綁定自動加入 | 預設啟用，log 印出「Enabling … binding」                                  | 預覽：Worker 不給任何綁定（與 Start 相同）；建置：產物規則拒絕（5.2）    | 預覽中綁定是否仍出現在 `env`，**未驗證**；建置產物中確實存在（已讀產物確認） |
| Workers Cache（`cache.enabled`）    | `cacheCloudflare()` 時開啟                                                | 建置拒絕這個設定欄位（5.2）；Theme 程式自行使用的快取不在範圍內          | 只讀了產物，沒有執行                                                         |
| 開發工具列                          | dev 預設開啟                                                              | 預覽：`devToolbar: { enabled: false }`                                   | spike 設定為關閉；開啟時的網路行為未調查                                     |
| 遙測                                | Astro CLI 會傳送匿名遙測                                                  | 預覽與建置設定 `ASTRO_TELEMETRY_DISABLED=1`                              | 沒有網路時是否會拖慢啟動，未驗證                                             |
| `.env`／`.dev.vars`                 | `loadWranglerEnv` 從專案根目錄讀取                                        | 工作區不放這些檔案（2.3）                                                | 讀取的確切檔案清單**未驗證**                                                 |
| 伺服器端外連（預覽、建置）          | 不限制                                                                    | 見 7.1：安全邊界是容器的網路政策                                         | 見 7.1                                                                       |
| `/@fs/` 讀取工作區外的檔案          | Vite `server.fs.strict`                                                   | 沿用 `fs.allow`                                                          | Run A：`/@fs/etc/passwd` 回 403；Run B 未測                                  |

### 7.1 外連隔離：與橋接注入分開

**安全邊界是容器的網路政策，不是 Worker 裡的檢查。** Worker 中的 JavaScript 檢查看不到主機名稱實際解析到
哪裡，Theme 程式也可能不經過被包住的 `fetch`（例如用其他 API 或直接開 socket），所以它不能承擔安全邊界。
`previewOutboundRefusal` 的註解也寫明它「只是第一層」。

| 層                     | Live Preview                                                                                                 | 建置（含預先渲染）                                                | Build Preview                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| **邊界：容器網路政策** | 【事實】`PreviewSandbox`：`enableInternet = false`、`interceptHttps`，對外請求一律交給 `refusePreviewEgress` | 【事實，2026-10-08 更正】**建置容器目前可以外連**：建置用的 `Sandbox` 類別（`src/server/build-sandbox.ts`）沒有設定 `enableInternet`，SDK（`@cloudflare/containers` 0.3.7）預設為 `true`。「建置沙箱不能外連」是 start-native-import-plan 的政策目標，尚未落實；見下方說明與 `TODO.md` 的部署前阻擋項 | 【事實】`BuildPreviewSandbox`：同上，只回答自己的 `/_morph/content` |
| 輔助：Worker 內的檢查  | 預覽 Worker entry 的 `previewOutboundRefusal`（2.5），只負責給 Theme 作者明確的錯誤訊息                      | `prerender` 環境的包裝拒絕非內容讀取，只負責明確的錯誤訊息（4.3） | 無（產物原樣執行，不注入）                                          |

- 不論 2.5 最後採用 Worker entry 還是 `injectScript`，上表的邊界都不變。所以橋接方案的選擇不影響安全性；
  兩個方案的差別只在錯誤訊息是否清楚。
- **本機 sidecar 不是安全邊界。** 它在開發者自己的機器上以 loopback 執行 Theme 程式，與 Start 相同，只供
  開關開啟的開發與測試環境使用。Astro 預覽在本機時，Theme 伺服器程式實際上可以對外連線；Worker 內的檢查
  只是讓開發者看到與容器中相同的錯誤。
- 【待驗】Astro 預覽在容器中會發出哪些對外請求（Astro 遙測、wrangler、套件解析等），要在 A6 中從政策記錄確認
  都被拒絕，而且被拒不會讓啟動卡住。
- **建置的外連（2026-10-08 更正）：** 建置容器目前不拒絕外連，所以 A2、A4 只能記錄建置**嘗試**連到哪裡，
  不能從政策記錄確認被拒。直接以 Docker 執行映像觀察到的外連，只說明工具鏈的行為，不代表 Sandbox SDK、代理或
  Cloudflare 的網路政策。
- **建置與部署共用 `Sandbox` 類別，但不共用容器。** 建置的實例以 `buildId` 為 id；部署以
  `deploymentSandboxSessionId(storefrontId, releaseId)` 為 id。Cloudflare 憑證只放在部署那一次 `exec` 的環境
  變數中，不寫入工作區；兩者結束後都銷毀容器（部署在 `finally` 中）。共用類別的影響是外連設定相同：部署需要
  連到 Cloudflare API，所以不能直接關掉這個類別的外連。要先把建置拆成自己的類別並關閉外連；部署的類別也不應
  永久自由外連，應依它實際需要的目的地另定允許清單。這是獨立的工作，不隨 A2 完成而結束。

### 7.2 建置期的監聽 socket（inspector port）

【事實】adapter 為預先渲染起的 preview server 預設開 inspector port（9229，被占用時改用下一個）；只有 Theme 在
`cloudflare({...})` 設定 `inspectorPort: false` 時才不開（R2 報告 §4）。Morph 不替作者改這個設定（5.1 第 3 點）。

「容器外部連不到」**不是**安全理由：容器內的其他程序（包括 Theme 自己的建置期程式）連得到 localhost。依序處理
（0.4 第 2 項）：

1. 【待驗】找官方的停用方式，而且不改作者的產品設定。只影響建置工具、不改變產物的設定（例如建置程序層級的
   設定或環境變數）可能可以接受，但要先驗證它確實停用了這個 port，**而且產物逐檔雜湊與不設時相同**，才能下結論。
   目前還沒有找到這樣的方式。
2. 找不到、必須保留時，逐項確認並記錄：
   - 監聽位址（只在 loopback，不在 `0.0.0.0`）；
   - 這個 port 絕不被 Sandbox 對應或轉發到容器外；
   - 建置容器中沒有任何祕密（憑證、權杖、其他商店的資料）；
   - 建置結束後容器即銷毀，不重用於其他建置。
3. 記錄殘餘風險：容器內的程序在建置期間可以連到 inspector，取得預先渲染 Worker 的除錯能力。

**驗收**（A2、A4，真實 Sandbox 建置中）：列出建置期間實際的監聽 socket（位址、port、程序），**每一個都有已知用途**
（例如封存內容伺服器、preview server、inspector）。驗收標準不是「沒有其他 port 在聽」。

### 7.2.1 A2b 結果（2026-10-09，本機；不是 Cloudflare 驗收）

三層分開記錄，下層的結果不推論上層：

1. **Docker**：A2a 映像，`docker run`，R2 的 harness 原樣放進容器，Theme 從 `/opt/morph-toolchain/astro-7.3`
   解析套件，以 root 執行（同 Morph 的建置容器）。
2. **本機 Sandbox 路徑**：一個使用 `@cloudflare/sandbox`（Morph 使用的版本）的 Worker，以本機 `wrangler dev`
   用同一份映像啟動容器，經 SDK 的 `exec` 執行同樣的情境；外連設定是 SDK 預設（`enableInternet` 開），與
   Morph 目前的建置容器相同。
3. **Cloudflare**：未驗，要等部署（部署需要使用者另外核准）。本機 `wrangler dev` 的網路是本機模擬，不代表
   Cloudflare 的容器網路與外連政策。

harness 與原始結果：`~/projects/astro-spike/a2b-sandbox/`（`results/docker-*`、`results/sandbox-*`）。

**上游錯誤與升級。** 14.3.3 映像在 Docker 中，無網路（`--network none`）時 12 個情境全部與本機相同；有網路
（bridge）時建置失敗，`ECONNREFUSED 127.0.0.1:<port>`。原因是上游錯誤
[withastro/astro#18056](https://github.com/withastro/astro/issues/18056)：預先渲染的 preview server 綁在 `localhost`
（解析為 `::1`），而 adapter 以 `http://localhost:<port>` 連線時解析到 `127.0.0.1`。由
[withastro/astro#18057](https://github.com/withastro/astro/pull/18057) 修正，發布於 `@astrojs/cloudflare` 14.3.4：
改用 server 實際綁定的位址組網址。決定：升級工具鏈，不在 Morph 中繞過（例如改 `/etc/hosts` 或包裝 adapter）。
升級只改 `sandbox/toolchains/astro-7.3/` 的 `package.json`、lockfile 與重新產生的 `theme-toolchains.generated.ts`
（Astro 工具鏈識別改變；Start 與平台的識別不變）。lockfile 的變化：adapter 14.3.3 → 14.3.4、`@astrojs/internal-helpers`
0.12.0，另多兩個巢狀位置（internal-helpers 與 `yaml`），安裝位置 383 → 387。

**情境結果。** 14.3.4 映像：

| 層                       | 網路                            | R2 的 12 個情境 |
| ------------------------ | ------------------------------- | --------------- |
| Docker                   | `--network none`                | 全部與本機相同  |
| Docker                   | bridge                          | 全部與本機相同  |
| 本機 Sandbox 路徑（SDK） | SDK 預設（`enableInternet` 開） | 全部與本機相同  |

12 個情境是 R2 的正常建置、無快照、500、連線被拒、拿掉標頭送達與路徑情境，各自在 fail-fast 與只靠建置後檢查下
（比對建置與檢查的結束碼、錯誤代碼、兩頁 HTML 的值）。另一個 `inspector-default`（不設 `inspectorPort`）兩層都
建置成功，用來觀察 9229。

**建置期間的監聽 socket（本機 Sandbox 路徑）。** 每一個都有已知用途：

| 位址與 port                  | 程序                           | 用途                                                                    |
| ---------------------------- | ------------------------------ | ----------------------------------------------------------------------- |
| `127.0.0.1:4401`             | R2 harness 的 node             | 封存內容伺服器（Morph 中由建置程式提供）                                |
| `127.0.0.1`、`::1` 臨時 port | `astro build`（node）          | adapter 為預先渲染起的 preview server                                   |
| `127.0.0.1` 臨時 port        | 工具鏈中的 `workerd serve`     | miniflare 的 workerd 入口                                               |
| `127.0.0.1:9229`             | `astro build`（node）          | inspector，只在 `inspector-default` 情境（7.2 第 2 點的情況）           |
| `0.0.0.0:3000`               | `/container-server/sandbox`    | Sandbox SDK 的容器控制伺服器（`exec` 經它執行），建置之前與建置期間都在 |
| `127.0.0.3:41209`            | 容器內看不到（屬於另一個容器） | 本機 `wrangler dev` 的 `proxy-everything` sidecar 的外連入口            |
| `:::39001`                   | 容器內看不到（屬於另一個容器） | 同一 sidecar 的 ingress（`--http-ingress-address 0.0.0.0:39001`）       |

最後兩項的證據：從 host 檢查時，Sandbox 容器的 `NetworkMode` 是 `container:<proxy>`，與映像
`cloudflare/proxy-everything` 的 sidecar 共用網路命名空間；sidecar 的指令列是 `--http-egress-port 41071
--http-ingress-address 0.0.0.0:39001`，它自己的 `/proc/net/tcp` 列出同樣的 `127.0.0.3:41209`、`0.0.0.0:3000`
與 `:::39001`。這兩個是本機模擬的一部分，Cloudflare 上是否有對應的程序要部署後才知道。另有幾筆 loopback 位址上、
與上表同 port 類別的 socket 沒有對應到程序（取樣時程序已結束），不另列用途。Docker 層的清單只有前四類，全部在
loopback。

Morph 的建置路徑沒有呼叫 `exposePort`，以上沒有一個被 Morph 對應到容器外；本機 sidecar 的 ingress 與 Cloudflare 的
轉發方式不在這次驗證範圍內。

**外連。** 只記錄「嘗試」，不推論政策。14.3.3 映像在 Docker bridge 下以外連記錄 hook 觀察：唯一的外部嘗試是
Node 端連 `workers.cloudflare.com:443`。建置 log 顯示這是 miniflare 取得 `Request.cf` 物件；無網路時印出
「Unable to fetch the `Request.cf` object! Falling back to a default placeholder」，建置照樣成功，12 個情境的結果
不變。所以建置本身不需要外連；建置容器的外連關閉（#160 列為部署前的 blocker）不會讓這些情境失敗，但仍要在
關閉後的真實建置中確認。

**沒有驗證的：** Cloudflare 上的容器網路、外連政策與 sidecar；以非 root 執行；Morph 自己的 Astro 建置程式
（A3、A4）。

## 8. 交付順序與閘門

每一步各自一個 PR，各自有本機驗收；任何一步都不宣稱 Cloudflare 驗收完成。閘門沒有通過，就不開始下一步。
Astro 相關的開關（伺服器端 `MORPH_ASTRO_THEMES=1`）預設關閉，正式環境一律拒絕，直到 A8。

### 8.1 獨立研究：不受 G0 阻擋

G0 阻擋的是「接入 `main`」與「對使用者開放」，不阻擋研究。下列實驗可以先做，條件是：

- 在 Morph repo 之外，或在不合併的分支上進行；**不接進 `main`**，不改產品程式碼；
- 結果寫成報告（作法同預覽報告），附可重現的指令與原始結果；
- 不宣稱 Astro 已支援，也不改變任何認證狀態；
- 不使用遠端 Cloudflare 資源。需要本機 E2E slot 或容器的實驗，與其他工作協調後再跑。

| 實驗 | 內容                                                                                                                                                                                               | 結果決定什麼                                     |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| R1   | `.astro` 解析器在實際 Worker 中的可行性與位置精度（3.1 的樣本清單）                                                                                                                                | 3.3 的注入位置；`.astro` Design 是否延後         |
| R2   | Astro 預先渲染的標頭送達、只套用在 `prerender` 環境的包裝、workerd 連到 loopback（4.3 的三項前提）；最簡單的 Theme 加上 `session: false` 與 `imageService` 後，產物不含 `SESSION`、`IMAGES`（5.2） | 4.3 的設計是否成立；第一版能否建置最簡單的 Theme |
| R3   | 預覽 Worker entry 包住 Astro 入口時，2.5 表中的串流、重新導向、Cookie、錯誤頁、HMR 是否保持不變                                                                                                    | 2.5 採用首選還是備案                             |

R1–R3 有任一項的結論是「不可行」，就先更新本文件，再談接入。

結果（2026-10-07）：

- **R1：完成。** compiler-rs 加官方 `wasm32-wasi` binding 可行並選定，`@astrojs/compiler`（Go）否決（3.1）。
  未涵蓋：與 Morph 主 Worker 合併後的記憶體，由 M1 量測。
- **R2：完成。** 4.3 的三項前提在本機 miniflare 成立，`session: false` 加 `imageService` 的產物不含 `SESSION`、
  `IMAGES`。本文件依 R2 報告 §5 修正了九處，並記錄了 0.4 的決定。未涵蓋：Sandbox 容器，由 A2 驗證。
- **R3：尚未進行。**
- **M1（8.2 的閘門，以 8.1 的研究條件在 G0 之前先量，2026-10-08）：不通過。** 解析器放不進 Morph 主 Worker 的
  isolate（3.1）。量測工具在 Morph repo 之外，沒有接進 `main`，也沒有改變產品行為。
- **M1c（0.3 的決定之後，以 8.1 的研究條件在本機量，2026-10-08）：本機完成。** 專用解析器 Worker 依 0.3 的設計條件
  實作，機制如預期；解析器 isolate 的記憶體 GC 後在限內、GC 前的取樣在多個條件下超過 122.1 MiB（3.1、M1c 報告）。
  只用本機 workerd，沒有部署，沒有使用遠端資源。**本機通過不開啟 L2**；雲端驗證是 8.2 的 M1c-C。
- **M1c-C（使用者核准部署、執行、清理後，2026-10-08）：通過**（3.1、`~/projects/astro-spike/m1c-cloud/M1C-C-REPORT.md`）。只使用名稱明確的測試
  資源，執行後刪除；資料、腳本與三次執行的原始紀錄在 `~/projects/astro-spike/m1c-cloud/`。

R1、R2、M1、M1c 的證據（`~/projects/astro-spike/r1-parser/`、`~/projects/astro-spike/r2-prerender/`、
`~/projects/astro-spike/m1-morph-memory/`、`~/projects/astro-spike/m1c-parser-worker/`）保留到本文件已記錄結論，
**而且** A2 的 Sandbox 驗證完成為止。

### 8.2 接入步驟

| 步驟   | 內容                                                                                                                                                                                    | 閘門（通過才能進入下一步）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G0** | 原生 Start 內容配對驗收（不屬於 Astro，但是 Astro 接入 `main` 與開放的前提；不阻擋 8.1 的研究）                                                                                         | 真實容器中：（1）Build Preview 顯示封存的草稿；（2）發布重用預覽過的 build，產物雜湊相同；（3）build 之後草稿又被修改，發布時重新建置，或被 `PUBLISH_BUILD_CONTENT_MISMATCH` 拒絕；（4）兩個並行的建置或發布不會配錯內容，OCC 拒絕落後的一方；（5）回滾後店面的 build 與內容一起回到舊版。**本機真實容器驗收（2026-10-07，#137，`MORPH_NATIVE_START_BUILD=1`）**：`e2e/native-publish-acceptance.spec.ts`（SSR 加上讀內容的預先渲染靜態頁，build 記為依賴）涵蓋（1）、（3）、（5），以及（2）的「發布不再建置、release 用的就是預覽過的那個 build」，產物雜湊沒有另外比對；（4）在容器中驗的是 build 之後、發布送達前另一方改了草稿，由最後的 OCC 以 `TEMPLATE_DRAFT_CONFLICT` 拒絕、D1 不變、不重試，Core 處理途中的草稿變更以 DAL 測試涵蓋；兩個同時進行的建置沒有另做容器驗收。`e2e/native-content-dependency.spec.ts` 涵蓋證明為不依賴的 build 的純內容發布與回滾。細節見 `docs/start-native-import-plan.md` 第 3 步。未驗：Cloudflare 部署環境                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| M1     | Morph 主 Worker 的解析器記憶體預算（3.1）：把 compiler-rs 加 `wasm32-wasi` binding 與 Morph 自己的載入器放進 Morph 主 Worker 的 bundle，量測                                            | 量到並記錄：合併後的 bundle 大小與啟動時間（1 秒上限內）；Morph Worker 本身的記憶體加上 61 MiB 底線與檔案大小上限內的 AST，是否在 128 MB isolate 內；trap 後重建實例的行為。放得下才進入 A1、A2；放不下時停下，由使用者在 0.3 的選項中決定（另一個 Worker 是新的部署單位，需要核准）。**結果（2026-10-08）：不通過**，Morph 處理過 SSR 請求後 72.8 MiB，加上解析器即 135.2 MiB（3.1、M1 報告）。使用者已在 0.3 決定：首選專用解析器 Worker，備案 Sandbox 容器中的官方 Node 解析器                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| M1c    | 專用解析器 Worker 的本機實驗（0.3 的設計條件，3.1）：本機 workerd 中 core 與解析器兩個 Worker 以 service binding 連接，不部署                                                           | 量到並記錄：slot 先於讀 body、等待數與等待時間的上限與拒絕、串流讀取時的位元組上限（不信任 `Content-Length`）、回應序列化的保護；同樣大小不同形狀（大量小節點、解析器允許的最深巢狀、長字串、無效語法）；並行 1、2、4、8（admission 開與關）；連續大檔；369 KB 壓力只經另一個入口；trap 後恢復（重複，且檢查之後的結果是否正確）；經過 binding 的大小與時間；GC 前後的記憶體（定義同 M1，確認 Wasm 不重複計算）。每個條件多次，記錄機器負載。**結果（2026-10-08）：本機完成**（3.1、M1c 報告）。**M1c 本機通過不開啟 L2**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| M1c-C  | **部署後的解析器 Worker 的雲端驗證（正式閘門）。** 解析器 Worker 是新的部署單位，部署需要使用者另外核准；核准之前不進行                                                                 | 以部署的解析器 Worker（沒有 route，只經 service binding；沒有 D1、R2 或部署相關的 binding）重做 M1c 的情境：100 KB 的各種形狀、單一 slot 下的並行與連續請求、trap 與毒化。以 Cloudflare 自己的記錄判定（Workers Metrics 的記憶體、超過記憶體上限的錯誤或 isolate 被終止、錯誤率），不以本機數字推估；要回答 128 MB 如何計算（GC 前或後、shared Wasm memory 是否計入）、毒化的 isolate 何時被回收、雲端的 trap 門檻、冷啟動與實例化時間。通過條件：上述負載下沒有任何記憶體上限錯誤或因記憶體被終止的 isolate，trap 一律得到明確錯誤。前提：128 MB 是每個 isolate 的上限，由該 isolate 中所有並行請求共用，包含 JS heap 與 Wasm；序列化降低峰值但控制不了 GC 時機，本機通過不能證明部署後留在上限內。**通過之前，L2（使用解析器 Worker 的步驟）與 A7 的解析器部分都不得使用它**；不通過時改走 0.3 的備案。**結果（2026-10-08）：通過**。判定依 Workers Logs 的 invocation outcome，逐請求對帳；每一種合法負載至少 3 輪完整、`exceededMemory` 為 0（3.1、M1c-C 報告）。128 MB 的計算方式、毒化 isolate 的回收、冷啟動仍未回答；正式部署解析器 Worker 仍要使用者另外核准                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A1     | 框架身分：`ThemeFrameworkId` 加入 `astro`、build 輸入記錄框架、`nativeBuildResult` 與預覽 runtime 依記錄選 adapter、Start 原生建置的共用部分搬到共用模組。只有 Start 一個實作，行為不變 | 既有測試、Start 的 E2E 不變；新增測試：build 輸入的框架被改動時 `inputHash` 也會改變；`theme-framework.test.ts` 的介面規則仍然成立。**結果（2026-10-08，本機）**：`storefront_theme_builds.framework`（migration 0075，可為 NULL）記錄框架；NULL 是框架被記錄之前的 build，由 `resolveThemeFramework` 讀成 TanStack Start，這是唯一做這個對應的地方。materializer 把框架寫進 build 輸入，只有不是 Start 時才算進 `inputHash`，所以既有 build 記錄的 `inputHash` 不變。materializer、兩個建置程式、`nativeBuildResult` 與兩個 Live Preview 傳輸都依紀錄選 adapter；`astro` 與未知值在任何工作區或容器之前以 `THEME_FRAMEWORK_UNAVAILABLE`／`THEME_FRAMEWORK_UNKNOWN` 拒絕，不退回 Start。Live Preview 的輸入可以帶框架，但網站層級的紀錄要到 multi-runtime 第 6 步才有，目前沒有呼叫者傳入。新增測試：框架改變時 `inputHash` 改變（反向驗證過：拿掉雜湊中的框架後該測試失敗）、未紀錄與 Start 的雜湊相同、既有 build 的雜湊仍相符、`astro` 被拒且 runner 不執行；`theme-framework.test.ts` 未修改且通過。`pnpm typecheck`、`typecheck:data`、`test`、`build`、`check:e2e-assertions`、`check-e2e-shards`、`check:migrations` 通過。真實容器 E2E（`MORPH_NATIVE_START_BUILD=1`）一次：`native-content-dependency` 通過，`native-publish-acceptance` 走完步驟 1–5 後，步驟 6 的建置容器啟動失敗（`SandboxError: Container failed to start`，`stage: sandbox-runtime`；該 build 已通過 materializer，`framework` 為 NULL），測試等不到發布而失敗；當時未重跑。原因查明是 #149 的啟動重試在真實 RPC 下從未生效（錯誤跨 Durable Object RPC 後只剩訊息），由 #155 修正。**修正後補驗（2026-10-08，本機，負載 2.5→4.6）**：A1 分支合併含 #155 的 `main` 後，同樣兩個 spec 在真實容器跑一次，4 個測試全數通過，`native-publish-acceptance` 走完發布、過期發布被拒、並行編輯與回滾                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A2     | 工具鏈「框架 × 版本」：多工具鏈根目錄、產生器、映像、本機 `toolchainProblem` 依 adapter 判斷                                                                                            | Start 工具鏈的內容雜湊不變；Astro 工具鏈從自己的根目錄解析到 Vite 8；量測映像大小、Node 版本與容器冷啟動時間；Morph 鎖定的 compiler-rs 與工具鏈中 `astro` 依賴的版本相容。**真實 Sandbox 中**：預先渲染 Worker 連得到建置程序的 loopback（4.3 前提 3）；R2 的失敗情境（無快照、500、連線被拒、拿掉標頭送達，各自在 fail-fast 與只靠建置後檢查下）結果與本機相同；7.2 的監聽 socket 清單。**A2a 結果（2026-10-09，本機；只代表基礎設施完成，不代表 Astro 已驗收）**：工具鏈分成 `/opt/morph-toolchain/tanstack-start-1.168`、`/opt/morph-toolchain/astro-7.3` 與平台的 `/opt/morph-platform`，各自 `package.json`＋lockfile，映像以 digest 固定基礎映像並以 `npm ci` 安裝，寫入工具鏈清單（2.2.1）。Start 的 lockfile 鎖定 2026-10-03 映像的套件樹：基線 168 個安裝位置在 17 個欄位逐一一致，`npm ci` 另多裝 6 個 musl 版可選原生套件（npm 10.9.8 的 lockfile 不記 libc），已測的載入情境使用 glibc 版；完整安裝樹不完全相同（證據：`~/projects/astro-spike/a2-toolchain/LOCK-A-REPORT.md`）。乾淨的 5 天後 `npm install` 有 10 個間接依賴漂移，證明原本未鎖定的安裝不可重現。不用快取重建映像，三套識別相同。Astro 工具鏈解析到 Vite 8.3.3、Start 仍是 Vite 7.3.5；Morph 鎖定的 compiler-rs（0.5.1）與 `astro` 要求的 `^0.5.0` 相容，有測試。migration 0076 加入 `input_hash_format` 與 `toolchain_id`，legacy build 不回填。真實容器 E2E（`MORPH_E2E_TRANSPORT=cloudflare-sandbox`，新映像）：`native-publish-acceptance`（建置、預先渲染、Build Preview、發布、過期發布被拒、並行編輯、回滾）與 `native-content-dependency` 通過；`build-preview-isolated` 在三份 spec 一起跑時於 `enableSelection`（預覽已渲染、選取按鈕 10 秒內未出現）失敗一次，單獨重跑通過，記為間歇性失敗、未修正；第一次執行在另一個 session 的 vitest 同時執行（負載 14）時於 Live Preview 前置檢查逾時。執行期間建置、Build Preview 與 Live Preview 容器內的程序只映射了 `tanstack-start-1.168` 下的 glibc 原生二進位（rollup、兩份 lightningcss、tailwind oxide），musl 為 0；依容器類別的歸屬未確認（Build Preview 容器也看到 Start 工具鏈的二進位，原因未查）。映像：未壓縮 1.421 → 1.913 GB；gzip 壓縮（拉取大小的近似）整個映像 472 → 748 MB、基礎映像以上的層 252 → 529 MB；容器啟動（`docker run` 到 `/bin/true`）與 Start 工具鏈 `vite --version` 的時間在誤差內相同。映像中留有 npm 快取（舊 442 MB、新 186 MB），未在 A2a 移除；之後每個 `npm ci` 改用同一 RUN 內刪除的快取目錄，映像不再有 npm 快取，未壓縮 1.914 → 1.726 GB，三套識別不變（2026-10-09，本機）。未量：Cloudflare 上的拉取與冷啟動。**A2b 結果（2026-10-09，本機 Docker 與本機 Sandbox 路徑；Cloudflare 未驗）**：`@astrojs/cloudflare` 14.3.3 在有網路的容器中因上游錯誤（withastro/astro#18056，preview server 綁 `::1`、連線用 `127.0.0.1`）建置失敗，工具鏈升到修正版 14.3.4；升級後 R2 的 12 個情境在 Docker（無網路與 bridge）與經 `@cloudflare/sandbox` 的本機 `wrangler dev` 中全部與本機相同，前提 3 在這兩層成立；建置期間的監聽 socket 每一個都有已知用途，包括 SDK 的控制伺服器與本機 `proxy-everything` sidecar 共用網路命名空間的兩個 port；建置唯一的外部嘗試是 miniflare 取 `Request.cf`，連不到時退回預設值、建置成功（7.2.1）。Cloudflare 上的網路、外連政策與 sidecar 要等部署 |
| A3     | 預先渲染內容的可行性，以真實建置測試驗證（形式同 `src/lib/storefront/compiler/native-start-runner.test.ts`）                                                                            | R2 已在本機證明可行，A2b 已在 Docker 與本機 Sandbox 路徑確認 loopback（Cloudflare 未驗，7.2.1）；4.3 的三值測試全部符合：HTML 是封存的 A，不是預設值 D 或目前草稿 B；內容接口失敗（無快照、500、連線被拒、拿掉標頭）一律讓建置失敗，不退回預設值，fail-fast 與建置後檢查各自有效；記錄以每次建置的 nonce 綁定；`ASTRO_ADAPTER_INCOMPATIBLE` 與「stamp 數不等於預先渲染頁數」各有會觸發它的測試；4.3 的路徑測試清單全部通過；失敗的建置沒有產物，成功的產物中沒有包裝標記、`.prerender/`、`.morph/` 診斷檔。**任一項不成立就停止**，回到設計層。**結果（2026-10-09，本機真實建置；Sandbox 與 Cloudflare 未驗）：通過**（4.3.1）。三值測試的 HTML 是 A；四種失敗情境在 fail-fast 與只靠紀錄下各自失敗；nonce、`ASTRO_ADAPTER_INCOMPATIBLE`、stamp 數不符各有會觸發它的測試；`trailingSlash` 三種設定與中文路徑通過；失敗的建置留下 `.prerender/`，成功的沒有洩漏。與閘門文字的差異：判定由 `astroPrerenderRecordsFailure` 做，還沒有接進 `nativeBuildResult` 與 runner，因為 `astro` 要到 A4 才有框架 adapter；接入列為 A4 的工作。另一項決定：`build.format` 只支援 `"directory"`（4.3.1）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| A4     | Astro 原生建置（本機建置程式，再到 Sandbox 建置程式）：包裝設定檔、匯入防護、產物整理、5.2 的規則、manifest、compiler 身分                                                              | 官方 Astro Cloudflare 範例以 fixture 原樣保存（`fixtures/astro/<example>/`，附 `SOURCE.json` 與逐檔雜湊，作法同 tanstack fixture），能建置的部分建置成功，不能的以 `KNOWN GAP` 斷言（例如 `SESSION`）；最簡單的 Astro Theme 加上 `session: false` 與 `imageService` 後建置成功，5.2 每一條拒絕規則各有一個會觸發它的測試；匯入防護放行專案別名與 Astro 虛擬模組，拒絕未核准的套件與工作區外的檔案                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A5     | Astro 的 Build Preview、發布、回滾，跑 G0 同一組驗收                                                                                                                                    | 真實容器中 G0 的五項對 Astro 全部通過；`SESSION` 的處理方式已決定並實作（基礎設施對應，或明確的替代方案）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| A6     | Astro Live Preview（本機 sidecar，再到容器）：啟動程式、預覽包裝設定、Worker entry、無 router 的 client module、整頁重新載入的內容更新與選取恢復                                        | 經過真實的 `preview.tsx` 與 `/applyFiles`：`.astro` 修改的 `applied` → 重新 `ready` 流程正確，選取能恢復；2.5 表中的回應行為（串流、重新導向、Cookie、錯誤頁、HMR）在真實路徑上不變；第 7 節的安全探測（沒有 `.wrangler/state`；列出預覽容器實際的監聽 socket，每一個都有已知用途，標準同 7.2；容器政策記錄顯示外連被拒）；冷啟動時間與 Start 比較                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A7     | `.astro` 檔案語言：能在 Morph Worker 中執行的解析器、來源位置、實例識別、props、改寫                                                                                                    | R1 已選定解析器；解析器的執行位置已依 0.3 決定（專用解析器 Worker），M1c-C 已通過；3.1 的五項採用條件都已實作並各有測試；`request-structure` 的 `nodes` 不為空；完整 Design 鏈（選取實例 → 欄位 → 文件儲存（權限、文件版本、OCC）→ 該實例更新、其他實例不變），同一元件出現兩次各自編輯                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A8     | 認證                                                                                                                                                                                    | A4–A7 通過，ISR／SSG 經 Core 的快取行為驗收（multi-runtime 計畫的規則），該「Astro × 版本」才轉為 Certified；在那之前是 Unverified，可以 Live Preview 與 Build Preview，不能發布                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

2026-10-08 調整（多框架計畫「支援層級」）：A6 的 Design 先做 L1.5 點選定位，在預覽容器的 Vite 流程注入來源位置，
點選後跳到 Code，內容以 `.fields.ts` 欄位編輯；A7 是 L2，需要 Morph 控制的可信解析（專用解析 Worker，
0.3），要等解析 Worker 的雲端驗證（M1c-C）之後。L1.5 的位置來自執行 Theme 的預覽容器，不能作為儲存授權或改寫安全
的證據。A1、A2 與 L1.5 可以先推進，但不宣稱 L2 可用。

順序的理由：先處理資料完整性（內容配對、發布、回滾，A3–A5），再處理編輯體驗（A6–A7）。在 A3 之前就做
Live Preview，可能做完才發現 Astro 的預先渲染沒辦法安全地讀封存內容。

**G0 之後的順序（2026-10-07 決定）：G0 → M1 → A1 → A2。**

1. M1：量測 Morph Worker 給解析器的記憶體預算。**已量（2026-10-08）：不通過**；使用者已在 0.3 決定解析器的位置，
   M1c 已在本機完成，M1c-C（雲端驗證）**2026-10-08 通過**（8.2）；正式部署解析器 Worker 仍要使用者另外核准；
2. A1：框架身分改由 build 記錄（上表），仍在 A2 之前；
3. A2，包括在真實 Sandbox 中驗證建置容器的 loopback 可達性，以及 R2 的同一組失敗情境；
4. R1、R2 的證據留在 `~/projects/astro-spike`，直到本文件記錄了結論，而且第 3 步的 Sandbox 驗證完成。A2b（2026-10-09）只完成本機的兩層，Cloudflare 層要等部署，所以證據繼續保留；A2b 的 harness 與結果（`~/projects/astro-spike/a2b-sandbox/`）同樣保留。

## 9. 未決事項與未驗證項目

### 9.1 未驗證（本文件的結論不依賴它們成立，但相關步驟的閘門依賴）

- **容器路徑**：`cloudflare-sandbox-vite-preview-server.ts` 與 Sandbox 建置程式，在 Astro 下完全沒有執行過
  （沒有第二套工具鏈的映像）。
- **經過 Core 的路徑**：預覽 proxy、`preview-host` 判斷、本機 sidecar 的 `/applyFiles`、Build Preview 的
  `bp-` 主機、店面的 service binding，都沒有讓 Astro Worker 實際走過。
- **真實的編輯器**：預覽報告用的是 harness，不是 `preview.tsx`；選取、反白、行內編輯、重新排序都沒測過
  （B5 解決之前也無法測）。
- **Vue**：元件修改的 HMR；React 與 Vue 混用時的 `$RefreshSig$`（這次 console 沒有出現，但沒有修改 Vue
  元件，不能據此判定問題已消失）。
- **啟動時間與 Start 的比較**：Astro 冷啟動約 15–16 秒，Start 在同一台機器、同一形態下的數字沒有量。
- 預覽中 adapter 覆寫後，`SESSION`、`IMAGES` 綁定是否仍然存在；`remoteBindings: false` 的實際效果。
- 4.3 的前提 3 在 **Sandbox 容器**中是否成立：建置程序與 workerd 是否在同一個網路命名空間、外連政策是否攔截
  loopback（A2）。前提 1、2 與本機 miniflare 上的前提 3 已由 R2 實測成立（0.1）。
- 4.3 的設計以 Morph 自己的程式碼實作後的行為：`createNativePrerenderContent`、共用 request handler、
  `nativeBuildResult`、`ThemeRouteRegistry`（R2 用的是重寫的簡化版本，A3）。
- `build.concurrency > 1` 時，包裝以 `AsyncLocalStorage` 區分每一頁讀取的歸屬；`getStaticPaths` 動態路由；
  `trailingSlash`、`build.format` 的非預設設定（R2 只測了預設值）。
- 包裝看不見的外連（`connect()` 等）；「回應無法解析」（`unparseable`）的分支沒有對應情境。
- `imageService: "compile"` 的建置期圖片處理（R2 的 Theme 沒有使用圖片，A4）。
- 2.5 的前提：Astro dev 的請求是否經過 wrangler `main`；包裝後串流、重新導向、Cookie、錯誤頁、HMR 是否不變（R3）。
- 正式 Cloudflare 環境中的 128 MB 如何計算（M1c-C 只依 invocation outcome 判定，沒有讀到平台的記憶體數字）、shared
  Wasm memory 如何計入、Wasm 編譯快取、雲端的 trap 門檻（M1c-C 只有兩個樣本）、毒化的解析器 isolate 何時被回收；登入後的編輯器與
  Design 請求時 Morph isolate 的記憶體（M1 只量了公開的 SSR 請求）；以解析位置產生 patch 再解析的往返；pnpm
  `supportedArchitectures` 在 Morph workspace 中的實際效果（R1 報告 §6、M1 報告 §4、M1c 報告 §5）；0.3 的備案
  （Sandbox 容器中的官方 Node 解析器）沒有量。
- 不改作者設定、又能停用建置期 inspector port 的官方方式（7.2）。
- Morph 的 dependency enforcer、`themePreviewContentPlugin`、SVG 隔離、root-public plugin 在 Astro 下的行為。
- `loadWranglerEnv` 讀取的檔案；Astro 遙測在無網路環境中的行為。
- `assertThemePrerenderArtifacts` 的路徑規則與 Astro `build.format` 的對應（與 4.3 的內容鍵對應合併處理）。
- Astro Worker（`no_bundle`、`rules`、`nodejs_als`）在 Morph 部署規劃與 Build Preview 執行器下能否正常執行。

已由 R1、R2、M1 回答、移到【事實】的項目：`session: false` 與 `imageService` 後產物不含 `SESSION`、`IMAGES`；
`@astrojs/compiler-rs` 有能在 workerd 中執行的 Wasm binding（官方 `wasm32-wasi`）；`@astrojs/compiler`（Go）的
位置精準度（有偏差，已否決）；解析器與 Morph 主 Worker 合併後的記憶體（放不進）、bundle 大小與本機啟動時間；
專用解析器 Worker 在本機的記憶體、同一個 isolate 中的並行與 admission、trap 後沿用或重建實例的結果（M1c：沿用在
第 94 次 trap 失效，重建每次留下約 13–22 MiB RSS）。

### 9.2 未決事項（需要決定）

- 第一版的 Sessions：不提供，要求作者設定 `session: false`（R2 已確認這樣能建置）；或等基礎設施對應，或先為每個商店
  提供一個 Morph 擁有的 KV namespace。在提供之前，官方範例原樣匯入無法建置。
- 第一版的圖片：要求 `imageService: "passthrough"` 或 `"compile"`，或對應 Cloudflare Images。
- Theme 程式自行使用的快取（Cache API 等）在回滾後的行為：要不要在執行期以 release 隔離 Theme Worker 的快取
  範圍。這不是 Astro 特有的問題，Start 也一樣。
- 映像策略：一個映像多個工具鏈根目錄，或每個框架一個映像（A2 量測後決定）。
- 解析器已選定（3.1），執行位置已決定（0.3，2026-10-08）：專用解析器 Worker，備案 Sandbox 容器中的官方 Node 解析器。
  M1c-C 已用測試資源在雲端通過（2026-10-08）。**待使用者核准**：正式部署解析器 Worker（新的部署單位）；之後 L2
  才能使用它。
- 預先渲染頁看到的多餘標頭要不要由包裝清掉；`ORIGIN_MISSING` 是否要區分「伺服器不在」與「標頭沒送到」（0.3）。
- 是否向 Astro 上游提出「預先渲染請求可以帶標頭」的選項。如果上游接受，4.3 的包裝可以移除。
- 6.2 的「applied 帶寫入路徑」是否要做，以及 Vite payload 能不能提供觸發檔。
- 建立網站時的框架選擇介面（multi-runtime 計畫第 5 步），以及 Astro starter Theme 的內容讀取函式放在哪裡、
  叫什麼名字。
- `output: "static"`（沒有 Worker）的 Astro 網站要不要支援，以及支援時對應到哪一種產物。
