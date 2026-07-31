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
- 新增 Dashboard 功能時，應建立或延伸對應 view，再於既有 collection 設定的 capability（`index`、`create`、`preview`、`detail`、`edit`）下註冊 `view` 與必要的 `pendingView`／`prefetch`；不可另寫一份 sidebar 或 breadcrumb 對照表。
- `-components`、`-queries`、`-views`、`-collections` 是 route-internal 模組，不應被無關的頂層功能反向依賴。
- Route search params 必須用 schema 驗證。可分享、可返回或影響資料集的狀態，例如 `folderId`、`q`、排序與分頁，應以 URL 為單一真實來源。

### Dashboard 路由由 config 決定，不新增靜態路由檔

- 「有哪些頁面」的唯一來源是 collection config。不得為了單一 collection 新增靜態路由檔 —— 靜態片段的排序高於 `$slug`，會無聲蓋掉同名的 collection，頁面直接變空白而不報錯。
- **collection 的網址一律是平的**：每個 collection，不論在側邊欄是否巢狀，都住在 `/dashboard/<slug>`。`items[]` 只影響側邊欄分組與麵包屑，不影響 URL。Medusa 也是這樣 —— 它的 `product-options`、`product-tags`、`collections` 全是頂層路由，所以 `/products/:id` 從來不會有歧義。
- 這條規則是詳情頁能存在的前提。若 Options 住在 `/dashboard/products/options`，那 `/dashboard/products/<id>` 就無法分辨是 collection 還是 record id。
- 因為網址是平的，**slug 必須全域唯一**（`assertCollectionsAreAddressable` 會在 `createCMSConfig` 擋下重複）。所以是 `product-options` 而不是 `options`。
- 目前的六條動態路由已涵蓋所有情況，新增頁面請走 config：
  - `$slug` —— collection 列表頁，同時是底下所有 child route 的 layout，必須渲染 `<Outlet />`。
  - `$slug/create` —— 建立頁，由 config 的 `create.view` 提供。
  - `$slug/view` —— collection 層級的瀏覽頁，由 config 的 `preview.view` 提供；目前資產 id 放在 `?assetId`。
  - `$slug/$id` —— 詳情頁，由 config 的 `detail.view` 提供。`create` 是靜態片段所以優先於 `$id`。
  - `$slug/$id/edit` —— 編輯頁，由 config 的 `edit.view` 提供；有 `detail` 時疊在詳情頁上，沒有 `detail` 時疊在列表上。
  - `$slug/$id/$page` —— 記錄的附屬頁面，由 config 的 `pages[key]` 提供。`edit` 是靜態片段所以優先於 `$page`，因此 `edit` 是保留的 page key。
- child route 的行為不同，`$slug` 用 `useChildMatches` 區分：
  - `/create` 與 `/$id/edit` **疊在**列表上，列表維持掛載，關閉即返回，不重抓也不丟失捲動與選取狀態。
  - `/view` 一律**取代**列表。
  - `/$id` 只有在該 collection 真的有 `detail` 時才取代列表。collection 可以只宣告 `edit` 而沒有 `detail`（Assets 就是），這時 `$id` 只是承載 id 的 layout，列表必須留在後面 —— 少判斷這個條件，編輯頁背後會是空的。
  - 判斷用 `useChildMatches` 各自回傳 boolean，不要回傳陣列或字串再比對：陣列每次 render 都是新參考會使相等性檢查失效，而 routeId 之間有前綴關係（`$id` 是 `$id/edit` 的前綴），字串比對會誤判。
- 解析 collection 一律使用 `findCollection(groups, slug)`，不可用 `getAllCollections()` 再自己 `find`。
- 建立頁必須是列表頁的 child，不可做成平行的獨立路由。這樣列表在底下維持掛載，關閉建立頁是 `navigate({ to: "..", replace: true })` —— 不重新掛載、不重抓資料、不在歷史紀錄留下廢棄的草稿頁。這是 Medusa admin 的作法（`get-route.map.tsx` 把 `create`／`import`／`export` 放在 list 的 `children`，再用 `RouteFocusModal` 疊在上面）。
- 新增保留字或新的靜態片段時，必須同步更新 `RESERVED_COLLECTION_SLUGS`。`assertCollectionsAreAddressable` 會在 `createCMSConfig` 就擋下撞到保留字或重複路徑的 collection，讓它在啟動時就爆，而不是等到使用者點進去看到空白頁。

### pendingView 必須畫出整個頁面的外框

- `pendingView` 不是「載入中的小圖示」，它是那個頁面在 chunk 到齊前的替身。**頁面有幾欄、幾張卡，pendingView 就要有幾欄、幾張卡**，只有內容換成 skeleton。
- 理由不是美觀，是串流 SSR 的執行順序：伺服器會解析 lazy view 並把真實 HTML 串流出去，接著瀏覽器 hydration 時該 chunk 還沒下載完，React 會**重新** suspend 一次。所以 fallback 是插在一個已經完整的畫面中間，少畫一欄就會看到那一欄出現、消失、再出現。
- 不需要資料就能畫的區塊（例如「未選取任何項目」的空狀態卡），pendingView 直接渲染真的那個組件，不要用灰塊假裝。
- **疊層路由的 pendingView 必須也是疊層。** `create`、`$id/edit`、`$id/$page` 與 `view` 都是 `fixed inset-0`，它們的 fallback 預設是 `RouteSurfacePending`（同一個 `RouteFullscreenSurface` 空殼加 spinner），不可用在流內排版的 `PageSpinner` —— 那會讓底下的頁面在 chunk 載入期間完全露出來，從選項頁開商品建立頁時會先看到商品列表再看到 wizard。
- 但 `pendingView` 被 collection config **靜態** import，所以它的 import 圖不得觸及 server function。要共用真實組件時，先把不碰 server function 的部分抽成獨立檔案再共用（`asset-property-empty.tsx` 是這樣來的：`AssetPropertyCard` 的 header 會 import delete／move server function，整張卡不能直接拿來用）。

### Collection capability 設定契約

- Collection config 只描述「這個 collection 有哪些 route-backed 頁面」。具名 capability 固定使用 `index`、`create`、`preview`、`detail`、`edit`，記錄的附屬頁面放同層的 `pages`。不可改回模糊的頂層 `component`，也不可讓 config 自行提供 `path`。
- 為什麼是「具名五個 + 均勻的 `pages`」而不是 Medusa 那種全部均勻的 `{ path, view }` 陣列：那五個名字是**框架的分支條件** —— `create` 決定要不要渲染 Create 按鈕、`edit` 決定要不要有 Edit row action、`detail` 決定 `$id` 是否取代列表與表單關閉回哪一層。改成均勻陣列後，這些判斷只能退化成字串慣例（`path === "create"`），型別安全從編譯期擋變成打錯就靜默失效。Medusa 能用均勻陣列，是因為那些 UI 它全部手寫在各頁；我們的賣點是使用者宣告 collection 就自動獲得它們。
- 每個 capability 的 render entry 一律叫 `view`；Suspense fallback 一律叫 `pendingView`；route 進入前的 query cache priming 一律叫 `prefetch`。`component`、`loader`、`loadData` 都是舊名稱，不得重新引入。
- **`view` 一律用 `lazyView(() => import("..."))` 宣告，不要直接寫 `lazy(...)`。** 它保留 import factory，讓框架可以在點擊前就開始下載那個 chunk。路徑只寫一次 —— 在 `view` 旁邊另外放一個 `preload` 欄位就是兩個地方要同步，而且漂移不會報錯。
- 開啟 view 的控制項要把 `useViewPreload(view)` 的 handlers 展開上去（hover、focus、touchstart 三者都要：只綁 hover 會讓鍵盤與觸控使用者等在原地）。Row action 這種藏在下拉裡的，改在**選單開啟時**預載 —— 指標移到項目上時距離點擊只剩幾十毫秒，太晚了。
- `view` 指的是「這條路由渲染哪個元件」，不是「唯讀顯示」。`create.view`、`edit.view` 與 `pages[key].view` 都是表單，一樣叫 `view` —— 六個 capability 讀起來必須一致。Medusa 也是一個名字打天下（React Router 的 `Component`）。
- **被 config 引用的 view 一律 `export default`**，config 寫 `lazy(() => import("..."))` 即可，不要 `.then((m) => ({ default: m.X }))`。那層樣板每個 capability 都要重寫一次，而且具名與預設兩種寫法並存會讓人以為它們有差別。View 的具名 export 只在真的有第二個引用者時才保留。
- `index` 是 collection 的預設目的地；`create`、`detail`、`edit` 是 record lifecycle 頁；`preview` 是 collection-level viewer，適合需要保留目前資料集並在項目間切換的介面。不要用 `detail` 假裝 Preview，也不要讓同一功能同時存在 route 與 Dialog 兩條入口。
- Capability 可以省略。省略代表該 collection 不支援該頁面：框架不應渲染對應按鈕，直接輸入該 URL 則回傳 `NotFound`；不可放一個空 view 或 `NotImplemented` 來假裝已支援。
- `move`、`delete`、`download`、`post-process` 等命令不是頁面，不放進 collection config。它們由 feature action、共用確認視窗或專用工具視窗負責；只有當操作本身需要可分享、可重新整理的完整畫面時，才把它加進 `pages`（而不是新增 capability）。
- `items[]` 只表示 sidebar／breadcrumb 的視覺分組，子 collection 仍使用自己的平面 `/dashboard/<slug>` URL，並套用相同 capability contract。
- Collection config 不得靜態 import query 或 server function。`prefetch` 內以 `await import(...)` 載入 query options，且必須與 view 使用同一個參數正規化函式，確保 query key 完全相同。
- View 自己負責 query、mutation、fields 與 feature interaction；config 不保存 fields、action、選取項目、Dialog open state 或 query result。Config 是 capability registry，不是 runtime state container。

### 用 search param 選擇變體時，值必須來自共用的 union

- 一個路由若靠 `?variant` 之類的 search param 決定顯示哪個表單，那組合法值要 export 成一個 `as const` 陣列與其 union type，並提供一個收斂函式（例如 `toAssetCreateVariant`）。所有導頁處引用同一份，不可各自寫字串字面值。
- 理由是這種路由通常有 fallback：`?variant=打錯了` 會靜默落到預設值而不是報錯。曾經同一個概念在三個檔案有三個名字（`upload`／`assets`／註解寫 `upload`），只因為 fallback 吃掉了全部非預期值才沒壞。
- search param 的型別在 `dashboardSearchSchema` 裡是寬鬆的 `string`，因為那層不該知道每個 collection 的變體。收斂要在使用它的路由裡做。

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

|                  | 對象                                                                            |
| ---------------- | ------------------------------------------------------------------------------- |
| ✅ 可用 barrel   | 型別、DTO、mapper、純函式、UI 元件（`@/lib/product`、`@/components/ui`）        |
| ⚠️ 不要用 barrel | **`src/server/**`的 server function**，一律從各自的`\*.serverFn.ts` 直接 import |
| ❌ 絕對不要      | server 模組圖裡的 `export *` wildcard re-export                                 |

判準是**有沒有「被外部按名稱或 id 反查」或「import 當下就產生副作用」的語意**。純型別與純函式沒有，server function 有。

### cms.config 的模組圖不得觸及 server function

`src/cms.config.ts` 被 `get-config.ts` 引用，而多個 server function 又引用 `get-config`。若 config 的**靜態** import 圖反過來觸及任何 server function，同一個 middleware 模組就會有多個入口；Vite 在 HMR 時並行重新求值這些入口，其中一個會讀到還沒綁定完的 namespace，於是 `.middleware([xxx])` 拿到 `undefined`，錯誤訊息是：

```
Cannot use 'in' operator to search for 'Symbol(TSS_SERVER_FUNCTION_FACTORY)' in undefined
Cannot access 'xxxServerFn' before initialization
```

實際踩過：`-collections/account/index.ts` 一行 `import { sessionQueries } from "@queries/auth.queries"`，就把 `list-sessions.serverFn` 與 auth middleware 拖進了 config 的圖，導致編輯任何 server 檔案後 Assets 頁就壞。

規則：

- collection 設定裡需要 query 時，一律在 `prefetch` 內用 `await import(...)`，不可在模組頂層靜態 import。`-collections/contents/index.ts` 是正確範例。
- 冷啟動正常、只有編輯原始碼後才壞，就是這個症狀。不要用重啟迴避，也不要在 UI 加 loading 遮罩掩蓋。
- **這條規則已經有自動守衛：`src/lib/config/module-graph.test.ts`。** 它跑兩件事 ——「整個 app 沒有任何 import 環」與「`cms.config` 的靜態圖走不到 server function」。改完 import 就跑 `pnpm test`，不要再靠肉眼追鏈。

### 沒有 import 環

- 環不會被 `tsc` 或 `pnpm build` 抓到。它在冷啟動時看入口順序運氣好壞，HMR 重新求值時就爆 `Cannot access 'X' before initialization` —— 而且錯誤指的檔案通常是無辜的那個。使用者的症狀是「每次都要重啟」。
- **共用 field／dialog／primitive 一律不得靜態 import server function 或 query 模組。** `FieldsRenderer` 在 `cms.config` 的靜態圖裡，所以任何欄位只要頂層 import 一個 `*.serverFn`，環就成立。需要時在事件處理器內 `await import(...)`，或用 `lazy()` 把整個子組件延後（`AssetLibraryPanel`、`FolderSelectField` 是這樣做的）。
- **Barrel 是環的溫床。** `currency-add-skeleton.tsx` 只要一個 `DataTableToolbar`，卻從 `data-table-card/index.ts` 拿，於是把同資料夾的 `CollectionCreateButton` 一起拖進來，而那個按鈕會讀 `getConfig()` —— 環就從 config 繞回 config。在 `cms.config` 靜態圖內的檔案一律直接 import 具體路徑，不要走 barrel。
- **只用到型別就寫 `import type`。** 它在編譯期被抹掉，根本不會成為 runtime edge。`navigation.ts` ↔ `create-config.ts` 那個環就只是少寫了 `type`。
- 修好後的基準：環 0 個，`cms.config` 靜態圖 70 個模組且觸及 0 個 server function。數字會隨功能長，重點是後兩項。

### 驗證與權限

- 登入狀態由 Better Auth 與既有 auth helpers 提供，不可自行解析 cookie 或複製 session 邏輯。
- 每個 server function 都必須依操作風險選擇 middleware。資產讀取沿用 `assetReadMiddleware`；建立、更新、移動、刪除等 mutation 沿用 `assetAdminMiddleware`。
- 權限必須在 server 端執行。隱藏按鈕只屬 UI 行為，不能代替 authorization。
- `createdBy`、`updatedBy`、`uploadedBy` 等 actor 欄位必須來自已驗證 session，不可相信 client 傳入的 user ID。

## 3. 資料與狀態管理

### 資料取得與分頁決策

- 不可因為畫面屬於同一個 route，就預設一次抓完該頁可能用到的所有資料。先把資料分成「單筆主資源」、「會持續成長的資源清單」、「有明確小上限的 reference data」與「遠端選項」，再決定 query 邊界。
- Products、Orders、Customers、Assets、Inventory、Promotions、Collections、logs，以及任何由使用者持續建立、沒有可靠 hard upper bound 的資源清單，預設使用 **server-side pagination**：
  - URL 保存 `page`、`q`、`sortBy`、`sortOrder` 與 filters。
  - `normalize*ListParams` 將 URL 正規化成 server function／DAL 的 `page + limit` 或 `offset + limit`。
  - Server 回傳目前 slice 與 `total`／`totalPages`；搜尋、排序、filter 必須在切頁前於 server／DAL 執行，不可先抓一頁再於 client 過濾。
  - Query key 必須包含所有會改變資料集的正規化參數；換頁使用 `keepPreviousData`，不要為了維持畫面而一次下載完整資料集。
- 固定型 reference data（例如 ISO currencies、countries、locales、有限狀態選項）只有同時符合以下條件，才可一次抓取後做 **client-side pagination**：
  - 資料有可說明的固定上限，不會隨商店內容持續成長。
  - 每筆是小型文字／數值資料，不包含 blob、大型 metadata 或深層 relation。
  - 完整 payload 與 client 搜尋、排序成本可接受。
  - Query／server function 名稱與註解明確表示它回傳完整 bounded dataset，並保留 server-side hard limit；不可把高 `limit` 當成真正的無限制查詢。
  - 此時 pagination 只是呈現層的 `slice`，換頁不得改 query key、重新 fetch 或把 viewport 推導出的 page size 傳回 server。
- 若需求明確要求 **Medusa Admin parity**，resource list 一律沿用 Medusa 的 server-side contract，即使資料目前不多。Medusa 2.18 的 Store 頁是單獨抓 Store；Currencies table 使用 `limit: 10 + offset`；Add Currencies 使用 `limit: 50 + offset`；price preferences 是獨立 query。不得把「Store response 含 supported currency codes」說成已完整載入所有 currency records。
- Detail page 先 retrieve 單一主資源；variants、prices、orders、products 等可能增長的 section 各自使用獨立 query，且需要時各自 server-side pagination。不要建立一個會無界展開全部 relation 的 mega response，也不要因為 section 位於 detail page 就一次載入全部關聯。
- Route loader／`prefetch` 只 prime 首屏真正需要的 query，且參數與 component query 必須完全相同。Loader 抓第一頁不是「把整個頁面資料抓完」；其他 section 可以在掛載時各自查詢，但要避免相同資料的重複 request 與可預見的 serial waterfall。
- 遠端 Select、Combobox 與關聯資源 picker 預設使用 debounced search 加 `limit + offset` 的 infinite query；必須另外以 id 載入目前已選值，不能假設選中項目一定存在第一頁。只有符合 bounded reference-data 條件的選項才可一次載入。
- 為 filter 建立的選項資料可以使用較高但明確的上限（Medusa 常用 `1000`），這是小型輔助資料的特例，不代表主 table 可以一次抓完。若可能超過上限，filter 本身也必須改成 searchable remote options。
- 跨頁勾選要保存穩定 resource ids，而不是保存「目前頁 row index」。換頁不得自動清除已選 ids；bulk mutation 送出 ids 後仍須在 server 重新驗證存在性、權限與操作上限。
- 決策順序固定為：
  1. 資料是否會持續成長或包含大型 relation？是 → server-side pagination。
  2. 是否為固定、小型、有 hard upper bound 的 reference data？是 → 可評估完整抓取與 client-side pagination。
  3. 是否為單筆 detail？只抓主資源，會增長的 section 分開查。
  4. 是否為遠端選項？預設 infinite query；只有 bounded dataset 才完整抓取。
  5. 無法證明資料有小上限時，一律選 server-side pagination。

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

### 任何 UI 修改前必須完成 primitive／Fields preflight

- 動手寫 JSX 或 class 前，必須先搜尋 `src/components/ui/`，確認是否已有對應 primitive；再搜尋 `src/components/form/`、`FormField` union 與 `FieldsRenderer`，確認是否已有對應 field type 或 renderer。不得先照畫面拼完，再事後補查共用層。
- Dialog、Sheet、Drawer、Alert Dialog、route fullscreen、Table、footer actions 與 keyboard hint 等結構，還必須檢查既有共用 wrapper（例如 `RouteFullscreenSurface`、`DialogFooterActions`、`Table`、`Kbd`）；feature 不得重建它們已經負責的 shell、語意、互動或樣式。
- 多選後出現在畫面底部的浮動批次工具列一律使用 `src/components/ui/command-bar.tsx` 的 `CommandBar`。Feature 只提供 selection value、clear handler、secondary actions 與 primary action；fixed position、surface、動畫、separator、Tooltip、Kbd、destructive 與 responsive 樣式由 `CommandBar` 擁有，不得再建立 Assets 專用的 float 盒模型。
- 所有 editable control 必須先使用 `FormField` contract。一般表單交給 `FieldsRenderer`；Table cell 等特殊版面應使用 `FieldsRenderer` 共用的底層 control renderer。若現有共用層尚未支援，先擴充可重用的 field type／control renderer，不得直接在 feature 內另寫一份輸入控制。
- 找不到合適 primitive 時，實作前必須在程式註解或工作說明中明確寫出「現有 primitive 為什麼不適用」以及新抽象的重用邊界；不得只因 class 比較快寫就建立平行組件。
- Feature class 只負責 layout、responsive placement，以及功能特有的狀態組合。顏色、盒模型、control height、圓角、邊框、陰影、focus、invalid 與 disabled 狀態必須由 primitive、shared token 或具名 variant 擁有。
- preflight 完成後才可修改 UI；交付前再反向搜尋本次新增的原生 interactive element 與 surface class，確認沒有繞過已存在的 primitive／Fields contract。

### 缺少 primitive 時優先引入 shadcn／Radix，而不是自己手寫

- preflight 找不到現成 primitive 時，下一步是查 shadcn/ui 是否已有對應組件（`components.json` 已設定 `new-york` 樣式、`zinc` base、lucide icons），有就引入到 `src/components/ui/`，不要自己從 `div` 開始拼。
- 選擇順序固定為：既有 primitive → shadcn 組件（其底層多為 Radix UI）→ 直接使用 Radix primitive → 最後才手寫。手寫必須在註解寫出前三層為什麼都不適用。
  - 理由是 keyboard 導航、focus trap、`aria-*` 關係、portal 定位與 composition 這些行為，手寫版本通常只覆蓋到「看起來對」的部分。這些是 Radix 已經解決過的問題。
  - 帶互動語意的東西尤其不得手寫：dropdown、popover、tooltip、dialog、select、combobox、tabs、accordion、switch、slider、context menu。
- **引入的 shadcn 原始碼必須立刻改寫成符合本專案規則，不可原樣保留。** 具體是：
  - surface 相關的 class（背景、邊框、圓角、陰影、focus ring、invalid、disabled）改為引用 `fieldControlVariants` 或對應的 shared token，不得保留 shadcn 預設那份複製的 class 字串。
  - 縮排、命名與 import 排序跟隨專案既有檔案，不保留上游的 4 空白縮排。
  - 用不到的 sub-component 直接刪掉；不要留一整包沒人用的 export。
- 這條規則的由來是 `input-group.tsx`：引入時原樣保留了 shadcn 的 `rounded-md border shadow-xs`，於是它跟 `Input` 的 `rounded-md-plus` 對不起來。兩個呼叫端各自在外面補 `bg-background rounded-md-plus` 和 `bg-transparent` 把它拉回來 —— 那些補丁就是「引入時沒改寫」的帳單。

### Handle 欄位一律使用 handleField

- 任何 handle／slug 欄位都必須用 `src/components/form/handle-field.ts` 的 `handleField()`，不可在 view 裡自己寫一份 `{ type: "input", name: "handle" }`。呼叫端只提供 `value`、`derivedFrom`、`error`、`colSpan`。
- 前綴 `/`、label、`labelHint` 與 `(Optional)` 標記屬於這個定義。handle 是 URL 片段，欄位就該長得像 URL 片段。
- 前綴是裝飾，不是資料：它由 `InputGroupAddon` 畫出來，永遠不會進入送出的 value。唯讀顯示（`EditCard` 的 `displayValue`）則用 `` `/${handle}` `` 保持一致。
- 需要新的靜態前後綴（貨幣代碼、單位）時，在 `InputFormField` 用既有的 `prefix`／`suffix` 就好，不要為單一頁面另包一層 input。

### 左右分欄一律使用 PageSplitLayout

- 任何「主內容 + 右側資訊欄」的頁面都必須使用 `dashboard/-components/layout/page-split-layout` 的 `PageSplitLayout`，不可自己寫 `flex` + 欄寬。分切的尺寸屬於這個組件：外層 `flex w-full items-start gap-4`、內容欄 `min-w-0 flex-1`、側欄 `w-md shrink-0`。
- 這條規則的由來是實際漂移：Assets 用 `w-md`，分類詳情頁用 `lg:w-80`，兩個畫面單獨看都正常，並排才看得出來不一樣。
- **`PageSplitLayout` 只管欄寬，不管高度，也不設 cross-axis 對齊。** 鎖定視窗高度是 Assets 獨有的行為，而且由它自己的卡片負責（`h-content`／`min-h-content`）；把高度或 `items-*` 放進這個組件，等於把那個行為交給每一個分欄頁。
- **側欄寬度以 Assets 為準（`w-md`）**。要改寬度就改這個組件，讓所有分欄頁一起變，不可為單一頁面覆寫。
- 內容欄必須保留 `min-w-0`。少了它，欄內一張寬表格會把側欄擠出畫面，而不是在自己的捲動區內捲動。
- **不做窄螢幕堆疊。** 側欄不會落到內容下方 —— Assets 的 explorer 卡是 `h-content`（一個視窗高），堆疊後側欄會被推到整個視窗之下，要捲動才看得到。
- 分欄頁的 `pendingView` 也必須用同一個組件畫出兩欄（見「pendingView 必須畫出整個頁面的外框」）。

### 唯讀資訊卡一律使用 EditCard

- 詳情頁上「標籤 ／ 值」形式的資訊區塊一律使用 `dashboard/-components/edit-card` 的 `EditCard`，不可自己拼 `CardWrapper` + `<dl>` 或 grid。它已經擁有列的分隔線、label 與值的欄寬比例、`max-sm` 的斷點行為與 header 的動作選單；重拼一份就會在其中某一項上漂移。
- 欄位用 `EditCardField` 宣告：`value` 是可編輯的原始值，`displayValue` 是畫面要顯示的內容（已解析的名稱、格式化後的日期，或 `value` 表達不了的連結）。兩者都省略時該列顯示 `-`。
- **編輯入口只能有一個。** 卡片的編輯行為依該 collection 的架構二選一：
  - 編輯是路由的 collection（`edit.view`）傳 `onEdit`，由它導向該路由。
  - 沒有路由編輯頁的設定類畫面（例如 Profile）傳 `onSave`，走內建的 `EditDialog`。
  - 兩者都不傳就是唯讀卡，`EditCard` 不會渲染那顆 `…`，避免出現一顆打開後沒有東西可做的選單。
  - 不可同時傳兩者，那會讓同一筆記錄有兩條編輯路徑 —— 正是 capability 契約禁止的事。
- 狀態徽章之類的 header 裝飾走 `headerActions`，排在 `…` 之前；不要為了放徽章而在卡片外面另外做一列標題。

### 縮圖是圖庫的第一張，由 DAL 推導

- `products.thumbnailAssetId` 與 `productVariants.thumbnailAssetId` **不是客戶端可以指定的欄位**，它們已經從 `updateProductInputSchema`／`createProductInputSchema` 移除。想換縮圖就把那張圖拖到第一個。
- 推導寫在 `productDal.setAssets()` 裡，跟 `rank` 同一次寫入。**不可在呼叫端算 `assetIds[0]`** —— 這條規則的由來就是它曾經被複製在建立精靈和 Media 編輯兩個地方，第三條寫入路徑（variant 圖片、匯入）遲早會忘掉其中一個。
- 這跟 Medusa 不同是有原因的：Medusa 的 `thumbnail` 是裸 URL，可以是不在 gallery 裡的圖，所以它必須是獨立欄位。我們的 schema 把它做成 `assets.id` 的外鍵，縮圖本來就一定是 gallery 的一員，用順序表達就少一個概念。
- 欄位保留而不是每次 join 取 rank 0：前台每一筆商品都會讀它。它是衍生資料，但衍生的地方只有一處。
- 圖片排序一律使用 `components/asset/sortable-asset-grid` 的 `SortableAssetGrid`，排序邏輯用 `reorderAssets()`。往前拖與往後拖落點不同，那是它有測試的原因。
- **排序只在編輯介面提供**。詳情頁的 Media 卡是唯讀的，跟同頁其他卡片一致；它只用第一格的徽章「回報」目前的縮圖。

### Metadata 是公開的逃生口，不是私密欄位

- `metadata` 存的是核心 schema 沒有建模、由商店自行定義的 key/value。它的設計目的就是**跨到前台** —— Medusa 的 store API 對 product-categories 預設就吐 metadata，products 雖不在預設欄位裡但也不在 `disallowedStoreFields`，前台可用 `?fields=+metadata` 取得。因此**絕不可放 API key、成本價、合約條款或任何個資**。
- 值一律以字串儲存。從輸入內容猜型別比不猜更糟：`01234` 會維持字串而 `1234` 會靜默變成數字，同一個郵遞區號或 SKU 的意義就取決於它的位數。需要真正型別的資料屬於真正的欄位。
- 編輯器一律使用 `metadata` field type 與 `MetadataField`，不可在 feature 內另寫一份 key/value 表單。它以 JSON 物件字串傳輸，理由與 `option-values` 相同：`FormFieldValue` 沒有物件成員，為單一 field type 擴充它會波及其他所有型別。
- 詳情頁的摘要一律使用 `MetadataCard`（只有標題、key 數徽章與開啟鈕）。內容不攤在卡片上：一筆記錄可能有數十組,會蓋過真正描述該記錄的區塊。它不是 `EditCard` —— `EditCard` 依已知欄位清單渲染 label／值，metadata 的 key 是商店自己放的。
- 輸入必須經 `metadataInputSchema`（key 與值長度、最多 50 組）。這個欄位由商店控制，沒有上限的話單一記錄就能塞進任意大的 payload，而之後每次讀取都要搬運它。

### 記錄的附屬頁面走 `pages`，不是 query param

- 一筆記錄若有主編輯表單以外的頁面（metadata、指派商品、拖曳排序），在 collection 的 `pages` 宣告，網址是 `/dashboard/<slug>/<id>/<key>`。**不可用 `?section` 之類的 query param 在同一個頁面裡切換表單** —— 那會讓 URL 不再描述畫面，而那條路由會長成一個 switch。
- `pages` 與 `edit` 同層，不掛在 `detail` 底下：一個 collection 可以有附屬頁面卻沒有詳情頁（Assets 就是有 `edit` 沒有 `detail`）。把它藏在 `detail` 裡會讓那種 collection 平白無法宣告子頁。
- 具名 capability 與 `pages` 的分界是「框架有沒有參與」：
  - `index`、`create`、`preview`、`detail`、`edit` 框架要參與 —— 它渲染 Create 按鈕、解析 Edit row action、決定表單關閉後回到哪一層。這五個固定，不可增減。
  - `pages` 框架只負責掛載，內容意義由 view 自己負責。要新增這類頁面時加進 `pages`，**不要為它新增第六個 capability**。
- `edit` 是 `$id` 底下的靜態片段，所以它是保留的 page key；`assertCollectionsAreAddressable` 會在 `createCMSConfig` 就擋下來，而不是讓那個頁面靜默消失。
- **每個附屬頁面只送出自己的欄位。** 共用一個提交路徑會讓沒出現在該表單裡的欄位以 `undefined` 送出，而 `undefined` 與「清空」無法區分 —— 編輯一般欄位就會把 metadata 清掉。各自走各自的 action adapter。
- 附屬頁面的卡片自己導頁（`MetadataCard` 收 `slug` + `id` 自行推出 URL），與 `CollectionCreateButton` 一致。詳情頁不傳 handler：那等於每個 collection 各自重述一次框架已經擁有的 URL。

### 詳情頁不重複顯示記錄名稱

- 詳情頁不做「返回鍵 + 記錄名稱 + 徽章」的頁面標題列。記錄名稱是麵包屑的最後一段，由 view 呼叫 `usePageBreadcrumb(name)` 發布；資料還在載入時傳 `null`，讓那一段等名稱確定後才出現，而不是先閃一個佔位字串。
- 麵包屑的其餘部分仍由 `findBreadcrumbsFromCollections` 從 URL slug 推導 —— 它看不到 record id，這正是需要 view 補上最後一段的原因。
- 返回上一層靠麵包屑，不另外放返回鍵。狀態徽章放進資訊卡的 `headerActions`。

### 表格與既有 primitive 的重用界線

- **任何列與欄的資料都必須用 `src/components/ui/table.tsx` 的 `Table` 系列**，不可用 `div` + `flex-1` 拼一張看起來像表格的東西。這條不只適用於列表頁：表單或 wizard 裡的表格（例如商品建立的變體矩陣）同樣適用。列表頁另外還要包在 `DataTableCard` 裡，那是額外要求，不是替代。
  - `flex-1` 拼出來的欄寬只是「看起來對齊」，欄位一多或內容一長就會各列不同寬；而且沒有 table 語意，螢幕閱讀器讀不出列與欄的關係。
  - `TableHead` 與 `TableCell` 已經有 `px-4` 與 `[&:has([role=checkbox])]:pr-0`，不要再自己補 `pl-4` 之類的 padding。
- **Table 的預設密度是固定格式，不由 feature 自行決定。** `TableHead` 與 `TableRow` 統一為 `h-12`，`TableCell` 統一使用 primitive 的 `px-4 py-1.5`；feature 不得用 `h-*`、`min-h-*` 或 `py-*` 改寫一般資料列。若產品真的需要 compact／comfortable 密度，必須先在 `Table` primitive 建立具名 variant，並讓 header、row、cell 一起切換，不可只縮其中一層。
- Checkbox、文字、Badge、Switch 與 row actions 都必須放進同一套 `TableHead`／`TableRow`／`TableCell` 結構；欄寬只由 column contract 或對應的 head/cell class 決定，禁止為單一頁面建立另一套 table row 盒模型。
- **一般 Dashboard Card（包含 Table Card）一律使用 `h-auto`；Table 使用固定 page size。** Card 高度由內容自然撐開，不得用 `ResizeObserver`、`window.innerHeight` 或 Card 可用高度動態改寫 page size。
  - Server-side 分頁的 `limit` 只能來自穩定的 route search、使用者明確選擇的 rows-per-page，或該 feature 的固定預設；視窗縮放、sidebar 展開與 Card layout 變化不得改寫 URL `limit` 或觸發新的資料請求。
  - `DataTableCard` 統一擁有 `h-auto`；feature 不得用 `h-full`、`h-content`、`flex-1` 或 `min-h-*` 改寫一般列表 Card 的高度。資料超過固定 page size 時交給 pagination。
  - Assets 頁面的 Explorer、Properties 與 matching skeleton 是唯一 Card 高度例外，維持目前的 `h-content`／`min-h-content`，因為它們需要填滿同一個可用畫面並分配 Folders、Assets 與屬性面板空間；Assets 固定每頁 15 筆，其 query normalization、fallback pagination 與 server default 必須使用同一個 `15`。
  - Fullscreen create／edit／selector 由 `RouteFullscreenSurface` 管理滿版高度，不套用 Card 的 `h-auto` 規則。已一次載入完整資料集的 client-side selector 可以依內部 viewport 切分可見 rows，但只能影響本地 page size，不得同步成 server query `limit` 或觸發重新抓取。
  - 不具分頁語意且資料量有明確小上限的 form matrix／ranking table 不切頁；它仍使用相同 Table primitive，超出容器時在既有 scroll region 內捲動。
- **不要重新推導 primitive 已經擁有的盒模型。** 圓角、邊框、內距、字級屬於 primitive；新組件只帶自己的顏色與裝飾。需要新外觀時在該 primitive 加一個具名 variant，不要在旁邊蓋一個尺寸相同的新組件 —— 那樣 primitive 改了它不會跟著改。
  - `Tip` 是這樣做的：盒模型來自 `Alert` 的 `muted` variant，surface 顏色與其他 card fields 一樣來自 `fieldControlVariants({ variant: "card" })`；它自己只負責左側導軌與 `role="note"`（`Alert` 預設 `role="alert"` 會打斷螢幕閱讀器，提示不該這樣）。

### 視窗內容與 Fields 單一來源

- 所有 Dialog、Sheet、Drawer、Alert Dialog 或其他開啟式視窗，只要包含表單或可編輯資料，其欄位內容都必須由 `fields` 設定提供，使用既有 `FormField`／`FieldConfig` 型別並交由 `FieldsRenderer` 渲染。
- Route-backed create／edit wizard 只要已採用 fields-driven 區塊，也套用同一規則；`Input`、`Textarea`、`Select`、Switch 設定卡與表單內提示都必須宣告為 `FormField`，不可在 feature view 旁邊再硬寫一份 JSX。
- `fields` 是視窗內表單內容的單一真實來源，必須包含欄位名稱、label、type、初始值、placeholder、options、required、validation 與版面資訊；視窗 component 只負責標題、說明、開關狀態、submit action 與整體 layout。
- 不可直接在個別 Dialog 或 Sheet 內硬寫 `Input`、`Textarea`、`Select`、`PhoneInput` 或其他資料欄位。若現有 `FieldsRenderer` 不支援需求，應新增可重用的 field type 與對應 renderer，再由 `fields` 宣告使用。
- `type: "switch"` 的 control、label、description 與 panel 盒模型由共用 `SwitchField` 負責，feature 只提供 boolean value 並處理 change；不得為不同功能各自拼一個 Switch 卡片。
- fields-driven 表單中的說明提示使用 `type: "tip"`，由 `FieldsRenderer` 轉交共用 `Tip`；純展示且不屬於 fields-driven 區塊的提示仍可直接使用 `Tip`，不需要偽裝成可提交欄位。
- 同一欄位不可同時存在於 `fields` 與視窗 component 的 hard-coded JSX，避免預設值、驗證、disabled 狀態與提交名稱發生漂移。
- 純預覽、圖片裁切畫布、操作按鈕與不承載表單資料的視覺工具不需要偽裝成 field；但其中任何可提交的輸入仍必須回到 `fields` 與 renderer 體系。

### 共用功能視窗架構

- 功能頁面不得自行建立一份 Dialog、Sheet 或 Alert Dialog。頁面與操作按鈕只負責準備 `title`、`description`、`fields`、`action`、`onSuccess` 與必要的 button labels，再寫入對應的 feature store 並開啟視窗。
- 視窗資料流固定為：`頁面／按鈕 → set*Data(...) → 對應 Zustand store → Dashboard 全域共用視窗 → FieldsRenderer／功能內容 → action`。不得跳過 store 建立平行的 local modal state 與重複視窗實作。
- 新增一律走建立頁路由（見「新增資源一律是路由」），`CreateDialog` 與 `useCreateStore` 已移除，不得再引入同類的建立視窗；一般編輯統一使用 `useEditStore` 與 `EditDialog`；刪除或需要使用者確認的操作統一使用 `useInfoStore`、`setInfoData` 與 `InfoAlert`。
- 資產專用操作沿用既有邊界：Edit 的 `Folder` 與 Name／Alt 等欄位相同，屬於目前 active item，必須顯示該 Asset 的 `folderId` 或 Folder 的 `parentId`；切換左側 item 時 fields 必須重新掛載並顯示該 item 自己的值。多選 Float Move 才是把全部選取項目移到單一共同目的地，仍使用 `AssetMoveDialog`。圖片處理使用 `AssetPostProcessDialog`。預覽使用 `/dashboard/assets/view?assetId=...` 路由；單選與複選編輯都使用 `/dashboard/assets/$id/edit`，並共用 `AssetEditSurface`。複選清單必須序列化在 `?editItems`，由 route 重新批次讀取，不得依賴 explorer 的 Zustand selection，也不得重新加入 `AssetBulkEditDialog`／Bulk Edit store 或 Preview Dialog。
- Edit 不得另外建立 `Location` section、selection-level destination、`Keep current location` 或獨立 Move 按鈕；Folder 必須是 `generateEditFields(activeItem)` 內的一般 `folder-select` field。每個 `AssetEditItem` 保存自己的 `locationId`，其中 folder id 表示該 item 的父資料夾、`null` 表示 Root；底部 Save 一次提交所有 item 各自的 Metadata 與 location，後端在同一個 D1 batch 原子更新。被選取的 Folder ids 必須透過 `excludedIds` 排除於 FolderSelect；循環移動、父子同選、目的地重名，以及 Folder 同時重新命名與移動後的 effective path，必須在任何 D1 statement 執行前完成驗證。
- Assets table 每列 `…` 選單不提供 Move；單筆位置變更由 Edit 的 Folder field 負責，多選共同目的地由 Float Move 負責，拖放 Move 維持快速路徑。不得重新把單筆 `AssetMoveDialog` 接回 table row menu。
- Assets 編輯路由的 `$id` 代表目前右側正在編輯的項目；切換左側項目時使用 `replace` 更新 `$id`，選取集合仍由 `editItems` 保存。Server 必須以單次 assets query 加單次 folders query 批次載入，不可為每個 tile 各發一個 detail request。
- 共用視窗只能在 `src/routes/_backend/dashboard.tsx` 的 Dashboard layout 掛載一次，功能頁不得再次 mount 相同視窗。新增共用視窗時，也必須在 layout 集中 lazy-load 與掛載。
- 刪除操作不得由頁面或 action menu 直接呼叫 delete server function。必須先透過 `InfoAlert` 顯示目標、影響範圍與不可復原提示，再由確認按鈕提交 hidden fields 與 delete action。
- Create、Edit、Delete／Info 等 store 在視窗關閉或 action 成功後必須重設 open、fields、action、callbacks 與暫存資料，避免下一個頁面開啟時沿用前一次視窗內容。
- 若新頁面需要編輯或刪除，只能提供該頁面的 fields 與 action；不可複製 `EditDialog`、`InfoAlert` 或其 footer、loading、toast、error handling 邏輯。
- Create 介面的外框、分隔線與內容欄位一律取自 `src/components/dialog/create-surface.ts` 的 `createSurface`，不得手抄 class 字串。建立頁沒有 Radix Dialog context，無法直接用 `DialogHeaderActions`，但仍必須共用同一份 token — 這正是兩邊分隔線曾經走樣的原因：header 的切線在 light mode 是 `border-b-[0.5px]`，在 dark mode 改用 `shadow-elevation-modal-header` 且 `border-none`，手抄很容易只抄到一半。
- Create 介面的底部按鈕一律使用 `DialogFooterActions`。次要的提交動作（例如「Save as draft」）走 `additionalActions` 收進主按鈕的下拉，不可在 footer 並排第三顆按鈕。
- `DialogFooterActions` 統一擁有滿寬與右對齊規則；Cancel 在 Save 左側，整組固定靠 footer 右側。Feature 不得再傳 `w-full`、`ml-auto`、`justify-end` 或自行建立 footer button wrapper 來修正位置。
- Route-backed 的滿版介面一律使用 `RouteFullscreenSurface`，由它統一 `fixed inset-0`、外框、header、Close 與 `esc` 樣式。`RouteFormModal` 與 Assets Preview 都只能組合這個 surface，不可各自複製滿版 shell。

### 列表頁統一使用 DataTableCard

- 任何「資源清單」頁面（Products、Collections、Options、未來的 Orders、Customers 等）都必須使用 `dashboard/-components/data-table-card` 的 `DataTableCard`，不可自行拼一份 `CardWrapper` + `Table`。
- 版面固定為三段，順序不可調換：
  - **Header**：只放 `label`、`description` 與主要操作按鈕（通常是 Create）；搜尋、filter、排序不得放在 Header。
  - **Toolbar**：只要頁面提供搜尋、filter 或排序，就統一渲染在 Header 下方、Table 上方的 `DataTableToolbar`。Add filter 與 active filter chips 放左側，Search 與 Sort 放右側；頁面不得自行選擇另一個位置或重建一列 controls。
  - **Table**：欄位由 `columns` 宣告，每欄提供 `key`、`header`、`cell` 與可選 `className`；`className` 會同時套到 `TableHead` 與 `TableCell`，欄寬才會對齊。
- **Footer**：結果筆數與分頁由 `DataTablePagination` 提供；只要 feature 傳入 pagination，footer 與 First／Previous／Next／Last 四個切頁按鈕就必須持續顯示。位於第一頁、最後一頁或只有一頁時，對應按鈕只設為 disabled，不可隱藏整個 pagination。
- 每列的操作一律收進尾端的 `RowActionsMenu`（`…` 按鈕），透過 `rowActions` 回傳 `RowAction[]`。不可在列上並排多顆圖示按鈕，否則資源長出第三、第四個操作時版面會崩。刪除類操作標記 `destructive: true`，會自動排到分隔線之後並套用警示色。
- Loading、error、empty 三種狀態由 `DataTableCard` 統一處理並在卡片內置中；表格本身維持靠上。頁面只負責傳 `isPending`、`errorMessage`、`onRetry`、`emptyTitle`、`emptyDescription`，不可自己再寫一套分支。
- **這三種狀態有高度下限，取自 `DATA_TABLE_STATE_HEIGHT`**（`noRecords` 150px、`noResults` 400px）。是下限不是固定值：Medusa 把它們釘死在那個高度，但它的空狀態圖示是約 20px 的字型圖示，我們的 `EmptyFileIcon` 是 87×74，釘死會把圖示、標題與說明擠在一起。有下限就夠達成目的 —— 沒有的話一張空的 section 會縮成文案剛好的高度，掛在詳情頁上忽高忽低。
- 「資源本來就是空的」與「查詢把資料濾光了」是兩種狀態，高度不同。查詢無結果用**較高**的那個，因為它是使用者打字時出現的 —— 每按一鍵就把卡片縮到 150px 會讓頁面跳動。判斷由 `DataTableEmptyState` 自己讀 route 決定，不由頁面傳入。
- `DataTableCard` 本身不讀 route：搜尋、排序、分頁與空狀態各自是會讀 route 的**兄弟組件**。這個界線讓卡片可以在沒有 router 的測試裡渲染，加東西時不要把 `useSearch` 放回卡片本體。
- 搜尋詞、排序與頁碼寫入 route 的 `q`、`sortBy`／`sortOrder`、`page` search param，不放 component state；換搜尋詞或改排序時 `page` 會被清掉，避免停在超出範圍的頁數。
- 排序透過 `sortOptions` 提供，由 `DataTableSort` 渲染成 header 的下拉（與 Assets card 相同的 `BarsArrowDownIcon`），再選一次同一欄位即翻轉方向。`sortBy` 的可用值由 `dashboardSearchSchema` 定義，各資源在自己的 `normalize*ListParams` 裡對應到實際欄位名。
- 表格的首尾欄位左右各補到 `pl-6`／`pr-6`，與 `CardHeader` 的 `px-6` 對齊。`Table` 的 cell 預設是 `px-4`，直接使用會比標題少 8px。這個補償寫在 `DataTableCard` 內，頁面不需要也不應該自己處理。
- 欄位內容盡量用摘要而非展開全部資料（例如顯示「4 values」而不是列出四個 badge），細節留給編輯視窗或詳情頁。
- Card header 的主要操作按鈕統一使用 `variant="form"` 與 `size="xs"`，與 Assets card 的 Create 按鈕同高同色。Toolbar 內的 Add filter、排序與其他次要工具使用 `variant="cardHeader"`；搜尋使用共用 `DataTableSearch`。
- 需要新的共用能力（欄位排序、批次選取、篩選 chip）時，加在 `DataTableCard` 上讓所有列表頁一起受益，不可只在單一頁面實作。
- Feature 只透過 `toolbarLeading` 傳入共用 `DataTableFilter`；filter 值必須保存於 route search，切換時清除 `page`，並在 server／DAL 分頁前生效。沒有真實可用的 filter 時不可放一顆空的 Add filter。

### 新增資源一律是路由，不是從頁面狀態開啟的視窗

- 建立頁一律是 collection config 的 `create.view`，由框架渲染在 `/dashboard/<slug>/create`。**沒有第二種建立機制** —— 不得用 `useCreateStore` + `setCreateData` 開一個建立視窗。
- 建立頁一律填滿視窗（`RouteFormModal` 組合 `RouteFullscreenSurface` 的 `fixed inset-0`），不做側邊抽屜。欄位少的表單靠 `createSurface.content` 的 `max-w-3xl mx-auto` 收窄內容欄，卡片本身仍是滿版 —— 讓所有建立介面的外框一致，只有內容寬度隨表單變化。
- 為什麼不留 dialog 那條路：共用視窗是「框架拿著 fields 幫你渲染」，config 因此被迫要裝 `fields`、`action`、要 invalidate 的 query key，還要泛型才能讓取值函式有型別。建立頁是一個 view 的話，那些它自己做就好，config 只需要一行。
- 欄位很少的建立頁用 `RouteFormPage`：宣告 `fields` 與 `action` 即可，外殼、submit、footer 由它提供。有步驟或自訂版面的（例如商品 wizard）直接用 `RouteFormModal` 自己組 header／footer。
- 關閉一律是 `useRouteModalClose()`，不可寫死路徑，也不可用 `history.back()`。列表在底下維持掛載，所以關閉不會重抓資料；`replace` 讓 Back 不會退回已放棄的表單。
- 預設關閉到父路由。**從別處開啟時，由開啟方傳 `?returnTo`** —— 例如從某個選項的頁面開商品建立頁，關閉應該回到那個選項而不是商品列表。
  - 用 URL 而不是 `history.back()`：建立頁是可以直接貼網址開啟的，重新整理之後「上一頁」就變成別的東西，而可分享、可重新整理正是它做成路由的理由。
  - `returnTo` 必須經 `toDashboardReturnTo()` 收斂。它是唯一一個由 URL 控制、而且會變成導頁目的地的參數，所以只接受 `/dashboard` 開頭的站內路徑，絕對網址與 `//host` 一律丟棄。
- **從別的資源開啟建立頁時，預填與返回是一組的。** 開啟方同時傳 `?seed<Thing>Id`（要預先套用什麼）與 `?returnTo`（關閉回哪裡）；只傳其中一個，作者不是要重新挑一次剛剛看的東西，就是被丟到一個沒去過的列表。
  - 預填一律叫 `seed*`：它是**起點不是鎖定**，目標頁的既有控制項仍然可以改或移除它。
  - 套用的 hook 要滿足三件事，缺一個都會出錯：沒有該參數就完全不動作；等關聯資料載入完才套用（例如選項的值還沒到就套，會生出一條空的變體軸）；**只套用一次**，否則查詢 refetch 會把作者剛移除的東西加回去。`use-seeded-option.ts` 是範例，測試也照這三條寫。
- 唯二的例外：
  - **刪除**維持 `InfoAlert`。那是確認不是表單，沒有會遺失的輸入，也沒有值得存在的 URL。
  - 一個 collection 若有多種建立形式（Assets 的資料夾與上傳），由同一個建立頁讀 `?variant` 決定，不是兩條路由也不是退回 dialog。目標資料夾同樣走 search param（`?folderId`），所以「上傳到這個資料夾」是可以分享的連結。
- Create 按鈕的樣式與導航由 `CollectionCreateButton` 統一決定（`variant="form"`、`size="xs"`）；頁面只傳 collection 自己的平面 `slug`，不得自己組按鈕、傳 sidebar parent 或手寫 create URL。

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

### 絕對不要用 git 還原未提交的檔案

- **禁止對工作區檔案執行 `git checkout -- <file>`、`git restore <file>`、`git stash`、`git reset --hard`。** 這個專案長期有大量未提交的變更,這些指令會把它們無聲刪除,且沒有 reflog 可救。
- 需要「撤銷剛才的實驗性修改」時,用 Edit 把那次修改改回去 —— 你知道自己剛寫了什麼,不需要問 git。
- 需要臨時改檔案做實驗(例如驗證某個測試會不會紅)時,先把原始內容記在腦中或另存一份,改完再用 Edit 還原。
- 這條是實際踩過兩次的帳:一次是 reindent 腳本比對錯 `return (`,一次是為了重現 HMR 錯誤而 `git checkout` 了六個檔案,把兩輪的工作全部清掉。第二次只能靠 `dist/` 的建置產物逐段還原 —— server 端的 Vite 輸出未壓縮且保留註解,所以救得回來,但這是運氣,不是流程。


依修改風險執行最小充分驗證：

1. TypeScript：`pnpm exec tsc --noEmit`
2. `any` 檢查：`grep -rn ": any\|as any\|<any>" src --include=*.ts --include=*.tsx | grep -v routeTree.gen.ts` 必須無輸出
3. 測試：`pnpm test`（有相關測試或修改核心邏輯時）
4. Production build：`pnpm build`（修改 route、SSR、Cloudflare binding、lazy import 或 build config 時）
5. Schema：`pnpm db:generate` 並檢查新 migration（修改 schema 時）
6. UI：實際檢查目標 route 的 loading、error、empty、responsive 與 keyboard flow

### 表單內的按鈕必須明確標示 type

- `Button` 已把預設值改成 `type="button"`。HTML 原本的預設是 `submit`，導致建立頁的 Close 按鈕會送出空表單、跳出驗證錯誤 —— 使用者看到的是「關閉就報錯」。
- **要送出的按鈕必須自己寫 `type="submit"`**，不可依賴預設值。`DialogFooterActions`、`SubmitButton`、`InfoAlert` 都已經是這樣。
- `asChild` 時不套用預設值：那會把 `type` 加到別人的元素上（例如 `<a>`），那個屬性在那裡沒有意義。
- 回歸測試在 `src/components/ui/button.test.tsx`。

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
