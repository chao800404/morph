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
- 權限必須在 server 端。
- 登入與 session 由 Better Auth / existing helper 提供，不自行解析 auth cookie。
- `createdBy`、`updatedBy`、`uploadedBy` 等 actor 必須來自 verified session，不能相信 client user id。
- Theme / Storefront operation 必須同時驗證 `storefrontId` 與 `themeId` ownership。
- Client hidden button 不是 authorization。
- Preview capability token 只能授予 preview 能力，不可被當作 general admin token。

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
