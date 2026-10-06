# Morph 多框架 Theme 規劃（2026-10-06）

狀態：規劃，尚未實作。取代「Theme 只能是 TanStack Start」的前提；TanStack Start 的細節改為本文件
下的其中一種框架，見 [`docs/start-native-import-plan.md`](start-native-import-plan.md)。

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
2. **支援的是「多框架元件」，不是「任意原生專案」。** 完整的 Next.js、Nuxt、SolidStart 專案各自有
   路由、server functions 與執行環境，每一種都是一個新的框架接入，須逐一驗證才開放。
3. **Morph 的契約與框架無關，框架只是可替換的接入層。** 契約見下節；任何框架都不得另建一套內容、
   商務、身分或發布路徑。
4. **Design 的改寫能力依「檔案語言」區分，不依「框架」區分。** 同一個 TSX 改寫器服務 TanStack
   Start、Astro 裡的 React 元件與 vinext；新增框架時，已支援的檔案語言不必重做。
5. **相容狀態沿用三級制**（Certified／Unverified／Blocked，見 start-native-import-plan 的工具鏈章節），
   以「框架 × 版本」為單位認證。只有 Certified 能發布。

## 支援範圍

| 階段   | 框架                                   | 狀態目標      | 說明                                                                                    |
| ------ | -------------------------------------- | ------------- | --------------------------------------------------------------------------------------- |
| 第一版 | TanStack Start（React）                | Certified     | 現有實作；原生匯入依 start-native-import-plan 進行                                      |
| 第一版 | Astro（`.astro` + React／Vue 元件）    | Certified     | 2026-10-06 驗證通過（見下）。靜態 HTML 模板以 `src/pages/*.html` 放進 Astro，不另設框架 |
| 之後   | Next.js（經 vinext）                   | 先 Unverified | vinext 1.0（2026-09-28）以 Vite 重新實作 Next.js API；官方仍提醒非所有專案都能直接替換  |
| 之後   | Nuxt、SolidStart、TanStack Start Solid | 先 Unverified | 依需求逐一接入                                                                          |

## 框架無關的 Morph 契約

每種框架都必須遵守，接入層只負責把它翻成該框架的寫法：

| 契約       | 內容                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| 內容欄位   | 元件旁的 `<Name>.fields.ts` 宣告欄位；欄位名稱即同名 prop（見下節）。內容存在 Morph，發布時凍結          |
| 商務       | 商品、購物車、結帳、會員一律呼叫 Morph Core；Theme 不另建資料來源，結帳金額由 Core 重新驗證              |
| 來源位置   | Live Preview 中每個 HTML 元素帶 `data-morph-loc="src/<file>:<line>:<column>"`，左側樹與選取由 DOM 建立   |
| 預覽橋接   | 選取、反白、HMR 通知、內容即時更新使用同一套編輯器協定                                                   |
| 產物       | 一個 Cloudflare Worker 加靜態資產，放在 Core 的 service binding 後面；訪客請求不直接進 Theme Worker      |
| 渲染規則   | SSG／SSR／ISR 由 Morph 凍結 Render Plan；ISR 的快取識別由 Core 加上 storefront 與 release                |
| 基礎設施   | D1、KV、R2、Secrets 以對應方式提供，包括框架 adapter 自動加入的綁定（例如 Astro 的 `SESSION`、`IMAGES`） |
| 建置與依賴 | 不可信沙箱、Theme 依賴快照、外連政策、建置來源紀錄，沿用 start-native-import-plan                        |

## 框架接入層（Runtime adapter）

每種框架提供：

| 能力         | 說明                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------ |
| 偵測         | 由 `package.json` 依賴判斷框架與版本（`@tanstack/react-start`、`astro`、`vinext`……）       |
| Live Preview | 在預覽容器啟動該框架的開發伺服器，並注入預覽橋接與來源位置                                 |
| 建置         | 執行專案自己的建置流程，提供部署環境輸入（Wrangler 設定路徑、內容環境變數），不注入 plugin |
| 產物         | 找到並整理產物（Astro 與 Start 都經 `.wrangler/deploy/config.json`），在沙箱外檢查         |
| 路由與渲染   | 讀取路由清單與各頁渲染方式，產生 Render Plan                                               |

## 檔案語言接入層（Source adapter）

Design 需要的四種能力，依檔案語言實作：

| 檔案語言       | 來源位置注入                                        | 讀取 props                       | 內容值傳入            | 改寫（文字、class）              |
| -------------- | --------------------------------------------------- | -------------------------------- | --------------------- | -------------------------------- |
| `.tsx`／`.jsx` | 現有 JSX 注入                                       | Babel（現有型別推斷）            | props（現有綁定注入） | 現有 TSX 改寫器                  |
| `.astro`       | 以 `@astrojs/compiler-rs` 解析，在 Vite `load` 注入 | frontmatter 的 `interface Props` | `Astro.props`         | compiler-rs 位置 + 現有樣式引擎  |
| `.vue`         | Vue 編譯器的 template node transform                | `vue/compiler-sfc` 的 bindings   | `defineProps`         | 之後；先只編輯 `.fields.ts` 欄位 |
| `.html`        | HTML parser 的行列位置                              | 不適用                           | 不適用                | 文字、屬性                       |

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
- 相容：元件內的 `export const contentFields` 繼續支援；同時存在兩處宣告時以 `.fields.ts` 為準並
  顯示診斷。新建元件、Morph 產生的檔案與文件一律使用 `.fields.ts`。沒有宣告時仍依 props 型別推斷。

## 左側樹

樹由預覽的 DOM 建立，與框架無關；每增加一種檔案語言只需要來源位置注入。框架無關的邊界情況：

| 情況                               | 樹上的呈現                                 |
| ---------------------------------- | ------------------------------------------ |
| 迴圈產生多個元素                   | 多個節點，指向同一行原始碼                 |
| `node_modules` 產生的元素          | 沒有來源位置，歸入父元件，只能在 Code 修改 |
| Canvas                             | 單一節點，內容由 `.fields.ts` 欄位編輯     |
| Portal／Teleport                   | 依來源位置歸位，不依 DOM 位置              |
| `client:only` 等瀏覽器才渲染的元件 | hydration 後出現，樹須在元件出現後更新     |

## 渲染方式對應

| Design 選擇 | TanStack Start                 | Astro                                                            |
| ----------- | ------------------------------ | ---------------------------------------------------------------- |
| SSG         | `tanstackStart({ pages })`     | 頁面 `export const prerender = true`                             |
| SSR         | 路由 `ssr` 為 `true`           | `output: "server"`（預設）                                       |
| ISR         | `headers()` 的 `Cache-Control` | `Astro.cache.set({ maxAge, swr, tags })` 或設定檔的 `routeRules` |
| CSR         | 路由 `ssr` 回傳 `false`        | 不支援整頁；只有元件層的 `client:only`，選擇器不顯示整頁 CSR     |

Astro 的 Cloudflare 快取提供者會產生 `Cloudflare-CDN-Cache-Control` 與 `Cache-Tag`；Core 仍須依
start-native-import-plan 的規則補上 storefront 與 release 的快取識別。

## 2026-10-06 驗證結果（本機，`~/projects/astro-spike`，未部署）

Astro 7.3.5、`@astrojs/cloudflare` 14.3.3、Vite 8.3.3，React 19 與 Vue 3.5 元件：

- 建置通過；產物結構與 Start 相同（`.wrangler/deploy/config.json` → `dist/server/wrangler.json`）。
- 首頁 SSG、商品頁 SSR 並帶 ISR 標頭（`public, max-age=60, stale-while-revalidate=300` 與 `Cache-Tag`）、
  會員頁 `no-store`。
- React 加入購物車、Vue 顯示數量，經 Nano Stores 同步。
- `@astrojs/compiler-rs` 解析出的模板是 JSX 形式的 ESTree，位置為 UTF-16 offset（插入中文與 emoji
  後仍精準）；以 Morph 現有的 `patchTailwindClasses` 直接改 `.astro` 的 class，畫面同步更新。
- `.fields.ts`：Morph 現有的 `parseColocatedContentFields` 原樣讀取三種元件的宣告；「欄位即 prop」
  在 `.astro`、`.tsx`、`.vue` 都檢查得出來，並能偵測不一致。CMS 中文內容正確傳入三種元件，
  建置後的頁面也正確。
- 來源位置：同一格式注入 `.astro`、`.tsx`、`.vue` 的元素，整頁組成一棵樹；互動與 hydration 正常。

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

1. **`.fields.ts` 支援（先做 TSX）。** 讀取元件旁的 `.fields.ts`，與元件內宣告並存；新建元件改用
   `.fields.ts`；「欄位即 prop」診斷。不需要新框架就有價值，也是後續所有框架的共同基礎。
2. **抽出框架接入層，現有 TanStack Start 路線移到介面後面，行為不變。**
3. **TanStack Start 原生建置**：start-native-import-plan 的 1b–1d，作為第一個接入。
4. **Astro 接入**：預覽容器中的 Live Preview、`.astro` 的來源位置／props／內容傳入／改寫、建置與
   產物、官方 Astro Cloudflare 範例原樣匯入驗收。
5. **建立網站時選擇框架**，以及模板宣告所需框架。
6. 依需求加入其他框架，從 Unverified 開始。

## 未決事項

- 建立網站的框架選擇介面與預設推薦。
- Vue 原始碼改寫的時程（第一版只編輯 `.fields.ts` 欄位）。
- Astro 網站允許同時使用多種 JSX 框架的條件。
- vinext 的認證範圍（`use cache` 等快取功能支援有限）。
- Astro island 傳入內容須可序列化；複合欄位（連結、清單）的傳遞方式待確認。
