# 本機開發讀取 Morph 已發布內容

狀態：開發模式的選用工具。不是正式建置、發布或執行環境的必要接點。

這份文件說明如何在自己電腦上跑自己的 TanStack Start 專案，並讓頁面讀到 Morph 商店**已發布**的內容。

## 這能做什麼，不能做什麼

能做：

- 本機 dev server 的首次載入（SSR）讀得到商店已發布的內容。
- 前端 Link 切頁後，頁面仍讀得到內容。
- 讀不到時顯示明確的原因，不退回元件預設值。

不能做（目前）：

- **既有工作區要沒改過 `src/morph/content.ts` 才會自動取得 `morph.pages.get`。** 下次開啟編輯器時，Starter 升級（版本 28）只替換逐位元組相同的舊版模組；作者改過的維持原樣，需要自行加入。
- **只讀已發布內容。** 不支援草稿；草稿需要 Core 另行提供授權，尚未設計。
- **這不是「CMS 畫布連接本機網站」。** 在 Morph 編輯器裡看到、選取、編輯本機頁面，是另一個功能，尚未實作。
- Design 在區塊上新增 section 時，仍寫 `{...content("slot")}`，不會產生 `{...home.slot}`。
- 沒有發布成套件：代理是單一檔案，要複製進自己的專案。

## 設定

### 1. 取得代理檔

把 Morph 專案裡的
`src/lib/storefront/local-dev/morph-dev-content-proxy.ts`
複製到自己的專案，例如 `morph.dev-content-proxy.ts`。它只依賴 `vite` 與 Node。

### 2. 加進 `vite.config.ts`

```ts
import { defineConfig } from "vite";
import { morphDevContentProxy } from "./morph.dev-content-proxy";

export default defineConfig({
  plugins: [morphDevContentProxy() /* , 你原有的外掛 */],
});
```

Morph 不會替你修改這個檔案。它只在 `vite` 開發伺服器（`serve`）生效，`vite build` 不會載入它。

### 3. 設定商店位址

在啟動 dev server 的 shell 設定環境變數，**不要**寫進會提交的檔案，也不要加 `VITE_` 前綴：

```bash
MORPH_CONTENT_ORIGIN=https://your-store.example pnpm dev
```

位址只取 origin（協定、主機、埠）；路徑會被忽略。只接受 `http:` 與 `https:`。

### 4. 在頁面讀取

```tsx
import { morph } from "../morph/content";

export const Route = createFileRoute("/")({
  loader: async () => ({ home: await morph.pages.get("/") }),
  component: Home,
});

function Home() {
  const { home } = Route.useLoaderData();
  return <Hero {...home.hero} />;
}
```

- `home.<slot>` 或 `home["slot-id"]` 是該區塊的值，可直接展開成 props。
- `morph.pages.isHidden(home, "slot-id")` 告訴你作者是否隱藏了該區塊。
- `_hidden` 是保留名稱；內容服務若送來叫 `_hidden` 的 slot，會被拒絕。

## 正式建置不使用這個環境變數

`MORPH_CONTENT_ORIGIN` 只在 Vite 開發模式（`import.meta.env.DEV`）生效。建置時這個判斷會被替換成常數，產物不會去讀它。

在 Morph 內執行時，來源一律是平台轉送的 `x-morph-content-origin` 標頭，優先於環境變數；標頭存在但不合法時直接拒絕，不會退回環境變數。

已驗證：對 SDK 模組做 Vite 正式建置、在純 Node 行程中執行產物，缺少平台標頭時報錯，且指定的端點收到零個請求。**尚未驗證** Morph 的 Build Preview 與預先渲染整條流程。

## 錯誤

`morph.pages.get` 讀不到時丟出 `MorphContentError`，帶有 `code`。給瀏覽器看的訊息是固定句子，不含位址、上游回應或堆疊；詳細原因寫在伺服器（dev server 終端）的 `[morph]` 日誌。

| `code`                   | 意思                                          |
| ------------------------ | --------------------------------------------- |
| `no_content_source`      | 沒有平台標頭，也沒有設定 `MORPH_CONTENT_ORIGIN` |
| `invalid_content_origin` | 位址不是合法的 http / https 位址              |
| `invalid_path`           | 頁面路徑不是以 `/` 開頭，或超過 500 字元      |
| `store_unreachable`      | 連不上內容服務                                |
| `content_not_found`      | 商店沒有這個頁面的內容                        |
| `store_error`            | 內容服務回報錯誤                              |
| `redirect_refused`       | 內容服務要求重新導向（不會跟隨）              |
| `invalid_response`       | 回應不是可用的內容                            |
| `response_too_large`     | 回應超過大小上限                              |
| `reserved_slot`          | 回應含有保留名稱 `_hidden`                    |

路由可以針對這些代碼顯示對應畫面，但沒有「出錯就用預設值」的捷徑，這是刻意的。

## 代理做什麼

瀏覽器切頁時會向自己的 origin 要 `/_morph/content`，dev server 沒有這個路由。代理替它向商店要：

- 只處理 `GET /_morph/content?path=/…`，其他路由交給框架。
- 目的地只來自 `MORPH_CONTENT_ORIGIN`，不接受請求指定。
- 對商店送出的請求從零建立，只帶 `accept`：不轉送 Cookie、Authorization、`x-morph-*`、本機 Host。
- 不跟隨重新導向；有逾時（10 秒）與回應大小上限（2 MiB）。
- 錯誤回應是固定的 `{ code, message }`。商店回 404 時回 404，其他失敗回 502。

沒設定位址時，代理回 503 並在終端提示；位址設錯（非法或非 http/https）時 dev server 啟動就失敗。

## 已知觀察

在全新的專案（沒有 `node_modules/.vite` 快取）第一次啟動 dev server 並載入頁面時，終端出現 Vite 的 optimize-deps「Pre-transform error」，緊接在 Vite 重新優化新發現的相依套件（`optimized dependencies changed. reloading`）之後。頁面功能正常。

- 冷啟動（無快取）兩次驗證中都出現；保留快取的熱啟動一次，沒有出現。每種情況只跑了很少次。
- 與這個功能的關聯未定位：沒有拿一個不含 SDK 與代理的對照專案比較，所以不能說它與 SDK 或代理無關，也不能說有關。
- 尚未決定是否需要另外調查。
