# Morph 專案開發規則

本規則適用於所有修改此 repository 的開發者與 AI 代理。規則以目前實際架構為準；若規則與執行中的程式碼不一致，先追查完整呼叫鏈，再以最小範圍修正規則或實作，不可直接建立第二套架構。

## 1. 核心工作原則

- 修改前先閱讀真正的入口、route、config、query、server function、DAL 與 schema；不要只依檔名推測資料流。
- 僅修改需求直接相關的檔案。保留工作樹中既有且無關的變更，不可擅自 reset、restore、clean、重寫或刪除。
- 優先延伸現有抽象與命名，不建立平行的 route registry、query key、權限判斷、DTO 或 config source of truth。
- 不可手動修改 `src/routeTree.gen.ts`、建置產物、Cloudflare 產生型別或其他 generated files；應修改來源後由對應工具重新產生。
- 除非使用者明確要求，不執行 deploy、production migration、push、建立 commit 或變更 Cloudflare 遠端資源。

## 2. 專案架構與責任邊界

### 路由與 CMS 導航

- `src/routes/` 使用 TanStack Router file-based routing；route 負責 URL 驗證、權限入口、loader/prefetch 與 view 組裝。
- Dashboard 的頁面來源為：
  `src/cms.config.ts` → `dashboard/-collections/**` → dynamic dashboard route → `dashboard/-views/**`。
- 新增 Dashboard 功能時，應建立或延伸對應 view，再於既有 collection 設定註冊 `slug`、label、icon、component 與必要的 `loadData`；不可另寫一份 sidebar 或 breadcrumb 對照表。
- `-components`、`-queries`、`-views`、`-collections` 是 route-internal 模組，不應被無關的頂層功能反向依賴。
- Route search params 必須用 schema 驗證。可分享、可返回或影響資料集的狀態，例如 `folderId`、`q`、排序與分頁，應以 URL 為單一真實來源。

### 設定與環境邊界

- CMS 設定集中在 `src/cms.config.ts`，由 `src/server/get-config.ts` 建立 server/client 版本。
- Client 僅可取得 `getConfig().client` 的安全欄位。database、email adapter、secret、Cloudflare binding 與其他 server-only 值不得進入 client bundle。
- 新增設定時，先判斷它是公開設定或 server-only 設定，再同步更新 `create-config.ts` 的型別與安全投影。
- 密鑰只能透過環境變數或 Wrangler secret 管理；不可寫入原始碼、`wrangler.jsonc` 的 `vars`、測試 fixture 或 log。

### Server Function、DAL、DTO

- `src/server/**/*.serverFn.ts` 是 client/server 邊界：負責解析輸入、套用 middleware、協調 use case 並回傳穩定結果。
- 所有外部輸入一律視為 `unknown`，使用 Zod 或既有 validation helper 驗證；不可只依賴 client-side validation。
- Server function 不直接散落複雜 SQL。資料存取放在 `src/lib/**/dal/`，資料庫 row 到公開資料形狀的轉換放在 mapper，跨邊界型別放在 DTO。
- 使用既有 `{ success, message, data?, error?, errors? }` 結果模式；預期中的驗證或操作錯誤應回傳可處理結果，真正未預期的錯誤才拋出或記錄。
- 不把 raw database row、內部 metadata、secret 或不必要的個資直接回傳給 client。

### Barrel（index.ts）的使用界線

Barrel 本身沒問題，但 server function 模組不適用。理由是模組圖重量，這點可量測：

`import { moveItems } from "@/server/asset"` 會連帶求值 `create-items`（R2 上傳）、`process-image`、`remove-background`（影像處理）、`search-assets`。一個拖曳元件只要一個 `moveItems`，不該扛這些。拆掉兩個 server barrel 後 client 檔案數從 122 降到 119。

> 註：曾經以為 barrel 是 `Cannot access 'xxx' before initialization` 的成因，拆掉之後問題**依然存在**，真正的原因見下一節。這條規則的依據是模組圖重量，不是那個 bug。

界線：

| | 對象 |
|---|---|
| ✅ 可用 barrel | 型別、DTO、mapper、純函式、UI 元件（`@/lib/product`、`@/components/ui`） |
| ⚠️ 不要用 barrel | **`src/server/**` 的 server function**，一律從各自的 `*.serverFn.ts` 直接 import |
| ❌ 絕對不要 | server 模組圖裡的 `export *` wildcard re-export |

判準是**有沒有「被外部按名稱或 id 反查」或「import 當下就產生副作用」的語意**。純型別與純函式沒有，server function 有。

### cms.config 的模組圖不得觸及 server function

`src/cms.config.ts` 被 `get-config.ts` 引用，而多個 server function 又引用 `get-config`。若 config 的**靜態** import 圖反過來觸及任何 server function，同一個 middleware 模組就會有多個入口；Vite 在 HMR 時並行重新求值這些入口，其中一個會讀到還沒綁定完的 namespace，於是 `.middleware([xxx])` 拿到 `undefined`，錯誤訊息是：

```
Cannot use 'in' operator to search for 'Symbol(TSS_SERVER_FUNCTION_FACTORY)' in undefined
Cannot access 'xxxServerFn' before initialization
```

實際踩過：`-collections/account/index.ts` 一行 `import { sessionQueries } from "@queries/auth.queries"`，就把 `list-sessions.serverFn` 與 auth middleware 拖進了 config 的圖，導致編輯任何 server 檔案後 Assets 頁就壞。

規則：

- collection 設定裡需要 query 時，一律在 `loadData` 內用 `await import(...)`，不可在模組頂層靜態 import。`-collections/contents/index.ts` 是正確範例。
- 冷啟動正常、只有編輯原始碼後才壞，就是這個症狀。不要用重啟迴避，也不要在 UI 加 loading 遮罩掩蓋。
- 驗證方式是靜態可達性檢查：從 `src/cms.config.ts` 沿著非 type-only 的 import 走訪，結果**不得包含任何 `*.serverFn.ts` 或 middleware**。修好後那張圖只有 12 個模組。

### 驗證與權限

- 登入狀態由 Better Auth 與既有 auth helpers 提供，不可自行解析 cookie 或複製 session 邏輯。
- 每個 server function 都必須依操作風險選擇 middleware。資產讀取沿用 `assetReadMiddleware`；建立、更新、移動、刪除等 mutation 沿用 `assetAdminMiddleware`。
- 權限必須在 server 端執行。隱藏按鈕只屬 UI 行為，不能代替 authorization。
- `createdBy`、`updatedBy`、`uploadedBy` 等 actor 欄位必須來自已驗證 session，不可相信 client 傳入的 user ID。

## 3. 資料與狀態管理

### TanStack Query

- Server data 使用 TanStack Query；query options 與 query keys 集中在對應的 `dashboard/-queries/` 模組。
- Route loader/prefetch 與 component query 必須共用相同的參數正規化函式與 query options，避免不同 cache key、重複請求或載入閃爍。
- 分頁、搜尋、排序或資料夾切換時，若保留上一筆資料不會造成誤操作，使用 `keepPreviousData` 維持畫面穩定。
- Mutation 成功後，精準 invalidate 或更新相關 query cache；不可用整頁 reload 代替 cache 一致性。

### React 與 Zustand

- Local、短生命週期且只服務單一 component subtree 的語意狀態可使用 `useState` 或 `useReducer`。不要為了「零 re-render」改成難以維護的 imperative DOM。
- 跨多個 dashboard component 的暫態互動狀態才使用既有 Zustand store。Component 應訂閱最小 selector；避免無條件訂閱整個 store。
- 不可在 URL、TanStack Query、Zustand 與 local state 同時保存同一份可推導資料。衍生值以 selector、`useMemo` 或純函式計算。
- 表單依需求選擇 controlled 或 uncontrolled；優先考量驗證、可讀性與局部更新成本，不採用一律禁止 state 的規則。

### 高頻互動與效能

- Pointer move、drag、resize、canvas 或逐幀動畫等高頻路徑，不應每個 event 都觸發大型 React subtree 更新。
- 高頻純視覺值可使用 `useRef`、pointer capture、CSS variables、transform 與 `requestAnimationFrame`；語意結果在互動結束或必要節點才提交到 React/store/URL。
- 純 hover、focus、展開視覺與簡單 transition 優先使用 CSS；但可存取性狀態與業務狀態仍由 React 管理。
- 不預先加入 `memo`、大量 `useMemo`、直接 DOM 操作或快取。先確認實際 render/paint/query 熱點，再做最小且可量測的優化。

## 4. Database、D1 與資產一致性

- Drizzle schema 置於 `src/db/*.schema.ts`，並由 `src/db/schema.ts` 統一 export。
- Better Auth schema 優先透過 `pnpm auth:update` 產生，不手動改寫 generated auth schema，除非已確認 generator 無法表達需求。
- Schema 變更後使用 `pnpm db:generate` 建立新 migration。不可修改已套用的歷史 migration 來假裝完成升級。
- 本機 migration 使用 `pnpm db:migrate:dev`；production migration 必須取得使用者明確同意。
- 所有一般資產與資料夾查詢必須尊重 `deletedAt` soft-delete 條件。若更動刪除流程，需同時考慮 D1 visibility、R2 archive/cleanup、失敗補償與重試後的一致性。
- 資產上傳必須保留檔案數量、大小、extension/MIME、magic number、SVG 內容與 folder existence 驗證。不可僅靠副檔名或 browser 提供的 MIME。
- D1/R2 批次操作必須有上限並分批執行；避免無界 `Promise.all`、過長 transaction 或一次載入完整大型資料集。跨項目的 fan-out 用 `pLimit(DB_FANOUT_CONCURRENCY)`（`src/lib/db/concurrency.ts`）包起來，不要裸寫 `Promise.all(items.map(...))`。

### D1／SQLite 的硬限制

這三條都實測過，而且都不是讀程式碼看得出來的。踩到時錯誤訊息會被 Drizzle 的 `Failed query:` 包住，要把 SQL 直接丟給 `wrangler d1 execute --local` 才看得到真正的原因。

**1. LIKE／GLOB pattern 上限 50 位元組**

超過就是 `LIKE or GLOB pattern too complex`。單位是**位元組不是字元**：中文一字三位元組，所以搜尋 17 個中文字就會爆，不是 49 個英文字母。

- **前綴比對**（子樹查詢）不可用 `like(col, prefix + "%")`。改用半開區間 `gte(col, prefix)` + `lt(col, upperBound)`，沒有長度限制且能吃索引。範例見 `asset-folder.dal.ts` 的 `startsWithPrefix`。`/uuid/uuid/%` 是 76 位元組，資料夾一巢狀就必爆。
- **包含比對**（使用者搜尋）一律經過 `containsPattern()`（`src/lib/db/like-pattern.ts`），它會依位元組截斷且不切斷多位元組字元。不可自行拼 `` `%${term}%` ``。

**2. 每個 statement 最多 100 個綁定參數**

超過就是 `too many SQL variables`。多列 insert 綁的是「列數 × 欄位數」，所以分批要**依欄位數推算**，不是固定列數 —— 用 `chunkForInsert(rows, columnCount)`（`src/lib/product/dal/d1-batch.ts`）。18 欄的表一次只能 5 列，2 欄的關聯表可以 50 列。照抄別處的固定值是這裡最容易犯的錯。

**3. `env.DATABASE.batch()` 整批只算一次 subrequest**

所以多筆寫入務必收進一次 `batch()`，而不是迴圈逐筆 `await`。反過來說，寫入的 statement 數量不會吃掉 subrequest 預算，真正會隨資料量膨脹的是 R2 呼叫（封存一個檔案要 `get` + `put` + `delete` 三次）。

### 批次操作的規模上限

- 使用者**選了幾個**用 Zod 擋（現行上限 100）。但**展開後影響幾個**（資料夾的子孫）Zod 擋不到 —— 它在任何 DB 存取之前就跑完了，不可能知道某個資料夾底下有五千個檔案。
- 展開後的上限必須在 handler 裡檢查，位置是**解析完子孫之後、第一次寫入之前**。太晚檢查的後果是 D1 軟刪除已完成、R2 封存做到一半被中斷，檔案在 UI 消失但實體還在。
- 上限值取自 `bulkOperationLimits()`（`src/lib/db/operation-limits.ts`），依 `cms.config.ts` 的 `cloudflare.plan` 決定。Cloudflare 沒有 runtime API 可以查方案，只能宣告。
- 調高上限前要有真實部署的量測。subrequest 通常不是最先耗盡的資源，串流檔案內容吃掉的 CPU 時間才是。

## 5. UI、樣式與可存取性

- 優先重用 `src/components/ui/`、既有 feature component 與 `cn()`，不要在 view 中複製一套基礎按鈕、dialog、table 或 form control。
- 樣式使用 Tailwind CSS v4 與 `src/styles.css` 的共享規則。跨頁或 breakpoint-sensitive 的視覺規則應有單一來源。
- 修改 shared UI primitive 前先檢查所有使用處；只影響單一 feature 的行為應留在該 feature 內。
- 新 UI 必須保留 keyboard 操作、focus 狀態、可辨識 label、loading/error/empty state 與現有 responsive 行為。
- 動畫應尊重 reduced motion，且不得用延遲或遮罩掩蓋真正的 loading、layout shift 或資料同步問題。

### 視窗內容與 Fields 單一來源

- 所有 Dialog、Sheet、Drawer、Alert Dialog 或其他開啟式視窗，只要包含表單或可編輯資料，其欄位內容都必須由 `fields` 設定提供，使用既有 `FormField`／`FieldConfig` 型別並交由 `FieldsRenderer` 渲染。
- `fields` 是視窗內表單內容的單一真實來源，必須包含欄位名稱、label、type、初始值、placeholder、options、required、validation 與版面資訊；視窗 component 只負責標題、說明、開關狀態、submit action 與整體 layout。
- 不可直接在個別 Dialog 或 Sheet 內硬寫 `Input`、`Textarea`、`Select`、`PhoneInput` 或其他資料欄位。若現有 `FieldsRenderer` 不支援需求，應新增可重用的 field type 與對應 renderer，再由 `fields` 宣告使用。
- 同一欄位不可同時存在於 `fields` 與視窗 component 的 hard-coded JSX，避免預設值、驗證、disabled 狀態與提交名稱發生漂移。
- 純預覽、圖片裁切畫布、操作按鈕與不承載表單資料的視覺工具不需要偽裝成 field；但其中任何可提交的輸入仍必須回到 `fields` 與 renderer 體系。

### 共用功能視窗架構

- 功能頁面不得自行建立一份 Dialog、Sheet 或 Alert Dialog。頁面與操作按鈕只負責準備 `title`、`description`、`fields`、`action`、`onSuccess` 與必要的 button labels，再寫入對應的 feature store 並開啟視窗。
- 視窗資料流固定為：`頁面／按鈕 → set*Data(...) → 對應 Zustand store → Dashboard 全域共用視窗 → FieldsRenderer／功能內容 → action`。不得跳過 store 建立平行的 local modal state 與重複視窗實作。
- 新增功能統一使用 `useCreateStore`、`setCreateData` 與 `CreateDialog`；一般編輯統一使用 `useEditStore` 與 `EditDialog`；刪除或需要使用者確認的操作統一使用 `useInfoStore`、`setInfoData` 與 `InfoAlert`。
- 資產專用操作沿用既有獨立視窗：資產編輯使用 `AssetEditDialog`、移動使用 `AssetMoveDialog`、預覽使用 `AssetPreviewDialog`、圖片處理使用 `AssetPostProcessDialog`。不得把不同責任合併進 Create 或 Info 視窗。
- 共用視窗只能在 `src/routes/_backend/dashboard.tsx` 的 Dashboard layout 掛載一次，功能頁不得再次 mount 相同視窗。新增共用視窗時，也必須在 layout 集中 lazy-load 與掛載。
- 刪除操作不得由頁面或 action menu 直接呼叫 delete server function。必須先透過 `InfoAlert` 顯示目標、影響範圍與不可復原提示，再由確認按鈕提交 hidden fields 與 delete action。
- Create、Edit、Delete／Info 等 store 在視窗關閉或 action 成功後必須重設 open、fields、action、callbacks 與暫存資料，避免下一個頁面開啟時沿用前一次視窗內容。
- 若新頁面需要新增、編輯或刪除，只能提供該頁面的 fields 與 action；不可複製 `CreateDialog`、`EditDialog`、`InfoAlert` 或其 footer、loading、toast、error handling 邏輯。

### 列表頁統一使用 DataTableCard

- 任何「資源清單」頁面（Products、Collections、Options、未來的 Orders、Customers 等）都必須使用 `dashboard/-components/data-table-card` 的 `DataTableCard`，不可自行拼一份 `CardWrapper` + `Table`。
- 版面固定為三段，順序不可調換：
  - **Header**：`label`、`description`、搜尋框、主要操作按鈕（通常是 Create）。
  - **Table**：欄位由 `columns` 宣告，每欄提供 `key`、`header`、`cell` 與可選 `className`；`className` 會同時套到 `TableHead` 與 `TableCell`，欄寬才會對齊。
  - **Footer**：結果筆數與分頁，由 `DataTablePagination` 提供，只有一頁時自動隱藏。
- 每列的操作一律收進尾端的 `RowActionsMenu`（`…` 按鈕），透過 `rowActions` 回傳 `RowAction[]`。不可在列上並排多顆圖示按鈕，否則資源長出第三、第四個操作時版面會崩。刪除類操作標記 `destructive: true`，會自動排到分隔線之後並套用警示色。
- Loading、error、empty 三種狀態由 `DataTableCard` 統一處理並在卡片內置中；表格本身維持靠上。頁面只負責傳 `isPending`、`errorMessage`、`onRetry`、`emptyTitle`、`emptyDescription`，不可自己再寫一套分支。
- 搜尋詞、排序與頁碼寫入 route 的 `q`、`sortBy`／`sortOrder`、`page` search param，不放 component state；換搜尋詞或改排序時 `page` 會被清掉，避免停在超出範圍的頁數。
- 排序透過 `sortOptions` 提供，由 `DataTableSort` 渲染成 header 的下拉（與 Assets card 相同的 `BarsArrowDownIcon`），再選一次同一欄位即翻轉方向。`sortBy` 的可用值由 `dashboardSearchSchema` 定義，各資源在自己的 `normalize*ListParams` 裡對應到實際欄位名。
- 表格的首尾欄位左右各補到 `pl-6`／`pr-6`，與 `CardHeader` 的 `px-6` 對齊。`Table` 的 cell 預設是 `px-4`，直接使用會比標題少 8px。這個補償寫在 `DataTableCard` 內，頁面不需要也不應該自己處理。
- 欄位內容盡量用摘要而非展開全部資料（例如顯示「4 values」而不是列出四個 badge），細節留給編輯視窗或詳情頁。
- Card header 的主要操作按鈕統一使用 `variant="form"` 與 `size="xs"`，與 Assets card 的 Create 按鈕同高同色。header 內的次要工具（排序、篩選等 icon-only 按鈕）維持 `variant="cardHeader"`，靠顏色區分主要與次要操作。
- 需要新的共用能力（欄位排序、批次選取、篩選 chip）時，加在 `DataTableCard` 上讓所有列表頁一起受益，不可只在單一頁面實作。

### 新增資源的入口：route 還是 dialog

- Create 的形式由 collection config 的 `create` 欄位宣告，不在各自的 view 裡各寫一份按鈕。列表頁一律渲染 `CollectionCreateButton`，`mode: "route"` 由它負責導頁，`mode: "dialog"` 才需要頁面傳 `onCreate`。沒宣告 `create` 就不會有按鈕。
- 選哪一種看**表單的形狀**，不是看喜好：
  - 有多個步驟，或表單會生出衍生資料（變體、價格、明細列）→ `route`。
  - 填到一半關掉會損失超過一分鐘的輸入 → `route`。
  - 需要當前頁面的上下文（正在瀏覽的資料夾、已選取的列）→ **兩種都不要**，控制項留在擁有那個上下文的 view 裡。Assets 的上傳屬於這類，所以它沒有 `create`。
  - 幾個欄位就填完 → `dialog`。
- 目前的歸屬：Products = `route`；Collections、Options = `dialog`；Assets = 留在 view。未來的 Orders draft、Promotions 幾乎確定是 `route`，Customers、Inventory 是 `dialog`。
- `mode: "route"` 的 `to` 型別是 `LinkProps["to"]`，會對著 route tree 檢查，寫錯路徑在 build 就會被擋下來，也讓使用者在 `cms.config.ts` 裡有自動完成。
- Create 按鈕的樣式由 `CollectionCreateButton` 統一決定（`variant="form"`、`size="xs"`），頁面不得自己組一顆。要改外觀改那一個檔案。

### Fields 視覺基準

- `src/components/ui/input.tsx` 的目前 field variant 是所有表單控制項的唯一視覺基準。`Textarea`、`SelectTrigger`、`PhoneInput`、`FolderSelectField`、`UploadField`、`OptionValuesField` 與未來新增的 field type，都必須與 `Input` 使用相同的背景色、文字色、placeholder、外框、圓角、陰影與高度節奏。
- 視覺一致性必須涵蓋全部狀態：default、hover、focus-visible、aria-invalid、disabled、light mode 與 dark mode；不可只讓靜止畫面看起來相似。
- Fields 在視窗、Card 或其他容器內不得自行覆寫另一套 border、shadow、background 或 focus ring。若產品需要新的外觀，先在 shared field primitive 建立具名 variant，再讓所有相關 field type 共用。
- 不可把 `Input` 的完整 class 字串複製到各 field component。共用的 field-control tokens 或 variant 應集中在 shared style utility／UI primitive，確保日後修改 `Input` 時其他 fields 不會漂移。
- Label、說明、錯誤訊息與欄位間距可以依 field type 調整，但實際可輸入或可選擇的 control surface 必須維持 `Input` 視覺語言。

## 6. TypeScript 與程式碼品質

### 禁止 any

- 專案採 strict TypeScript，`src/` 內**不得出現 `any`**，包含 `: any`、`as any`、`<any>`、`any[]`、`Record<string, any>`。唯一例外是 generated files（`routeTree.gen.ts`、`worker-configuration.d.ts`），那些不手改。
- `any` 不是型別，是關閉型別檢查。它讓錯誤延後到 runtime 才爆，而且通常爆在離原因很遠的地方。
- 遇到型別對不上時，**先追根因，不要用 `any` 讓它閉嘴**。實際案例：`server/auth/helpers.ts` 的 `as any` 曾同時掩蓋四個真問題——`CloudflareBindings` 與產生的 `Env` 不相容、`role` 型別被放寬成 `string`、serverFn 回傳不可序列化的 `Response`、以及連鎖造成的 `unknown`。移除 `as any` 後才全部浮現。

替代做法，依序考慮：

1. **不寫註記**：多數情況 TypeScript 推導得出來。先刪掉再看 `tsc` 有沒有意見。
2. **從函式庫推導**：用 `Parameters<>`、`ComponentProps<>`、`Awaited<ReturnType<>>` 取得型別，函式庫升級會自動跟上。例：`FirstFieldRefTarget`、dnd-kit 的 `DragEventOf<>`。
3. **對外邊界用 `unknown` 再驗證**：request body、`JSON.parse` 結果、第三方回應一律 `unknown`，經 Zod 或既有 validation helper 縮窄後才使用。
4. **具名的窄轉型**：真的需要轉型時，轉到**具體型別**而不是 `any`，例如 `as RefObject<HTMLInputElement>`、`as Env & { CF_PAGES?: string }`。並在旁邊寫一行註解說明為什麼型別系統看不出來。
5. **修正型別來源**：若是自家型別定義錯了（過度 required、union 少一型），改定義，不要在使用端補救。

- 若真的無法避免（例如函式庫型別有缺陷），必須在該行留下註解說明原因與追蹤依據（issue 連結或版本），並限縮到最小範圍。

### 其他

- 使用既有 alias：`@/*`、`@queries/*`、`@views/*`。同一模組內維持一致 import 方式。
- 遵守 `.editorconfig`：UTF-8、LF、2 spaces、檔尾 newline。
- 修正需求時只清理觸及範圍內的型別與重複邏輯，不順手重構整個舊模組。
- Error log 不可包含 secret、OTP、完整 token、敏感 request body 或不必要的個資。

## 7. 驗證與交付

依修改風險執行最小充分驗證：

1. TypeScript：`pnpm exec tsc --noEmit`
2. `any` 檢查：`grep -rn ": any\|as any\|<any>" src --include=*.ts --include=*.tsx | grep -v routeTree.gen.ts` 必須無輸出
3. 測試：`pnpm test`（有相關測試或修改核心邏輯時）
4. Production build：`pnpm build`（修改 route、SSR、Cloudflare binding、lazy import 或 build config 時）
5. Schema：`pnpm db:generate` 並檢查新 migration（修改 schema 時）
6. UI：實際檢查目標 route 的 loading、error、empty、responsive 與 keyboard flow

### 防護與修復必須做負向測試

「跑起來沒報錯」不等於「有效」。加了守門機制或修了 bug，就要證明它在**該擋的時候真的會擋**，否則等於沒加：

- 加防護後，故意製造違規輸入，確認它被拒絕。做過的例子：bundle secret 檢查（把 env 讀進共用 config，確認 build 失敗並中斷）、Import Protection（建 `.server.ts` 從 client 匯入，確認 build 報出完整 import chain）。
- 修查詢後，除了確認新寫法不報錯，還要**與舊寫法比對結果**。把 LIKE 換成範圍比較時，用一個舊寫法還能執行的短前綴跑兩次，確認回傳的列數一致——只證明「不報錯」可能是條件寫錯導致查不到任何東西。
- 負向測試若沒失敗，先懷疑測試本身。實際發生過：把 `process.env` 提到模組層想模擬洩漏，檢查卻通過——因為那個常數只被 server-only 函式引用，被 tree-shake 掉了，根本沒洩漏。換成真的會進 client 的路徑才重現。
- 測完務必還原，並確認 `git diff` 乾淨、`routeTree.gen.ts` 沒有殘留、測試資料已從 D1 清除。

### 追查 runtime 問題時

- 錯誤訊息被框架包住時（Drizzle 的 `Failed query:`、TanStack 的 `Server Fn Error!`），要取得底層原因：把 SQL 直接丟給 `wrangler d1 execute --local`，或在 catch 裡印出 `error.cause`。照著外層訊息猜會走錯方向。
- 只在編輯原始碼後才發生、冷啟動正常的問題，屬於模組圖／HMR 類，不是邏輯錯誤。見「cms.config 的模組圖」一節。
- 提出假設後要能證偽。這輪曾誤判 barrel 是 TDZ 的成因，拆掉後問題依舊；真正的線索來自完整的 dev server log（裡面有並行重新求值的模組清單）。沒有 runtime 證據就不要宣稱找到根因。

交付時說明：

- 實際修改了哪些檔案與行為。
- 執行了哪些驗證，以及結果。
- 未執行的驗證、既有錯誤或仍存在的風險。

不可為了讓檢查通過而關閉 strict 選項、移除安全驗證、吞掉錯誤、擴大 ignore 範圍或修改無關檔案。
