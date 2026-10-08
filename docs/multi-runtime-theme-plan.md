# Morph 多框架 Theme 規劃（2026-10-06）

狀態：規劃，尚未實作。取代「Theme 只能是 TanStack Start」的前提；TanStack Start 的細節改為本文件
下的其中一種框架，見 [`docs/start-native-import-plan.md`](start-native-import-plan.md)。

更新（2026-10-08）：使用者的目標改為「盡量支援 Vite 能建置的框架」。加入支援層級（L1 託管、L1.5 點選定位、
L2 視覺改寫、L3 認證）、新的接入順序（Astro 之後是 React Router，再來是通用 Vite 託管與 Next.js），以及
點選定位的參考做法與 L2 改寫引擎的套件邊界。各層級的能力不互相代表：L1 通過不代表 Design 可用，
L1.5 的定位也不是儲存授權或改寫安全的證據。

## 產品目標

Morph CMS 本體維持 TanStack Start。網站前端（Theme）可以用不同框架撰寫：

```text
建立網站時選擇框架（或匯入既有專案，由 package.json 自動偵測）
→ Code 看到的是該框架的原生寫法
→ Design 修改同一份原始碼
→ 建置執行專案自己的建置流程
→ 產物放在 Morph Core 後面，部署到 Cloudflare
```

使用者選的是**框架**（TanStack Start、Astro……），不是「語言」。React、Vue、Solid 是元件寫法，
可以在框架內使用，例如 Astro 網站裡的 React 或 Vue 元件。

## 已定原則

1. **框架在建立網站時決定，不提供一鍵轉換。** 一個網站一份原始碼（單一網站工作區）。要換框架就
   建立新的原始碼，預覽通過後發布；不做 Astro ↔ TanStack Start 之類的自動轉換。
2. **能建置、預覽、發布的範圍盡量放寬；能在 Design 中改寫的範圍逐一接入。**（2026-10-08 修訂）
   以 Vite 加上 Cloudflare 建置成 Worker（或純靜態輸出）的專案，目標是走同一條通用路線託管（L1，見下節）。
   完整的 Next.js、Nuxt、SolidStart 等專案各自有路由、server functions 與執行環境，要轉為 Certified
   仍須逐一驗證（L3）；Design 的改寫依檔案語言逐一接入（L2）。
3. **Morph 的契約與框架無關，框架只是可替換的接入層。** 契約見下節；任何框架都不得另建一套內容、
   商務、身分或發布路徑。
4. **Design 的改寫能力依「檔案語言」區分，不依「框架」區分。** 同一個 TSX 改寫器服務 TanStack
   Start、Astro 裡的 React 元件與 vinext；新增框架時，已支援的檔案語言不必重做。
5. **相容狀態沿用三級制**（Certified／Unverified／Blocked，見 start-native-import-plan 的工具鏈章節），
   以「框架 × 版本」為單位認證。只有 Certified 能發布。
6. **框架認證與 Design 能力分開。** 框架認證只表示能預覽、建置、發布；Design 能做什麼另依檔案語言
   逐項列出（見「檔案語言接入層」），介面分別顯示。例如 Astro 網站已認證，其中的 Vue 元件仍可能只能
   編輯欄位、不能改原始碼樣式。
7. **限制綁定實測組合，不寫成永久規則。** 已知問題（例如 React 與 Vue 混用）以實測的套件版本組合
   列為 Unverified，上游修正並通過驗證後即可轉為 Certified。

## 支援層級（2026-10-08）

| 層級              | 涵蓋範圍                                                                 | 使用者能做的事                                                                                                                   | 每多一種的成本                         |
| ----------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **L1 託管**       | 以 Vite 加 `@cloudflare/vite-plugin` 建置成 Worker 的專案，或純靜態輸出  | Code、Live Preview（內容變動時整頁重新載入）、Build Preview、發布、回滾；以 SDK 讀 CMS 內容；`.fields.ts` 右側欄位；預先渲染讀封存內容 | 接近零，走同一條通用路線               |
| **L1.5 點選定位** | 任何已接入 L1、而且檔案語言有來源位置注入的專案                          | 在畫面上點選元素，跳到 Code 中對應的那一行；內容仍以 `.fields.ts` 欄位編輯；**不在畫面上改寫原始碼**                                     | 每種檔案語言一個來源位置注入           |
| **L2 視覺改寫**   | 依檔案語言逐一接入：`.tsx`（已完成）、`.astro`、之後 `.vue`、`.svelte`…  | 選取實例、改樣式與文字、把字面值升級成欄位，經 Core 的權限、來源版本與 OCC 寫入                                                       | 每種檔案語言一個解析器與改寫器         |
| **L3 認證**       | 特定「框架 × 版本」                                                      | 通過整套驗收、工具鏈固定，標為 Certified；只有 Certified 能發布（原則 5）                                                            | 每個版本一次驗收                       |

L1 能通用，是因為內容配對、內容依賴的證明、Build Preview、release 預覽、發布與回滾處理的都是「產物加上
內容」，不依賴框架（start-native-import-plan 第 3 步）。框架之間的差別在產物位置、預先渲染的觸發方式與
開發伺服器的啟動方式，由接入層描述。只能在 Cloudflare Workers 執行的限制不變：依賴完整 Node 環境的功能
必須明確回報不支援，不能靜默失敗。

## 支援範圍

| 階段   | 框架                                   | 狀態目標      | 說明                                                                                    |
| ------ | -------------------------------------- | ------------- | --------------------------------------------------------------------------------------- |
| 第一版 | TanStack Start（React）                | Certified     | 現有實作；原生匯入依 start-native-import-plan 進行                                      |
| 第一版 | Astro（`.astro` + React／Vue 元件）    | Certified     | 2026-10-06 驗證通過（見下）。靜態 HTML 模板以 `src/pages/*.html` 放進 Astro，不另設框架 |
| 第二個接入 | React Router（原 Remix）         | 先 Unverified | 2026-10-08 排在 Astro 之後。官方 Cloudflare Vite plugin 支援，建置路線同 Start；檔案語言是 TSX，L2 沿用現有改寫器。輪到時再選定版本（Cloudflare 文件已從 v7 改寫為 v8） |
| 之後   | 通用 Vite 託管（L1）：SvelteKit、SolidStart、Vue 等 | 先 Unverified | 先求能建置、預覽、發布；SvelteKit 用自己的 `adapter-cloudflare`，SolidStart 在 Cloudflare 文件標為 Beta |
| 之後   | Next.js（經 vinext）                   | 先 Unverified | vinext 1.0（2026-09-28）以 Vite 重新實作 Next.js API；官方仍提醒非所有專案都能直接替換，npm 上仍為 beta  |
| 之後   | Nuxt、TanStack Start Solid             | 先 Unverified | 依需求逐一接入                                                                          |

## 框架無關的 Morph 契約

每種框架都必須遵守，接入層只負責把它翻成該框架的寫法：

| 契約       | 內容                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 內容欄位   | 元件旁的 `<Name>.fields.ts` 宣告欄位；欄位名稱即同名 prop（見下節）。內容存在 Morph，發布時凍結                                        |
| 商務       | 商品、購物車、結帳、會員一律呼叫 Morph Core；Theme 不另建資料來源，結帳金額由 Core 重新驗證                                            |
| 來源位置   | Live Preview 中每個 HTML 元素帶 `data-morph-loc="src/<file>:<line>:<column>"`，只負責定位原始碼                                        |
| 實例與內容 | 沿用現有的 `data-storefront-section-id`、`data-storefront-item-id`、`data-storefront-field(-path)`，決定修改哪一份內容；與來源位置分開 |
| 預覽橋接   | 選取、反白、HMR 通知、內容即時更新使用同一套編輯器協定                                                                                 |
| 產物       | 一個 Cloudflare Worker 加靜態資產，放在 Core 的 service binding 後面；訪客請求不直接進 Theme Worker                                    |
| 渲染規則   | SSG／SSR／ISR 由 Morph 凍結 Render Plan；ISR 的快取識別由 Core 加上 storefront 與 release                                              |
| 基礎設施   | D1、KV、R2、Secrets 以對應方式提供，包括框架 adapter 自動加入的綁定（例如 Astro 的 `SESSION`、`IMAGES`）                               |
| 建置與依賴 | 不可信沙箱、Theme 依賴快照、外連政策、建置來源紀錄，沿用 start-native-import-plan                                                      |

## 框架接入層（Runtime adapter）

每種框架提供：

| 能力         | 說明                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| 偵測         | 由 `package.json` 依賴判斷框架與版本（`@tanstack/react-start`、`astro`、`vinext`……）                           |
| Live Preview | 在預覽容器啟動該框架的開發伺服器，並注入預覽橋接與來源位置                                                     |
| 建置         | 執行專案自己的建置流程，提供部署環境輸入（Wrangler 設定路徑、內容環境變數），不注入 plugin                     |
| 產物         | 找到並整理產物，在沙箱外檢查，並描述給產物儲存與發布（目標：原生建置經 `.wrangler/deploy/config.json` 找產物） |
| 路由與渲染   | 讀取路由清單與各頁渲染方式，產生 Render Plan                                                                   |

### 第 2 步現況（`src/lib/storefront/theme-framework/`）

介面 `ThemeFrameworkAdapter` 目前只有：`id`、`detect`、`planWorkspace`（預覽與建置的工作區）、
`preview.framePath`、`build.artifactEntry`／`verifyArtifact`／`manifestMetadata`。介面上沒有任何
權限、OCC、內容文件、發布或回滾的方法；`theme-framework.test.ts` 鎖住介面的欄位，並在框架層或檔案語言層
匯入共用核心模組時失敗。檔案語言層的 TSX 部分在 `src/lib/storefront/source-language/tsx-source-language.ts`
（預覽的身分標記與 `contentFields` 提升、建置的標記移除），工作區規劃與 Live Preview 同步共用它。

盤點時確認、與本文件先前假設不同的現況：

- 產物目前是 Morph 自己的配置：`dist/runtime/{server,client}` 與 `dist/preview`，發布讀
  `runtime/server/wrangler.json`；原始碼中沒有任何地方讀 `.wrangler/deploy/config.json`。「經
  `.wrangler/deploy/config.json` 找產物」是原生建置（第 3 步）的目標，不是現況。
- 本機建置程式（`local-vite-theme-build-runner.ts`）只在測試中使用；正式建置只走 Cloudflare Sandbox。
- 產生的 `vite.config.ts` 文字與入口檔仍由 `theme-sandbox-workspace.ts` 產生，屬於 TanStack Start
  adapter 的內部實作；第 3 步原生建置時改為執行專案自己的設定。
- 目前只有一個框架，`themeFramework()` 對所有 Theme 回傳它，包括沒有路由的舊單一入口 Theme。
  （2026-10-08，Astro 計畫 A1）adapter 改為依紀錄選擇：build 記錄框架（`storefront_theme_builds.framework`，
  NULL 為 TanStack Start），`resolveThemeFramework` 是唯一把「沒有紀錄」讀成 Start 的地方；`astro` 只是 id，
  選到時以 `THEME_FRAMEWORK_UNAVAILABLE` 拒絕。Live Preview 的啟動輸入也帶框架，但網站層級的紀錄要到第 6 步
  （建立網站時選擇框架）才有，目前沒有呼叫者傳入，一律讀成 Start。

## 檔案語言接入層（Source adapter）

Design 需要的能力，依檔案語言實作。「實例與內容識別」與「來源位置」是兩個注入，不能互相取代：

| 檔案語言       | 來源位置注入                                        | 實例與內容識別注入                | 讀取 props                       | 內容值傳入            | 改寫（文字、class）              |
| -------------- | --------------------------------------------------- | --------------------------------- | -------------------------------- | --------------------- | -------------------------------- |
| `.tsx`／`.jsx` | 現有 JSX 注入                                       | 現有（`inject-preview-bindings`） | Babel（現有型別推斷）            | props（現有綁定注入） | 現有 TSX 改寫器                  |
| `.astro`       | 以 `@astrojs/compiler-rs` 解析，在 Vite `load` 注入 | 待實作（未驗證）                  | frontmatter 的 `interface Props` | `Astro.props`         | compiler-rs 位置 + 現有樣式引擎  |
| `.vue`         | Vue 編譯器的 template node transform                | 待實作（未驗證）                  | `vue/compiler-sfc` 的 bindings   | `defineProps`         | 之後；先只編輯 `.fields.ts` 欄位 |
| `.html`        | HTML parser 的行列位置                              | 待實作                            | 不適用                           | 不適用                | 文字、屬性                       |

**L1.5 的來源位置注入（2026-10-08）。** 在預覽容器的 Vite 流程中，編譯時替元素注入來源位置，參考
[`code-inspector-plugin`](https://github.com/zh-lx/code-inspector)（MIT，已處理 Vue、React、Svelte、Solid、
Astro 等編譯器各自的注入時機）。只參考做法；若日後直接取用其程式碼，保留 MIT 授權聲明，並掃描整串相依的
授權。它的本機開啟編輯器伺服器與自動尋找空 port 不帶進 Morph。注入只在預覽，正式建置不帶。注入仍可能需要
容器內的解析器，這和 L2 用的可信解析不是同一件事：預覽容器執行 Theme 程式碼，它回傳的位置只決定「點到哪裡」，
不能作為儲存授權或改寫安全的證據。

**L2 的可信解析與改寫。** 改寫與儲存時的分析由 Morph 自己的程式碼執行，不採信預覽容器的結果。`.astro` 的
解析器放不進 Morph 主 Worker（Astro 計畫 M1），使用者已決定走專用解析 Worker 加 service binding，備選是 Sandbox 中
的官方 Node 解析器（Astro 計畫 0.3）；本機實驗 M1c 已完成，部署後的雲端驗證（M1c-C）2026-10-08 以測試資源通過；正式部署解析器 Worker 仍待使用者核准。Core 套用修改建議前，核對來源版本（OCC）、來源雜湊、修改範圍
合法而且不重疊；解析被拒時只讓該檔案的 Design 改寫降級為唯讀，Code 編輯與原本的存檔防護不變。

**L2 改寫引擎的邊界。** 各檔案語言的「來源位置 → 精準改寫」寫成介面不依賴 Morph 的獨立 package：輸入原始碼
字串，輸出位置與修改內容，不 import Morph 的其他模組。改寫引擎是 Morph 的付費差異，目前不開源；獨立 package
只是保留日後授權方式的彈性。

**解析器的位置：統一介面，依量測放置（2026-10-08）。** 統一的是「來源分析」的介面，不是部署位置。所有檔案語言
共用同一份介面：請求與回應的格式、大小上限、錯誤碼、admission 與 trap 後停用（poison）的規則，以及 Core
套用修改建議前的檢查（OCC、來源雜湊、範圍合法且不重疊）。這份介面和 L2 改寫引擎在同一個獨立 package，主
Worker 和解析 Worker 都能使用。每種解析器放在哪裡，看量測：

- `.tsx` 留在主 Worker：放得下，而且和 Design、實例識別、欄位升級、存檔驗證緊密相依。
- `.astro`（Wasm 的 compiler-rs，記憶體底線約 61 MiB）放在專用解析 Worker：主 Worker 內的 M1 未通過，
  專用 Worker 的 M1c-C 通過。
- `.vue`、`.svelte`、`.html`（純 JS 解析器）輪到各自的 L2 時再量：放得下就留在主 Worker，放不下再加入
  解析 Worker 或各自獨立。判斷依據是單一 isolate 的總記憶體，以及一種解析器 trap 後連帶停用其他語言的風險。

不把所有解析器打包進同一個 Worker：記憶體會疊在同一個 isolate（回到 M1 的問題），`.astro` 的 trap 也會連帶
停用同一 isolate 裡的 `.tsx` 編輯。把 `.tsx` 移出主 Worker 是風險高的大改，目前沒有需要。另外，主 Worker 在
處理請求後停在 73–85 MiB 的原因（例如模組在載入時就初始化）另案調查。

一種檔案語言的 Design 支援，必須驗到整條鏈才算完成：**選取實例 → 顯示欄位 → 文件儲存（權限、
文件版本、OCC）→ 該實例更新、其他實例不變**。只完成宣告讀取或來源位置，不算支援。

`.astro` 必須在 Vite 的 `load` 階段注入：Astro 自己的編譯器是 `enforce: "pre"` 的 transform，
排在使用者 plugin 之前。Astro 內建的 `data-astro-source-*` 只在開發工具列開啟時產生，且會被工具列
從畫面移除，不作為依據。

## 內容欄位規則：`.fields.ts`

```text
src/components/Hero/
├─ Hero.astro         （或 Hero.tsx、Hero.vue）
└─ Hero.fields.ts
```

```ts
// Hero.fields.ts
export const contentFields = {
  heading: { type: "text", label: "標題" },
  image: { type: "image", label: "主圖" },
} as const;
```

- 內容與現在寫在元件內的 `export const contentFields` 完全相同，由現有的
  `parseColocatedContentFields` 讀取，只接受靜態物件字面值。從元件內搬出來只是剪下貼上。
- **欄位名稱即 prop 名稱。** React 的 props、Astro 的 `Astro.props`、Vue 的 `defineProps` 都照此
  接收。欄位沒有對應的 prop 時，Code 模式顯示診斷。
- 先例：CloudCannon Bookshop 以元件旁的 `*.bookshop.yml` 支援 Astro、React、Svelte 等框架。
  Morph 用 `.ts` 以取得 Monaco 的型別提示。
- 解決的問題：Vue 的 `<script setup>` 不能 `export`；HTML 沒有模組；React Fast Refresh 需要移除
  元件內的 `contentFields` export（`hoist-colocated-content-fields.ts`），搬到旁邊後不再需要。
- 相容：元件內的 `export const contentFields` 繼續支援。新建元件、Morph 產生的檔案與文件一律使用
  `.fields.ts`。沒有宣告時仍依 props 型別推斷。
- **兩處都有宣告時不默默選一個。** 兩份內容相同：可編輯，並提示刪除元件內那份。兩份不同：停止該
  元件的 Design 內容編輯，顯示指出兩個檔案的診斷；Code 仍可使用。作者不會以為在改其中一份，實際
  生效的卻是另一份。
- **不執行欄位檔。** `.fields.ts` 只被解析，不被 import 或執行；動態寫法（變數、函式、展開）與現有
  規則相同，判為無效並停用該元件的欄位編輯。

### `.fields.ts` 支援現況

「`.fields.ts` 可以使用」只代表下表標為支援的部分；未標為支援的不得視為已完成。

| 範圍                                                        | 狀態                                                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| TSX 元件：右側欄位與伺服器存檔驗證                          | ✅ #105                                                                       |
| Live Preview（真實 React）畫布欄位標記                      | ✅ 新增、修改：#105；只刪 `.fields.ts`：立即重新標記，不重啟預覽              |
| Code 模式診斷（兩處宣告、無效宣告）                         | ✅ #105                                                                       |
| 文字升級寫入 `.fields.ts`                                   | ❌ 目前顯示 Code only（`fields-in-sidecar`），之後另開 PR                     |
| 新建元件預設產生 `.fields.ts`                               | ✅ #109：與元件同批建立，已存在則拒絕；路由與其他檔案不變                     |
| 舊解譯器預覽（`safe-theme-component-renderer`）的列欄位名稱 | ✅ #107：與能力解析器同一合併規則；兩處宣告不同或無效時不提供任何宣告的列欄位 |
| 另一個分頁刪除 `.fields.ts`                                 | ✅ 見下方「另一個分頁刪除」                                                   |
| `.astro`、`.vue`、`.html` 元件                              | ❌ 尚未接入（見交付順序第 4 步）                                              |

**另一個分頁刪除 `.fields.ts`**（`e2e/content-fields-sidecar.spec.ts`，第二個瀏覽器 context 以
`removeThemeFiles` 刪除，第一個分頁保持開啟；本機 sidecar 預覽、CI 環境值量測）：

| 情況                                         | 修正前（實測）                                                                      | 現在（E2E 驗證）                                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 第一個分頁閒置（量到 30 秒）                 | 畫布標記與右側欄位都還在                                                            | 不變：分頁不會自己得知，沒有新增推送管道                                                                       |
| 回到第一個分頁（檔案快取已超過 30 秒）       | 重新讀取檔案：右側欄位消失，**畫布標記留著直到重新整理**                            | 重新讀取檔案後，以只刪 `.fields.ts` 的同一路徑重送元件：畫布標記與右側欄位一起消失，另一個元件不受影響         |
| 得知前就編輯該欄位並存檔                     | 伺服器不寫入（丟棄未宣告的值），但回應成功；分頁顯示已存、畫布顯示新值直到重新整理 | 伺服器仍不寫入，並在回應列出被丟棄的欄位；分頁顯示「Not saved」、畫布回到已存值、重新讀取檔案並移除標記與欄位 |
| 重新載入                                     | 欄位不見、顯示預設值（沒有寫入任何值）                                              | 同左                                                                                                           |

已知問題（另案處理）：同一路徑的檔案刪除後再重建，新檔版本從 1 起算，低於預覽 write fence 記錄的舊版本，
預覽啟動會被 `PREVIEW_START_STALE` 拒絕，直到預覽程序重啟。

## 左側樹

樹由預覽的 DOM 建立，與框架無關；每增加一種檔案語言只需要來源位置注入。框架無關的邊界情況：

| 情況                               | 樹上的呈現                                           |
| ---------------------------------- | ---------------------------------------------------- |
| 迴圈產生多個元素                   | 多個節點，來源位置相同；修改哪一份內容由實例識別決定 |
| `node_modules` 產生的元素          | 沒有來源位置，歸入父元件，只能在 Code 修改           |
| Canvas                             | 單一節點，內容由 `.fields.ts` 欄位編輯               |
| Portal／Teleport                   | 保留實際 DOM 位置；只有能確認父子關係時才歸位，不猜  |
| `client:only` 等瀏覽器才渲染的元件 | hydration 後出現，樹須在元件出現後更新               |

## 渲染方式對應

| Design 選擇 | TanStack Start                 | Astro                                                            |
| ----------- | ------------------------------ | ---------------------------------------------------------------- |
| SSG         | `tanstackStart({ pages })`     | 頁面 `export const prerender = true`                             |
| SSR         | 路由 `ssr` 為 `true`           | `output: "server"`（預設）                                       |
| ISR         | `headers()` 的 `Cache-Control` | `Astro.cache.set({ maxAge, swr, tags })` 或設定檔的 `routeRules` |
| CSR         | 路由 `ssr` 回傳 `false`        | 不支援整頁；只有元件層的 `client:only`，選擇器不顯示整頁 CSR     |

Astro 的 Cloudflare 快取提供者會產生 `Cloudflare-CDN-Cache-Control` 與 `Cache-Tag`；Core 仍須依
start-native-import-plan 的規則補上 storefront 與 release 的快取識別。

**產生正確標頭不等於 ISR 已驗收。** 每種框架的 ISR 與 SSG 都要經 Core 實測：

- ISR：快取確實命中、過期後先回舊內容並在背景更新、新 release 發布後失效、帶會員或購物車
  cookie 的請求與有 `Set-Cookie` 的回應不進共享快取。
- SSG：CMS 內容更新後如何重新產生（重新建置或改為 ISR）以及更新前顯示的內容。

## 2026-10-06 驗證結果（本機，`~/projects/astro-spike`，未部署）

Astro 7.3.5、`@astrojs/cloudflare` 14.3.3、Vite 8.3.3，React 19 與 Vue 3.5 元件：

- 建置通過；產物結構與 Start 相同（`.wrangler/deploy/config.json` → `dist/server/wrangler.json`）。
- 首頁 SSG、商品頁 SSR 並帶 ISR 標頭（`public, max-age=60, stale-while-revalidate=300` 與 `Cache-Tag`）、
  會員頁 `no-store`。只驗到標頭，快取行為本身尚未驗證（見上節）。
- React 加入購物車、Vue 顯示數量，經 Nano Stores 同步。
- `@astrojs/compiler-rs` 解析出的模板是 JSX 形式的 ESTree，位置為 UTF-16 offset（插入中文與 emoji
  後仍精準）；以 Morph 現有的 `patchTailwindClasses` 直接改 `.astro` 的 class，畫面同步更新。
- `.fields.ts`：Morph 現有的 `parseColocatedContentFields` 原樣讀取三種元件的宣告；「欄位即 prop」
  在 `.astro`、`.tsx`、`.vue` 都檢查得出來，並能偵測不一致。CMS 中文內容正確傳入三種元件，
  建置後的頁面也正確。
- 來源位置：同一格式注入 `.astro`、`.tsx`、`.vue` 的元素，整頁組成一棵樹；互動與 hydration 正常。
- 未驗證：實例與內容識別、「選取實例 → 欄位 → 文件儲存 → 元件更新」整條鏈。宣告與來源位置通過，
  還不代表 Astro 或 Vue 的 Design 支援完成。

已知問題：

- React 與 Vue 同時使用時，Vue 元件呼叫 `use*` 函式會在開發模式報 `$RefreshSig$ is not defined`
  （vite-plugin-vue #798）；正式建置不受影響。Astro 網站預設只啟用一種元件框架；React 與 Vue 混用列為 Unverified。
- 修改 `.astro` 會整頁重新載入，island 的狀態歸零；修改 React 元件可以局部更新。
- 未驗證：放進 Morph 預覽容器與 Core service binding、接上 Morph 內容與發布流程、Vue 原始碼改寫。

## 與 start-native-import-plan 的關係

以下章節改為適用所有框架：建置沙箱、工具鏈三級相容與建置來源紀錄、Theme 依賴快照、基礎設施
對應、外連政策、Design 修改程式碼的流程（AST patch → 摘要與 diff → OCC 存檔 → 預覽建置）、匯出。
TanStack Start 專屬的部分（selective SSR、`pages`、`spa`、步驟 1b–1d）保留在該文件。

## 交付順序

每一步各自一個 PR，各自有本機驗收；任何一步都不宣稱 Cloudflare 驗收完成。

1. **`.fields.ts` 讀取（先做 TSX）。** 第一個 PR 只做讀取、兩處宣告規則、診斷與測試，不搬動既有
   元件，也不改新建元件的範本（另一個 PR）。驗收：
   - 同一元件在頁面出現兩次，兩份內容各自編輯、互不串用；
   - Code 修改 `.fields.ts` 後，右側欄位正確更新；
   - 元件內的舊宣告照常運作；兩份宣告相同與不同時的行為符合上節規則；
   - 欄位檔只被解析、不被執行，動態寫法判為無效；
   - 儲存仍走原本的權限、文件版本與 OCC。
     「欄位即 prop」診斷可在同一 PR 或下一個 PR。
2. **抽出框架接入層，現有 TanStack Start 路線移到介面後面，行為不變。** 第一個 PR 完成兩種預覽傳輸、
   兩個建置程式與 Live Preview 同步的接入（見「第 2 步現況」）；路由清單與 Render Plan 仍由共用的
   路由模組提供，等第二個框架需要時再移入 adapter。
3. **TanStack Start 原生建置**：start-native-import-plan 的 1b–1d，作為第一個接入。
4. **Astro 接入**：預覽容器中的 Live Preview、`.astro` 的來源位置／實例識別／props／內容傳入／改寫、
   建置與產物、官方 Astro Cloudflare 範例原樣匯入驗收；Design 以整條鏈驗收，ISR／SSG 以經 Core 的
   快取行為驗收。（2026-10-08）Design 先做 L1.5；`.astro` 的 L2 改寫等專用解析 Worker 通過雲端驗證之後
   （Astro 計畫 8.2）。
5. **React Router（原 Remix）接入**（2026-10-08 決定排在 Astro 之後）：建置路線同 Start，L2 沿用 TSX。
   做 Astro 的 A1、A2 時，以「第三個框架也能套用」檢查共用介面，不把 Astro 特有的處理寫進共用層。
6. **建立網站時選擇框架**，以及模板宣告所需框架。
7. **通用 Vite 託管（L1）**：以兩三個官方 Cloudflare 範例（例如 Vue、Svelte、Solid）驗收；之後依需求替
   各檔案語言加上 L1.5。
8. **Next.js（經 vinext）**：等 vinext 穩定後接入，從 Unverified 開始。
9. 依需求加入其他框架，從 Unverified 開始。

## 未決事項

- 建立網站的框架選擇介面與預設推薦。
- Vue 原始碼改寫的時程（第一版只編輯 `.fields.ts` 欄位）。
- React 與 Vue 混用轉為 Certified 的條件（上游修正 vite-plugin-vue #798 的版本）。
- 介面如何分別顯示「框架認證」與各元件的 Design 能力。
- vinext 的認證範圍（`use cache` 等快取功能支援有限）。
- Astro island 傳入內容須可序列化；複合欄位（連結、清單）的傳遞方式待確認。
- 通用 Vite 託管（L1）的依賴與工具鏈：沿用 Theme 依賴快照（依 lockfile 鎖定，經既有套件申請流程提出、
  不自動信任，start-native-import-plan），但要支援任意框架，必須決定建置 plugin 與工具鏈套件的放行政策、
  供應鏈風險、建置容器的外連權限與建置時間。這是安全模型的擴大，由使用者決定；決定前不實作。
- 介面如何顯示專案的支援層級（L1／L1.5／L2／L3），讓使用者知道哪些功能可用。
