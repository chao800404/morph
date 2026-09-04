# Morph Backend、Data 與 Routing 規則

## 12. Dashboard Routing 與 CMS Navigation

`src/routes/` 使用 TanStack Router file-based routing。

Dashboard 頁面的唯一 registry：

```text
src/cms.config.ts
→ dashboard/-collections/**
→ dynamic dashboard route
→ dashboard/-views/**
```

### 12.1 Dashboard collection

- 不可為單一 collection 再新增會蓋掉 `$slug` 的平行 static route。
- 新功能優先延伸 existing collection capability：`index`、`create`、`preview`、`detail`、`edit`。
- `-components`、`-queries`、`-views`、`-collections` 是 route-internal module。
- route search params 必須經 schema 驗證。
- 可分享、可返回、影響 dataset 的 state 應放 URL，不放 component-only state。

### 12.2 Visual Editor 例外

`/store/$storefrontId/themes/$themeId/editor` 是獨立 top-level authoring route，因此可以使用自己的 file route / pathless layout。

但仍必須：

- TanStack file routing
- validated search
- authentication
- loader / query prefetch
- pending / error state
- 不手改 `routeTree.gen.ts`

---

## 13. Server Function、Authorization 與 Actor

- Server function 所有 external input 必須使用 Zod 或集中 validation。
- **Validator 不得拋錯。** `.validator((data) => schema.parse(data))` 的 ZodError
  會在 handler 之前拋出，繞過 handler 內把 domain failure 轉成 `fail(...)` 的
  `try/catch`，最後被 h3 包成不透明的 500。改用
  `parseInput(schema, data)`（`@/lib/db/server-result`）回傳 `ServerFailure`，
  讓驗證失敗留在呼叫端本來就在處理的 union 裡，並帶上欄位錯誤。
  **優先套用在 schema 編碼了伺服器狀態前提（OCC/CAS，例如 `expected*`、
  `expectMissing`）的 server function**——那些會在正常操作中失敗，而純表單
  validation 幾乎只在 client 有 bug 時才會失敗。
- 權限必須在 server 端。
- 登入與 session 由 Better Auth / existing helper 提供，不自行解析 auth cookie。
- `createdBy`、`updatedBy`、`uploadedBy` 等 actor 必須來自 verified session，不能相信 client user id。
- Theme / Storefront operation 必須同時驗證 `storefrontId` 與 `themeId` ownership。
- Client hidden button 不是 authorization。
- Preview capability token 只能授予 preview 能力，不可被當作 general admin token。

### 13.1 診斷：`{"status":500,"unhandled":true,"message":"HTTPError"}`

這個回應**不是**你的 handler 產生的，是 h3 對任何逃出處理鏈的例外的兜底包裝，
原因整個被抹掉。看到它先確認請求是否真的抵達 handler，**不要從 handler 邏輯查起**。

依可能性排序：

1. **請求根本沒到 handler。** server function 的 URL 由
   `process.env.TSS_SERVER_FN_BASE + functionId` 組成，而該表達式會原封不動送到
   瀏覽器。若未在 transform 階段替換，URL 會由 `undefined` 組成，打到不存在的路徑。
   驗證方式：在 browser console 檢查某個 server function 的 `.url` 是否以
   `/_serverFn/` 開頭。這條會呈現為「改了程式就壞、刷新就好」，因為它取決於模組
   被求值當下的順序。
2. **Validator 拋錯**（見上）。
3. 才輪到 handler 內部。

判準：打到真正的 handler 時，回應會是有意義的（`405`、`401`、
`{success:false, message}`）。**不透明的 500 代表沒打到。**

`src/server/server-fn-recovery.ts` 會在 Worker entry 攔截這個空 500，換成帶
`error: "SERVER_FN_UNHANDLED"` 與 function id 的訊息（h3 是**回傳**它而不是拋出，
所以必須檢查 response 而非 catch）。**它刻意不宣稱「id 過期」**——真的 handler
crash 也會落進同一個兜底，貼上「not found」只會把人帶去查錯地方；狀態碼也維持
500，不改成 404。看到這個 error code 時原因仍然只在 server log 裡。

---

## 14. DAL、DTO、Service、Storage Boundary

責任分工：

```text
Route / Component
   ↓
TanStack Query / Server Function
   ↓
Authorization + Validation
   ↓
Service / Use Case Coordination
   ↓
DAL or Storage Contract
   ↓
D1 / R2 / Cloudflare service
```

### 14.1 DAL

DAL 負責：

- database query
- aggregate write
- atomic guard
- ownership filtering
- relation read
- D1-specific SQL when required

**單列查詢必須誠實表達「查不到」。**

`const [row] = await db.select()...` 會把解構出的元素推導成必定存在。
`row ?? null` 之後型別又縮回非 null，於是呼叫端**看不到查無資料這個情況**，
失敗會延後成無法解釋的 `undefined`。

單列讀取一律使用 `firstOrNull()`（`@/lib/db/single-row`）：

```ts
const row = firstOrNull(await db.select().from(t).where(...).limit(1));
if (!row) return null;
```

映射成 DTO 時用 `mapFirstOrNull()`。`rows.length > 0 ? toDTO(rows[0]) : null`
看起來有防護但沒有：length 檢查不會 narrow `rows[0]`。

**這條規則由 `pnpm typecheck:data` 強制執行。** 根 `tsconfig.json` 沒有開
`noUncheckedIndexedAccess`（對 dense numeric array 與 fixture 測試是雜訊，
`theme-compiler-hasher.ts` 的 SHA-256 word array 一個檔就要 44 個 non-null
assertion 而毫無安全收益）。`tsconfig.strict.json` 會用該 flag 編譯整個程式，
但只**回報** DAL / storage / serverFn 這幾層 —— 查無資料在那裡才是真實的失敗模式。

其他區域整理好之後，擴大 `scripts/typecheck-data-layer.mjs` 的
`ENFORCED_PATHS` 即可漸進納管。

### 14.2 Service

Service 負責跨 storage / build / artifact 的 workflow coordination。

例如 Theme Build 不應把：

- revision storage
- build runner
- artifact store
- build lifecycle

全部耦合進同一個 D1 DAL。

### 14.3 Storage abstraction

如果 domain 已存在 storage contract：

- server function 不應直接知道 backend 是 D1、R2 或 future backend。
- composition root 集中選擇 implementation。
- 不建立相同用途的第二套 storage interface。

---

## 15. Drizzle、Raw SQL 與 Cloudflare D1

Drizzle 是主要 ORM，但**不是所有操作都必須硬塞進 Drizzle API**。

以下情況可以使用 `env.DATABASE.prepare()` / `batch()`：

- atomic precondition guard
- CAS / OCC
- D1-specific transaction-like batch orchestration
- ORM 無法可靠表達的 SQLite / D1 primitive
- 需要把 guard 與 mutation 放進同一個 D1 batch

原則：

- raw SQL 必須集中在 DAL / storage backend。
- 不可從 component / server function 散落直接 SQL。
- query 參數必須 bind，不拼接不可信輸入。
- 有可能使用 Drizzle 清楚完成的普通 CRUD，優先用 Drizzle。

### 15.1 D1 LIKE / GLOB

D1 / SQLite LIKE / GLOB pattern 有 byte 限制。

- prefix subtree query 不使用超長 `LIKE prefix%`，優先半開區間 `gte(prefix)` + `lt(upperBound)`。
- user contains search 使用集中 `containsPattern()`，不可自行拼 `%${term}%`。

### 15.2 Binding parameter limit

每 statement 的 binding 數量有限。

Multi-row insert 必須依：

```text
row count × bound column count
```

計算 chunk，不可照抄固定 batch size。

沿用既有 `chunkForInsert()` 等 helper。

### 15.3 D1 batch

同一 aggregate 的多 statement mutation 應盡量收進同一 `env.DATABASE.batch()`，避免部分寫入。

Atomic precondition guard 與實際 mutation 必須屬於同一次 logical write。

---

## 16. Commerce Module Boundary

Morph 保留 Medusa-style module ownership。

- 同 module 可以有真正 DB FK。
- 跨 commerce module 優先使用 id / link table，不建立 schema import cycle。
- `*.schema.ts` 不應為跨模組 relation 隨意 import 其他 module schema。
- link table 沒有 FK cascade 時，delete workflow 必須自行處理。
- read 時不可無條件相信 cross-module link 仍有效。
- 金額使用 currency minor unit integer。
- 稅率 / 百分比依現有 schema convention。
- totals 通常 computed；歷史 order snapshot 除外。
- API key / invite token 保存 hash，不存 plaintext token。
- Cart / Order line item 是歷史快照，不應因商品後續改名或刪除而失真。

---

## 17. Aggregate Write 與 Round-trip

一個使用者動作若更新同一 aggregate root 的多張表：

- 必須盡量原子寫入。
- 不可先 create root 再逐筆 await relation insert。
- 任何 action 可編輯欄位都必須能由 detail query / DTO 讀回。
- edit form 不可因未呈現欄位而用空陣列 / 空字串覆蓋既有值。

複合功能至少驗證：

1. create 後 detail 可見。
2. reopen edit 值仍存在。
3. 只改無關欄位不會清掉其他資料。
4. batch 中任一 statement fail 不留下 partially visible aggregate。

---

## 18. Query、Pagination 與 URL State

會持續成長的 collection：

- Products
- Orders
- Customers
- Assets
- Inventory
- Promotions
- logs
- 其他無可靠 hard upper bound 的資料

預設 server-side pagination。

URL 應是可分享 dataset state 的 SSOT：

- `q`
- sort
- page
- filter
- folder
- route modal return target

TanStack Query key 必須集中，不在 view 手寫重複 key。
