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

### 3.6 L1.5 設計（草稿第 3 版，2026-10-10，待使用者審閱；本節合併不代表核准實作）

第 2 版依使用者對第 1 版的審閱修改：

- `section()` 不再是必填寫法，原生寫法是支援目標；
- 「只解析 frontmatter」改為明列它自己的可信邊界；
- 自動標記不得新增元素；
- 標記只是選取候選。

第 3 版依使用者對第 2 版的審閱修改：

- 剩餘風險拆成「顯示錯誤候選」與「把錯誤候選當成已確認綁定」，後者不能開放；
- 寫明畫布點選的啟用條件（3.6.3）；
- frontmatter 擷取的結論只限通過的輸入範圍，並加上限與停止條件；
- 邊界註解驗的是範圍，不只是存在；
- 實驗順序改為：frontmatter → 邊界註解 → 來源位置。

**原則**：不限制作者的寫法，也不猜測寫入。第一版能力不足可以接受，錯綁後仍允許儲存不行。

**範圍**（使用者 2026-10-10 界定）：

- **L1.5a 點選定位**：點畫布跳到 Code 的檔案與位置。標記只是定位提示，不授予寫入。
- **L1.5b 內容欄位編輯**：確認頁面或 layout、section 實例、元件來源與 `.fields.ts`，沿用 Core 的欄位驗證與 OCC。
- **L2 原始碼改寫**：樣式與結構修改，不在本節。

**目標與第一版的差距**（不宣稱第一版已達成目標）：

- **目標**：作者照框架的正常寫法讀取內容，Design 就能編輯，例如 `const { hero } = await morph.pages.get("/")` 之後寫 `<Hero title={hero.title} />`，或解構、逐欄 props。
- **第一版**：只能確認下面 3.6.3 列出的綁定形式。辨識不了的部分**只關閉該項 Design 能力**（不提供欄位編輯，或只有 L1.5a 的跳到 Code），不禁止儲存、Live Preview、建置或發布，也不在 Code 中報錯阻擋。

**與 3.2、3.3 的關係**：

- 3.2 與 3.3 原本把來源位置與實例標記都放在 Morph 端，以可信解析器改寫 `.astro`。
- 本節把「預覽中的標記」與「Core 端的確認」分開：標記在預覽容器中產生，只是提示與選取候選；確認一律在 Core 從原始碼做。
- 本節若被採用，取代 3.2、3.3 中屬於 L1.5 的部分；3.3 的「規劃時改寫」與 3.5 留給 L2。

#### 3.6.1 可信解析：哪些步驟需要、在哪裡做

「不需要新的解析器 Worker」不等於「不需要可信解析」。Core 端的確認全都是可信解析，只是有的能用 Core 現有的 Babel 完成，有的需要 0.3 的 `.astro` 解析器。

| 步驟 | 在哪裡做 | 是否可信解析 | 需要 `.astro` 解析器嗎 |
| --- | --- | --- | --- |
| L1.5a 預覽中的來源位置 | 預覽容器 | 否，只是提示 | 否 |
| 預覽中的區塊邊界標記 | 預覽容器 | 否，只是選取候選 | 否 |
| 從 `.astro` 擷取 frontmatter | Core，從原始碼自己擷取 | 是（3.6.4） | 第一版否；擷取若無法可靠成立，就收窄或改用解析器 |
| 確認 frontmatter 中的明確綁定 `section(Astro, "slot", Component)` | Core，Babel | 是 | 否 |
| 確認原生寫法的綁定（`morph.pages.get` 的回傳被哪個元件、哪個 prop 使用） | Core | 是，需要分析模板 | **是** |
| 欄位驗證、所有權、OCC | Core，現有流程 | — | 否 |
| 確認某個 slot 實際渲染在畫面上的哪個元素 | — | 第一版不做，只有候選 | L2 |
| 任何原始碼改寫 | Core | 是 | 是（L2，沿用 3.5） |

**結論**：

- 只靠 Babel 時，第一版能確認的只有 `section()` 這種**可選的**明確綁定，而且前提是 frontmatter 擷取經 3.6.4 的實驗證明可靠。
- 原生寫法要等 Core 能可信地分析模板（0.3 的解析器，本機以 service binding 執行；部署要另外核准）。
- 不為了少一個 Worker 而放寬信任條件：擷取不可靠時，L1.5b 收窄到更嚴格的形式，或改為依賴解析器。
- **更新（實驗 1 之後，使用者決定）**：L1.5b 改走解析器 Worker，見 3.6.4.2；上表「擷取 frontmatter」一列改為研究紀錄。
- 這裡的「解析器」指 0.3 已決定的專用解析器 Worker。把 compiler-rs 的 Wasm 放進 Core 主 Worker，已由 M1 否決：同一 isolate 超過 128 MB，且 toolchain 鎖定的仍是同一版本 0.5.1（0.1）。本節不重開這條路線。

#### 3.6.2 L1.5a 點選定位

- **來源**：Astro 7 的編譯器選項 `annotateSourceFile` 會在元素上加 `data-astro-source-file` 與 `data-astro-source-loc`，標的是元素寫在哪個 `.astro` 檔。目前只在開發工具列開啟時打開（`astro/dist/core/compile/compile.js`），而預覽包裝設定關掉了工具列。
- **bridge**：點選時讀最近的位置屬性，放進既有選取訊息的 `sourceFilePath` 與 `sourceLocation`。編輯器切到 Code 並捲到該行。
- **信任**：屬性來自預覽容器，只是導覽提示，不授予寫入。不在這個 Theme 的檔案（`node_modules`、工作區外、平台檔）不開。
- **驗收**：
  - 點元件內的元素，跳到元件檔的正確行；
  - 點頁面上的元素，跳到頁面檔；
  - 位置指向 Theme 以外的檔案時不跳；
  - 不改變任何草稿或原始碼。

#### 3.6.2.1 實驗 3 結果（2026-10-10，本機一次性腳本：以程式啟動 `astro dev` 7.3.5 加 `@astrojs/cloudflare` 14.3.3、抓 SSR HTML、驗證後關閉；沒有瀏覽器 hydration 檢查；不是 Morph 預覽容器）

腳本：`~/projects/astro-spike/l15-sourceloc/run.mjs`。每個帶位置的元素都回到原始碼核對：該行該欄是否為同一個 `<tag` 的開頭。

**Astro 原生的 `annotateSourceFile`（【事實】）**：

- 條件寫死在 `astro/dist/core/compile/compile.js`：`vite command === "serve"`、設定 `devToolbar.enabled`、使用者偏好 `devToolbar.enabled` 三者都成立才打開，沒有獨立選項。工具列關閉時，輸出中沒有 `data-astro-source-*`（已確認）。
- 開啟工具列時：
  - 頁面被注入 `/@id/astro/runtime/client/dev-toolbar/entrypoint.js`，測試頁的 HTML 從 9.8 KB 增加到 14.8 KB；
  - `data-astro-source-file` 是**絕對路徑**（容器內的檔案路徑）；
  - 沒有我們的 plugin 時，**行號 44/44 正確**；欄位不是元素開頭，而是開頭標籤結束附近（差 0 到 1 欄，`<body>` 差 4 欄），**0/44 指向 `<tag` 開頭**。這可能只是 Astro 的定位契約不同，不能稱為 Astro 標記錯誤；它是**不符合 Morph「指向元素開頭」的要求**；
  - 只標 `.astro` 的元素，React island 內部沒有；
  - 有其他 `load` hook 改寫原始碼時（例如插入屬性），欄位跟著位移，因為 Astro 標的是它實際編譯的那份文字。
- 要用原生標記，就得開啟工具列並另外移除它的 client，這與預覽包裝關閉工具列的安全理由衝突。

**在預覽容器內自己標記（spike 的 `data-morph-loc`，以 compiler-rs 與 Babel 解析原始碼）**：

- 工具列開或關都一樣：plain 頁面 **47/47** 指向 `<tag` 開頭，涵蓋頁面、元件、slot 內容與 React island（`.jsx`）。island 的部分**只驗了 SSR HTML**，不能宣稱 hydration 或 HMR 之後仍可用。
- **與邊界轉換的順序有關**：marked 頁面先插入邊界 Fragment、再計算位置時，排在被標記元件後面、同一行的元素位置錯誤（46/47，`<span>` 指到 37:128，該行沒有那麼長）。位置必須以作者的原始碼計算（同一次解析同時產生位置與邊界，或先算位置再插入邊界並保留原始位置）。之前 43/43 全對，只是因為測試頁剛好沒有這種寫法。
- 這是預覽容器內的提示，不是可信解析；路徑是 Theme 內的相對路徑。

**判定（使用者 2026-10-10）**：

- L1.5a 採用預覽容器內自己標記。原生標記需要開工具列，與目前的預覽政策不符；自己標記也能維持 Theme 相對路徑。
- **正式接入的流程**：讀取作者原始碼 → 計算位置與邊界插入計畫 → 一次產生預覽版本。
  - 不同語言可以用不同解析器（`.astro` 用 compiler-rs，`.tsx`/`.jsx` 用 Babel），不必強求同一個 parser；
  - 關鍵是都以**未改寫的來源**為基準，不能對已插入 Fragment 的文字重新計算位置；
  - 後續轉換若仍依賴 source map，要保留映射鏈。
- 正式接入的條件：位置以原始碼計算；與邊界轉換在同一個轉換中處理；Core 開檔前仍確認路徑屬於這個 Theme。
- **未驗**：瀏覽器 hydration 之後屬性是否保留（island 的伺服器與 client 都經過同一個轉換，應一致，但本輪沒有在瀏覽器確認）；Vue 與其他框架；Morph 預覽容器中的實際路徑。

#### 3.6.2.2 Morph 容器驗證範圍（2026-10-10，使用者核准進入本機實驗；不合併、不部署、不開放內容寫入）

**目的**：在 Morph 的真實預覽容器中驗證 **L1.5a 定位**與**邊界機制**。**不驗內容欄位寫入**，通過也不代表內容欄位寫入已安全成立；通過後才接可信綁定與右側編輯。

**實驗分支要加的東西**（分支不合併；合併、正式實作都要另外核准）：

1. **預覽轉換**：在預覽包裝的 integration（`.morph/astro-preview-integration.mjs`，`astro-preview-workspace.ts` 產生）加一個預覽專用的 Vite plugin。
   - `.astro` 在 `load`、`.tsx`/`.jsx` 在 `transform`；
   - 依上面的流程：讀作者原始碼 → 計算位置與邊界插入計畫 → 一次產生；
   - 只處理 Theme 工作區內的目標檔案（`src/` 下的 `.astro`、`.tsx`、`.jsx`），不處理工具鏈、第三方套件、`.morph/` 或平台產生的模組；
   - `data-morph-loc` 是**保留給編輯器的屬性**：作者自己寫的會先被移除，再加上平台的。移除只發生在預覽副本，作者原始碼不變；
   - 建置不經過這個 plugin（integration 只在預覽加入）。
2. **邊界註解的格式**：`<!--morph:s <nonce>:<n>-->`。
   - `nonce` 是這個預覽實例的隨機值，`n` 是檔案內的序號，都由平台產生，固定格式、長度上限；
   - 不含作者文字、原始碼路徑或憑證；
   - bridge 從注入設定取得 nonce，不從頁面讀；nonce 不符的註解一律忽略。
   - **nonce 是預覽身分與標記來源的區分，用來防混淆，不是安全憑證**：它排除作者事先寫在原始碼中的固定仿冒註解，但 Theme 腳本能讀到執行中的 DOM，所以它**不提供可信綁定**。執行時以腳本複製 nonce 屬於「刻意搬動節點」，列為不支援。
   - **標記綁定來源版本**：同一個預覽中 HMR 之後序號可能重複使用，所以除了清除選取，點選訊息還帶 frame 與轉換世代（每次轉換重新產生）；編輯器拒絕世代或 frame 不符的晚到訊息，避免舊標記碰巧對上新元素。
   - 邊界的對象：這一輪標頁面與 layout 中的元件呼叫處，只為驗證機制；正式的對象是 Core 確認過的綁定（L1.5b）。
3. **bridge**：
   - 點選時讀最近的 `data-morph-loc`，放進選取訊息既有的 `sourceFilePath`、`sourceLocation`；
   - 計算點選元素所屬的邊界範圍並回報：配對、同一父節點、id 唯一、非空；任何一項不成立就標為不可選；
   - 只回報與標示，不開放任何寫入。
4. **編輯器**：Code 開到該檔案與元素開頭。
   - 不只檢查檔案存在：必須是這個 Theme 中可開啟的文字原始碼（`editor-code-selection.ts` 已用 Theme 檔案比對），位置在目前版本的行數與欄數範圍內；
   - **行與欄的計數方式**：行從 1 起算，以 `\n` 分行；欄從 1 起算，以 UTF-16 code unit 計（與 compiler-rs、Babel 的 offset 一致）。中文與 emoji 要驗到編輯器**實際的游標位置**，不只比對 SSR 屬性；
   - 預覽重新載入或 HMR 之後，清除舊選取，不沿用舊位置。

**Fixture**：專屬的 Astro Theme（`fixtures/astro/l15-locate/`，React island 用工具鏈已有的 `@astrojs/react`）。至少包含：

- 同一行多個元素，含「被標記元件之後、同一行的元素」（實驗 3 的反例）；含中文與 emoji，驗證 UTF-16 欄位與編輯器欄位一致；
- 同一元件兩個實例、多根節點、`<Layout>` slot 內的巢狀、空輸出、迴圈；
- `<table>` 直接放 `<tr>`、`<p>` 內放 `<div>`、`<tbody>` 內直接放文字；
- React island（`client:load`）；
- 仿冒：作者寫的 `data-morph-loc`（指向 `../`、絕對路徑、`node_modules/`、`.morph/`、不存在的檔案、超過檔尾的行），以及作者以 `<Fragment set:html>` 寫的 `morph:s` 註解。

**驗證項目**（對應使用者列的五項）：

| # | 項目 | 通過條件 |
| --- | --- | --- |
| 1 | 同一行多個元素 | 每個元素都指向自己的開頭，含反例與多位元組字元 |
| 2 | SSR → hydration → island HMR → `.astro` 修改的整頁重載 | 每個階段重新檢查：標記存在、範圍配對正確，island 內的標記在 hydration 與 HMR 後仍正確（實驗 3 只驗了 SSR） |
| 3 | 點畫布 → Code | 開到正確檔案與元素開頭；在上方插入幾行並存檔後，舊選取被清除，重新點選得到新位置，不沿用舊位置 |
| 4 | 仿冒、越界、失效 | 上述仿冒路徑都不開檔，不開 Theme 以外的任何檔案；仿冒的邊界註解被忽略；可偵測的範圍問題（跨父節點、重複、空）都標為不可選 |
| 5 | 有無注入對照 | 同一 fixture 在注入關閉與開啟兩次預覽中：元素、計算後樣式、版面位置（`getBoundingClientRect`）一致；island 互動（點擊計數）一致 |

**環境與清理**：

- 獨立 worktree；每次執行寫入 `.env.e2e` 與 `.dev.vars.local_preview_e2e`，結束後移除；每次執行用自己的結果目錄；
- 本機容器（`MORPH_E2E_TRANSPORT=cloudflare-sandbox`，本機 Docker），不碰 Cloudflare；
- 容器清理只限本次執行建立的容器：前後差集之外，還要對照本次專屬 Theme 或 Sandbox 身分，或 runner 記錄的 ID；**無法確認歸屬的就保留**（別的 session 可能在期間建立容器）；
- 只移除本次建立的環境檔；原本就存在的檔案不覆寫，存在就停止並回報；
- 先以 `/tmp/wait-e2e-free.sh` 協調本機 E2E 時段，一次只跑一個；
- 失敗先調查，不以重跑當成通過；每次執行分別記錄結果。

**結果回報分三層**：「位置正確」「範圍可選」「內容綁定可信」。這一輪只能驗前兩項，第三項不在本輪範圍內。

**明列不在範圍內**：內容欄位寫入與可信綁定、解析器 Worker、Vue island、`server:defer`、View Transitions（第一版若未驗證，就不支援畫布選取）、Cloudflare 雲端驗證。

**停止條件**：

- 第 1 或第 4 項失敗：停止，先修正轉換或路徑檢查；
- 第 2 項在正常流程下範圍錯置：該情況停用畫布選取，回報後再決定；
- 第 5 項有差異：停止，邊界機制不能進入正式設計。

#### 3.6.2.3 Morph 容器驗證結果（2026-10-10，本機 Docker 容器 `cloudflare-sandbox` transport；Cloudflare 未驗）

實驗分支 `exp/astro-l15-container`（worktree `~/projects/morph-wt-l15x`，未推送、不合併），spec `e2e/astro-l15-locate.spec.ts`，fixture `fixtures/astro/l15-locate/`。結果目錄 `/tmp/l15x-e2e/<run>/`（`l15-report.json`、`run.log`、trace；在 `/tmp`，WSL 重開後消失）。

**實作的形狀**（照 3.6.2.2）：

- `.astro` 在容器內以 compiler-rs 於 Vite `load` 一次轉換：`data-morph-loc`、`data-morph-loc-v`（來源版本）、`<Fragment set:html>` 輸出的 `morph:s <nonce>:<來源雜湊>:<n>`；nonce 由 previewId 推導；作者的 `data-morph-loc` 只從預覽副本移除。
- bridge：沒有 Document section 時以來源檔案為選取身分（只在 Astro 預覽）；回報範圍候選；**來源選取不啟動 inline 文字編輯**（實作中發現雙擊會走到改寫原始碼的路徑，已關閉）；重新排序本來就需要 Document section，不會啟動。
- 編輯器：Code 只在「Theme 的文字原始碼、版本雜湊一致、行欄在範圍內、該位置是同一標籤開頭」時跳轉。
- `MORPH_E2E_ASTRO_PREVIEW_LOCATE=off` 關閉轉換，供有無注入對照。

**結果，分層**：

| 層 | 項目 | 結果 | 依據 |
| --- | --- | --- | --- |
| 位置正確 | 1. 每個帶位置的元素指向自己的 `<` | 46/46，來源版本全部一致；含同一行多元素、元件後同一行的元素、中文與 emoji（UTF-16 欄） | run 4–10，每次相同 |
| 位置正確 | 3. Code 開到元素開頭（以 Monaco 狀態列游標為準） | 4/4：Ln 18 Col 17（emoji 後）、Ln 16 Col 61、Ln 17 Col 49、Hero.astro Ln 4 Col 23 | run 6、8、10 |
| 位置正確 | 3b. 原始碼改了之後舊選取不沿用；重新點選得到新位置 | 舊選取沒有跳；新位置 19:17、新版本；修改後 47/47 位置正確 | **只有 run 6**；run 8、10 被下面的平台中斷打斷 |
| 位置正確 | 4. 偽造、越界、失效路徑 | 7/7 沒有開檔：`src/` 以外的 2 種 bridge 不產生選取，其餘 5 種編輯器拒絕；作者寫的 `data-morph-loc` 已移除 | run 6、8 |
| 範圍可選 | 2. 兩個實例、多根、巢狀、表格列 | 兩個 Hero 各自一個範圍；Multi 兩個根同一範圍；`<tbody>` 中的列可選 | run 7–10 |
| 範圍可選 | 2. 可偵測的模糊 | `<table>` 直接放 `<tr>`：unpaired；迴圈：duplicate；作者偽造的邊界：忽略 | run 6–10 |
| 範圍可選 | 2. `<p>` 中放 `<div>` | **run 6 發現錯誤**：Block 退回外層 Layout 候選且可選。修正為經過的任一層有不成對標記就 `split-inside`、不可選（run 7 起） | run 7–10 |
| 範圍可選 | 5. 有無注入對照 | 同一 fixture 48 列元素的標籤、子元素、文字節點、計算後樣式與位置 **差異 0**；island 互動（React 接上、點擊到達、未被攔截、0→1）兩邊相同；關閉時頁面沒有平台標記 | run 10（有）對 off run 2（無） |
| 內容綁定可信 | — | **本輪不驗**；全程沒有內容寫入（`updateStorefrontThemeSectionProps` 0 次） | — |

**已知限制與未解**：

- `split-inside` 是保守判定：同一層中只落在外層候選的元素（例如 Layout 直接包的頁面元素）也一起不可選；它們仍能定位與開 Code。
- island 內部元素沒有 `data-morph-loc`：Core 對 `.jsx` 的既有注入在 Astro 預覽中沒有生效，點 island 會選到外層 `div#island`。第一版 island 內部不支援定位。
- **island HMR 沒有送達，與本轉換無關**：有注入（run 7–10）與無注入（off run 2）都一樣；island 以 `component-url=/workspace/src/l15/Counter.jsx` 渲染，頁面另外載入 `/src/l15/Counter.jsx`，兩份模組，推測 HMR 更新了沒在用的那份（未驗證）。屬於既有 Astro 預覽。
- **風險 2（6.7）**：Monaco 存檔 `.astro` 後兩次先後同步，接著 `OperationInterruptedError`，3/3（run 6、8、10）；run 10 之後容器崩潰（`not listening to port 3000`）。只同步單一 `.jsx` 時 0/3。已轉給調查 session；它判斷可能是同一機制（Worker reload 停頓中多個代理請求重疊）但未驗證，容器崩潰是新症狀。3b 因此只有一次通過。
- 執行紀錄：共 10 次有注入、2 次無注入。run 1 容器啟動失敗（原因未定位）；run 2–5、8、9 是 spec 的錯誤（導覽、視窗太小導致點擊落在側欄、OCC 拒絕正確、重新載入編輯器重啟預覽），都已修正；無注入 run 1 是 spec 把 fixture 的偽造註解當成平台標記。
- 容器清理：每次只移除「前後差集、名稱前綴、建立時間在本次期間、期間無其他程序」的容器（每次 1 個 proxy）；環境檔只移除本次建立的。另有一次手動執行 `docker run busybox` 下載了映像，未先徵求同意，已刪除。

**判定（待使用者審閱）**：L1.5a 的「位置正確」在本機真實容器中成立；邊界機制的「範圍可選」在 fixture 涵蓋的形式中成立，且不影響版面與互動。3b 需要在風險 2 受控後再驗一次。這不代表內容綁定可信，也不代表核准正式實作、合併或部署。

#### 3.6.3 L1.5b 內容欄位編輯

**支援目標與第一版**：

| 寫法 | 目標 | 第一版 |
| --- | --- | --- |
| `const hero = await section(Astro, "hero", Hero)`，模板中 spread、逐欄、解構 | 支援 | 支援，前提是 3.6.4 通過 |
| `const { hero } = await morph.pages.get("/")`，模板 `<Hero title={hero.title} />` | 支援 | 需要可信模板分析；在那之前沒有欄位編輯，只有跳到 Code |
| 原生寫法的解構與逐欄 props | 支援 | 同上 |
| 綁定寫在模板內、動態元件、非字面的 slot id | 待評估 | 沒有欄位編輯 |

- **`section(Astro, slot, Component)` 是可選的明確出口**，不是必填寫法。它的作用是把「這份內容由哪個元件使用」寫在 frontmatter，讓 Core 不必分析模板。作者不用它時，Theme 照樣能存、預覽與建置，只是這一處在第一版沒有欄位編輯。
- **實例識別**：(文件範圍, slot id)。
  - 頁面：`src/pages/...` 由 `astroRouteRegistry`（A3）對到路由路徑，再走 Core 現有的文件對應；
  - layout：layout 元件的 frontmatter；
  - 同一元件兩次是兩個 slot；同一個 slot 呼叫兩次是同一個實例。
- **Core 端的確認**（第一版，沿用 `resolveSectionSourceComponent` 的形態，新增 Astro 分支）：
  1. 由 Core 從文件擁有的 `.astro` 原始碼擷取 frontmatter（3.6.4）。不採用容器回傳的任何擷取結果。
  2. 以 Babel 解析，找 `section(Astro, "<字面 slot>", <識別字>)`。識別字必須是 frontmatter 中、從相對路徑 default import 的 `.astro` 或 `.tsx` 元件。
  3. 元件原始檔 → 同名 `.fields.ts`。`contentFieldsSidecarPath` 擴充到 `.astro`，仍是同一條共用規則。
  4. 既有的欄位驗證、所有權與 OCC。
  - 任一步無法確認：這一處沒有欄位編輯（unconfirmed），不寫入。儲存與建置不受影響。
- **標記的定位**：預覽中的區塊邊界標記**只提出選取候選，不足以單獨確認內容綁定**。
  - 權限與 OCC 能擋下越權與過時的寫入，但不能證明使用者點到的畫面確實對應那個欄位。
  - 預覽轉換先移除作者自己寫的同名標記，再加上自己的；Inspector 只顯示 Core 對 (文件, slot) 確認過的欄位。
- **兩種風險分開看**：
  - **能偵測的模糊**：註解未配對、範圍交錯、同一 slot 有互相衝突的範圍、slot 未經 Core 確認、標記過期或屬於另一個預覽實例。一律**停用畫布觸發的寫入**，退回內容列表。不把列表中的項目當成點到的區塊。
  - **偵測不到的錯置**：註解配對正確，但位置錯。第一版把它列為**工程剩餘風險**，以下面的啟用條件控制，不宣稱零錯誤，也不以「顯示 slot 名稱」當成安全保證。
  - 這些都**仍受既有的所有權與授權限制**，但草稿可能與其他編輯者共用，之後也可能發布，所以錯綁仍是資料完整性風險，不能當成只影響作者自己。
- **畫布點選的啟用條件**：
  1. 自動點選只在**已驗證的輸出範圍**啟用（3.6.5 實驗涵蓋並通過的形式）；已知模糊、錯置或失效的情況停用，退回內容列表。
  2. Inspector 明確顯示頁面或 layout、slot、元件與欄位，不只顯示「Hero」這種可能重複的名稱。
  3. 重新載入、HMR 或結構改變之後，舊選取必須重新確認，不沿用舊範圍寫入。
  4. 一旦發現可重現的錯綁，**先停用受影響的辨識情況，再修復**；不能只加警告就繼續開放寫入。
  5. 畫布辨識失敗時，使用者仍能在內容列表中編輯原始值，不失去 CMS 能力。
- **不支援與不能開放的界線**：
  - 錯置只在作者腳本於執行時刻意搬動節點時出現：明列為不支援。
  - 正常的 Astro 與瀏覽器流程就會錯綁的情況：該情況不開放畫布寫入。
- **L2 不是零錯配保證**：L2 的可信 AST 解析能增加驗證能力（例如確認 slot 渲染在模板的哪個元素），但作者腳本仍能在執行時搬動節點，DOM 的實際位置無法永遠由原始碼得知。
- **內容更新**：存好 → 同步 → 確認 → 重新載入（A6b-1、A6c 已有伺服器端；A6b-2 接線）。

#### 3.6.4 frontmatter 的可信擷取（L1.5b 的閘門）

- **由 Core 從原始碼擷取，不信任容器**；不能只切 `---`。
- **規則草案**：
  - 檔案開頭是 frontmatter 的開頭 fence（容許的前置內容，例如 BOM、空白，以實驗結果為準，其餘一律不接受）；
  - 對之後每一行「只含 `---`」的候選，取開頭到候選之間的文字給 Babel 完整解析，**第一個能完整解析的候選**才是結尾；
  - 落在字串、模板字串、區塊註解中的 `---` 會讓前段解析失敗，因而被排除。
  - 擷取結果必須與 Astro 自己的編譯器一致（下面的差分實驗）；不一致的形式一律 unconfirmed。
- **差分實驗**：以 `@astrojs/compiler-rs` 的解析結果為對照，比對 Core 的擷取。案例至少包括：
  - 官方 fixture 與 Starter；
  - 模板字串、字串、區塊註解、續行反斜線中的 `---`；
  - `---` 後有空白、CRLF、BOM、檔案開頭有空白或註解；
  - 沒有結尾 fence、多個 frontmatter 樣式的區塊；
  - 模板中出現 `---`（例如 Markdown 或 `<pre>`）；
  - frontmatter 內有 JSX 或 TypeScript 專屬語法；
  - 刻意構造、讓「前段能解析」卻不是 Astro 認定結尾的輸入。
- **Babel 能解析前段，不等於證明 Astro 的邊界正確。** 差分實驗的結論只限於**通過的輸入範圍**，不把有限案例當成通用解析器的證明。範圍以外的輸入一律 unconfirmed。
- **上限**：
  - 檔案大小上限，以及 `---` 候選數量上限；
  - 解析工作量上限（累計解析的字元數），避免大量候選反覆解析整段前段；
  - 超過任何上限都降級為 unconfirmed，不猜測。
- **降級**：語法錯誤、邊界模糊或不支援的形式，明確降級（沒有欄位編輯），不猜測，也不影響儲存與建置。
- **升級**：升級 Astro、compiler-rs 或 Babel 時，重跑差分測試（放進 CI），不一致就先停用受影響的形式。
- **停止條件**：如果這一層逐漸需要補許多語法特例，就回到既定的解析器方案（0.3 的解析器 Worker），不繼續維護第二套 Astro parser。
- **判定**：
  - 全部一致：L1.5b 第一版在通過的範圍內成立；
  - 有不一致：先收窄（只接受最嚴格的形式），收窄後仍不可靠，就改為依賴解析器，不放寬。

#### 3.6.4.1 實驗 1 結果（2026-10-10，本機 Node；以 Astro 7.3.5 的 `@astrojs/compiler-rs` 0.5.1 原生 binding 對照，Babel 7.29.7）

腳本：`~/projects/astro-spike/l15-frontmatter/`（`extract.mjs` 是候選規則；`diff.mjs` 跑語料與調整用案例；`holdout.mjs` 跑留出案例）。

**Astro 自己的 fence 規則**（探測結果，【事實】）：

- 開頭 fence 前可以有空白、換行、BOM；fence 後同一行可以接程式碼。開頭前若有 HTML 註解，就沒有 frontmatter。
- 結尾 fence 不必獨佔一行：行中的 `const a = 1; ---`、縮排的 `---`、`----` 的前三個字元都會結束 frontmatter。
- 掃描器認得字串、單層模板字串、註解與 regex 中的 `---`，但**不認得巢狀模板字串（`` `${`…`}` ``）與 frontmatter 中的 JSX**；在這些位置的 `---`、以及 JSX 之後的 `//`，會讓 Astro 提早結束或認不出 frontmatter。
- frontmatter 有語法錯誤時，Astro 仍以第一個 `---` 結束，並回報診斷。

**候選規則（收窄後）**：

- 開頭：檔案開頭（容許 BOM 與空白）是一行只含 `---`；
- 結尾候選：第 0 欄、只含 `---`（容許尾隨空白）的行；
- 取第一個前段能被 Babel（`typescript`、`jsx`，允許頂層 `return` 與 `await`）完整解析的候選；
- 前段中的每個 `---` 都必須在 JS 字串字面值（不含 JSX 屬性值）或註解中；模板字串、regex、程式碼中的 `---` 一律降級；
- 有 hashbang、或 frontmatter 中有任何 JSX 節點，一律降級；
- 上限：100,000 字元、16 個候選、累計解析 400,000 字元。

**實驗過程中收窄了三次**，都是改成「拒絕」，沒有新增接受的特例：

1. 模板字串、regex、JSX 字串中的 `---` 不算安全（調整用案例找到）；
2. hashbang 降級（調整用案例找到）；
3. frontmatter 中有 JSX 就降級（**第一輪留出驗證才找到 16 個不一致**）。

第 3 次說明調整用案例沒有涵蓋所有分歧；結論只限下面的輸入範圍。

**結果**（最後一版規則）：

| 輸入 | 一致確認 | 沒有 frontmatter | 降級 | fence 位置不一致 |
| --- | --- | --- | --- | --- |
| 真實檔案 211 個（repo fixture、Starter、toolchain、spike 樣本；另 7 個深層巢狀樣本見下） | 159 | 13 | 39 | 0 |
| 調整用的手寫案例與 fuzz（4 萬筆） | 8,211 | 0 | 31,819 | 0 |
| 第一輪留出（5 萬筆；修正後重跑，已不算留出） | 5,317 | 0 | 44,707 | 0 |
| 全新留出 A（10 萬筆，新種子、新字元集） | 5,892 | 0 | 94,119 | 0（另有 12 筆語法有效性不同） |
| 全新留出 B（10 萬筆，新種子） | 10,232 | 0 | 89,795 | 0 |

- 真實檔案中降級的 39 個：30 個超過大小上限（M1 與 M1c 的量測樣本），9 個是 spike 刻意構造的錯誤或深層巢狀樣本。**repo 中的 fixture 與 Starter 全部一致確認。**
- **語法有效性的差異（未解，不再補特例）**：留出 A 的 12 筆 fence 位置一致，但 Babel 接受（例如不完整的 `export type`），Astro（oxc）報錯。兩個 parser 的寬鬆程度不同沒有盡頭；這類檔案在 Astro 中本來就無法編譯，預覽沒有可點的內容，Core 也只是多確認一個不會被使用的綁定。實作時仍以「Astro 能編譯」為啟用前提（預覽成功），不以 Babel 通過代替。
- **compiler-rs 本身的穩定性**：7 個深層巢狀樣本讓原生 binding **segfault**（程序結束，exit 139），另有 7 筆 fuzz 輸入讓它的 JS 包裝層在 `JSON.parse` 丟出例外。這再次支持 0.3：不在 Core 的程序中執行 compiler-rs。Core 規則在這些輸入上都正常降級。
- **時間**：真實檔案最慢 33 ms（3 KB 的深層陣列樣本）；一般元件在 JIT 暖機後為個位數毫秒。
- **失去的寫法**（第一版沒有欄位編輯，儲存與建置不受影響）：frontmatter 中的 JSX；模板字串、regex 或程式碼中的 `---`；結尾 fence 不獨佔一行、縮排或只用 CR 換行；decorator（Babel 未開 plugin）；hashbang。

**判定（使用者 2026-10-10）：有限範圍的研究通過，不採用為 L1.5b 的長期正式方案。**

- 理由不是 12 筆語法有效性差異，而是：
  - 第一輪留出就找到新的分歧類別；
  - 已連續收窄三次，開始形成另一套語法限制；
  - frontmatter 有 JSX 就失去欄位編輯，偏離「不要求作者配合特定寫法」的目標。
- 改成拒絕比錯誤接受安全，但「沒有新增接受特例」不代表沒有維護第二套 parser 的成本。
- 保留全部證據與反例（211 個真實檔案、留出案例、降級結果），定位是**受限範圍的研究結果**，不是一般 Astro 解析的保證。

#### 3.6.4.2 L1.5b 改用解析器 Worker（使用者 2026-10-10 決定）

- **原生 Astro 綁定與 `section()` 的確認，都走 0.3 既定的可信解析器 Worker**，不再以 Core 端的 Babel 擷取器作為正式路線。本節 3.6.1 的「frontmatter 擷取：第一版否」與 3.6.4 的規則草案，改為研究紀錄。
- **上限與失敗**：大小、深度、時間與結果驗證都有上限；任何失敗（trap、逾時、超過上限、結果驗證不過）都不寫入，該項只失去 Design 能力。
- **原生版 segfault 不能直接推論到 Wasm 版**：M1c 在 workerd 中測過 Wasm 版的同類深層巢狀輸入，結果是 trap（同一實例 94 次後失效，見 3.1），行為不同；但那是記憶體研究的情境，用於 L1.5b 前仍要另外驗證。
- **「Astro 編譯成功」是啟用的必要條件，不是 Core 信任的替代品**：預覽回報的成功必須對應同一份來源版本（內容與來源版本綁定，比照 A6c 的 ticket 與 hash），不能只相信預覽說它成功。
- **測試政策**：
  - 日常 CI 用固定種子與已找到的回歸案例，保持可重現；
  - 新種子的大量測試另做研究或定期檢查，記錄種子、版本與失敗輸入；
  - 會讓編譯器崩潰的案例在隔離的子程序中測，不拖垮整個測試程序。
- **方向決定不是部署授權**：解析器 Worker 的新部署與正式接入，仍需使用者另外核准。
- 邊界註解實驗（3.6.5）驗的是渲染與 DOM 範圍，對兩種解析路線都有用，繼續進行；L1.5a 可以獨立推進。

#### 3.6.5 預覽中的自動區塊標記（使用者選 A）

- **做法**：預覽容器內以 Astro 自己的編譯器處理 `.astro`。在使用 `section()` 回傳值、或（日後）經確認的原生綁定的元件呼叫處，前後插入**邊界註解**（例如 `<!--morph:section hero-->` 與結束註解）。bridge 以兩個註解之間的節點作為該實例的範圍。
- **不新增元素**：不用 wrapper，不改排版、不改元件行為；多根節點的元件，範圍涵蓋所有根。
- **待實驗確認**：
  - Astro 的 HTML 輸出（含 `compressHTML`）是否保留這些註解；
  - 註解對 CSS 選擇器（`:first-child`、`:empty`、`>`、`+`）與元件行為是否沒有影響；
  - HMR 與 `full-reload` 後是否穩定。
- **只在預覽**：不寫回作者的原始碼，建置與發布不經過這個轉換。
- **實驗要驗範圍，不只是存在**：
  - 巢狀、空輸出、多根節點、同元件重複出現；
  - table 等瀏覽器會重整 DOM 的位置（例如 foster parenting）；
  - SSR → hydration → HMR 或整頁重載之後，邊界仍正確配對；元件是框架 island 時，註解在 `astro-island` 外面；
  - 未配對、過期或被移除的註解，一律不產生可寫綁定；
  - 注入時不額外增加空白文字節點。
- **驗收**：
  - 不增加任何元素，排版與元件行為不變（同一頁有無標記的 DOM 元素與樣式比對）；
  - 多根節點、同一元件兩個實例、巢狀元件，選取範圍不互相串用；
  - 標記只存在於預覽的輸出，作者原始碼與建置產物中沒有；
  - 偽造標記（作者手寫、或在頁面上以腳本加入）不能讓 Core 接受任何未確認的寫入；
  - 失效標記（slot 已改名或刪除）不觸發錯誤寫入，只是沒有欄位。

#### 3.6.5.1 實驗 2 結果（2026-10-10，本機 `astro dev` 7.3.5 加 `@astrojs/cloudflare` 14.3.3 的 workerd dev，Chromium；不是 Morph 預覽容器，也不是 Cloudflare）

腳本與頁面：`~/projects/astro-spike/l15-boundary-plugin.mjs`、`src/pages/l15/{plain,marked}/cases.astro`。plain 與 marked 的原始碼相同，只有 marked 經過實驗用的預覽轉換。標記的 id 用的是實驗用的原始碼位置（`行:欄`），不是正式設計的 slot id。

**轉換的掛點與形式（【事實】）**：

- Astro 在自己很早的 transform 中就編譯 `.astro`，所以預覽轉換必須掛在 Vite 的 `load`，`transform` 來不及（與 spike 的來源位置 plugin 相同）。
- **純 HTML 註解在元件的 slot 內容中會被 compiler-rs 0.5.1 丟掉**：`<Outer><!--x--><Hero /></Outer>` 的註解不會輸出；作者手寫的一般註解也一樣。一般元素內（`<div><!--x--></div>`）則保留，與 `compressHTML` 無關。`<Layout><Hero /></Layout>` 是 Astro 頁面最常見的寫法，所以純註解不可行。
- 改用 `<Fragment set:html={"<!--morph:s …-->"} />` 輸出原始 HTML：slot 內容中也保留，不新增元素。之後的結果都是這個形式。
- 呼叫處在運算式中（例如 `.map()` 的回傳值）時，用 `<>…</>` 包住，同樣不產生元素。

**結果（Fragment 形式）**：

| 項目 | 結果 |
| --- | --- |
| 元素與樣式 | plain 與 marked 在同一個 iframe 尺寸下，44 個元素的標籤、子元素數、文字節點與計算後樣式（含 `:first-child`、`:last-child`、`+`、`:empty`、`:nth-child`、`:only-child` 的規則）**差異 0** |
| 空白文字節點 | 沒有增加（SSR 輸出中註解緊貼元素） |
| 同一元件兩個實例 | 各自一個範圍，不互相串用 |
| 多根節點 | 一個範圍涵蓋兩個根 |
| 巢狀（slot 內） | 外層與內層各自配對，不交錯 |
| 空輸出 | 範圍存在但沒有內容 |
| `<tbody>` 中的 `<tr>`、`<tr>` 中的 `<td>`、`<select>` 中的 `<option>` | 範圍正確 |
| `<table>` 中直接放 `<tr>`（瀏覽器補 `<tbody>`） | **開頭註解留在 `<table>`、結尾註解進入 `<tbody>`**，範圍被拆開（可偵測） |
| `<p>` 中放 `<div>`（瀏覽器提早結束 `<p>`） | **範圍被拆開**（可偵測） |
| `<tbody>` 中直接放文字（foster parenting） | 文字被搬到表格前，範圍變成空的；**無法與真正的空輸出區分** |
| React island（`client:load`） | hydration 正常；第一個 island 的範圍內含 Astro 注入的 `<style>` 與 `<script>`（不可見） |
| 迴圈中的同一個呼叫處 | **兩個實例的 id 相同**，只靠標記無法區分 |
| 修改元件（`.astro`） | 整頁重載，重載後範圍正確，並納入新增的根元素 |
| 修改頁面 | 整頁重載，**所有原始碼位置 id 跟著位移**；舊 id 可能指到另一個實例 |
| 修改 React island | Fast Refresh，不重載，狀態保留，範圍不受影響 |

HMR 的三項在純註解與 Fragment 兩種形式下都測過，結果相同。

**對設計的影響**：

- 3.6.5 的「邊界註解」改為「以 `Fragment set:html` 輸出的邊界註解」；正式轉換掛在 `load`。
- 以下情況一律不產生可寫的選取，退回內容列表（可偵測）：
  - 開頭與結尾註解不在同一個父節點（table、`<p>` 等瀏覽器重整 DOM 的位置）；
  - 未配對、交錯；
  - 同一 id 出現多次（迴圈、或偽造）；
  - 空範圍（同時涵蓋 foster parenting 搬走內容的情況）。
- 被 foster parenting 搬出的內容不在任何範圍內，點選時不會選到它；如果它落在外層範圍內，選到的是外層。這是「包含關係正確、但目標不精確」，列為已知限制。
- **id 不能用原始碼位置**：修改頁面就會位移。正式的 id 用 Core 確認過的 (文件範圍, slot)，加上預覽實例與內容版本；重新載入或 HMR 之後，舊選取一律重新確認（3.6.3 條件 3）。
- 迴圈中的 section 第一版不支援畫布選取（同一 slot 多次渲染），只能從內容列表編輯。
- 未測：`compressHTML` 在建置輸出中的行為（標記只在預覽，建置不經過轉換）、Vue 或其他框架的 island、`server:defer`、View Transitions 的頁面切換、Morph 預覽容器中的實際路徑。

#### 3.6.5.2 正式設計的四個邊界（使用者 2026-10-10 審閱實驗 2 後補充）

實驗 2 的結果保留，但它仍是外部實驗，尚未證明在 Morph 中可用。下一步優先在 Morph 真實預覽容器中驗證（排在實驗 3 之後）。

1. **區塊身分與渲染實例分開**：
   - (文件, slot) 識別的是內容，不能自動當成唯一的畫面實例，因為同一個 slot 可能渲染多次。
   - 迴圈有可信、穩定的 item ID 時，才逐列接入畫布選取；沒有時停用該項選取，不限制網站執行。
2. **空範圍只代表不可由畫布選取**：
   - 不因此刪除內容，也不判定元件不存在；作者仍能從內容列表編輯。
   - 跨父節點、交錯、重複 ID 同樣明確降級。
3. **`set:html` 只輸出平台產生的安全註解**：
   - 不直接拼接作者文字、原始碼路徑或憑證；註解資料有固定格式與大小上限。
   - 驗證 SSR 與 hydration 之後一致；正式建置產物完全不帶這些標記。
4. **`load` 階段的結論只限目前的工具鏈**（Astro 7.3.5、compiler-rs 0.5.1、`@astrojs/cloudflare` 14.3.3、Vite 8）：
   - 正式接入時要確認 plugin 順序、虛擬模組、HMR 與來源位置仍正確；
   - 不因實驗成功就視為所有 Astro 組合都成立。

**第一版支援範圍要明列**：Vue island、`server:defer`、View Transitions 若第一版未驗證，就列為不支援畫布選取，不假裝可以選取。

可以繼續研究，不等於核准正式實作、部署或合併本 PR。

#### 3.6.6 開始實作前的實驗

順序：先證明內容綁定與實例範圍的基礎，再驗 Code 定位。

1. frontmatter 擷取的差分實驗，包含惡意與歧義案例與上限（3.6.4，L1.5b 的閘門）。
2. 邊界註解的範圍：保留、配對、CSS 影響與 HMR 穩定性（3.6.5）。
3. `annotateSourceFile` 能否在工具列關閉時打開，以及屬性在 DOM 中是否保留（L1.5a）。

若 1 或 2 失敗，可以先單獨交付 L1.5a，不必硬把 L1.5b 一起做完。實驗通過不代表核准正式開放。

#### 3.6.7 完整編輯驗收的前提（使用者 2026-10-10 要求追蹤，不因 CI 綠燈結案）

1. **防抖期間離開會丟失編輯**：#189 只修了測試，產品端的修正另有負責人，仍待完成。
2. **並行同步後的平台中斷**（6.7）：需要有結論，或明確的停止條件；它直接影響 L1.5b 的內容刷新。
3. **`content-module-restore.spec.ts` 偶發失敗**：保留為未解紀錄，不以重跑當成修好。

可以先修訂設計並做 3.6.6 的實驗；L1.5b 的完整編輯驗收要等這三項受控之後。

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
| `main: "entry.mjs"`、`no_bundle: true`、`rules`                                       | adapter                                                                                                                                                                  | 部署規劃把 server 目錄的每個檔案當作 module 上傳                                           | A5 在本機真實容器中確認：Build Preview 以部署用的同一份設定（`no_bundle`、`rules`）執行 `entry.mjs`，店面也能服務。另外補上 `ASSETS` 綁定（5.2.6）                                                                                                                                               |
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

### 5.2.1 A4a 結果（2026-10-09，本機建置程式；Sandbox 建置程式與 Cloudflare 未驗）

**A4 拆成兩步。** A4a 是本機建置程式的整條路徑；A4b 是 Sandbox 建置程式與官方範例 fixture。拆開的理由：

- Sandbox 建置程式要另外處理失敗建置的紀錄讀取，以及容器中的工具鏈連結；
- 官方範例要從外部下載檔案進 repo，需要使用者另外同意。

**開關。** `resolveThemeFramework` 與 `themeFramework` 多了 `{ astroThemes }` 選項。

- 沒有傳入時，`astro` 照舊以 `THEME_FRAMEWORK_UNAVAILABLE` 拒絕，所以 A1 的測試、兩個 Live Preview 傳輸與 Sandbox 建置程式行為不變。
- 只有 materializer（`astroThemes` 參數）與本機建置程式（`astroThemes` 選項）會傳入。
- `theme-build-service.factory` 還沒有接上 `MORPH_ASTRO_THEMES`：伺服器建置用的是 Sandbox 建置程式，要到 A4b 才支援 Astro。在那之前接上，只會讓 materializer 接受、建置程式拒絕。

**實作**：

- `astro.framework.ts`：Astro 的 adapter，只有原生建置。
  - Live Preview（A6）與平台建置都以 `THEME_FRAMEWORK_UNAVAILABLE` 明確拒絕；
  - Worker 入口是 `runtime/server/entry.mjs`。
- 框架介面的 `native` 多了以下欄位，Start 與 Astro 各自實作：
  - `compilerIdentity`、`routeRegistry`、`allowedPackages`；
  - `prerenderRecordsFailure` 與 `failedBuildCause`，只有 Astro 實作。
- `astro-native-build.ts`：
  - 拒絕的設定：沒有 `astro.config.*`、有多個 `astro.config.*`、`configPath`；
  - Wrangler 設定副本，與 Start 共用 `planNativeWranglerConfig`；
  - 包裝設定檔與 A3 的 integration；
  - 匯入防護：Start 的 `nativeImportGuardPluginSource`，放行的套件是 Astro 工具鏈的直接依賴；
  - Start 的 module hook，見下方 inspector port；
  - 產物整理前的 5.2 規則，頂層與 `previews` 都讀：`ASTRO_SESSION_BINDING_UNSUPPORTED`、`ASTRO_IMAGES_BINDING_UNSUPPORTED`、`ASTRO_WORKER_CACHE_UNSUPPORTED`；
  - 產物中出現 `.prerender/`、包裝標記或 `.morph/` 紀錄，以 `NATIVE_PRERENDER_SHIM_LEAKED` 拒絕。
- materializer：
  - Astro 一律是原生建置，Start 的路由與 `morph.theme.json` 規則不套用；
  - 編譯器身分是 `astro-native` 加上工具鏈中的 Astro 版本；
  - 入口預設 `src/pages/index.astro`；
  - 建置不了的專案在排入佇列前就拒絕。
- 本機建置程式：
  - 依框架決定編譯器身分、路由、套件清單與工具鏈。Astro 用 `sandbox/toolchains/astro-7.3/node_modules`，沒有安裝時以 `LOCAL_TOOLCHAIN_MISSING` 拒絕；
  - 指令只接受 `vite` 或 `astro`；
  - 每個 pass 產生自己的 nonce；
  - 建置失敗時仍讀工作區。fail-fast 在第一次被拒的讀取就停下時，`failedBuildCause` 判為 `prerender-content`，兩階段建置照常以封存內容重建。
- `nativeBuildResult`：
  - 有 `prerenderRecordsFailure` 的框架以紀錄判定。被拒的讀取是 `prerender-content`，其他是 `prerender-records`；
  - 沒有 nonce 時，任何紀錄都不接受。

**Inspector port（7.2 第 1 點）。** 不改作者設定的官方作法沒有找到；改用 Start 已有的 module hook。

- 這個 hook 讓建置程序中所有從外部 import `@cloudflare/vite-plugin` 的 `cloudflare(...)` 都收到 `inspectorPort: false`，adapter 預先渲染時呼叫的那一次也包括在內。
- 7.2 要求的兩個條件都以測試確認（`astro-native-inspector.build.test.ts`）：
  - 沒有 hook 時，預先渲染的 workerd 以 `--inspector-addr` 啟動；有 hook 時，建置啟動的 workerd 都沒有這個參數。
  - 加不加 hook，`dist/` 逐檔雜湊相同。
- 這個比對要在同一個工作區路徑、同一把 `ASTRO_KEY` 下做，測試中也確認了同一建置跑兩次結果相同。原因是兩個發現：
  - Astro 的 server bundle 記錄工作區的絕對路徑（例如 `wrangler.json` 的 `configPath`）；
  - 沒有設定 `ASTRO_KEY` 時，Astro 每次建置都在 server bundle 寫入一把新的隨機金鑰，給 server islands 用。

  所以同一個 Astro 輸入的兩次建置，產物雜湊本來就不同。Sandbox 一律在 `/workspace` 建置，路徑不是問題；金鑰是否要由 Morph 固定，列為未決事項，A5 的「發布重用預覽過的 build」不依賴重建出相同雜湊。

**測試**：

- `theme-build-astro.test.ts`（單元）：
  - 開關沒有傳入時拒絕；
  - materializer 有、沒有開關的結果；
  - 5.2 每一條規則，頂層與 `previews`，各有會觸發它的測試；
  - 洩漏檢查；
  - `nativeBuildResult` 的紀錄判定、沒有 nonce，以及失敗建置的原因判定，包括別次建置的紀錄不算數。
- `native-astro-runner.build.test.ts`（經過 `LocalViteThemeBuildRunner` 的真實建置）：
  - 封存內容與 `dependent`；
  - 不讀內容時是 `independent`；
  - 沒有封存內容時以 `NATIVE_PRERENDER_CONTENT_UNAVAILABLE` 失敗；
  - adapter 預設設定以 `ASTRO_SESSION_BINDING_UNSUPPORTED` 拒絕；
  - 未核准的套件（`zod`，工具鏈中裝了但不是直接依賴）以 `UNAPPROVED_DEPENDENCY` 拒絕；
  - 沒有開關時在任何工作區之前拒絕；
  - `trailingSlash: "always"`。

**A4b 還要做的：**

- Sandbox 建置程式；
- `MORPH_ASTRO_THEMES` 接上 factory，正式環境一律拒絕；
- 官方 Astro Cloudflare 範例 fixture（`KNOWN GAP` 斷言）；
- 匯入防護中「工作區外的檔案」與 Astro 虛擬模組的明確測試；
- `imageService: "compile"` 的建置期圖片處理（5.2 的待驗項目）。

### 5.2.2 A4b 結果（2026-10-09；本機 Docker 與假容器，真實 Sandbox 容器與 Cloudflare 未驗）

**Sandbox 建置程式。** 與本機建置程式相同的規則：

- 開關沒有給時，在任何容器指令之前以 `THEME_FRAMEWORK_UNAVAILABLE` 拒絕；
- 編譯器身分、路由、套件清單依框架決定，每個 pass 有自己的 nonce；
- 指令只接受 `vite` 或 `astro`，執行檔一律是紀錄中的工具鏈的 `node_modules/.bin/<指令>`，不採用 plan 給的路徑。

建置失敗時不讀整個工作區，只讀那一份被拒讀取的紀錄（先查大小，上限 1 MiB）：

- 這次 pass 的紀錄判為 `prerender-content`，兩階段建置照常以封存內容重建；
- 別次建置的紀錄不算數，回報建置本身的錯誤，不會重建。

**開關接上。** `theme-build-service.factory` 的 `astroThemesEnabled`：只有 `MORPH_ASTRO_THEMES=1`、而且不是正式環境時才開。開關同時傳給 materializer 與 Sandbox 建置程式，開與關的判斷在兩處一致。

**驗證**：

- 假容器（`cloudflare-sandbox-astro-build.test.ts`）：
  - 沒有開關時沒有任何容器指令；
  - 指令與環境變數（沒有 Morph 的祕密）；
  - 完整紀錄時成功，產物入口 `runtime/server/entry.mjs`；
  - 沒有 stamp 時以 `prerender-records` 失敗；
  - fail-fast 停在被拒的讀取後，以封存內容重建成 `dependent`；
  - 沒有封存內容時以 `prerender-content` 失敗；
  - 別次建置的紀錄不觸發重建。
- 本機 Docker，一次：
  - 環境：A2a 的 Sandbox 映像、`--network none`、以 root 執行；
  - 執行內容：Morph 的 plan 產生的工作區（同一個 nonce），以及 Sandbox 建置程式會用的同一條指令與環境變數；
  - 結果：`astro build` 成功，`nativeBuildResult` 判定成功，產物 23 個檔案，`/about` 的 HTML 是封存值 A；
  - 這是映像中的工具鏈與 Morph 的 plan 的組合，不是 Sandbox SDK 或 Cloudflare 的驗證。
- 匯入防護（`native-astro-runner.build.test.ts`）：
  - 引用工作區外的檔案以 `WORKSPACE_PATH_ESCAPE` 拒絕；
  - `astro:assets`、`astro:middleware` 可以通過。

**還沒做的**：

- 經過 Sandbox SDK 的真實容器 Astro 建置：目前網站沒有記錄框架的地方（multi-runtime 第 6 步），E2E 無法建立 Astro 網站；
- 官方 Astro Cloudflare 範例 fixture：需要使用者同意下載；
- `imageService: "compile"` 的建置期圖片處理。

### 5.2.3 官方 fixture（2026-10-09，使用者同意下載）

`fixtures/astro/`，原樣複製，逐檔 git blob SHA-1 與上游相同，記錄在 `SOURCES.json`，附上游的 MIT 授權：

- `cloudflare-astro-blog-starter`：
  - 來源：Cloudflare 官方的 Workers 範本，`cloudflare/templates` @ `47645c9`；
  - 38 個檔案，1.17 MB，其中 `worker-configuration.d.ts` 604 KB，依使用者決定原樣保留。
- `adapter-sessions`、`adapter-compile-image-service`、`adapter-with-react`：
  - 來源：`@astrojs/cloudflare` 自己的測試 fixture，tag `@astrojs/cloudflare@14.3.4`（`e4f8f46`），與工具鏈的版本相同；
  - 依賴寫成 `workspace:*`，也沒有自己的 lockfile。

`official-astro-import.test.ts` 對每一個 fixture 斷言第一個拒絕它的關卡（`KNOWN GAP`）：

| fixture                         | 第一個拒絕它的關卡                                                                 | 拿掉這一關之後（只在探測中，fixture 不改；不是測試）                                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare 範本                 | materializer：`PUBLIC_FILE_REFUSED`，`public/.assetsignore` 是點開頭的檔案         | 建置時找不到 `@astrojs/mdx`：不在工具鏈中，`@astrojs/sitemap`、`@astrojs/rss` 也是。另外它固定 Astro 5.16.9 與 adapter 12.6.12，`wrangler.json` 的 `main` 是舊版的 `./dist/_worker.js/index.js` |
| `adapter-sessions`              | 真實建置成功，產物以 `ASTRO_SESSION_BINDING_UNSUPPORTED` 拒絕                      | —                                                                                                                                                                                               |
| `adapter-with-react`            | materializer：`NATIVE_WRANGLER_CONFIG`，沒有 Wrangler 設定，Morph 目前要求一定要有 | 補一份最小的 `wrangler.jsonc` 後，以 `ASTRO_SESSION_BINDING_UNSUPPORTED` 拒絕（adapter 的預設值）                                                                                               |
| `adapter-compile-image-service` | materializer：`NATIVE_WRANGLER_CONFIG`                                             | 補 `wrangler.jsonc` 後仍然失敗，Astro 回報 `no-image-metadata`                                                                                                                                  |

最後一列的原因：圖片放在 `src/content/blog/post/`，Morph 的原始碼版本只在 `public/` 存二進位檔，這張圖存不進去。探測中把它當文字傳入就損壞了；工具鏈中有 sharp。所以 `imageService: "compile"` 的建置期圖片處理仍然未驗。這不是 adapter 的問題，是 Morph 的檔案模型還不能存放 `src/` 下的圖片。

**從 fixture 得出的缺口**（依影響排序，都還沒有處理）：

1. Morph 要求 Wrangler 設定，但 adapter 14 沒有設定檔也能建置；**已處理（5.2.4）**
2. `src/` 下的二進位檔（Astro 的圖片管線）存不進原始碼版本；**已處理，入口已開，真實容器驗收通過（5.2.5）**
3. Cloudflare 官方範本附的 `public/.assetsignore` 被 `public/` 規則拒絕；
4. 常見的官方 integration（mdx、sitemap、rss）不在 Astro 工具鏈中；
5. adapter 預設的 `SESSION`（已知，5.2）；**已決定（2026-10-09，使用者）：維持建置時拒絕，以 `session: false` 作為明確的替代方案（5.2.6）**。

### 5.2.4 缺口 1：Wrangler 設定可省略（2026-10-09，使用者審閱過邊界）

**實驗**：

- adapter 14 在沒有 Wrangler 設定時照常建置，自己寫出 Worker 設定：
  - 名稱取自 `package.json`；
  - `compatibility_date` 是工具鏈 workerd 的日期；
  - `compatibility_flags` 為空；
  - `assets` 帶 `ASSETS` 綁定。
- 正規化後的設定裡，每一種綁定欄位都會出現，但都是空的（`durable_objects: { bindings: [] }`、`queues: { producers: [], consumers: [] }`）。
- 不論有沒有設定，預先渲染時 Miniflare 都在工作區寫 `.wrangler/state`。

**決定**：

- **沒有設定時，交給 adapter 的預設值**。Morph 不另外產生一份，也不設定 `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH`，結果與作者在 Morph 之外執行 `astro build` 相同。
- **沒有設定檔不代表沒有檢查。** 建置寫出的 Worker 設定一律經過產物規則：
  - 5.2 的 `SESSION`、`IMAGES`、`cache`；
  - 共用的綁定清單：`unmappedBindings`，頂層與 `previews` 都讀，以 `NATIVE_BINDINGS_UNMAPPED` 拒絕。
  
  這一步放在建置產物上，因為 adapter 可能加入專案沒寫的綁定。
- **「有宣告」的判斷**：陣列有元素，或物件中有任何實際的值，才算有宣告，所以 Wrangler 寫出的空結構不算。這條規則同時用在專案自己的設定上，該拒絕的實際宣告不受影響。
- `compatibility_flags` 目前沒有任何既有規則，也沒有新增。
- **`wrangler.toml` 在建置前拒絕**，不論是否另有 `.jsonc`。adapter 會讀它，Morph 不讀 TOML，它的綁定會在沒有檢查的情況下進入建置。
- **`.wrangler/` 與 `.morph/` 不能來自 Theme 的原始碼**（`NATIVE_RESERVED_PATH`，Start 與 Astro 都適用）：
  - `.wrangler/` 有產物整理所讀的 `deploy/config.json`，以及預先渲染會當作 KV、D1、R2 讀取的 Miniflare 狀態；
  - `.morph/` 是 Morph 的包裝與建置紀錄。
  
  以前 Start 只取代 Morph 自己會寫的那幾個檔，其他檔案會留在工作區；現在整個目錄拒絕。
- **工具狀態不進產物，也不進下一次建置**：
  - 產物整理只收 Worker 目錄與 assets 目錄，又加一條 `.wrangler/` 路徑在產物中就以 `NATIVE_ARTIFACT_TOOL_STATE` 拒絕；
  - 每次建置從原始碼版本寫出新的工作區，兩階段建置之間會清空工作區（只留工具鏈連結）；
  - 原始碼本身也不能帶 `.wrangler/`。

**測試**：

- `astro-native-build.test.ts`：
  - 有、沒有設定時的 plan；
  - `wrangler.toml`；
  - 專案設定宣告綁定，包括 `previews`；
  - 兩種框架的保留路徑；
  - 建置寫出的設定宣告綁定就拒絕；
  - adapter 的空結構可以通過；
  - 工具狀態不進產物。
- `native-astro-runner.build.test.ts`：沒有設定的真實建置成功，頁面是封存值，產物沒有 `.wrangler`。
- `official-astro-import.test.ts`：`adapter-with-react` 的缺口往下移，現在真實建置成功，產物以預設 `SESSION` 拒絕。

### 5.2.5 缺口 2：`src/` 下的二進位檔（2026-10-09，使用者審閱過邊界；三個 PR 中的第一個）

**做法**：延伸既有的二進位檔機制，不另建一套資源系統：R2 不可變 blob、D1 的 `encoding` / `blob_digest`、`saveThemeBinaryFile`、原始碼版本以 digest 參照。

**規則**（`theme-public-files.ts`，與 `public/` 同一份契約）：

- **位置與類型**：只有 `src/` 底下，只收 png、jpg、webp、gif、avif、woff、woff2。這一輪不收 SVG，也不收影音或任意二進位檔。
- **不收 SVG 的理由**：從 `src/` 匯入的 SVG 可能被內嵌成頁面上的標記，不經過 `public/` SVG 的隔離標頭；SVG 放在 `public/`。
- **路徑規則**沿用既有的正規化與保留規則：不能有 `..`、`.` 開頭的段落或 `node_modules`，也到不了工具鏈或平台的工作目錄。`.wrangler/`、`.morph/` 本來就不在 `src/` 下，原生建置也另外拒絕它們（5.2.4）。
- **公開與否**：Morph 不為它們建立任何 CMS 的公開入口，也不檢查路由衝突。但這不代表不公開：頁面用到之後，實際怎麼公開由框架的建置產物決定，可能是雜湊檔名、處理過的版本，或直接內嵌進頁面。所以不能存放秘密資料。
- **配額與 `public/` 共用**：200 個檔案、50 MB。並行時也成立：寫入要求的 `sourceGeneration` 必須與讀取配額時相同，同一個版本出發的兩個寫入只會成功一個。取代檔案保留逐檔的 `expectedVersion`（OCC）。

**檔案簽章不等於處理安全**：

- 簽章只證明格式。`src/` 的圖片還要看檔頭宣告的尺寸（`theme-image-dimensions.ts`，只讀檔頭，不解碼）：單邊最多 16 383 像素、總共最多 4,000 萬像素，讀不出尺寸就拒絕。
- 16 383 是實測後定的。用 Astro 的 `imageService: "compile"` 建置時，寬 16 384 的圖片在最大的那個版本無法編碼成 WebP，建置把 PNG 的內容以 `.webp` 檔名輸出；16 383 時每個版本都是真正的 WebP（WebP 格式的單邊上限）。
- **處理成本**：本機、`compile`、三種寬度各一次，記錄建置程序樹的 RSS 峰值（每 50 ms 取樣）。這是量級，不是穩定性的結論：

  | 圖片 | 建置時間 | RSS 峰值 |
  | --- | --- | --- |
  | 64 × 48 | 5.1 秒 | 1103 MiB |
  | 7680 × 5120（像素上限附近，純色、檔案很小） | 7.4 秒 | 1266 MiB |
  | 16 383 × 2400 | 7.5 秒 | 1349 MiB |

  都遠低於建置容器的 3 GiB 與建置的逾時；建置的時間與記憶體仍由容器規格和 runner 的 `maxDurationMs` 約束。

**入口仍然關閉**：

- `saveThemeBinaryFile` 只有在呼叫端明確傳入 `allowSourceAssets` 時才接受 `src/`，現在沒有任何使用者入口會傳入。
- materializer 與發布前檢查已接受 `src/` 的二進位參照。發布時會依當下的規則重新檢查路徑，但不重讀點陣與字型的位元組，與 `public/` 的點陣檔相同。
- 第一個 PR 合併只代表儲存與建置支援，不代表使用者已能操作。兩種 Live Preview 傳輸（PR 2）與 Code mode（PR 3）完成後才開放入口。

**測試**：

- 契約：
  - 位置、類型、SVG、路徑規則；
  - 共用配額；
  - 各格式的檔頭解析，以及無法判斷時回傳 null。
- 儲存（真實 SQLite 加 migration）：
  - 沒有開關時拒絕；
  - 存入、修訂版本與建置的參照；
  - SVG、格式、尺寸過大與檔頭無法讀取都拒絕，而且什麼都不寫入；
  - 共用配額的數量與總量；
  - 同一個 generation 的兩個寫入只成功一個；
  - 取代時的 OCC；
  - 較早的修訂版本讀回原本的 blob，回滾後恢復；
  - 發布檢查不讀位元組，也會拒絕舊規則存下的 `src/` SVG。
- 真實建置：
  - Start 的路由匯入 `src/assets/hero.png`，客戶端輸出中有一個雜湊檔名的 PNG，位元組相同；
  - Astro 以 `imageService: "compile"` 處理 `src/assets/hero.png`，產出 `/_astro/hero.*.webp`，頁面的 `<img>` 指向它；
  - 兩者的產物中都沒有原始碼路徑。

**PR 2：兩種 Live Preview 傳輸（2026-10-09）。** 不需要改產品程式。兩種傳輸啟動時都以參照與 `loadBinary` 取得二進位檔，寫入工作區時用共用的 `materializeThemeSandboxWorkspace` 或本機的同一套寫入流程，兩者都沒有限定 `public/`。這次補上證明：

- 本機傳輸（`local-vite-preview-server.source-asset.test.ts`，真實的 Start Live Preview）：路由匯入 `src/assets/hero.png`，`/gallery` 正常渲染，頁面 `<img>` 指向的網址回傳的位元組與儲存的相同。
- Sandbox 傳輸（`cloudflare-sandbox-vite-preview-server.test.ts`，假容器）：圖片先暫存，再由受 fence 保護的啟動流程移到 `/workspace/src/assets/hero.png`，內容是位元組的 base64，以 base64 寫入。真實容器要在最後的端到端驗收中確認。

編輯中替換 `src/` 的圖片後，預覽要重新啟動，這和 `public/` 一樣，是 Code mode 那一側的工作（PR 3）。

**PR 3：Code mode 與開放入口（2026-10-09）。**

- 上傳入口（`theme-binary-upload.ts`）傳入 `allowSourceAssets`，從這裡起使用者可以把檔案放進 `src/`。
- Code mode：
  - `src/` 底下的資料夾也有「Upload Files…」，工具列的上傳會跟著選取的 `src/` 資料夾；
  - 檔案選擇器的 `accept` 依目的地切換，`src/` 只列 png、jpg、webp、gif、avif、woff、woff2；
  - 用戶端的預檢（`checkPublicFileWrite`）改用共用的 `checkThemeBinaryPath`，伺服器照樣再檢查一次；
  - 取代、刪除、上傳後重新啟動預覽，都沿用 `public/` 的同一條路徑，不分目錄。
- 刪除資料夾時的網址審查只列 `public/` 的檔案。`src/` 的檔案沒有網址，是靠 import 引用；引用斷了，建置會報錯。
- 移動與重新命名：`src/` 的二進位檔先拒絕，訊息改成「重新上傳並更新 import」。這是因為移動時沒有東西會一起改寫 import。原本那句「只能在 `public/` 內移動」用在 `src/` 上並不正確。
- 端到端測試（`e2e/source-asset.spec.ts`，CI 的 sidecar 傳輸，第 3 個分片）：
  - 經同一個上傳入口放入 `src/assets/…png`；
  - 在 Code 裡讓 hero 元件 import 它，畫布顯示這張圖，且讀到的位元組與上傳的相同；
  - 同一個入口對 `src/` 下的 SVG 回 422；
  - 結束時把 hero 改回原狀。

**真實容器驗收（2026-10-09，本機一次通過）。** `e2e/source-asset-publish.spec.ts`，只在 `MORPH_E2E_TRANSPORT=cloudflare-sandbox` 與本機部署器下執行，CI 的各分片都會略過（放在第 1 個分片，和其他只用容器傳輸的檔案一起）：

1. 經 Code 寫入一個 Start 路由，它 import `src/assets/e2e-source-asset.png`；圖片 v1 經同一個上傳入口放入。
2. 發布，在 Sandbox 容器中從封存的版本建置：
   - 該 release 的 Build Preview 在它自己的主機上回傳的圖片位元組與 v1 相同；
   - 店面（本機部署器從這次執行的 R2 讀回 release 的產物）回傳的位元組也與 v1 相同，頁面上的網址不含原始碼路徑。
3. 以檔案的 `expectedVersion` 取代成 v2（OCC），再發布：店面回傳 v2。
4. 以 `expectedActiveReleaseId` 回滾到第一個 release：回到第一個 build，店面回傳 v1，讀的是原本的 blob。

結果：3 個測試通過，6.0 分鐘。前一次執行在第二次編輯時失敗：重啟後的 Live Preview 畫布遇到 `OperationInterruptedError`（「platform was updating the sandbox runtime」），一直沒有載入。這個錯誤在先前許多容器執行中都出現過，不是這次的改動造成的。因為這份驗收要證明的是建置、發布與回滾，第二份草稿改用編輯器自己的草稿寫入，與 `native-publish-acceptance.spec.ts` 第 6 步相同。容器傳輸下 Live Preview 重新啟動後沒有回來，是另一個問題。

### 5.2.6 A5 結果（2026-10-09，本機真實容器；Cloudflare 未驗）

**網站層級的框架紀錄**（使用者決定：加欄位，驗收時直接寫入）：

- `storefront_themes.framework`（migration 0077，只在本機套用，可為 NULL）。NULL 是框架被記錄之前的每個網站，讀成 TanStack Start。產品中還沒有任何地方寫入它；multi-runtime 第 6 步在建立網站時選擇。2.1 仍然成立：記錄一次，不轉換。
- 建置：`ThemeBuildService.requestPreviewBuild` 從網站紀錄讀框架，凍結進 build 紀錄（`framework`、工具鏈、hash 格式 2），之後每一步都讀 build 紀錄。原本可由呼叫端傳入的 `framework` 選項已移除，網站紀錄是唯一來源。不認得的值在建立 build 之前就以 `THEME_FRAMEWORK_UNKNOWN` 拒絕。`astro` 是否能建置，仍由 materializer 與 runner 依 `MORPH_ASTRO_THEMES` 判斷，關閉時以 `THEME_FRAMEWORK_UNAVAILABLE` 失敗、不執行。
- Live Preview：編輯器 context 帶出網站的 `framework`，Live Preview 依它啟動。這是修正：原本沒有呼叫端傳入框架，Astro 網站的 Live Preview 會被當成 Start 啟動。現在在任何工作區或容器之前就以 `THEME_FRAMEWORK_UNAVAILABLE` 拒絕，直到 A6。

**`SESSION`**（使用者決定：維持建置時拒絕，並給出改法）：adapter 預設的 `SESSION` KV 綁定仍以 `ASTRO_SESSION_BINDING_UNSUPPORTED` 在建置時拒絕，訊息說明在 `astro.config` 設定 `session: false`。這就是 A5 閘門所說的「明確的替代方案」。基礎設施對應（每個網站一個 KV namespace）是之後的工作，需要另外核准建立 Cloudflare 資源。

**驗收中發現並修正：`ASSETS` 綁定。** Morph 為 Theme Worker 組出的設定（`wranglerDeployConfig`，Build Preview 與正式部署共用）沒有靜態資產綁定。Start 的 entry 不用它，但 Astro 的 entry 對所有它不處理的路徑都呼叫 `env.ASSETS.fetch`，所以不存在的頁面回 500 而不是 404，正式部署後也會一樣。修正：

- `planThemeWorkerDeployment` 從 build 自己的 Worker 設定讀 `assets.binding`，只接受合法的綁定名稱，否則以 `INVALID_WORKER_CONFIG` 拒絕；
- `wranglerDeployConfig` 把它寫入；
- 本機 harness（`verify-published-artifact.mjs`）同樣處理。

這個綁定只能讀該 Worker 自己的靜態資產，不是禁止清單中的平台資源。

**驗收中確認的規則：預先渲染的頁面只讀自己路徑的內容。** 第一版測試讓 `/astro-ssg` 在預先渲染時讀首頁 `/` 的內容，建置以 `NATIVE_PRERENDER_CONTENT_UNAVAILABLE`（`NATIVE_PRERENDER_PATH_NOT_SEALED`）失敗。這是 4.3 的規則正確生效：封存的內容只給這個 build 自己有的靜態路徑。測試改成由首頁 `src/pages/index.astro` 預先渲染並讀自己的內容。這和 Start 的驗收不同，Start 的預先渲染頁面可以讀 `/`。

**真實容器驗收**（`e2e/astro-publish-acceptance.spec.ts`）：

- 條件：`MORPH_E2E_TRANSPORT=cloudflare-sandbox`、`MORPH_ASTRO_THEMES=1` 與本機部署器。CI 的各分片都會略過（放在第 1 個分片）。
- 網站經 harness 直接在這次執行的 D1 記為 `astro`；結束時改回 NULL。
- Astro 專案經 Code 存入：自己的 `astro.config.mjs`（`session: false`、`imageService: "passthrough"`），沒有 Wrangler 設定，用 adapter 的預設值。兩個讀首頁內容的頁面：伺服器渲染的 `/astro-check` 帶程式碼標記；首頁 `/` 在建置時預先渲染。
- 沒有 Live Preview（A6），所以草稿一律經編輯器自己的草稿寫入，不在畫布上編輯。

G0 的五項：

1. 工具列建置在容器中執行，封存草稿 A；build 紀錄為 `astro`、`astro-native`，產物入口是 `runtime/server/entry.mjs`。隔離的 Build Preview 顯示 v1 與 A。
2. 發布重用預覽過的 build，不再建置。release 預覽與店面都是 v1 與 A；不存在的頁面回 404。
3. 草稿 B 之後重新打開 build A 的 Build Preview，仍是 A；指名 build A 發布草稿 B 以 `PUBLISH_BUILD_CONTENT_MISMATCH` 拒絕，D1 不變。Code v2 之後由工具列發布 B，重新建置一次，店面是 v2 與 B，不混入 A。
4. 草稿 C 的發布請求送達前，另一方改成 D，最後的 OCC 以 `TEMPLATE_DRAFT_CONFLICT` 拒絕：只建置一次、只送出一次發布、D1 不變，店面仍是 B。
5. 回滾到第一個 release：build 與內容發布都回到 A，店面是 v1 與 A。

結果：本機一次通過，3 個測試，3.5 分鐘。這是一次執行，不是穩定性的結論。前幾次執行的失敗依序是：測試找錯 hero 區塊 id；上面的路徑規則；上面的 `ASSETS` 綁定。

**未驗**：

- Cloudflare 部署環境；
- 兩個同時進行的建置（與 G0 相同，沒有另做容器驗收）；
- 產物雜湊沒有另外比對。發布重用的是預覽過的那個 build（build id 相同），Astro 的產物本來就含隨機金鑰（5.2.1）。

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

### 6.4 A6a 結果（2026-10-09，本機 sidecar；容器未做）

A6 分三個 PR：A6a 本機啟動、A6b bridge 的整頁模式與編輯器、A6c 容器與經過真實編輯器的驗收。這是 A6a。

**工作區**（`astro-preview-workspace.ts`，`astroFramework.planWorkspace`）：

- 作者的檔案原樣放入，不跑任何檔案語言處理（L1.5、L2 之前，`.astro` 沒有編輯器識別）。
- `.morph/astro.preview.config.mjs`：import 作者的 `astro.config.*`，換成 Morph 自己的 `cloudflare({ inspectorPort: false, persistState: false, remoteBindings: false })`，關掉開發工具列，最後加上 Morph 的 integration。建置不經過這個檔案，照作者的 adapter 設定執行。
- Morph 的 integration：與其他 Live Preview 相同的 Vite plugin（HTTP HMR relay、伺服器原始碼邊界、SVG 隔離、草稿內容端點），以實際解析位置判斷的匯入防護（建置的規則，加上預先打包的依賴依原本要求的套件判斷），`server.fs` 只允許工作區與工具鏈，watch、HMR 路徑。
- Vite 的快取目錄指定為工作區自己的 `.vite/`。工作區的 `node_modules` 是連到共用工具鏈的連結，預設的快取會被所有預覽共用，而且寫進工具鏈目錄；這是第一次全套測試時並行失敗發現的。
- `.morph/wrangler.preview.json` 的 `main` 是預覽 Worker entry，包住 `@astrojs/cloudflare/entrypoints/server`（2.5 的首選，R3），以 `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH` 提供，沒有任何綁定。
- Astro 版 client module：在 `DOMContentLoaded` 之後載入內容模組與 bridge，不設定 router。
- Adapter 的 `preview.devServer` 宣告由 `astro dev` 啟動（設定檔路徑與環境變數，含 `ASTRO_TELEMETRY_DISABLED=1`），兩種傳輸讀同一份宣告。
- 作者的 `cloudflare()` 若帶 `imageService` 等 2.4 列出的選項，預覽回報「這些設定在預覽中不套用」的警告；以 AST 帶入列為之後的工作。

**Worker entry 的注入補上沒有 `<head>` 的文件**：Astro 不會自動補 `<head>`，作者的頁面可以只寫 `<html><body>`，原本的注入只插在 `<head>`，這樣的頁面完全沒有 bridge。現在依序是 `<head>` 最前面、`<body>` 最前面、文件結尾，每個回應一次。Start 的頁面一定有 `<head>`，行為不變。

**開關**：Live Preview 也受 `MORPH_ASTRO_THEMES` 控制。由啟動預覽的 Worker 判斷（`astroThemesEnabled`）後放進啟動參數 `astroThemes`，兩種傳輸照它解析框架；沒有開關時照舊以 `THEME_FRAMEWORK_UNAVAILABLE` 拒絕。

**本機 sidecar**：沿用 Start 預覽的子行程模式。工作區的 `node_modules` 連到 `sandbox/toolchains/astro-7.3`（`pnpm toolchain:astro`），子行程從那裡 import Astro 的 `dev()`，所以本機跑的是容器的同一套套件；沒有安裝時以 `LOCAL_PREVIEW_TOOLCHAIN_MISSING` 拒絕。

**容器傳輸**：還沒有啟動 `astro dev`，在取得容器之前以 `THEME_FRAMEWORK_UNAVAILABLE` 明確拒絕（A6c）。

**測試**：

- 工作區規劃：作者檔案原樣、包裝設定只換 adapter、Wrangler 副本指向預覽 entry、client module 不用 router、匯入防護與快取目錄、沒有或多個設定檔與建置模式被拒、作者檔案不能佔用 Morph 的路徑、未帶入的 adapter 選項有警告、指紋隨內容改變。
- 本機真實預覽（`local-vite-preview-server.astro.test.ts`，經過 `LocalVitePreviewServer`）：位址探測回 204 與這次的 id；草稿內容出現，腳本在 `<head>` 最前面；沒有 `<head>` 的頁面與預先渲染的頁面也有注入；工作區沒有 `.wrangler`；`/@fs/etc/passwd` 被拒；寫入 `.astro` 後 relay 送出 `full-reload`，頁面是新內容；沒有開關時拒絕。連續執行兩次都通過。
- 冷啟動：本機約 6 秒就緒（一次手動量測，不是比較結論；與 Start 的比較在 A6c 做）。

**還沒做**（A6b、A6c）：內容更新改成重新載入整頁、`set-route` 改用 `location.assign`、重新載入後恢復選取、編輯器處理「`applied` 之後的 `preview-ready`」；容器啟動與程序識別、經過真實 `preview.tsx` 的驗收、第 7 節的監聽 socket 與外連政策記錄、冷啟動比較、L1.5 點選定位。

### 6.5 A6b-1：草稿內容同步到預覽伺服器（2026-10-09，本機 sidecar）

**問題**：Start 的即時內容更新只在瀏覽器端（bridge 更新頁面內的快照，router 重新跑 loader），預覽伺服器上的快照只在啟動時寫入。Astro 頁面在伺服器渲染，6.3 計畫的「內容更新時重新載入整頁」會讀到啟動時的舊快照，剛改的內容會消失。

**決定（2026-10-09，使用者）**：由編輯器經過現有、已驗證身分的預覽寫入路徑，把 Core 從草稿產生的快照寫進預覽；不讓 bridge 或 Theme 成為草稿內容的來源。使用者同時要求的四個條件與做法：

1. **先確認套用，再重新載入**：預覽 Worker 的位址探測回報它這時讀到的快照序號（`x-morph-content-ticket`），探測本身就經過 Worker 讀快照的同一條路徑。寫入後輪詢，Worker 回報的序號達到這次的序號才算已套用；逾時回報 `PREVIEW_CONTENT_NOT_CONFIRMED`。Worker 每次讀都重新 import 資料檔這件事是實測，不是推論。
2. **快照帶版本與預覽身分**：D1 的 `storefront_theme_preview_content_tickets`（migration 0079，只在本機套用）以預覽 session id 為鍵，每次啟動與每次同步都先以一個陳述式取下一個序號，**之後**才讀草稿。同步只在對應的修改存好之後送出，所以序號較大的快照包含序號較小者看到的每個修改；預覽只接受比手上更大的序號，晚到的舊快照以 `PREVIEW_CONTENT_SUPERSEDED` 拒絕，什麼都不寫。寫入只到這個預覽 id 的工作區。
3. **資料與模組一致**：伺服器端的兩個讀取點（預覽 Worker 與 Vite 的內容端點）都讀同一個資料檔 `.morph-preview-content.json`，同步也只寫這一個檔案，先寫到旁邊再以 rename 替換，讀者只會看到舊檔或新檔。瀏覽器端的快照模組不變，Start 的瀏覽器行為不受影響。
4. **失敗不假裝成功**：沒有確認就回報失敗，不回報已套用；草稿已經存在 D1，最新修改不會遺失；不重啟預覽。編輯器端的顯示與「不刷新到舊內容」在 A6b-2。

**啟動也遵守同一個順序**：啟動取得的序號寫在它的資料檔中。磁碟上已有序號更高的快照時，重新佈置會保留它；沿用原伺服器時，以同一個規則寫入。序號只用來排序，不算工作區內容，工作區指紋計算時排除它，所以每次啟動取新序號不會讓預覽重啟。

**範圍**：本機 sidecar（`writeContent`，sidecar 協定新增同名端點）。容器端的同步與確認要和容器中的 Astro 預覽一起在 A6c 做；`syncThemePreviewContent` 在容器傳輸上回 `PREVIEW_CONTENT_SYNC_UNAVAILABLE`。

**測試**：

- 真實的本機 Astro 預覽（經過 `LocalVitePreviewServer`）：A（101）、C（103）依序套用並經 Worker 確認，頁面依序顯示 A、C；之後 B（102）晚到，以 `PREVIEW_CONTENT_SUPERSEDED` 拒絕，之後連續五次重新載入都是 C；以較舊序號（102）重新啟動，C 仍然保留；以較新序號（104）重新啟動，顯示 D。沒有序號的快照被拒絕。連續執行兩次都通過。
- 序號 DAL（真實 SQLite 加 migration）：每個預覽從 1 開始遞增；10 個並行呼叫拿到 10 個不同的序號；主題刪除時一起刪除。
- 序號的讀取、指紋排除序號（只限資料檔）、Worker 讀資料檔並在探測回報序號、sidecar 協定多一個端點。
- Start 的伺服器預覽相關的真實測試（4 個檔案、98 個測試）照常通過。

### 6.6 快照一致性與實例確認（2026-10-09，使用者審閱 6.5 後要求；本機 sidecar）

使用者指出：序號代表更新順序，不保證快照內容一致；確認訊號要屬於當前的預覽實例。做法：

- **一致讀取**（`readConsistentPreviewContent`）：快照要讀 template 與頁面草稿，不止一次讀取，中間可能有寫入。讀內容前後各讀一次所有草稿的版本（`readDraftVersions`：每個 template 的 `draftGeneration` 與 `draftRevisionId`，每個頁面的 `draftRevisionId` 與 `updatedAt`；每次內容寫入都會改變其中之一），兩次一致才採用，否則重讀；三次都不一致就以 `PREVIEW_CONTENT_UNSTABLE` 拒絕，不寫入。啟動與同步都用這個讀取。
- **序號、雜湊與版本綁在一起**：快照帶 `contentTicket`、`contentHash`（內容本身的 SHA-256，不含這些中繼欄位）與 `contentVersions`。預覽收到同一個序號時，內容雜湊相同視為同一次寫入，重新確認（回應遺失後重送不會被當成新寫入）；雜湊不同以 `PREVIEW_CONTENT_TICKET_CONFLICT` 拒絕。sidecar 重算雜湊，與快照宣稱的不符就拒絕。中繼欄位不算內容，也不算工作區指紋。
- **確認屬於當前實例**：傳輸層每次啟動 dev server 都產生一個實例識別碼，蓋在資料檔上（`previewInstance`），之後每次內容寫入也一樣。Worker 在位址探測同時回報序號與實例，兩者來自同一次讀取；確認時兩者都要對上，另一個伺服器寫的檔案或回報不算確認。

**實例放在資料檔，不另外放一個檔案**：第一版把實例放在獨立的 `.morph-preview-instance.json`，由 Worker 另外 import。這讓下面的時序衝突在本機必然發生，所以改為資料檔的欄位，Worker 不必多 import 任何東西。

**`deps_ssr` 失敗：原因與修正（2026-10-10 更正）**（6.5 的 CI 失敗）：

- 這一節原本寫成「Cloudflare plugin 與 Vite 第一次 ssr 最佳化之間的時序問題」，**判斷錯誤**。
- 真正的原因在 Morph 自己的匯入防護：A6a 把 Vite 的 `cacheDir` 移到工作區的 `.vite/`，匯入防護卻仍以為預先打包的依賴在 `node_modules/.vite/` 下，於是對 `.vite/deps_ssr/...` 呼叫 `realpathSync`。Vite 在第一次最佳化提交 `deps_ssr` 之前就已經把檔名交出來，`realpathSync` 因此在 `lstat '.vite/deps_ssr'` 失敗。
- 已由 #184（d9d14f0）修正：快取中的路徑依路徑段判斷，不經由檔案系統讀取。上面的「多一個 import 就必定發生」也不成立，後來同樣條件下沒有重現。

**測試**：

- 一致讀取：沒有寫入時讀一次就採用；讀取途中另一個請求修改了兩份草稿，第一次讀到「template 舊、頁面新」的組合被丟棄，重讀後兩者一致；一直在變就拒絕，不產生快照。
- 草稿版本（真實 SQLite）：沒有寫入時不變；template 的草稿寫入、頁面的草稿寫入、頁面刪除都會改變版本。
- 真實的本機 Astro 預覽：6.5 的排序測試照常通過；同一序號同一內容重送時重新確認、同一序號不同內容被拒；Worker 讀到的資料檔標著另一個伺服器時，重送不算確認（`PREVIEW_CONTENT_NOT_CONFIRMED`），之後由這個伺服器的傳輸寫入的下一份快照照常確認；雜湊與內容不符的快照被拒。連續執行三次都通過。
- 雜湊只取內容，不受序號、版本、實例影響；指紋同樣不受影響。

### 6.7 A6c：容器中的 Astro 預覽與內容同步（2026-10-10，本機真實容器；Cloudflare 未驗）

- **啟動**：容器傳輸依 adapter 宣告的 `devServer` 執行 `astro dev --config .morph/astro.preview.config.mjs`，工作目錄為 `/workspace`，帶 adapter 宣告的環境變數，連接埠固定（包裝設定加上 `server.strictPort`）。就緒以 Worker 的位址探測判斷。程序識別也認得 Astro 的 dev server，重新啟動時能找到並停止舊的程序。
- **實例**：只有宣告了 `devServer` 的框架才在容器中做，Start 的容器行為不變。啟動 dev server 前產生實例識別碼，記在容器的 `/tmp/morph-preview-instance`（不在工作區；容器重啟就消失），並蓋到資料檔上。
- **內容寫入**：柵欄腳本新增 `content`、`stamp`、`read` 三種請求，和其他工作區寫入共用同一把鎖。`content` 比較序號與雜湊、蓋上當前實例、以 rename 替換；沒有任何 dev server 蓋過章時回 `no-server`（`PREVIEW_CONTENT_UNCONFIRMABLE`），什麼都不寫。啟動的 `start` 請求在搬入資料檔時，磁碟上序號較高的保留，並重新蓋上當前實例。
- **確認**：Core 經由 Sandbox 代理探測 Worker（`preview-content-confirm.ts`），序號與實例都對上才算確認。
- **只確認**：`confirmThemePreviewContent`（容器與本機都有，sidecar 多一個 `confirmContent` 端點）。用於「已套用但回應遺失」：重新探測，不盲目重送；重送也只會被當成同一次寫入（6.6）。
- **容器重啟**：`/tmp` 的實例與工作區一起消失，D1 的序號照常遞增。下一次啟動以較大的序號、從草稿重建快照，並蓋上新的實例；之前的確認不再適用，因為實例不同。

**真實容器驗收**（`e2e/astro-preview-container.spec.ts`，容器傳輸、`MORPH_ASTRO_THEMES=1`；CI 的各分片略過）：

- 網站記為 Astro，經 Code 存入 Astro 頁面（伺服器渲染、讀首頁內容）。
- 草稿一律經編輯器自己的草稿寫入，同步經 server function。這個網站仍帶著 Starter 的 Start 檔案，所以不代表 Astro Design 已可用（L1.5）。

步驟與結果：

1. 開啟編輯器，容器啟動 `astro dev`，預覽頁面顯示 A。
2. 草稿改 B 並同步：Worker 確認後頁面顯示 B，不再出現 A。
3. 只確認：持有的序號回報已確認，大 1000 的序號回報 `PREVIEW_CONTENT_NOT_CONFIRMED`。
4. C、D 依序同步：之後連續三次讀取都是 D，沒有 C。
5. 停止預覽後重新開啟：新的 dev server 顯示最新草稿 E，之後的同步序號大於重啟前，照常確認。

依序版本**連續 2 次通過**（1.7、1.8 分鐘）。

**並行同步後的平台中斷：已重現，未定位**（使用者決定先合併，另開調查）：

- 第 4 步原本讓 C、D 兩個同步並行。2 次執行中，兩個同步都成功，資料檔停在較大的序號；但緊接著的下一個頁面代理請求被平台中斷（`OperationInterruptedError`，「platform was updating the sandbox runtime」），每次正好 1 次。改成依序後，2 次都沒有中斷。
- SDK 把「isolate 被取代」「連線中斷」「DO 儲存重設」都轉成這個訊息，日誌沒有記下原始錯誤，所以還不知道是哪一種。
- 產品面：A6b-2 的編輯器每個分頁一次只送一個同步；跨分頁同時同步時，頁面請求若被中斷，代理會回中斷狀態，由編輯器重新載入（`preview-runtime-interruption.ts`）。
- 並行寫入本身的正確性由容器腳本的真實執行測試涵蓋：9 個並行同步，最後一定是最大序號。

**測試**：

- 容器腳本（真實 `node`）：
  - 沒有蓋章前不寫入；
  - 蓋章寫在 `/tmp` 與資料檔；
  - 序號較低被取代、同序號同雜湊為相同、同序號不同雜湊為衝突；
  - 9 個並行同步停在最大序號；
  - 啟動時保留較新的內容並重新蓋章。
- 確認：
  - 序號達到才確認；
  - 其他實例的回報不算；
  - 不回應時不確認；
  - 寫入被拒時不探測；
  - 只確認時先問容器目前的實例，沒有實例就回報無法確認。
- 容器傳輸（假容器）：Astro 的啟動指令、工作目錄、環境變數、就緒路徑與蓋章；Start 的寫入順序與既有測試相同。
- 本機：「只確認」對持有與未持有的序號。

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
- **R3：完成（2026-10-09，本機 `astro dev`，`~/projects/astro-spike/r3-preview/R3-REPORT.md`）：採用 2.5 的首選。**
  - 條件：以 Morph 自己的 `themePreviewStartWorkerSource` 產生的 Worker entry 包住 `@astrojs/cloudflare/entrypoints/server`，與不包的基線比較。唯一的差別是以 `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH` 指定預覽的 Wrangler 設定。
  - 次數：每個條件跑兩次，各用新的 dev 程序，HTTP 與 WebSocket 兩種 HMR 各一組；基線對基線的對照組 28 個請求全部相同。
  - 2.5 表的每一列都相同：
    - 串流：分段與間隔相同；首位元組晚 5–11 ms，只有兩次，算方向不算結論；
    - 重新導向：狀態碼與 `Location` 相同，包裝不跟隨；
    - 多個 `Set-Cookie`：不合併、順序相同；
    - 404 與 500：只多了注入的腳本，非 HTML 不改寫；
    - HMR：`.tsx` 就地更新並保留狀態，`.astro` 整頁重新載入，替代的編輯器頁面收到 `theme-files-applied` 與重新送出的 `preview-ready`。
  - 有差別的 4 個請求是設計上的：內容端點、外連被拒、兩個回傳注入標頭的端點。
  - 需要知道的三點：
    - 丟出錯誤時的 500 頁是 Vite 在 Node 中產生的，不經過 Worker，沒有橋接腳本，所以編輯器收不到 SSR 錯誤；備案也一樣。
    - 預先 gzip 的 HTML 原樣通過、沒有注入腳本；dev server 會去掉 `Content-Encoding`，真實 Worker 的情形沒有觀察到。
    - 首選也會注入端點回傳的 HTML，備案的 `injectScript` 漏掉這 3 個回應。
  - 未驗：
    - Sandbox 容器與 Cloudflare；
    - 真實的 `preview.tsx`，所以選取、行內編輯與重新排序沒有測；
    - Vue、server islands、sessions、`Astro.rewrite`、`.astro` 語法錯誤的覆蓋層。
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

| 步驟   | 內容                                                                                                                                                                                    | 閘門（通過才能進入下一步）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **G0** | 原生 Start 內容配對驗收（不屬於 Astro，但是 Astro 接入 `main` 與開放的前提；不阻擋 8.1 的研究）                                                                                         | 真實容器中：（1）Build Preview 顯示封存的草稿；（2）發布重用預覽過的 build，產物雜湊相同；（3）build 之後草稿又被修改，發布時重新建置，或被 `PUBLISH_BUILD_CONTENT_MISMATCH` 拒絕；（4）兩個並行的建置或發布不會配錯內容，OCC 拒絕落後的一方；（5）回滾後店面的 build 與內容一起回到舊版。**本機真實容器驗收（2026-10-07，#137，`MORPH_NATIVE_START_BUILD=1`）**：`e2e/native-publish-acceptance.spec.ts`（SSR 加上讀內容的預先渲染靜態頁，build 記為依賴）涵蓋（1）、（3）、（5），以及（2）的「發布不再建置、release 用的就是預覽過的那個 build」，產物雜湊沒有另外比對；（4）在容器中驗的是 build 之後、發布送達前另一方改了草稿，由最後的 OCC 以 `TEMPLATE_DRAFT_CONFLICT` 拒絕、D1 不變、不重試，Core 處理途中的草稿變更以 DAL 測試涵蓋；兩個同時進行的建置沒有另做容器驗收。`e2e/native-content-dependency.spec.ts` 涵蓋證明為不依賴的 build 的純內容發布與回滾。細節見 `docs/start-native-import-plan.md` 第 3 步。未驗：Cloudflare 部署環境                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| M1     | Morph 主 Worker 的解析器記憶體預算（3.1）：把 compiler-rs 加 `wasm32-wasi` binding 與 Morph 自己的載入器放進 Morph 主 Worker 的 bundle，量測                                            | 量到並記錄：合併後的 bundle 大小與啟動時間（1 秒上限內）；Morph Worker 本身的記憶體加上 61 MiB 底線與檔案大小上限內的 AST，是否在 128 MB isolate 內；trap 後重建實例的行為。放得下才進入 A1、A2；放不下時停下，由使用者在 0.3 的選項中決定（另一個 Worker 是新的部署單位，需要核准）。**結果（2026-10-08）：不通過**，Morph 處理過 SSR 請求後 72.8 MiB，加上解析器即 135.2 MiB（3.1、M1 報告）。使用者已在 0.3 決定：首選專用解析器 Worker，備案 Sandbox 容器中的官方 Node 解析器                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| M1c    | 專用解析器 Worker 的本機實驗（0.3 的設計條件，3.1）：本機 workerd 中 core 與解析器兩個 Worker 以 service binding 連接，不部署                                                           | 量到並記錄：slot 先於讀 body、等待數與等待時間的上限與拒絕、串流讀取時的位元組上限（不信任 `Content-Length`）、回應序列化的保護；同樣大小不同形狀（大量小節點、解析器允許的最深巢狀、長字串、無效語法）；並行 1、2、4、8（admission 開與關）；連續大檔；369 KB 壓力只經另一個入口；trap 後恢復（重複，且檢查之後的結果是否正確）；經過 binding 的大小與時間；GC 前後的記憶體（定義同 M1，確認 Wasm 不重複計算）。每個條件多次，記錄機器負載。**結果（2026-10-08）：本機完成**（3.1、M1c 報告）。**M1c 本機通過不開啟 L2**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| M1c-C  | **部署後的解析器 Worker 的雲端驗證（正式閘門）。** 解析器 Worker 是新的部署單位，部署需要使用者另外核准；核准之前不進行                                                                 | 以部署的解析器 Worker（沒有 route，只經 service binding；沒有 D1、R2 或部署相關的 binding）重做 M1c 的情境：100 KB 的各種形狀、單一 slot 下的並行與連續請求、trap 與毒化。以 Cloudflare 自己的記錄判定（Workers Metrics 的記憶體、超過記憶體上限的錯誤或 isolate 被終止、錯誤率），不以本機數字推估；要回答 128 MB 如何計算（GC 前或後、shared Wasm memory 是否計入）、毒化的 isolate 何時被回收、雲端的 trap 門檻、冷啟動與實例化時間。通過條件：上述負載下沒有任何記憶體上限錯誤或因記憶體被終止的 isolate，trap 一律得到明確錯誤。前提：128 MB 是每個 isolate 的上限，由該 isolate 中所有並行請求共用，包含 JS heap 與 Wasm；序列化降低峰值但控制不了 GC 時機，本機通過不能證明部署後留在上限內。**通過之前，L2（使用解析器 Worker 的步驟）與 A7 的解析器部分都不得使用它**；不通過時改走 0.3 的備案。**結果（2026-10-08）：通過**。判定依 Workers Logs 的 invocation outcome，逐請求對帳；每一種合法負載至少 3 輪完整、`exceededMemory` 為 0（3.1、M1c-C 報告）。128 MB 的計算方式、毒化 isolate 的回收、冷啟動仍未回答；正式部署解析器 Worker 仍要使用者另外核准                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| A1     | 框架身分：`ThemeFrameworkId` 加入 `astro`、build 輸入記錄框架、`nativeBuildResult` 與預覽 runtime 依記錄選 adapter、Start 原生建置的共用部分搬到共用模組。只有 Start 一個實作，行為不變 | 既有測試、Start 的 E2E 不變；新增測試：build 輸入的框架被改動時 `inputHash` 也會改變；`theme-framework.test.ts` 的介面規則仍然成立。**結果（2026-10-08，本機）**：`storefront_theme_builds.framework`（migration 0075，可為 NULL）記錄框架；NULL 是框架被記錄之前的 build，由 `resolveThemeFramework` 讀成 TanStack Start，這是唯一做這個對應的地方。materializer 把框架寫進 build 輸入，只有不是 Start 時才算進 `inputHash`，所以既有 build 記錄的 `inputHash` 不變。materializer、兩個建置程式、`nativeBuildResult` 與兩個 Live Preview 傳輸都依紀錄選 adapter；`astro` 與未知值在任何工作區或容器之前以 `THEME_FRAMEWORK_UNAVAILABLE`／`THEME_FRAMEWORK_UNKNOWN` 拒絕，不退回 Start。Live Preview 的輸入可以帶框架，但網站層級的紀錄要到 multi-runtime 第 6 步才有，目前沒有呼叫者傳入。新增測試：框架改變時 `inputHash` 改變（反向驗證過：拿掉雜湊中的框架後該測試失敗）、未紀錄與 Start 的雜湊相同、既有 build 的雜湊仍相符、`astro` 被拒且 runner 不執行；`theme-framework.test.ts` 未修改且通過。`pnpm typecheck`、`typecheck:data`、`test`、`build`、`check:e2e-assertions`、`check-e2e-shards`、`check:migrations` 通過。真實容器 E2E（`MORPH_NATIVE_START_BUILD=1`）一次：`native-content-dependency` 通過，`native-publish-acceptance` 走完步驟 1–5 後，步驟 6 的建置容器啟動失敗（`SandboxError: Container failed to start`，`stage: sandbox-runtime`；該 build 已通過 materializer，`framework` 為 NULL），測試等不到發布而失敗；當時未重跑。原因查明是 #149 的啟動重試在真實 RPC 下從未生效（錯誤跨 Durable Object RPC 後只剩訊息），由 #155 修正。**修正後補驗（2026-10-08，本機，負載 2.5→4.6）**：A1 分支合併含 #155 的 `main` 後，同樣兩個 spec 在真實容器跑一次，4 個測試全數通過，`native-publish-acceptance` 走完發布、過期發布被拒、並行編輯與回滾                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A2     | 工具鏈「框架 × 版本」：多工具鏈根目錄、產生器、映像、本機 `toolchainProblem` 依 adapter 判斷                                                                                            | Start 工具鏈的內容雜湊不變；Astro 工具鏈從自己的根目錄解析到 Vite 8；量測映像大小、Node 版本與容器冷啟動時間；Morph 鎖定的 compiler-rs 與工具鏈中 `astro` 依賴的版本相容。**真實 Sandbox 中**：預先渲染 Worker 連得到建置程序的 loopback（4.3 前提 3）；R2 的失敗情境（無快照、500、連線被拒、拿掉標頭送達，各自在 fail-fast 與只靠建置後檢查下）結果與本機相同；7.2 的監聽 socket 清單。**A2a 結果（2026-10-09，本機；只代表基礎設施完成，不代表 Astro 已驗收）**：工具鏈分成 `/opt/morph-toolchain/tanstack-start-1.168`、`/opt/morph-toolchain/astro-7.3` 與平台的 `/opt/morph-platform`，各自 `package.json`＋lockfile，映像以 digest 固定基礎映像並以 `npm ci` 安裝，寫入工具鏈清單（2.2.1）。Start 的 lockfile 鎖定 2026-10-03 映像的套件樹：基線 168 個安裝位置在 17 個欄位逐一一致，`npm ci` 另多裝 6 個 musl 版可選原生套件（npm 10.9.8 的 lockfile 不記 libc），已測的載入情境使用 glibc 版；完整安裝樹不完全相同（證據：`~/projects/astro-spike/a2-toolchain/LOCK-A-REPORT.md`）。乾淨的 5 天後 `npm install` 有 10 個間接依賴漂移，證明原本未鎖定的安裝不可重現。不用快取重建映像，三套識別相同。Astro 工具鏈解析到 Vite 8.3.3、Start 仍是 Vite 7.3.5；Morph 鎖定的 compiler-rs（0.5.1）與 `astro` 要求的 `^0.5.0` 相容，有測試。migration 0076 加入 `input_hash_format` 與 `toolchain_id`，legacy build 不回填。真實容器 E2E（`MORPH_E2E_TRANSPORT=cloudflare-sandbox`，新映像）：`native-publish-acceptance`（建置、預先渲染、Build Preview、發布、過期發布被拒、並行編輯、回滾）與 `native-content-dependency` 通過；`build-preview-isolated` 在三份 spec 一起跑時於 `enableSelection`（預覽已渲染、選取按鈕 10 秒內未出現）失敗一次，單獨重跑通過，記為間歇性失敗、未修正；第一次執行在另一個 session 的 vitest 同時執行（負載 14）時於 Live Preview 前置檢查逾時。執行期間建置、Build Preview 與 Live Preview 容器內的程序只映射了 `tanstack-start-1.168` 下的 glibc 原生二進位（rollup、兩份 lightningcss、tailwind oxide），musl 為 0；依容器類別的歸屬未確認（Build Preview 容器也看到 Start 工具鏈的二進位，原因未查）。映像：未壓縮 1.421 → 1.913 GB；gzip 壓縮（拉取大小的近似）整個映像 472 → 748 MB、基礎映像以上的層 252 → 529 MB；容器啟動（`docker run` 到 `/bin/true`）與 Start 工具鏈 `vite --version` 的時間在誤差內相同。映像中留有 npm 快取（舊 442 MB、新 186 MB），未在 A2a 移除；之後每個 `npm ci` 改用同一 RUN 內刪除的快取目錄，映像不再有 npm 快取，未壓縮 1.914 → 1.726 GB，三套識別不變（2026-10-09，本機）。未量：Cloudflare 上的拉取與冷啟動。**A2b 結果（2026-10-09，本機 Docker 與本機 Sandbox 路徑；Cloudflare 未驗）**：`@astrojs/cloudflare` 14.3.3 在有網路的容器中因上游錯誤（withastro/astro#18056，preview server 綁 `::1`、連線用 `127.0.0.1`）建置失敗，工具鏈升到修正版 14.3.4；升級後 R2 的 12 個情境在 Docker（無網路與 bridge）與經 `@cloudflare/sandbox` 的本機 `wrangler dev` 中全部與本機相同，前提 3 在這兩層成立；建置期間的監聽 socket 每一個都有已知用途，包括 SDK 的控制伺服器與本機 `proxy-everything` sidecar 共用網路命名空間的兩個 port；建置唯一的外部嘗試是 miniflare 取 `Request.cf`，連不到時退回預設值、建置成功（7.2.1）。Cloudflare 上的網路、外連政策與 sidecar 要等部署 |
| A3     | 預先渲染內容的可行性，以真實建置測試驗證（形式同 `src/lib/storefront/compiler/native-start-runner.test.ts`）                                                                            | R2 已在本機證明可行，A2b 已在 Docker 與本機 Sandbox 路徑確認 loopback（Cloudflare 未驗，7.2.1）；4.3 的三值測試全部符合：HTML 是封存的 A，不是預設值 D 或目前草稿 B；內容接口失敗（無快照、500、連線被拒、拿掉標頭）一律讓建置失敗，不退回預設值，fail-fast 與建置後檢查各自有效；記錄以每次建置的 nonce 綁定；`ASTRO_ADAPTER_INCOMPATIBLE` 與「stamp 數不等於預先渲染頁數」各有會觸發它的測試；4.3 的路徑測試清單全部通過；失敗的建置沒有產物，成功的產物中沒有包裝標記、`.prerender/`、`.morph/` 診斷檔。**任一項不成立就停止**，回到設計層。**結果（2026-10-09，本機真實建置；Sandbox 與 Cloudflare 未驗）：通過**（4.3.1）。三值測試的 HTML 是 A；四種失敗情境在 fail-fast 與只靠紀錄下各自失敗；nonce、`ASTRO_ADAPTER_INCOMPATIBLE`、stamp 數不符各有會觸發它的測試；`trailingSlash` 三種設定與中文路徑通過；失敗的建置留下 `.prerender/`，成功的沒有洩漏。與閘門文字的差異：判定由 `astroPrerenderRecordsFailure` 做，還沒有接進 `nativeBuildResult` 與 runner，因為 `astro` 要到 A4 才有框架 adapter；接入列為 A4 的工作。另一項決定：`build.format` 只支援 `"directory"`（4.3.1）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A4     | Astro 原生建置（本機建置程式，再到 Sandbox 建置程式）：包裝設定檔、匯入防護、產物整理、5.2 的規則、manifest、compiler 身分                                                              | 官方 Astro Cloudflare 範例以 fixture 原樣保存（`fixtures/astro/<example>/`，附 `SOURCE.json` 與逐檔雜湊，作法同 tanstack fixture），能建置的部分建置成功，不能的以 `KNOWN GAP` 斷言（例如 `SESSION`）；最簡單的 Astro Theme 加上 `session: false` 與 `imageService` 後建置成功，5.2 每一條拒絕規則各有一個會觸發它的測試；匯入防護放行專案別名與 Astro 虛擬模組，拒絕未核准的套件與工作區外的檔案。**A4a 結果（2026-10-09，本機建置程式；Sandbox 建置程式與 Cloudflare 未驗）**（5.2.1）：Astro adapter 只在伺服器開關下可用，沒有傳入開關時照舊拒絕；經過 `LocalViteThemeBuildRunner` 的真實建置：封存內容與兩階段的內容依賴判定、adapter 預設設定以 `ASTRO_SESSION_BINDING_UNSUPPORTED` 拒絕、未核准的套件被匯入防護拒絕；5.2 每一條規則與洩漏檢查各有測試；inspector port 由 module hook 關閉，workerd 不再帶 `--inspector-addr`，且產物逐檔雜湊相同。**A4b 未做**：Sandbox 建置程式、`MORPH_ASTRO_THEMES` 接上 factory、官方範例 fixture（需要使用者同意下載）、工作區外檔案與虛擬模組的明確測試、`imageService: "compile"`。**A4b 結果（2026-10-09）**（5.2.2）：Sandbox 建置程式支援 Astro，`MORPH_ASTRO_THEMES` 接上 factory（正式環境一律關閉）；假容器測試涵蓋指令、紀錄、fail-fast 後重建與別次紀錄；Sandbox 映像在無網路的 Docker 中以同一條指令建置成功、`nativeBuildResult` 判定成功；匯入防護拒絕工作區外的檔案、放行 Astro 虛擬模組。未驗：經過 Sandbox SDK 的真實容器 Astro 建置、`imageService: "compile"`。**官方 fixture（2026-10-09）**（5.2.3）：Cloudflare 官方範本與 adapter 14.3.4 的三個測試 fixture 原樣保存，每一個以 `KNOWN GAP` 斷言第一個拒絕它的關卡；得出五個尚未處理的缺口（Wrangler 設定必填、`src/` 下的二進位檔、`public/.assetsignore`、mdx／sitemap／rss 不在工具鏈、預設 `SESSION`）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A5     | Astro 的 Build Preview、發布、回滾，跑 G0 同一組驗收                                                                                                                                    | 真實容器中 G0 的五項對 Astro 全部通過；`SESSION` 的處理方式已決定並實作（基礎設施對應，或明確的替代方案） **結果（2026-10-09，本機真實容器；Cloudflare 未驗）：通過**（5.2.6）。網站層級的 `storefront_themes.framework`（migration 0077）由建置與 Live Preview 讀取；`SESSION` 維持建置時拒絕，以 `session: false` 作為明確的替代方案；驗收中補上 Theme Worker 的 `ASSETS` 綁定。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| A6     | Astro Live Preview（本機 sidecar，再到容器）：啟動程式、預覽包裝設定、Worker entry、無 router 的 client module、整頁重新載入的內容更新與選取恢復                                        | 經過真實的 `preview.tsx` 與 `/applyFiles`：`.astro` 修改的 `applied` → 重新 `ready` 流程正確，選取能恢復；2.5 表中的回應行為（串流、重新導向、Cookie、錯誤頁、HMR）在真實路徑上不變；第 7 節的安全探測（沒有 `.wrangler/state`；列出預覽容器實際的監聽 socket，每一個都有已知用途，標準同 7.2；容器政策記錄顯示外連被拒）；冷啟動時間與 Start 比較                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A7     | `.astro` 檔案語言：能在 Morph Worker 中執行的解析器、來源位置、實例識別、props、改寫                                                                                                    | R1 已選定解析器；解析器的執行位置已依 0.3 決定（專用解析器 Worker），M1c-C 已通過；3.1 的五項採用條件都已實作並各有測試；`request-structure` 的 `nodes` 不為空；完整 Design 鏈（選取實例 → 欄位 → 文件儲存（權限、文件版本、OCC）→ 該實例更新、其他實例不變），同一元件出現兩次各自編輯                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| A8     | 認證                                                                                                                                                                                    | A4–A7 通過，ISR／SSG 經 Core 的快取行為驗收（multi-runtime 計畫的規則），該「Astro × 版本」才轉為 Certified；在那之前是 Unverified，可以 Live Preview 與 Build Preview，不能發布                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

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
