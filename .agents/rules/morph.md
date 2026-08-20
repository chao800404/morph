# Morph 專案開發規則

本文件是 Morph repository 的**工程與架構規則**，適用於所有開發者與 AI coding agent。

本文件只規範「不可違反的邊界、SSOT、資料流、安全與實作慣例」。產品階段、優先順序與未來交付內容請看 [`ROADMAP.md`](../../ROADMAP.md)。

如果本文件與執行中的程式碼不一致：

1. 先追查真實 route → query → server function → service → DAL/storage → schema 的完整呼叫鏈。
2. 判斷是既有程式尚未遷移，還是規則已過時。
3. 以**單一架構收斂**為目標修正，不可建立第二套平行 framework。
4. 不可為了讓局部功能先跑而繞過 authorization、revision、build、release、OCC 或 production safety boundary。

---

## 1. Morph 的產品與架構定位

Morph 是一個 **AI-native commerce platform**，目標結合：

- Medusa 式 commerce backend：商品、價格、庫存、訂單、客戶、促銷、稅務、sales channel 等維持明確資料責任邊界。
- Shopify 式 Online Store：Theme、Page、Template、Navigation、Domain、Preview、Publish 與 Visual Editor。
- Code-backed storefront：React / TSX / Tailwind 是 presentation 的主要 source of truth。
- Visual AST Editor：Canvas 是 source code 的高階編輯介面，不是另一份 presentation JSON。
- AI Code Agent：可以在受控 workspace 中新增或修改真正的 React / Tailwind / interaction code。
- Cloudflare build / runtime plane：source revision、Sandbox build、R2 artifact、preview、release、edge runtime 與 rollback。

Morph 不是單純的 section-schema page builder，也不是無限制的一般用途 app generator。

---

## 2. Source of Truth：不得混淆

Morph 有多個 SSOT，但每一種資料只能有一個權威來源。

| 領域 | Source of Truth |
|---|---|
| 商品、價格、庫存、選項、媒體、客戶、訂單、促銷、稅、sales channel | Commerce modules / D1 |
| Storefront layout、樣式、responsive、motion、interaction、Canvas/WebGL/Three/GSAP implementation | React / TSX / CSS / Tailwind Theme Source |
| 可視化元件 implementation | Theme Source |
| 文案、圖片選擇、SEO、commerce references、頁面 section instance 與 ordering | Versioned Page / Template Document |
| Theme 的可編輯工作狀態 | Theme Workspace Files |
| 可重現的 Theme source snapshot | Immutable Theme Source Revision |
| 可執行前端結果 | Immutable Theme Build Artifact |
| 線上正在使用的 storefront 組合 | Storefront Release / Active Release |
| 使用者登入、角色與 session | Better Auth / existing auth helpers |

### 2.1 Presentation SSOT

React / TSX / CSS / Tailwind source 是 presentation SSOT。

以下資訊不得再建立第二份可獨立演進的 JSON presentation model：

- Tailwind class
- arbitrary values
- grid / flex layout
- breakpoint behavior
- component nesting
- animation implementation
- GSAP timeline
- Three.js / R3F / Canvas logic
- Map runtime
- event handlers
- custom component composition
- component-local state
- effect implementation

Visual Editor 若修改以上內容，應透過 AST / source transformer 更新 Theme Source。

### 2.2 Page / Template Document 的責任

Page Document 是 content / assembly data，不是 presentation implementation。

Document 可以保存：

- section instance id
- `componentRef`
- enable / hide state
- section ordering
- copy
- image / video / asset reference
- CTA URL
- SEO
- navigation reference
- product / collection / category reference
- safe presentation-independent settings
- locale-specific content

Document 不應保存可執行 JS、任意 TSX、shader、callback、dynamic import 或環境變數。

**Document 不得成為 React source 的鏡像。**

如果同一個 styling value 同時存在於 TSX Tailwind 與 Document props，必須明確指定誰是 SSOT；預設 styling 以 Theme Source 為準。

### 2.3 Commerce SSOT

Page / Theme 不得複製可變 commerce 權威值成第二份可編輯資料。

例如：

- product price
- inventory quantity
- variant availability
- SKU
- option value
- promotion result
- tax calculation

頁面應保存 record reference 或 query configuration，production runtime 再讀取目前 request context 下的公開 Commerce DTO。

### 2.4 Theme Storage Policy

Theme code 的 storage boundary 必須固定，不可因為目前使用的 service、DAL 或 agent 實作方便而改回 schema-first 或把 customer code 放進 Morph Core。

```text
Mutable Theme Workspace
        → D1

Immutable Source Revision
        → D1 revision metadata
        → R2 immutable, content-addressed source blobs

Build Artifact
        → R2

Release / activeReleaseId
        → D1
```

具體責任如下：

- `storefront_theme_files` 是目前可編輯的 mutable Theme Workspace；AI、Code Editor、Monaco 與 Visual Editor 都只能透過既有 workspace／OCC 邊界修改這份資料。
- `storefront_theme_revisions`（或等價 revision metadata store）只保存 immutable source revision metadata、manifest、generation、actor 與時間。Revision 的完整 source bytes 必須存成 R2 content-addressed blobs，例如 `theme-source/{sha256}`；不可把 mutable workspace 當成 revision 的 fallback。
- Theme source revision 的 manifest 應由 path 對應到 immutable blob digest。相同 bytes 應可去重，revision 建立後不得覆寫既有 blob。
- `storefront_theme_builds`（或等價 build metadata store）保存 build identity、狀態、compiler、diagnostics 與 artifact metadata；成功的 `index.html`、JS、CSS、圖片、字型與其他 build output 必須存到 R2，例如 `themes/{themeId}/builds/{buildId}/`。
- `StorefrontRelease`、`activeReleaseId` 與 release activation／OCC metadata 必須存於 D1。Production runtime 只能從 active release resolve immutable Theme Build Artifact 與 published content revision。
- `storefronts.active_release_id` 是 production release 的唯一 SSOT；`storefront_releases.status` 只能表達 `available`／`invalidated` 等 lifecycle，不得再用 `active`／`superseded` 維護第二份 active state。Rollback 只切換 `active_release_id`。
- 任何被 `storefront_content_publication_items.revision_id` reference 的 template/page/navigation revision 都是 retained immutable history；GC 或 hard-delete 必須先通過 retention guard，禁止刪除被 ContentPublication 引用的 revision。
- Theme workspace source、source blobs、assets 與 build artifacts 不得寫回 Morph GitHub repository，也不得寫入 Morph Core 的 Worker bundle 或部署原始碼。GitHub／Worker 只保存 Morph Core、平台程式與 bootstrap starter source。
- 目前若仍有 D1 snapshot 或 compatibility path，必須明確視為 migration／compatibility implementation，不能因此新增第二套 source、revision 或 production runtime SSOT。

---

## 3. 核心工作原則

- 修改前先閱讀真正的入口、route、query、server function、service、DAL/storage 與 schema。
- 僅修改需求直接相關的檔案；保留工作樹中無關變更。
- 優先延伸現有 abstraction，不建立平行 route registry、query key、auth helper、DTO、storage backend、publish state 或 page framework。
- 不可手動修改 `src/routeTree.gen.ts`、Cloudflare generated types、build output 或其他 generated files。
- 除非使用者明確要求，不執行 production deploy、remote migration、push、commit 或 Cloudflare remote resource mutation。
- 新 capability 必須先確認它屬於 Control Plane、Authoring Plane、Build Plane 還是 Runtime Plane，避免責任混在同一個 module。
- 不可用 UI 隱藏、disabled button 或 client state 代替 server-side authorization。
- 不可用「先做假成功 UI」冒充 backend capability 已完成。尚未接線的 action 必須 disabled、標示 unavailable，或有清楚的 failure state。

---

## 4. Storefront Theme Source Workspace

### 4.1 Theme Files

Theme source workspace 是一個 virtual filesystem，典型內容包括：

```text
package.json
morph.theme.json

src/
├─ pages/
├─ components/
├─ styles/
└─ ...
```

Theme files 可以包含：

- `.tsx`
- `.ts`
- `.css`
- `.json`
- 允許的靜態資產或 manifest

所有 path 必須經 `safeThemeFilePathSchema` 或等價的集中驗證，不可直接相信 client path。

### 4.2 Workspace 是 mutable，Revision 是 immutable

必須維持：

```text
Theme Workspace Files
        ↓ freeze
Immutable Theme Source Revision
        ↓
Build
```

Build 不可直接讀取 mutable working files。

一旦 build 綁定 `sourceRevisionId`：

- build input 不得 fallback 回目前 workspace。
- revision bytes 不得被覆寫。
- compiler identity / input hash 一旦 freeze 不得漂移。
- retry 必須重用相同 immutable input，或建立新的 build。

### 4.3 OCC

Theme workspace mutation 必須保留 optimistic concurrency control。

至少使用：

- per-file version / identity guard
- `expectedSourceGeneration`
- theme ownership guard：`storefrontId + themeId`
- server-side conflict response

遇到 remote generation conflict：

- 不可 silent last-write-wins。
- client 必須 reload / accept remote / resolve conflict。
- AI agent 也必須遵守同一條 OCC 邊界。

### 4.4 Starter Theme

Starter theme 必須是**真的可以 build 的 React theme source**，不是 preview-only mock。

Starter Theme 是建立新 Theme 時使用的 bootstrap seed，不是任何 customer Theme 的 runtime dependency，也不是所有 storefront 共用的 Morph Core component implementation。建立 Theme 時可以從 repository 內的 starter source directory 複製檔案進入 D1 Theme Workspace；複製完成後，Theme A、Theme B 與後續 AI／Code Editor 修改的都是各自 workspace 的 copy。

不得讓 customer Theme runtime 直接 import Morph Core 的 starter component，也不得因為 starter source 更新而自動改寫既有 Theme Workspace。Starter source 可以存在 Morph GitHub repository，但 customer-generated source 必須遵守 2.4 的 D1／R2 storage boundary。

`morph.theme.json` 是 Theme source metadata / capability manifest，可用於：

- entry file
- component mapping
- `componentRef`
- source path
- visual editor capability metadata
- future AI agent context

Manifest 不得變成另一份 presentation SSOT。

---

## 5. Visual Editor = Source Code 的 GUI

Visual Editor 是獨立 authoring surface，正式 route 目前使用：

```text
/store/$storefrontId/themes/$themeId/editor
```

它不是 Dashboard collection page。

### 5.1 Editor shell

Editor 應維持：

```text
Left: structure / template / section navigation
Center: isolated storefront preview
Right: selected element inspector
Code Mode: Monaco / source workspace
```

Editor 不複製 Dashboard sidebar / breadcrumb framework。

Dashboard 的 `Customize theme` 應以新分頁開啟，並使用 `noopener noreferrer`。

### 5.2 Visual editing 的基本資料流

可視化 style 修改應遵循：

```text
Select preview node
      ↓
Resolve data-morph-node / source location
      ↓
Parse source AST
      ↓
Safe source patch
      ↓
Update local workspace
      ↓
Save with OCC
      ↓
Preview refresh
```

Canvas 不得只更新 React local state 或 Page Document 來假裝 source 已改。

### 5.3 `data-morph-*` metadata

Theme component 可以使用：

- `data-morph-section`
- `data-morph-node`
- `data-morph-element`

其中 `data-morph-node` 應在同一 source file 內保持唯一，作為 Visual Editor 定位穩定節點的主要方式。

AI 產生的新 component 若希望完整支援 Visual Editor，應盡可能輸出穩定的 Morph metadata。

沒有 Morph metadata 的合法 React component仍可以 build / runtime 執行，只是 visual editability 降低；不得因此阻止 Code Mode 的自由度。

### 5.4 AST 安全邊界

Visual Editor 只能在 transformer 能證明安全時自動 patch source。

例如：

- 靜態字串 `className="..."` 可以修改。
- 可定位的 literal/default prop 可以修改。
- `className={complexExpression(...)}` 不應被 regex 粗暴覆寫。
- 無法安全修改時，Inspector 應顯示 unsupported / code-only，或導向 Code Workspace。

禁止用 regex 當作通用 TSX parser。

### 5.5 Visual → Code / Code → Visual 必須雙向收斂

目標行為：

```text
Canvas 修改
→ source 改變
→ Monaco 看到相同 source

Monaco 修改
→ source save
→ parser 重新解析
→ Canvas / Inspector 反映可解析的新結果
```

不得建立 Editor 專屬的第二份 component state 作為長期 persisted source。

---

## 6. Page / Template Content Authoring

Content 修改與 source 修改是兩種不同 mutation。

### 6.1 Content-only mutation

例如：

- Hero heading
- description
- image
- CTA
- SEO
- product / collection reference
- section ordering

應更新 versioned Page / Template Document。

Content-only change **不需要重新 build Theme**。

### 6.2 Presentation mutation

例如：

- font size class
- grid layout
- responsive breakpoint
- new component
- animation
- custom Canvas/WebGL logic

應更新 Theme Source，並在 production release 前建立新的 successful build。

### 6.3 Runtime composition

Production storefront 必須能組合：

```text
Theme Build Artifact
        +
Published Page / Template Document
        +
Current Commerce DTO
        ↓
Rendered Storefront
```

不得把所有 page content bake 進 theme build，否則改一句文案都會要求重新 build。

---

## 7. Theme Build Plane

Build 是 engineering pipeline，不是普通 CMS content save。

### 7.1 Build identity

Theme Build 必須永久綁定：

- `storefrontId`
- `themeId`
- `sourceRevisionId`
- `inputHash`
- `compilerId`
- `compilerVersion`

Build state：

```text
queued → building → succeeded
                  ↘ failed
```

不可把 failed build 標記成 publishable。

### 7.2 Build source

Materializer 只能從 immutable revision 重建 virtual filesystem。

禁止：

```text
build → current mutable theme files
```

必須：

```text
build → immutable sourceRevisionId → snapshot
```

### 7.3 Sandbox

不可信 Theme / AI source 必須在隔離 build environment 執行。

Cloudflare Sandbox / Container build 至少要維持：

- CPU / duration bound
- source file count limit
- source bytes limit
- output file count limit
- output bytes limit
- workspace path containment
- dependency allowlist
- pinned build toolchain
- no production D1 credential
- no Better Auth secret
- no R2 credential passed into user code
- no unrestricted environment access

Theme source 不可在 Morph request Worker 中 `eval`。

### 7.4 Dependencies

Theme package dependencies 必須經平台 dependency policy。

AI 不得自行加入任意 npm dependency 並直接 production build。

新增 dependency capability 時要：

1. 加入 allowlist。
2. 固定 / 管理版本。
3. 評估 bundle size、license、安全與 Cloudflare runtime compatibility。
4. 加 negative test。

### 7.5 Artifact

Build 成功後輸出 immutable artifacts，保存到 R2 或正式 artifact backend。

Artifact manifest 必須是 serve allowlist，Preview / Runtime 不得接受任意 path 讀取 R2 prefix。

Artifact 寫入成功後才可 finalize build succeeded。

---

## 8. Preview

Morph 可以同時存在兩種 Preview，但用途必須清楚。

### 8.1 Live Authoring Preview

目的：快速回饋 workspace / document 編輯。

可以使用 browser compiler、dev runtime 或其他低延遲方式。

它不是 production proof。

### 8.2 Immutable Build Preview

目的：驗證真正的 source revision + compiler + artifact。

必須：

- 只 serve `succeeded` build。
- 綁定 immutable `buildId`。
- 使用 capability token 或正式 session authorization。
- iframe 與 Dashboard 隔離。
- 防 path traversal。
- 只 serve manifest allowlist file。
- 正確 CSP / MIME / `nosniff`。
- preview token 不得等同 production deploy credential。

Human publish 應以 successful immutable build 為基礎，而不是只看 live preview。

---

## 9. Storefront Release 與 Production Runtime

這是 Morph 最重要的 production boundary。

### 9.1 Release model

長期正式模型應是 immutable Storefront Release，例如：

```text
StorefrontRelease
├─ id
├─ storefrontId
├─ themeId
├─ themeBuildId
├─ sourceRevisionId
├─ contentPublicationId
├─ createdBy
├─ createdAt
└─ metadata
```

`ContentPublication` is the immutable set of published content references for
that release:

```text
ContentPublication
└─ template / page / navigation revision references
```

Storefront 再持有：

```text
activeReleaseId
```

Content-only publish 可以建立一個新 Release，但重用相同 successful `themeBuildId`。

Presentation/source publish 必須引用對應 source revision 的 successful build。

### 9.2 Atomic activation

Production 切版的核心應是：

```text
activeReleaseId: old → new
```

必須是經 authorization 與 OCC 保護的原子操作。

不得先切 published source，再晚一點才產生 artifact。

### 9.3 現行 publish path 的遷移規則

在 `StorefrontRelease` 尚未完整落地前：

- 既有 `publishedSourceRevisionId`、template `publishedRevisionId`、`releaseGeneration` 可以作 compatibility path。
- 不可基於 compatibility path 再建立第二套 production router。
- 新 production runtime 工作必須朝 immutable release 收斂。
- migration 必須保留 rollback 與既有 published state。

### 9.4 Production Edge Router

目標請求流程：

```text
Request hostname
      ↓
Resolve Storefront
      ↓
Resolve activeRelease
      ↓
Resolve immutable Theme Build Artifact
      ↓
Resolve published Page / Template content
      ↓
Resolve public Commerce DTO
      ↓
Serve / render Storefront
```

Control Plane failure 不應讓已發布 storefront 下線。

Build Plane failure 不應影響上一個 active release。

---

## 10. AI Authoring / AI Code Agent

AI 是 author，不是 production operator。

### 10.1 AI 可以做什麼

AI 可以在受控 authoring workflow：

- 讀取 Theme source snapshot / workspace
- 新增 React component
- 修改 TSX / Tailwind / CSS
- 建立 GSAP / Canvas / WebGL / Three/R3F implementation
- 更新 `morph.theme.json`
- 修改 safe Page / Template content
- 產生 code patch
- 執行 bounded repair loop
- 建立 AI source revision
- request sandbox build
- 顯示 preview / diff / diagnostics

### 10.2 AI 不可以做什麼

AI 不可：

- 直接改 production artifact
- 直接切 active release
- 直接 deploy production
- 直接執行 production migration
- 讀 production secrets
- 直接取得 raw Better Auth session secret
- 繞過 dependency policy
- 關閉 build resource limits
- 關閉 authorization / OCC
- 把 failed build publish
- 自行提升權限

### 10.3 AI Code workflow

正式目標：

```text
User Prompt
   ↓
AI reads scoped source/context
   ↓
Proposed file operations / patch
   ↓
Validate paths + dependency policy
   ↓
Apply to authoring workspace with OCC
   ↓
Create immutable source revision
   ↓
Sandbox build
   ↓
Immutable preview
   ↓
Human approval
   ↓
Release activation
```

AI repair loop 每次都必須 bounded，不可無限 retry。

### 10.4 AI 與 Page Document

AI 不需要被限制成只能輸出 section schema。

但若任務只是改文案、asset、SEO、commerce reference 或 ordering，優先修改 Page / Template Document，不必修改 code。

判斷原則：

```text
Content/assembly change → Document
Presentation/runtime change → Source
```

---

## 11. Interactive Experience

Canvas、WebGL、Three.js、R3F、GSAP、Mapbox、scroll story 等不是特殊旁路。

它們是正常 Theme Source capability。

AI / developer 可以建立真正的 React implementation，但仍必須遵守：

- sandbox build
- dependency policy
- runtime performance budget
- lazy loading
- asset budget
- reduced motion
- mobile fallback
- WebGL unavailable fallback
- error state
- cleanup / dispose
- no unbounded render loop
- no production secret access

可以建立 reusable preset / component library，但 preset 是**加速 authoring 的 product layer**，不是限制所有頁面只能使用 preset。

---

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

---

## 19. UI 與 Shared Primitive

- 優先使用 `src/components/ui/` 與現有 feature/shared component。
- 修改 shared primitive 前先搜尋全部使用處。
- 不在 feature 重做 Dialog、Table、CommandBar、Route fullscreen、form field 等已存在 primitive。
- Field control 視覺應以 shared Input / field primitive 為基準。
- keyboard、focus、label、loading、error、empty、responsive 必須保留。
- reduced motion 必須被尊重。
- 主題切換應避免全頁 transition 造成閃色 / 漸變。
- 需要新的共用 interaction 時優先在 shared primitive 擴充，而不是單頁 copy。

### 19.1 Resizable panel

會持久化寬度的 Editor / Dashboard panel：

- SSR initial width 使用 Cookie。
- client 可以同步保存 localStorage。
- 初始 HTML 與 hydration state 必須一致，避免 CLS。
- resize control 使用 Pointer Capture 與 min/max guard。

### 19.2 Continuous numeric control

視覺 editor 的連續值，例如尺寸、間距、角度：

- 支援 keyboard input。
- 可提供 scrub interaction。
- 優先沿用 `ScrubbableNumberInput`。
- 保留 min/max / step / Enter / Escape / accessible label。

---

## 20. DataTable / Resource List

資源清單頁優先沿用既有 `DataTableCard`、`DataTableToolbar`、`DataTablePagination`、`RowActionsMenu` 與 filter primitives。

不得在單一 feature 重新拼一套：

```text
Card + search + filter + table + pagination
```

會影響 dataset 的搜尋、排序、分頁與 filter 應保存於 route search params。

---

## 21. Create / Edit Route

Dashboard 新增資源預設是 route-backed form，而不是靠頁面 local state 開啟不可分享的建立 dialog。

- create 使用 collection `create.view`
- route form close 沿用 existing helper
- cross-resource create 使用 safe `returnTo`
- seed data 使用明確 `seed*` search param
- destructive confirmation 可以保留 Alert Dialog

如果 existing feature 已有經驗證的另一種 pattern，先確認架構再遷移，不做半套雙軌。

---

## 22. TypeScript 與 Code Quality

- `src/` 採 strict TypeScript。
- 不使用 `any` 逃避型別問題；generated files 除外。
- external JSON / DB JSON / manifest 先視為 `unknown`，再 validate / narrow。
- 不重複定義 domain DTO。
- 共享型別應靠近 domain boundary。
- 不因測試方便把 production private invariant 暴露成 public API。
- 對 impossible state 使用 explicit error，不 silent fallback 成看似成功的資料。

---

## 23. Security

所有新 feature 都要考慮：

- authentication
- authorization
- tenant / storefront ownership
- path traversal
- HTML / rich text injection
- SSRF
- dependency supply-chain
- untrusted source execution
- preview token scope
- production secret isolation
- D1 / R2 object ownership
- rate limiting / bounded work
- auditability
- rollback

Theme code 與 AI code 一律視為不可信 source。

---

## 24. Testing

每個 capability 至少按風險覆蓋：

- happy path
- invalid input
- unauthorized
- ownership mismatch
- concurrent update / OCC
- storage failure
- partial failure
- rollback / previous version preservation
- loading / empty / error state
- production build

Theme / Build 相關額外測試：

- unsafe path
- duplicate source path
- empty revision
- multiple entry files
- compiler identity mismatch
- input hash mismatch
- failed sandbox
- timeout
- dependency deny
- artifact persistence failure
- preview token mismatch
- manifest path not allowed
- build from immutable revision only
- CAS loser 不得把 winner 標成 failed

Visual Editor 額外測試：

- `data-morph-node` duplicate
- static class patch
- dynamic class reject
- source conflict
- Canvas → source
- source → Inspector parse

---

## 25. CI 與完成條件

正常程式修改完成前至少執行：

```bash
pnpm typecheck
pnpm test
pnpm build
```

不能因為其中一項「應該沒問題」而直接宣稱完成。

GitHub CI / local validation 若尚未實際執行或無法取得結果，必須明確說「未驗證」，不可推測通過。

---

## 26. Migration 原則

架構轉換時：

- 不建立新舊 framework 長期並存。
- 先建立 compatibility adapter，再逐步搬 caller。
- 舊資料需要 migration / fallback 時要明確定義 sunset。
- 任何 production state migration 都要有 rollback。
- 不可為了新架構直接丟棄既有 published storefront state。

### 26.1 Morph 目前的主要收斂方向

目前新 storefront 工作應優先朝以下架構收斂：

```text
Theme Source Workspace
        ↓
Visual AST Editor / Monaco / AI Code Agent
        ↓
Immutable Source Revision
        ↓
Sandbox Build
        ↓
Immutable R2 Artifact
        ↓
Storefront Release
        ↓
Edge Runtime
```

內容資料則走：

```text
Page / Template Draft
        ↓
Immutable Content Revision
        ↓
Publish
        ↓
Storefront Release
```

最後由 Runtime 組合：

```text
Theme Artifact
+ Published Content
+ Commerce DTO
= Storefront
```

**禁止重新把 Morph 收斂回「所有 presentation 都由 Page Section Schema 產生」的架構。**
