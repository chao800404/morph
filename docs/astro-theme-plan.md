# Morph Astro Theme 接入設計（2026-10-07）

狀態：設計草案，供審查，尚未實作，Morph 程式碼未修改。這是 [`docs/multi-runtime-theme-plan.md`](multi-runtime-theme-plan.md)
交付順序第 4 步（Astro 接入）的設計。總體原則以該文件為準；建置、Build Preview、發布與回滾沿用
[`docs/start-native-import-plan.md`](start-native-import-plan.md) 的原生 TanStack Start 路線，本文件只寫
Astro 與它不同的地方。

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
- Morph `main` @ `0f832bd`：`src/lib/storefront/theme-framework/`、`compiler/theme-prerender-content.ts`、
  `compiler/theme-preview-start-runtime.ts`、`compiler/theme-preview-bridge-entry.ts`、
  `service/theme-worker-deployment-plan.ts`、`compiler/native-build-result.ts`。

版本基準（spike 實際解析到的版本）：Astro 7.3.5、`@astrojs/cloudflare` 14.3.3、`@cloudflare/vite-plugin`
1.62.5、Vite 8.3.3、wrangler 4.147.0、`@astrojs/react` 7.0.0、`@astrojs/vue` 7.0.3、`@astrojs/compiler-rs` 0.5.1。

## 0. 事實、待驗解法與待決選擇

### 0.1 【事實】

| 事實                                                                                                                                                                                    | 證據                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Astro 7.3.5 與 `@astrojs/cloudflare` 14.3.3 要求 Vite `^8.0.13`；Morph 唯一的工具鏈固定 Vite 7.3.5                                                                                      | 預覽報告 B1                                                                                                                                        |
| Astro 的 Cloudflare 預先渲染另起 `vite.preview({ configFile: false })`，每頁的請求只帶 URL，頁面看到的請求沒有 `x-morph-content-origin`；Start 的 `configurePreviewServer` 外掛不會生效 | 讀 `@astrojs/cloudflare` 的 `dist/prerenderer.js`、`dist/utils/prerender.js`                                                                       |
| 預設建置產物的 Worker 設定含 `kv_namespaces: SESSION`、`images: IMAGES`；設定 `cacheCloudflare()` 時含 `cache.enabled`                                                                  | 讀 spike 的 `dist/server/wrangler.json`                                                                                                            |
| 現有部署規則以 `FORBIDDEN_BINDING` 拒絕 KV；`images`、`cache` 不在禁止清單中，部署時被丟掉                                                                                              | `theme-worker-deployment-plan.ts`                                                                                                                  |
| Astro 的設定 schema 接受 `session: false`，adapter 在這時不加 `SESSION`；adapter 的 `imageService` 為 `"passthrough"` 或 `"compile"` 時，正式環境不需要 `IMAGES`                        | 讀 `astro/dist/core/session/config.js`、`@astrojs/cloudflare` 的 `dist/index.js`、`dist/utils/image-config.js`；**只讀了程式碼，沒有建置確認產物** |
| `@astrojs/compiler-rs` 0.5.1 經 `@astrojs/compiler-binding-<平台>` 載入原生 binding                                                                                                     | spike 的 `node_modules`                                                                                                                            |
| `.astro` 修改會整頁重新載入；`.tsx` island 修改是局部 HMR                                                                                                                               | 預覽報告 Run A／B                                                                                                                                  |
| `.astro` 頁面沒有實例識別，`request-structure` 回報 `nodes: []`                                                                                                                         | 預覽報告 B5                                                                                                                                        |
| bridge 的內容更新與導覽在沒有 TanStack Router 時不做任何事                                                                                                                              | `theme-preview-bridge-entry.ts`                                                                                                                    |
| relay 的 `applied` 不代表「這次寫入造成的更新已顯示」                                                                                                                                   | 預覽報告第 2 節                                                                                                                                    |
| adapter 預設會寫 `.wrangler/state`、開 inspector port；以 Morph 的 adapter 設定覆寫後這兩項消失                                                                                         | 預覽報告 Run A／B                                                                                                                                  |
| Live Preview 與 Build Preview 容器本來就是 `enableInternet = false`，對外請求一律交給拒絕政策                                                                                           | `src/server/preview-sandbox.ts`、`build-preview-sandbox.ts`                                                                                        |

### 0.2 【待驗】解法與對應閘門

| 解法                                                                                      | 節  | 閘門   |
| ----------------------------------------------------------------------------------------- | --- | ------ |
| 預先渲染：封存內容伺服器，加上只在 `prerender` 環境補標頭                                 | 4.3 | R2、A3 |
| `.astro` 解析器能在 Morph Worker 中執行，位置精準                                         | 3.1 | R1     |
| 實例識別在工作區規劃時改寫文字（依賴 R1）                                                 | 3.3 | R1、A7 |
| Live Preview 沿用 Start 的預覽 Worker entry，包住 Astro 入口，而且不改變 Astro 的回應行為 | 2.5 | R3、A6 |
| 以 `session: false`、`imageService` 讓產物不含 `SESSION`、`IMAGES`                        | 5.2 | R2、A4 |
| 整頁重新載入後恢復選取與捲動                                                              | 6.1 | A6     |
| 一個映像放多個工具鏈根目錄                                                                | 2.2 | A2     |

### 0.3 【待決】產品選擇

- 第一版不提供 Sessions：要求作者設定 `session: false`，還是等基礎設施對應提供每個商店自己的 KV（9.2）。
- 圖片：第一版要求 `imageService: "passthrough"` 或 `"compile"`，還是對應 Cloudflare Images。
- 解析器全部不可行時，`.astro` 的 Design 是否延後，只開放 Code 與 Live Preview。
- 是否向 Astro 上游提出「預先渲染請求可以帶標頭」的選項。
- `output: "static"` 的網站要不要支援。

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
   這正是 #130 為 Start 修掉的那一類錯誤。補救方案是【待驗】，驗收標準是「HTML 中是封存的內容」，
   不只是「標頭有送到」。
5. **建置、Build Preview、發布、回滾走同一條原生路線**：同一個產物整理、同一個部署規則、同一個隔離式
   Build Preview、同一個 `PUBLISH_BUILD_CONTENT_MISMATCH` 最終把關。Astro 只多了幾條產物拒絕規則，
   每一條都寫明拒絕的是哪個設定、怎麼偵測：adapter 加入的 `SESSION`、`IMAGES`，Workers Cache 設定，
   以及 `.prerender/`。
6. **`.astro` 實例識別的注入位置，取決於解析器的可行性閘門（R1）。** 首選是比照 TSX，由 Morph 在工作區
   規劃時改寫文字（理由見 3.3），但這要求解析器能在 Morph Worker 中執行，而 spike 用的
   `@astrojs/compiler-rs` 是原生 binding，不能。R1 通過之前，這個方案不算可行。
7. **Live Preview 中的 `.astro` 修改與內容更新一律重新載入整頁**（第一版）。bridge 的路由能力改由
   adapter 宣告，不再自己探測 `window.__morphPreviewRouter`。
8. **預覽橋接注入與外連隔離是兩件事。** 安全邊界是容器的網路政策；Worker entry 中的外連檢查只負責提供
   明確的錯誤訊息，不是安全邊界（2.5、7.1）。
9. **G0 阻擋的是接入與開放，不阻擋研究。** 原生 Start 的內容配對驗收（Build Preview、發布、過期發布拒絕、
   並行、回滾，真實容器）必須先通過，Astro 才能接進 `main`。解析器與預先渲染機制的小型實驗
   （R1–R3）可以先做：這些實驗不接 `main`，也不宣稱 Astro 已支援（第 8 節）。

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
- `@astrojs/compiler-rs` 透過 `@astrojs/compiler-binding-linux-<arch>-<libc>` 載入原生 binding，所以映像的
  架構與 libc 必須在認證組合中寫明。

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
  插入中文與 emoji 後位置仍然精準。frontmatter 取出範圍後交給 Babel（TypeScript）解析，用來讀 props 型別。
- **阻礙：`@astrojs/compiler-rs` 透過 `@astrojs/compiler-binding` 載入平台原生 binding**（spike 中為
  `compiler-binding-linux-x64-gnu`）。Design 的讀取與改寫，以及工作區規劃（3.3），都在 Morph 的 Worker
  中執行，原生 binding 在那裡不能載入。候選方案，依偏好排序：
  1. compiler-rs 若有 WASM 版 binding，而且能在 workerd 中執行，就使用它（未驗證是否有這個套件）；
  2. 改用 `@astrojs/compiler`（WASM）。它與 compiler-rs 的 AST 形狀不同，位置與錯誤行為要重新驗證；
  3. 都不行時，`.astro` 的 Design 不開放，Live Preview 只提供來源位置。這時改用預覽容器內的 Vite plugin，
     也就是預覽報告的作法，但這條路線產生的結果不能作為儲存的依據。
- 【待驗】**可行性閘門 R1（獨立實驗，不接 `main`）**：候選解析器放進實際的 Worker（`wrangler dev` 的 workerd，
  不是 Node）執行，以同一組樣本比對 compiler-rs 在 Node 中的結果：
  - 中文、emoji（含 surrogate pair 與組合字元）前後元素的位置，換算成行列後與原始檔一致；
  - frontmatter：範圍正確，含 `---` 內的 TypeScript、`import`、`export const prerender`；
  - 動態屬性：`class:list`、`{...spread}`、`attr={expr}`、`set:html`、`client:*` 指令；
  - 運算式中的 JSX（`{items.map(item => <li>…</li>)}`、條件式）、`<slot>`、`<Fragment>`、`<style>`、`<script>`；
  - 解析錯誤時的行為（不得丟出未捕捉的例外，也不得卡住 Worker）；
  - bundle 大小、冷啟動與單檔解析時間，在 Worker 的 CPU 與記憶體限制內。
    R1 通過之前，3.3 的「工作區規劃時改寫」只是首選方案，不視為可行。
- Morph 用來解析的版本與 Theme 工具鏈中的 Astro 編譯器版本可能不同。Morph 解析失敗的檔案，在 Design 中
  只能唯讀（「由程式碼控制」），Code 照常可以編輯；建置不受影響。

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
- 【待驗，依賴 R1】**注入時機的首選：工作區規劃時改寫文字，與 TSX 相同；不採用預覽報告第 5 節第 2 點的
  Vite `load` plugin。** 理由：
  1. 實例識別必須與 Design 儲存時的分析完全一致。在 Morph 中執行，保證程式碼與解析器版本相同；
     在容器內執行的 plugin 做不到這點。
  2. Live Preview 的檔案同步本來就在 Morph 端呼叫 `prepareSourcesForLivePreview`，`.astro` 走同一處，
     不必額外處理 Astro 編譯器 `enforce: "pre"` 的排序問題。
  3. 預覽報告也指出兩套 TSX 注入不能並存。TSX 繼續使用規劃時改寫，spike 中的 TSX transform 不帶進產品。
- 代價：前提是 3.1 的解析器能在 Morph Worker 中執行。如果最後只能退回第 3 個候選方案，這一節要重新設計。
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
   請求只帶 `Content-Type`。在 Worker 中，頁面的 `Request` 是以這個 POST 的標頭重建的，所以頁面看到的
   請求**沒有 `x-morph-content-origin`**。
3. adapter 的 `experimental.prerenderWorker.config` 把 `main` 寫死為
   `@astrojs/cloudflare/entrypoints/server`，所以 Morph 也不能透過 wrangler 設定換掉預先渲染 Worker 的入口。

如果什麼都不做，頁面讀不到 origin，Theme 退回元件預設值，建置成功，發布出去的就是預設值的靜態頁。
而且因為根本沒有發出讀取，refused-reads 也不會有任何記錄。

**設計**（【待驗】，閘門 R2、A3）：

- **封存內容伺服器**：Morph 的建置 integration（5.1 的包裝設定檔加入）在 `astro:build:start` 時於建置
  程序中啟動一個只聽 loopback 的 HTTP server，`astro:build:done` 時關閉。
  - 它只回答 `GET /_morph/content`，資料只來自 `.morph/` 中的 `NativePrerenderContent`（檔名、格式、
    產生函式 `createNativePrerenderContent` 都與 Start 相同）。
  - 回答不了的讀取追加到同一個 `.morph/prerender-refused-reads.ndjson`，由同一個 `nativeBuildResult` 讓建置失敗。
  - 回答與拒絕的邏輯從 `themePrerenderContentPluginSource` 抽成共用的 request handler，Start 的 preview
    middleware 與 Astro 的 server 共用它，不寫第二份。
- **標頭送達**：在 Vite 的 `prerender` 環境中（且只在這個環境），包住 `@astrojs/cloudflare/entrypoints/server`：
  - 為進入的頁面請求設定 `x-morph-content-origin`，值為上面那個 server 的 origin；
  - 在這一頁渲染期間，記錄每一次對內容 origin 的讀取結果：成功、被拒（404）、連線失敗、非 2xx、
    回應無法解析；
  - 其他外連一律拒絕，只為了讓錯誤訊息明確；建置期的外連隔離由 Sandbox 的網路政策負責（7.1）。
  - 頁面渲染完成後，把「pathname、讀取次數、失敗次數」送回封存內容伺服器
    （loopback 上的另一個路徑），由伺服器寫入 `.morph/prerender-stamped.ndjson`。workerd 不能寫檔，
    所以記錄一律經由這個伺服器。
- **建置失敗條件**（`nativeBuildResult`，判斷依據是讀取記錄，不是 HTML）：
  - 有被拒的讀取：`NATIVE_PRERENDER_CONTENT_UNAVAILABLE`（與 Start 相同）；
  - 有任何一頁的內容讀取失敗（連線失敗、非 2xx、無法解析）：`NATIVE_PRERENDER_CONTENT_READ_FAILED`。
    Theme 的讀取函式通常會 `catch` 錯誤並退回預設值，所以「頁面照常產生」不能當作讀取成功的證據；
  - 產物中任何一個預先渲染的 HTML 沒有對應的 stamped 記錄：`NATIVE_PRERENDER_CONTENT_ORIGIN_MISSING`。
    封存內容伺服器停掉或連不到時，記錄也送不回來，所以這種情況一樣會失敗，不會因為「沒有讀取」而通過。
    不讀內容的靜態頁本來就允許，所以「沒有讀取」本身不能當作錯誤；能證明標頭有送到的，只有這份記錄。
- **標頭有送到，不等於頁面讀到正確內容。** 驗收以 HTML 的實際內容為準（見下方 A3 的三值測試）。
- **不進產物**：上面的包裝只存在於 `prerender` 環境的 bundle 裡。Astro 的 `verifyArtifact` 以字串標記掃描
  `runtime/server/**`，找到就以 `NATIVE_PRERENDER_SHIM_LEAKED` 拒絕。`.prerender/` 目錄也不得進入產物（5.2）。

**必須先驗證的前提**（R2 為獨立實驗，可以在 G0 之前做；A3 是接入 `main` 前的真實建置測試）：

1. Astro core 在 workerd 預先渲染時，會把請求標頭原樣交給頁面，而不是另外清空或警告；
2. 只套用在 `prerender` 環境的 plugin 能夠包住那個入口；
3. workerd 中的預先渲染 Worker 連得到建置程序的 loopback（本機 miniflare 與 Sandbox 容器都要驗）。

**任何一項不成立，Astro 接入就停在這裡**，回到設計層決定，不悄悄改成新的資料管道。

**A3 的三值測試**（形式同 `src/lib/storefront/compiler/native-start-runner.test.ts`，真實建置）：同一個欄位準備三個不同的值，
元件預設值 D、封存快照中的 A、建置後才改的目前草稿 B。

| 情境                               | 預期                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------- |
| 正常建置                           | 預先渲染的 HTML 含 A，不含 D、不含 B                                   |
| 沒有快照                           | 建置失敗（`NATIVE_PRERENDER_CONTENT_UNAVAILABLE`），沒有產物           |
| 封存內容伺服器回 500               | 建置失敗（`NATIVE_PRERENDER_CONTENT_READ_FAILED`）                     |
| 封存內容伺服器沒有啟動（連線被拒） | 建置失敗（`NATIVE_PRERENDER_CONTENT_ORIGIN_MISSING` 或 `READ_FAILED`） |
| 拿掉標頭送達                       | 建置失敗（`NATIVE_PRERENDER_CONTENT_ORIGIN_MISSING`）                  |
| 不讀內容的靜態頁                   | 建置成功                                                               |
| 部署的 Worker 產物                 | 不含包裝的標記，也沒有 `.prerender/`                                   |

任何一種失敗情境下，如果建置成功並產生含 D 的 HTML，A3 就不通過。

**被否決的作法**：

- 包裝檔把 `prerenderEnvironment` 改成 `"node"`：這等於改變專案自己的建置方式，SSR 程式碼也會在 Node
  而不是 workerd 中預先渲染，違反「建置執行 Theme 自己的設定」。
- 讓 Theme 讀環境變數或 `Astro.locals`：新的資料管道。
- 以 HTML 有無預設值判斷：Start 已經決定判定依據是讀取，不是 HTML。

**路由與封存範圍**：

- `createNativePrerenderContent` 需要 `ThemeRouteRegistry`。Astro adapter 的 `routes` 從 `src/pages/**`
  的檔名產生：`[param]`、`[...rest]` 是動態路由，其餘是靜態路由。
- 動態路由經 `getStaticPaths` 產生的頁面，路徑在建置前無法得知，讀內容時會被拒絕
  （`NATIVE_PRERENDER_PATH_NOT_SEALED`），規則與 Start 相同。這列為已知缺口：第一版中讀 Morph 內容的動態
  頁面不能預先渲染，要改用 SSR。
- CMS 指定 SSG 的發布限制（`PUBLISH_RENDER_POLICY_NOT_READY`）不變。

## 5. 建置、Build Preview、發布、回滾

與原生 Start 同一條路線。下表只列 Astro 不同或需要確認的地方：

| 環節          | 共用（不改）                                                                                       | Astro 專屬                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 輸入          | materializer、`buildMode: "native"`、`inputHash`、開關預設關閉、正式環境拒絕                       | 輸入記錄 `framework: "astro"` 與工具鏈 id；compiler 身分為 `astro-native`                 |
| 執行          | 兩個建置程式、只拿到必要環境變數、Sandbox 不外連                                                   | 命令為 `astro build --config .morph/astro.build.config.mjs`；`ASTRO_TELEMETRY_DISABLED=1` |
| 產物          | `.wrangler/deploy/config.json` → Worker 設定 → `runtime/server`、`runtime/client`；manifest 與雜湊 | 排除 `prerenderWorkerConfigPath` 指向的目錄；adapter 自動加入的綁定（5.2）                |
| Build Preview | 每個權杖一個隔離實例、只載入該 build 的產物、外連政策只回答自己的 `/_morph/content`                | 無                                                                                        |
| 發布          | 重用預覽過的 build、`buildContentCurrent`、`PUBLISH_BUILD_CONTENT_MISMATCH`、只有 Certified 能發布 | 無                                                                                        |
| 回滾          | release 指回舊 build，部署該 build 的產物                                                          | 拒絕產物 Worker 設定中的 `cache.enabled`（5.2）；Theme 程式自行使用的快取不在偵測範圍內   |

### 5.1 包裝設定檔

`.morph/astro.build.config.mjs` import Theme 的 `astro.config.*`（不修改），保留它的 `integrations` 並在最後
加上 Morph 的建置 integration。這個 integration 只做三件事：

1. **匯入防護**：沿用 `nativeImportGuardPluginSource`（依解析後的位置判斷）。Astro 的虛擬模組
   （`astro:*` 解析成 `\0` 開頭的 id）是否已被既有的「略過 `\0`／`virtual:`」規則涵蓋，要在 A4 確認；
   不夠的部分以 adapter 的 `devInfrastructureAllowances` 補，不在防護中寫死 Astro 字串。
2. **封存內容伺服器**與 **`prerender` 環境的標頭送達**（4.3）。
3. 沒有其他事。不覆寫 adapter，不改 `output`，不加任何進入 Worker 的程式。

Wrangler 設定副本與 Start 相同，以 `CLOUDFLARE_VITE_WRANGLER_CONFIG_PATH=.morph/wrangler.json` 提供。
adapter 在 `astro:config:setup` 中會呼叫 `loadWranglerEnv(config.root, configPath)`，它讀哪些檔案、會不會讀到
工作區中的 `.dev.vars`／`.env` 要在 A4 確認。工作區本來就不放這些檔案（2.3），所以確認的目的是讓規則有依據。

### 5.2 Astro 的產物規則

【事實】spike 建置後，`dist/server/wrangler.json` 中有以下內容（證據：spike 的 `dist/server/wrangler.json`
與 `.wrangler/deploy/config.json`）。

原則：Morph 不支援的項目，**在建置時明確拒絕，並說明拒絕的是哪個設定、作者可以怎麼改**；不在部署時才拒絕，
也不默默丟掉。每一條規則只檢查「產物 Worker 設定中的某個欄位」，所以寫得出確切的偵測方法；
Theme 程式碼中的行為不在這個範圍內。

| 產物 Worker 設定中的欄位                                            | 來源                                                                        | 現有部署規則的結果                                                                         | 設計（偵測方式：讀 `.wrangler/deploy/config.json` 指向的 Worker 設定）                                                                                                           |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kv_namespaces` 含 `SESSION`（或 `sessionKVBindingName`）           | Theme 沒有設定 `session: false`，也沒有指定其他 driver 時，adapter 自動加入 | `planThemeWorkerDeployment` 以 `FORBIDDEN_BINDING` 拒絕，但要到 Build Preview 或發布才發現 | 建置時以 `ASTRO_SESSION_BINDING_UNSUPPORTED` 拒絕，訊息說明可在 `astro.config` 設定 `session: false`                                                                             |
| `images`（Images 綁定）                                             | adapter 的 `imageService` 為預設的 `"cloudflare-binding"`                   | 不在禁止清單中，部署時被默默丟掉；之後執行期的圖片端點會失敗                               | 建置時以 `ASTRO_IMAGES_BINDING_UNSUPPORTED` 拒絕，訊息說明可改用 `imageService: "passthrough"` 或 `"compile"`。另外建議把 `images` 加入部署的禁止清單（部署規則的修改，另開 PR） |
| `cache.enabled === true`                                            | Astro 設定 `cache.provider: cacheCloudflare()`                              | 部署時被丟掉，`Astro.cache` 的實際效果未知                                                 | 建置時以 `ASTRO_WORKER_CACHE_UNSUPPORTED` 拒絕。ISR 快取由 Core 以 storefront 與 release 為鍵；這個設定開啟的是 Theme Worker 自己的 Workers Cache，鍵中沒有 release              |
| `prerenderWorkerConfigPath` 指向的目錄（`dist/server/.prerender/`） | adapter 的 workerd 預先渲染                                                 | 共用的產物整理會把 server 目錄下的所有檔案都帶入                                           | 整理時排除；若仍有任何檔案出現在 `runtime/server/.prerender/`，驗證失敗                                                                                                          |
| `main: "entry.mjs"`、`no_bundle: true`、`rules`                     | adapter                                                                     | 部署規劃把 server 目錄的每個檔案當作 module 上傳                                           | 預期可用，未驗證：在 A5 以 Build Preview 與店面實際執行確認                                                                                                                      |
| `_headers`（client 資產）                                           | Astro                                                                       | 在 `ASSET_EXCLUSIONS` 中，不會送出                                                         | 不拒絕；Theme 寫的回應標頭不生效。與 Start 相同，但 Astro 專案較常使用，所以在 Code 模式顯示診斷                                                                                 |

**快取規則的範圍。** `ASTRO_WORKER_CACHE_UNSUPPORTED` 只拒絕上表那一個設定欄位，**不代表 Morph 能找出 Theme
所有自行使用快取的程式碼**。例如 Theme 程式直接呼叫 Cache API（`caches.default`、`caches.open`），或其他
Astro 快取 provider，都不會被這條規則發現。這些情況下，回滾是否仍然只等於「換 build」，要由執行期的隔離
（例如 Theme Worker 的快取範圍是否以 release 區分）來保證，列為 9.2 的待決事項。Start 也有同樣的問題，
不是 Astro 特有的。

**官方停用方式（【事實】只讀了程式碼；【待驗】產物）**：Astro 的設定 schema 接受 `session: false`，
adapter 這時不加入 `SESSION`；`imageService` 為 `"passthrough"` 或 `"compile"` 時，adapter 不要求正式環境的
`IMAGES`（`"compile"` 在 dev 時仍會加入）。R2 與 A4 要以真實建置確認：最簡單的 Astro Theme（一頁、沒有
Sessions、沒有圖片處理），只加上這兩項設定，就能通過上表全部規則並建置成功。如果做不到，第一版連最簡單的
Theme 都無法建置，接入不往下進行，回到 9.2 決定是否提供 `SESSION` 的對應。

這兩項設定是作者要寫進自己 `astro.config` 的官方寫法，Morph 不在包裝檔中替作者覆寫。因此官方範例**原樣**
匯入時會被拒絕，fixture 驗收（A4）把它記為 `KNOWN GAP`，直到 Sessions 有對應。

`native.verifyArtifact`：Worker 入口、client 資產、內容要求的預先渲染頁（沿用 `assertThemePrerenderArtifacts`；
Astro 的輸出格式是 `about/index.html`，與 Start 的路徑對應要在 A4 確認），加上上表的拒絕與 4.3 的兩項檢查。
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

| 項目                                | adapter 預設                                                            | Morph 的處理                                                             | 驗證狀態                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| miniflare 狀態持久化                | 寫入工作區 `.wrangler/state`（Run A 寫了 6.2 MB 的 kv/d1/r2/do/images） | 預覽：`persistState: false`；工作區不同步、不算指紋、不讀回 `.wrangler/` | Run B 通過（沒有寫入）                                                       |
| inspector（除錯 port）              | 開啟（Run A 為 9230）                                                   | 預覽：`inspectorPort: false`                                             | Run B 通過（沒有警告）；容器中是否仍有其他 port 在聽，未驗證                 |
| 遠端綁定                            | 綁定設定 `remote: true` 時連到 Cloudflare                               | 預覽：`remoteBindings: false`；建置：沙箱沒有網路，也沒有憑證            | **未驗證**實際效果                                                           |
| `SESSION` KV、`IMAGES` 綁定自動加入 | 預設啟用，log 印出「Enabling … binding」                                | 預覽：Worker 不給任何綁定（與 Start 相同）；建置：產物規則拒絕（5.2）    | 預覽中綁定是否仍出現在 `env`，**未驗證**；建置產物中確實存在（已讀產物確認） |
| Workers Cache（`cache.enabled`）    | `cacheCloudflare()` 時開啟                                              | 建置拒絕這個設定欄位（5.2）；Theme 程式自行使用的快取不在範圍內          | 只讀了產物，沒有執行                                                         |
| 開發工具列                          | dev 預設開啟                                                            | 預覽：`devToolbar: { enabled: false }`                                   | spike 設定為關閉；開啟時的網路行為未調查                                     |
| 遙測                                | Astro CLI 會傳送匿名遙測                                                | 預覽與建置設定 `ASTRO_TELEMETRY_DISABLED=1`                              | 沒有網路時是否會拖慢啟動，未驗證                                             |
| `.env`／`.dev.vars`                 | `loadWranglerEnv` 從專案根目錄讀取                                      | 工作區不放這些檔案（2.3）                                                | 讀取的確切檔案清單**未驗證**                                                 |
| 伺服器端外連（預覽、建置）          | 不限制                                                                  | 見 7.1：安全邊界是容器的網路政策                                         | 見 7.1                                                                       |
| `/@fs/` 讀取工作區外的檔案          | Vite `server.fs.strict`                                                 | 沿用 `fs.allow`                                                          | Run A：`/@fs/etc/passwd` 回 403；Run B 未測                                  |

### 7.1 外連隔離：與橋接注入分開

**安全邊界是容器的網路政策，不是 Worker 裡的檢查。** Worker 中的 JavaScript 檢查看不到主機名稱實際解析到
哪裡，Theme 程式也可能不經過被包住的 `fetch`（例如用其他 API 或直接開 socket），所以它不能承擔安全邊界。
`previewOutboundRefusal` 的註解也寫明它「只是第一層」。

| 層                     | Live Preview                                                                                                 | 建置（含預先渲染）                                                | Build Preview                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| **邊界：容器網路政策** | 【事實】`PreviewSandbox`：`enableInternet = false`、`interceptHttps`，對外請求一律交給 `refusePreviewEgress` | 【事實】Sandbox 建置容器不能外連（start-native-import-plan）      | 【事實】`BuildPreviewSandbox`：同上，只回答自己的 `/_morph/content` |
| 輔助：Worker 內的檢查  | 預覽 Worker entry 的 `previewOutboundRefusal`（2.5），只負責給 Theme 作者明確的錯誤訊息                      | `prerender` 環境的包裝拒絕非內容讀取，只負責明確的錯誤訊息（4.3） | 無（產物原樣執行，不注入）                                          |

- 不論 2.5 最後採用 Worker entry 還是 `injectScript`，上表的邊界都不變。所以橋接方案的選擇不影響安全性；
  兩個方案的差別只在錯誤訊息是否清楚。
- **本機 sidecar 不是安全邊界。** 它在開發者自己的機器上以 loopback 執行 Theme 程式，與 Start 相同，只供
  開關開啟的開發與測試環境使用。Astro 預覽在本機時，Theme 伺服器程式實際上可以對外連線；Worker 內的檢查
  只是讓開發者看到與容器中相同的錯誤。
- 【待驗】Astro 預覽與建置在容器中，各會發出哪些對外請求（Astro 遙測、wrangler、套件解析等），要在 A2、A4、A6
  中從政策記錄確認都被拒絕，而且被拒不會讓啟動卡住。

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

### 8.2 接入步驟

| 步驟   | 內容                                                                                                                                                                                    | 閘門（通過才能進入下一步）                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G0** | 原生 Start 內容配對驗收（不屬於 Astro，但是 Astro 接入 `main` 與開放的前提；不阻擋 8.1 的研究）                                                                                         | 真實容器中：（1）Build Preview 顯示封存的草稿；（2）發布重用預覽過的 build，產物雜湊相同；（3）build 之後草稿又被修改，發布時重新建置，或被 `PUBLISH_BUILD_CONTENT_MISMATCH` 拒絕；（4）兩個並行的建置或發布不會配錯內容，OCC 拒絕落後的一方；（5）回滾後店面的 build 與內容一起回到舊版。本文件撰寫時（`0f832bd`），`e2e/native-publish-acceptance.spec.ts` 只涵蓋了不讀內容的路由的發布與回滾；（1）、（3）、（4）在 `e2e/` 中找不到對應的真實容器驗收 |
| A1     | 框架身分：`ThemeFrameworkId` 加入 `astro`、build 輸入記錄框架、`nativeBuildResult` 與預覽 runtime 依記錄選 adapter、Start 原生建置的共用部分搬到共用模組。只有 Start 一個實作，行為不變 | 既有測試、Start 的 E2E 不變；新增測試：build 輸入的框架被改動時 `inputHash` 也會改變；`theme-framework.test.ts` 的介面規則仍然成立                                                                                                                                                                                                                                                                                                                       |
| A2     | 工具鏈「框架 × 版本」：多工具鏈根目錄、產生器、映像、本機 `toolchainProblem` 依 adapter 判斷                                                                                            | Start 工具鏈的內容雜湊不變；Astro 工具鏈從自己的根目錄解析到 Vite 8；量測映像大小、Node 版本與容器冷啟動時間                                                                                                                                                                                                                                                                                                                                             |
| A3     | 預先渲染內容的可行性，以真實建置測試驗證（形式同 `src/lib/storefront/compiler/native-start-runner.test.ts`）                                                                            | R2 已證明可行；4.3 的三值測試全部符合：HTML 是封存的 A，不是預設值 D 或目前草稿 B；內容接口失敗（無快照、500、連線被拒、拿掉標頭）一律讓建置失敗，不退回預設值；部署的 Worker 中沒有包裝標記。**任一項不成立就停止**，回到設計層                                                                                                                                                                                                                         |
| A4     | Astro 原生建置（本機建置程式，再到 Sandbox 建置程式）：包裝設定檔、匯入防護、產物整理、5.2 的規則、manifest、compiler 身分                                                              | 官方 Astro Cloudflare 範例以 fixture 原樣保存（`fixtures/astro/<example>/`，附 `SOURCE.json` 與逐檔雜湊，作法同 tanstack fixture），能建置的部分建置成功，不能的以 `KNOWN GAP` 斷言（例如 `SESSION`）；最簡單的 Astro Theme 加上 `session: false` 與 `imageService` 後建置成功，5.2 每一條拒絕規則各有一個會觸發它的測試；匯入防護放行專案別名與 Astro 虛擬模組，拒絕未核准的套件與工作區外的檔案                                                        |
| A5     | Astro 的 Build Preview、發布、回滾，跑 G0 同一組驗收                                                                                                                                    | 真實容器中 G0 的五項對 Astro 全部通過；`SESSION` 的處理方式已決定並實作（基礎設施對應，或明確的替代方案）                                                                                                                                                                                                                                                                                                                                                |
| A6     | Astro Live Preview（本機 sidecar，再到容器）：啟動程式、預覽包裝設定、Worker entry、無 router 的 client module、整頁重新載入的內容更新與選取恢復                                        | 經過真實的 `preview.tsx` 與 `/applyFiles`：`.astro` 修改的 `applied` → 重新 `ready` 流程正確，選取能恢復；2.5 表中的回應行為（串流、重新導向、Cookie、錯誤頁、HMR）在真實路徑上不變；第 7 節的安全探測（沒有 `.wrangler/state`、沒有 inspector、容器政策記錄顯示外連被拒）；冷啟動時間與 Start 比較                                                                                                                                                      |
| A7     | `.astro` 檔案語言：能在 Morph Worker 中執行的解析器、來源位置、實例識別、props、改寫                                                                                                    | R1 已選定解析器；`request-structure` 的 `nodes` 不為空；完整 Design 鏈（選取實例 → 欄位 → 文件儲存（權限、文件版本、OCC）→ 該實例更新、其他實例不變），同一元件出現兩次各自編輯                                                                                                                                                                                                                                                                          |
| A8     | 認證                                                                                                                                                                                    | A4–A7 通過，ISR／SSG 經 Core 的快取行為驗收（multi-runtime 計畫的規則），該「Astro × 版本」才轉為 Certified；在那之前是 Unverified，可以 Live Preview 與 Build Preview，不能發布                                                                                                                                                                                                                                                                         |

順序的理由：先處理資料完整性（內容配對、發布、回滾，A3–A5），再處理編輯體驗（A6–A7）。在 A3 之前就做
Live Preview，可能做完才發現 Astro 的預先渲染沒辦法安全地讀封存內容。

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
- 4.3 的三項前提（標頭送達頁面、只套用在 `prerender` 環境的包裝、workerd 連到 loopback），以及頁面實際使用
  封存快照（R2、A3）。
- 2.5 的前提：Astro dev 的請求是否經過 wrangler `main`；包裝後串流、重新導向、Cookie、錯誤頁、HMR 是否不變（R3）。
- `session: false` 與 `imageService` 設定後，產物是否確實不含 `SESSION`、`IMAGES`（只讀了程式碼）。
- `@astrojs/compiler-rs` 有沒有能在 workerd 中執行的 WASM binding；`@astrojs/compiler`（WASM）的位置精準度。
- Morph 的 dependency enforcer、`themePreviewContentPlugin`、SVG 隔離、root-public plugin 在 Astro 下的行為。
- `loadWranglerEnv` 讀取的檔案；Astro 遙測在無網路環境中的行為。
- `assertThemePrerenderArtifacts` 的路徑規則與 Astro `build.format` 的對應。
- Astro Worker（`no_bundle`、`rules`、`nodejs_als`）在 Morph 部署規劃與 Build Preview 執行器下能否正常執行。

### 9.2 未決事項（需要決定）

- 第一版的 Sessions：不提供，要求作者設定 `session: false`（R2 確認可行時）；或等基礎設施對應，或先為每個商店
  提供一個 Morph 擁有的 KV namespace。在提供之前，官方範例原樣匯入無法建置。
- 第一版的圖片：要求 `imageService: "passthrough"` 或 `"compile"`，或對應 Cloudflare Images。
- Theme 程式自行使用的快取（Cache API 等）在回滾後的行為：要不要在執行期以 release 隔離 Theme Worker 的快取
  範圍。這不是 Astro 特有的問題，Start 也一樣。
- 映像策略：一個映像多個工具鏈根目錄，或每個框架一個映像（A2 量測後決定）。
- `.astro` 解析器的選擇（3.1），以及全部不可行時 `.astro` Design 是否延後。
- 是否向 Astro 上游提出「預先渲染請求可以帶標頭」的選項。如果上游接受，4.3 的包裝可以移除。
- 6.2 的「applied 帶寫入路徑」是否要做，以及 Vite payload 能不能提供觸發檔。
- 建立網站時的框架選擇介面（multi-runtime 計畫第 5 步），以及 Astro starter Theme 的內容讀取函式放在哪裡、
  叫什麼名字。
- `output: "static"`（沒有 Worker）的 Astro 網站要不要支援，以及支援時對應到哪一種產物。
