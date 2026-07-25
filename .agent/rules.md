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
- D1/R2 批次操作必須有上限並分批執行；避免無界 `Promise.all`、過長 transaction 或一次載入完整大型資料集。

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

交付時說明：

- 實際修改了哪些檔案與行為。
- 執行了哪些驗證，以及結果。
- 未執行的驗證、既有錯誤或仍存在的風險。

不可為了讓檢查通過而關閉 strict 選項、移除安全驗證、吞掉錯誤、擴大 ignore 範圍或修改無關檔案。
