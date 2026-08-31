# Morph Product Roadmap

本文件描述 Morph 從目前 repository foundation 演進成 **AI-native Code-backed Commerce Platform** 的產品路線。

它是方向與交付順序，不是日期承諾。

工程 invariants 以 [`AGENTS.md`](./AGENTS.md) 與 [`.agents/rules/`](./.agents/rules/) 為準。

---

## 1. Product Vision

Morph 的目標不是只做另一個 Shopify section builder，也不是做完全無限制的 Base44 / Lovable clone。

Morph 的定位是：

> **一個以 commerce correctness 為底座、以 React code 為 storefront presentation source、同時提供 Visual Editor 與 AI Code Agent 的 Cloudflare-native commerce platform。**

Morph 希望同時具備：

- Medusa-style modular commerce backend
- Shopify-style Online Store management
- React / Tailwind Code-backed Themes
- Visual AST editing
- AI source generation and modification
- real Canvas / WebGL / Three / GSAP capability
- immutable builds and previews
- atomic releases and rollback
- Cloudflare edge storefront runtime
- eventually commerce-focused app generation

---

## 2. Architecture Direction

Morph 不採用「所有 storefront presentation 都由固定 section schema 決定」的架構。

正式方向分成三個 authority layer。

### 2.1 Commerce Data

```text
Products
Prices
Inventory
Variants
Orders
Customers
Promotions
Tax
Sales Channels
```

由 Commerce modules 擁有。

Page / Theme 只能 reference，不建立第二份可編輯 commerce truth。

### 2.2 Presentation Source

```text
React / TSX
Tailwind / CSS
Component Composition
Responsive Layout
Motion
GSAP
Canvas
WebGL
Three / R3F
Map Runtime
```

由 Theme Source 擁有。

它是 storefront presentation 的主要 SSOT。

### 2.3 Content / Assembly

```text
Copy
Assets
SEO
Product / Collection References
Section Instances
Ordering
Visibility
Locale Content
```

由 versioned Page / Template Document 擁有。

Document 是 data，不是 React implementation。

---

## 3. Authoring Model

Morph 的 Human / AI authoring 最終都收斂到相同底層。

```text
                    ┌─ Visual AST Editor ─┐
                    │                     │
Theme Source ───────┼─ Monaco Code Editor ├─→ Theme Workspace
                    │                     │
                    └─ AI Code Agent ─────┘
                                              ↓
                                     Immutable Source Revision
                                              ↓
                                         Sandbox Build
                                              ↓
                                      Immutable Artifact
```

Content authoring：

```text
Human Content Editor ─┐
                      ├─→ Page / Template Draft
AI Content Assistant ─┘
                               ↓
                       Immutable Content Revision
```

Production：

```text
Theme Build Artifact
        +
Published Content Revisions
        +
Current Commerce DTO
        ↓
Storefront Release
        ↓
Edge Runtime
```

---

## 4. Current Foundation — 2026-08

目前 repository 已具備相當多基礎。

### Commerce / CMS

已具備：

- TanStack Start + React dashboard
- Better Auth
- Cloudflare D1
- R2 assets
- Drizzle ORM
- config-driven Dashboard routes
- commerce catalogue / pricing / inventory / cart / checkout / order 等 foundations
- Storefront / Theme / Template / Page / Domain data models
- Store API foundations

### Theme Authoring

已具備：

- Theme file virtual workspace
- starter React theme files
- `morph.theme.json`
- Monaco Code Workspace
- source file save
- file version OCC
- theme `sourceGeneration`
- immutable Theme Source Revision
- AST parser / transformer
- `data-morph-node` / `data-morph-element`
- Tailwind token parsing / patching
- Visual Editor shell
- style inspector foundations
- Canvas / code mode foundations
- editor comments / collaboration UI foundations
- 隔離 Monaco file URI workspace，預載同一 Theme 的全部 source models，讓相對 import 可被 TypeScript worker 解析
- 由 bounded route registry 推導的唯讀虛擬 `src/routeTree.gen.ts`，提供 TanStack route path/type 補全；正式 generated output 仍只在 Theme build 暫存 workspace 產生
- Code Mode 的 route literal completion 由同一份 `src/routes/**` registry 推導，支援 `Link`／`navigate`／`createFileRoute` 的路徑輸入，不另維護手寫清單
- `tsconfig.json`／`jsconfig.json` 的 workspace-local 相對 `extends`、`baseUrl` 與 `paths` 會同步到 Monaco、Vite 與 import protection；package／越界 extends 會 fail closed
- Starter Theme bootstrap 的 preview/apply、版本閘門、source generation/OCC 保護與 additive upgrade

### Build Plane

已具備：

- immutable build identity
- source revision materializer
- deterministic input hash
- compiler identity
- queued / building / succeeded / failed lifecycle
- CAS build ownership
- Browser Tailwind preview compiler
- local Vite runner
- Cloudflare Sandbox Vite build runner
- dependency allowlist
- platform-owned dependency catalog、精確版本驗證與 queued → building → succeeded/failed build lifecycle
- Code Mode customer-facing dependency catalog／request UI；只允許選取 `cms.config.ts` 的核准套件，並以最新成功 Build Preview 的 source revision 作為請求閘門
- build resource limits
- R2 artifact store
- canonical build manifest
- immutable build preview service
- preview capability token
- sandboxed iframe preview
- source-authored `src/routes/` registry、fail-closed route diagnostics、真正 TanStack Start Cloudflare Worker build 與隔離的 TanStack Router client preview adapter

依賴安裝不是瀏覽器直接執行 `npm install`：客戶只能從 `cms.config.ts` 的平台核准目錄提出請求，建置成功後才會進入可用狀態。

### Authoring Contract（2026-08 確立）

已具備：

- **內容契約以元件原始碼為優先**：元件可在同一檔案以 `export const contentFields`
  宣告可編輯欄位，不需要先登記在 `morph.theme.json`。掃描涵蓋所有 `src/**/*.tsx`，以來源
  路徑為身分；manifest 的 `contentFields` 只保留給尚未遷移的既有元件作相容 fallback，
  不得成為新的唯一宣告來源。
- 未宣告時，欄位由 JSX 自動推導，依據是元件簽章宣告的 prop 而非執行期收到的值——
  否則從未編輯過的元件永遠無法編輯。
- 欄位型別：text／textarea／url／number／boolean／select／array。`array` 支援
  `minRows`／`maxRows`、逐列欄位與新增／刪除；row 可抽成獨立元件並以 `of: "./Card"` 參照。
  array 不可巢狀 array（與 Sanity 相同的取捨）。
- **section 由路由的 `content("slot")` 推導**：路由決定頁面有哪些 section 與順序，
  Document 只存值。同一元件可在同頁出現多次，各自由 slot id 區分。
- 左側樹的排序與新增 section 直接改寫路由 JSX；路由尚未宣告 slot 時沿用既存 Document，
  所以採用 slot 是每個路由各自的選擇。
- 選取、樣式、結構樹與內容編輯都不再需要 `data-morph-*` 標記。instance 樣式需要跨編輯
  穩定的身分，平台會在首次寫入時自動補上，作者不必手寫。

Code Mode 的 generated route tree 契約：

- `src/routes/**` 是作者可編輯的 route source，也是頁面結構與 route path 的 SSOT。
- `src/routeTree.gen.ts` 在 Code Mode 只以唯讀虛擬檔案呈現，供 Monaco 提供與 TanStack
  Router 相同的 path/type 推導；它不屬於 persisted Theme Workspace，不能由使用者或 AI
  直接儲存、修改或刪除。
- 真正的 `routeTree.gen.ts` 只能由固定版本的 Theme build toolchain 在暫存 build workspace
  產生。虛擬模型與正式 build 必須共用 bounded route registry；不合法路由要顯示診斷，
  不得以 `any` 或空 route tree 掩蓋 build 錯誤。

Code Mode 與 TanStack Start 的編譯邊界：

- `.server.*`／`.client.*`、`server-only`／`client-only` marker 與 Start server/client
  specifier 會在 Monaco Problems、Local Vite 與 Cloudflare Sandbox 三條路徑共用同一份
  reachable-graph 檢查；只有 `createServerFn().handler`、`createMiddleware().server`、
  `createIsomorphicFn().server/.client` 等 compiler boundary 可安全跨環境。
- `tsconfig.json`／`jsconfig.json` 的 `baseUrl`、`paths` 會被同一份受限解析器提供給
  Monaco、import protection 與 Vite；不安全或越界 alias 會 fail closed。這對齊 TanStack
  Start 的路徑別名契約，但不執行客戶自訂的 Vite／Router plugin。

Starter bootstrap 與 workspace upgrade 契約：

- 新建或升級 Theme 前先產生檔案差異；只對未被作者修改的已知 starter bytes 套用安全升級。
- 使用者確認後才透過 Theme Workspace、ownership、source generation 與 OCC 寫入；既有
  authored files、customer dependencies 與不安全刪除一律保留並顯示衝突。
- 套用後必須重新跑 route diagnostics、Live Preview 與 immutable build；bootstrap 成功不
  代表已 Publish。

寫入目標的分界：

| 使用者動作 | 寫進哪裡 |
| --- | --- |
| 樣式、Tailwind classes、同層排序 | 元件 TSX |
| section 排序、新增 section | 路由 TSX |
| Content & Fields 的值、陣列列增刪、section 啟用 | Document（D1） |

---

### Production Runtime / Deployment（2026-08 新增）

已具備：

- hostname → 已驗證 domain → published storefront → `active_release_id` → available release → succeeded build 的 fail-closed 解析鏈
- preview 與 production 共用的 artifact serving core（manifest 邊界、path sanitize、ETag／304、快取與安全標頭），差異只由 serving policy 表達
- `ThemeRuntime` 傳輸抽象：service binding（生產）、local direct（開發）、dispatch namespace（保留給 Phase 8）、unavailable（fail-closed）
- storefront hostname 與平台 hostname 的精確分流；storefront 網域上不得出現 dashboard／editor／server function 路由
- Theme Worker 部署平面：deployment plan（含 forbidden binding 檢查）、Sandbox 內以固定版本 wrangler 部署、憑證只存在於 exec environment 且失敗輸出會清洗
- Publish 與 rollback 兩條路徑共用同一個部署核心
- artifact smoke-run harness：本地實際啟動 `runtime/server/index.js` 驗證 build 產物真的可執行
- **純內容發布不再重新部署**：Theme Worker 實際執行的 build 記錄在該 release 的 metadata，
  只在部署成功後寫入。發布時若記錄顯示 Worker 已在跑同一個 build 就跳過部署；
  沒有紀錄、紀錄不符、id 空白等任何不確定情況一律照常部署——多部署一次只是慢，
  少部署一次會讓網站靜默地服務舊的產物。
- **Theme artifact + Page Document 的 runtime 組合已閉環**：Morph Core 以 `/_morph/content` 提供 active release 的已發布內容，Theme 在 root route `beforeLoad` 以 server-only 分支取回並經 router context 序列化到 client。編輯器解釋器、Build Preview 與 production 三個平面共用同一份 root route source
- Morph Core 以 `x-morph-content-origin` 明確告知回撥位址，Theme 不需從 hostname 猜測 scheme／port；該 header 為 set 而非 merge，外部無法偽造

### 已完成但需持續回歸

以下能力已完成並有驗證，但仍需隨新 Theme 與瀏覽器回歸：

- release history UI：已閉環——編輯器工具列的 History 列出每次發布的 release，
  標出目前 live 的版本並可切換。啟用沿用同一個部署核心（CAS 搶指標後部署該 release
  的不可變 artifact），CAS 的期望指標取自清單自身看到的狀態，過期的分頁會輸掉。
  分頁已完成：25 筆一頁，底部可載入更早的版本。
- 復原／重做已覆蓋全部八條寫入路徑，同一檔案的多次寫入會逐筆堆疊；範圍是單一分頁的
  編輯 session（上限 100 筆、不持久化）。跨發布的回復由 release history 負責。
- content-only publish：已閉環——不重新編譯，且相同 build 不再重新部署 Worker。
  已用真實 workspace 的資料庫副本實測：第一次發布因無部署紀錄而部署，記錄後的第二次
  純內容發布判定為跳過，且仍建立新 release。
- 編輯器解釋器與真實建置的一致性：元件層已證實逐字相同（同一份 starter 主題原始碼，
  一邊走解釋器、一邊以 esbuild 編譯後交給真的 React，比對正規化 DOM；九個案例通過，
  含跨檔案 import 與 `map` 內的元件邊界）。前提是主題依賴為封閉白名單，所以解釋器要
  覆蓋的是一個受控子集，不是整個 React 生態。框架整合層也已涵蓋：以真實 TanStack
  Router 渲染 starter 主題首頁並與解釋器逐字比對，`beforeLoad`、`createIsomorphicFn`、
  React context 與 `Outlet` 全部真的執行。另有對抗性模式測試：列出 15 種 starter
  沒用過、但熟悉 React 的人會使用的模式，據此找出並修好五個缺口——其中三個是靜默
  分歧（`{...rest}` 轉發被丟棄、JSX 文字空白被無條件 trim、`%` 運算子未支援且靜默
  回傳 `undefined`）。**邊界是那份 fixture 是自己寫的**：它只能找到有人想得到要探的
  缺口。因此另有 `pnpm test:parity`，直接對照本機工作區裡真實開發中的主題跑同一套
  比對——那份主題不會顧慮解釋器支援什麼，所以每個新元件都是沒人設計來通過的 fixture。
- 真實瀏覽器層 E2E：已建立（Playwright，`pnpm test:e2e`，與單元測試分離；憑證走未追蹤
  的 `.env.e2e`，未設定時自行 skip）。目前覆蓋三個場景——畫布選取回到樹狀、預覽框高度
  等於內容高度、未編輯時 Undo 停用——皆經變異驗證。仍缺：實際互動延遲、跨瀏覽器行為、
  響應式斷點與跨瀏覽器已覆蓋（無障礙以 axe 掃描含對話框狀態、鍵盤操作與焦點歸還；
  響應式比對 header 各組是否重疊；Chromium、Firefox、WebKit 三個引擎全數通過，
  無任何引擎行為差異）。
  發布迴圈已實際執行並通過：編譯 → 建置產物 → Publish → 建立 release → production
  指標移動，斷言包含最新的 release 帶有 `Live` 標記。仍由 `E2E_ALLOW_PUBLISH=1`
  才啟用，因為它會建立 release 並移動指標。互動延遲也已建立基準（畫布選取約 470ms、
  樹狀選取約 150ms、模式切換約 220ms），量測過程本身找出並修掉一處退化。
  原生拖放在 iframe 加縮放畫布的組合下仍驗證不了，拖曳行為只能手動實測。

### 尚未完整閉環

目前主要缺口：

- custom domain 憑證與 DNS 生命週期
- 獨立平台人工 approval workflow；Code Mode 已有 customer-facing dependency catalog／request UI，
  只顯示 `cms.config.ts` 核准套件並顯示 queued／building／ready／failed。若採逐案人工審核，
  還需要獨立 approval role、audit 與 state machine
- AI Code Agent backend workflow
- AI patch / diff / repair orchestration
- production-grade observability / metering / tenant isolation

---

# Phase 0 — Architecture Alignment

## Status

✅ 已完成。規則 authority 已收斂到 `AGENTS.md` 與 `.agents/rules/*.md`；本文件只保留產品階段、交付順序與未來缺口。

## Goal

讓 repository 文件、AI coding rules 與實際 Code-backed implementation 完全一致。

## Deliverables

- 對齊 `AGENTS.md` 與 `.agents/rules/*.md` 的規則 authority
- 重寫 `ROADMAP.md`
- 把 Presentation SSOT 明確改為 Theme React Source
- 把 Page Document 明確降回 Content / Assembly responsibility
- 移除「AI 只能 Schema Authoring」的限制
- 移除「Code Mode 最後才做」的舊演進規則
- 定義 Visual Editor = AST/source editor
- 定義 AI Code Agent 與 Sandbox / Release safety boundary
- 定義 target Storefront Release model

## Completion criteria

- 開發者與 AI agent 不會再依文件建立第二套 schema-first storefront framework。
- 新功能有明確 authority：Commerce、Source 或 Content。
- Build / Preview / Publish 名詞在文件與程式中意思一致。

---

# Phase 1 — Authoring Convergence

## User value

使用者可以在 Canvas 或 Code Editor 編輯同一個真正的 React Theme，不會出現「Canvas 一份、程式碼另一份」。

## Core flow

```text
Theme Source
   ↕
Visual AST Editor
   ↕
Monaco
```

## Deliverables

### Theme Workspace

目前狀態：核心 file lifecycle、tree UX、multi-file OCC、source-generation conflict 與 revision history／restore 已完成；dirty／saving／conflict 的回歸持續進行。

- 完成 file create / rename / delete lifecycle
- 完成 file tree UX
- 強化 workspace dirty / saving / conflict state
- 完成 multi-file OCC
- 完成 source generation conflict UX
- revision history / restore UI

### Visual AST Editor

- 選取 preview DOM → resolve `data-morph-node`
- node → source file / AST position
- Inspector read static Tailwind values
- Inspector safe source patch
- source save → preview refresh
- Monaco edit → Inspector reparse
- unsupported dynamic expression 顯示 Code-only state

### Code Mode route authoring

- `src/routes/**` 由作者直接編輯，新增 `about.tsx` 等 route source 後由同一份 bounded route registry
  解析 path、parent 與 diagnostics。
- Explorer 顯示唯讀虛擬 `src/routeTree.gen.ts`，用來提供 TanStack Router 的 path/type 補全；
  它不是 workspace source，也不會被保存或由 AI 直接修改。
- 真正的 route tree 只在固定版本 Theme build toolchain 的暫存 workspace 產生；新增 route
  只有在 route generation、Preview 與 build 成功後才算可執行。

### Starter bootstrap / upgrade

- 新建或升級 Starter Theme 前先產生可審閱的 create／update／delete plan。
- 套用時沿用 ownership、source generation 與 OCC；作者修改過的檔案、客戶依賴與非安全刪除不會
  被靜默覆蓋。
- 套用後重新執行 route diagnostics、Live Preview 與 immutable build；bootstrap 不等同 Publish。

### Morph component metadata

維持 `morph.theme.json` 作為 routing、component mapping 與舊元件相容 metadata；新的 code-authored
內容 capability 以元件同檔案的 `export const contentFields` 為優先來源，manifest `contentFields`
只作為尚未遷移元件的 fallback。

- component id
- source path
- entry
- display name
- visual-editor capability
- optional inspector metadata
- bounded `contentFields` capability parser 與 server-side allowlist，讓 customer code-authored props 可安全接入 versioned Page／Template content draft

Manifest 是 mapping / metadata，不是 styling SSOT。

### Editing capability

先把最重要的 CSS / Tailwind 能力打通：

- typography
- spacing
- sizing
- color
- background
- border / radius
- flex
- grid
- alignment
- responsive tokens

## Completion criteria

至少一個完整 vertical slice：

```text
Canvas 改 Hero heading font size
→ Hero.tsx class 改變
→ Monaco 立即看到
→ Save
→ reload 後保持
→ create source revision
→ build
→ immutable preview 正確
```

反向：

```text
Monaco 改 Hero.tsx
→ Save
→ Visual Editor reparse
→ Inspector 顯示新值
```

---

# Phase 2 — Build & Preview Productionization

## User value

任何 source revision 都能以可重現方式 build，且 preview 真正對應 immutable artifact。

目前 repository 已有大部分技術 foundation，本階段重點是 production hardening。

## Deliverables

### Build Runner

- Cloudflare Sandbox production configuration
- deterministic toolchain
- approved dependency registry
- dependency version policy
- build timeout
- file / source / output budgets
- structured build logs
- diagnostics mapping 到 Monaco / Inspector
- customer dependency request 的 platform allowlist、精確版本與 queued → building → ready／failed 狀態

### Theme dependency workflow

- `cms.config.ts` 是平台擁有的核准套件目錄與精確版本來源；客戶端不可提交任意 npm 名稱或版本。
- 已登入且具備 CMS 管理權限的請求只能啟用核准目錄中的套件，建立 dependency request 並綁定
  immutable source revision。
- Cloudflare Queue／local runner 執行 `queued → building → succeeded／failed`；只有 build 成功
  後套件才進入 `ready`，失敗不得影響上一個可用 build。
- 目前「平台核准」等同 `cms.config.ts` allowlist 加上 CMS admin server capability；若未來要
  由平台人員逐案審核，必須另建 review role、approval state、audit 與 UI，不得把 `building`
  當成審核完成。

### Artifact

- immutable R2 artifact prefix
- canonical manifest
- hash / metadata
- retention policy
- orphan artifact cleanup policy

### Preview

- stable immutable preview URL
- preview token lifecycle
- iframe isolation
- build diagnostics UI
- failed build UX
- retry behavior
- build history UI

### Build verification

Publish 前能確認：

- source revision
- compiler identity
- build success
- artifact availability
- manifest integrity

## Completion criteria

- Build 永遠只讀 immutable revision。
- 同一 revision + compiler identity 可以 deterministic rebuild / verify。
- Failed build 不影響前一個 preview / production artifact。
- Build Plane 無 production database / auth secrets。
- Preview asset 只能從 manifest allowlist 讀取。

---

# Phase 3 — Storefront Release Model

## User value

Morph 可以安全地把一個已驗證版本切到 production，且瞬間 rollback。

這是下一個最高優先級 backend milestone。

## Target model

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

```text
Storefront
└─ activeReleaseId
```

## Rules

### Presentation release

Theme Source 改變：

```text
Source Revision
→ Successful Build
→ New Release
→ Atomic activate
```

### Content-only release

只有 copy / assets / SEO / section ordering 改變：

```text
Existing Successful Theme Build
+
New Published Content Revisions
→ New Release
→ Atomic activate
```

不需要重新 build theme。

## Deliverables

已完成：

- `storefront_releases` / `activeReleaseId` SSOT
- `ContentPublication` immutable template/page revision snapshot foundation
- content-only build reuse
- publication + release atomic activation
- legacy `sourceGeneration` fail-closed
- source/build identity validation
- rollback activation service with history query and OCC
- release activation fail-closed ContentPublication/revision/document validation
- revision retention guard for ContentPublication references
- 0045 → 0049 migration regression coverage, including trustworthy active legacy backfill

已具備（續）：

- release history UI 與回滾切換（編輯器工具列 History）

待完成：

- ~~release history 分頁~~：已完成（`useInfiniteQuery`，25 筆一頁，收到不足一頁即停止）
- audit/history presentation：誰在何時發布、變更了什麼；目前只有 `created_by` 與時間
- compatibility cleanup from current `publishedSourceRevisionId` / `publishedRevisionId`

## Completion criteria

- Production 永遠指向完整 immutable release。
- 不可能出現 source 已 published 但 artifact 不存在。
- Content-only publish 不觸發 Vite build。
- Rollback 只需切回 previous release。
- Concurrent publish 不 silent overwrite。

---

# Phase 4 — Production Edge Storefront Runtime

## User value

真正的顧客可以透過 storefront domain 使用 Morph 發布的網站。

## 部署拓撲（2026-08 確立）

Morph 目前是**單租戶交付**：每個客戶取得一份自己的 Morph 部署，跑在客戶自己的
Cloudflare 帳號。這決定了 production runtime 的形狀：

```text
merchant hostname
      ↓
Morph Core Worker（分流：平台 hostname vs storefront hostname）
      ↓ hostname → active release → immutable build
      ↓
service binding → Theme Worker（同帳號內的一般 Worker）
```

- Theme Worker 是**同一個 Cloudflare 帳號裡的普通 Worker**，用 service binding 呼叫。
- **Workers for Platforms／dispatch namespace 屬於 Phase 8**，不是現在的方案。它是為
  「一個帳號承載大量互不信任的客戶 Worker」而存在的，單租戶交付不需要，也不該為此付費。
- `ThemeRuntime` 介面已保留 dispatch 實作，Phase 8 只需換傳輸層，解析與授權邏輯不變。

### service binding 的取捨

service binding 指向**固定的 script 名稱**，所以「哪個 build 在線上」由部署決定，
指標翻轉做不到。因此：

- `storefronts.active_release_id` 仍是「哪個 release 應該在線上」的唯一 SSOT。
- 啟用必須**先以 CAS 佔位、再部署**；佔位失敗者永遠不得碰部署腳本，兩個並行啟用
  就不可能同時替換同一個 script。
- 部署失敗必須把 `active_release_id` 還原；還原也失敗時必須明確回報 drift，不得靜默。

## Request path

```text
Hostname
   ↓
Storefront Resolver
   ↓
Active Release
   ↓
Theme Build Artifact
   ↓
Published Page / Template Context
   ↓
Commerce DTO
   ↓
Storefront
```

## Deliverables

### Domain / routing

- hostname resolver
- primary domain
- preview domain
- home route
- pages
- products
- collections
- cart / checkout handoff
- 404
- canonical URL
- sitemap
- robots

### Runtime bridge

建立正式 `StorefrontRuntimeContext` contract。

Theme build 不應 bake mutable content 與 commerce values。

Theme runtime 可以透過：

- initial serialized boot context
- same-origin Store API
- Morph runtime adapter

取得：

- page/template content
- public product data
- collection data
- cart context
- navigation
- locale
- currency / sales channel

### Artifact serving

- immutable cache
- proper MIME
- ETag / cache headers
- route fallback
- asset manifest
- versioned URLs

### Isolation

- Control Plane downtime 不影響已發布 storefront。
- Build Plane downtime 不影響 active release。
- draft content 不可透過 public runtime 取得。

## Completion criteria

- custom domain 可以載入 active release。
- `/`, `/products/:handle`, `/collections/:handle`, `/pages/:handle` 正常運作。
- 同一 theme build 可以搭配更新後的 content release。
- product price / inventory 更新不需要 theme rebuild。
- previous release 可以立即 rollback。

---

# Phase 5 — AI Code Agent

## User value

使用者可以描述想要的頁面、元件或互動效果，AI 直接修改真正的 React Theme，而不是只能排列固定 sections。

## AI scope

AI 可以：

- inspect source tree
- read selected component
- create component
- modify React / TSX
- modify Tailwind / CSS
- create responsive layout
- create GSAP animation
- create Canvas / WebGL / Three / R3F experience
- update `morph.theme.json`
- add Morph visual-edit metadata
- modify Page / Template content when appropriate

## Architecture

```text
Prompt
   ↓
Context Builder
   ↓
Agent Workspace
   ↓
File Operations / Patch
   ↓
Validation
   ↓
Theme Workspace OCC
   ↓
AI Source Revision
   ↓
Sandbox Build
   ↓
Diagnostics
   ↓
Bounded Repair Loop
   ↓
Preview
   ↓
Human Approval
```

## Context Builder

只提供必要資訊：

- relevant source files
- component manifest
- current selected node
- theme design language
- dependency allowlist
- public commerce DTO schema
- Page / Template context
- asset references
- project rules

不可提供：

- production secrets
- raw session secret
- unrestricted D1
- unrelated PII

## Agent operations

Agent 不應取得 unrestricted filesystem。

提供 scoped tools：

- list theme files
- read file
- create/update/delete allowed file
- apply patch
- query diagnostics
- request source revision
- request build
- inspect build result

## Repair loop

- bounded attempts
- every attempt recorded
- build error fed back with scoped diagnostics
- no infinite loop
- failed repair leaves previous workspace / release recoverable

## Human approval

AI 不可：

- publish
- deploy
- activate release
- migrate production
- expand dependency policy
- expand its own permissions

## Completion criteria

使用者可以輸入：

> 做一個跟著滾輪移動的 IoT Canvas hero，手機版改成靜態圖片。

AI 能：

1. 建立真正 React / Canvas code。
2. 通過 dependency / path / security policy。
3. Build。
4. 顯示 preview。
5. 失敗時有限次 repair。
6. 使用者批准後才建立 / activate release。

---

# Phase 6 — AI Content & Commerce Authoring

## User value

對不需要寫 code 的工作，AI 可以用更快、更安全的資料層直接完成。

## Use cases

- landing page copy
- SEO
- image selection
- product / collection binding
- translation
- navigation
- reorder sections
- campaign page content
- product merchandising

## Decision rule

```text
Content / assembly
→ Page Document

Presentation / behavior
→ Theme Source
```

## Deliverables

- content assistant
- asset suggestion
- localization
- SEO generation
- commerce reference search
- structured content diff
- draft revision
- publish review

## Completion criteria

Content-only AI change 不需要 build Theme，也不會取得 code execution capability。

---

# Phase 7 — Advanced Interactive Runtime

## User value

Morph 可以穩定承載高品質品牌官網與互動式商品體驗。

## Capabilities

- Canvas
- WebGL
- Three.js / R3F
- GSAP
- image sequence
- scroll story
- Mapbox / maps
- 3D product viewer
- immersive landing page
- IoT / data visualization

## Platform work

- dependency capability packs
- asset preload budgets
- GLB / texture / sequence pipeline
- lazy activation
- visibility lifecycle
- render-loop controls
- memory / FPS instrumentation
- mobile strategy
- no-WebGL fallback
- reduced-motion fallback
- error boundaries

Reusable presets 可以存在，但它們是 authoring acceleration，而不是唯一可用 presentation vocabulary。

## Completion criteria

AI 能建立超出預設 component library 的新互動實作，同時 production 仍受到 build sandbox、resource budget 與 release policy 保護。

---

# Phase 8 — Multi-tenant SaaS Platform

## User value

Morph 可以安全地服務多個商家、網站與不同方案。

## Target topology

```text
Morph Control Plane
├─ users / orgs
├─ projects / storefronts
├─ billing / entitlement
├─ AI jobs
├─ builds
├─ releases
├─ domains
└─ observability

Morph Authoring Plane
├─ theme workspace
├─ visual editor
├─ Monaco
└─ AI agent

Morph Build Plane
├─ queue / workflow
├─ sandbox / container
├─ artifact store
└─ immutable previews

Morph Runtime Plane
├─ hostname router
├─ active releases
├─ Store API
├─ commerce runtime
└─ CDN / cache
```

## Deliverables

- explicit tenant identity
- **Workers for Platforms dispatch namespace**：多租戶才需要的傳輸層。`ThemeRuntime`
  已有 `DispatchNamespaceThemeRuntime` 實作與 script 命名（以 buildId 為鍵，讓啟用
  變成指標切換），Phase 8 需補的是部署平面、script GC 與 outbound worker 隔離
- tenant-aware D1 / storage strategy
- per-tenant quotas
- AI cost attribution
- build metering
- release audit
- backups
- retention
- domain lifecycle
- incident tooling
- logs / traces
- enterprise isolation option
- migration between shared / dedicated runtime

## Completion criteria

沒有任何 request 能取得其他 tenant 的：

- commerce data
- theme source
- artifact
- preview
- release
- secret
- domain
- AI job

---

# Phase 9 — Commerce Application Generator

## User value

Morph 不只產生 storefront，也能建立 commerce-adjacent application。

例如：

- B2B quotation portal
- dealer portal
- service booking
- product configurator
- marketplace operations
- subscription management
- wholesale customer portal

## Architecture principle

優先重用既有 commerce source of truth。

對通用業務 entity 可建立 controlled application schema，但它不是 storefront presentation schema。

```text
Commerce Core
     +
Application-owned Extension Data
     +
Generated UI / Workflow
```

Code Agent 可處理超出 controlled runtime schema 的需求，但仍走 Sandbox → Preview → Approval → Release。

## Completion criteria

- commerce records 不被複製成第二套 truth。
- generated server behavior 有 permission boundary。
- migration 可 preview / rollback。
- tenant isolation 完整。
- production schema mutation 必須人工批准。

---

# Deferred by decision

以下不是缺口，是明確決定「先不做」的項目。記在這裡是為了不用再討論第二次。

## 把一致性檢查搬進建置容器

**決定：現階段不做。** 目前的組合已經把風險蓋住：本機的 `pnpm test:parity` 修的是
會跟著出貨的解釋器本身，而部署後的安全網是 Build Preview——發布流程強制要有一次成功
的建置，所以「沒看過真實產物就上線」在設計上發生不了。

問題在於 Build Preview 只給你「實際長什麼樣」，要自己用眼睛比對兩個預覽；而
`pnpm test:parity` 能指出**哪一行不一致**，但只跑在有 repo 與 Node 的機器上，部署到
Cloudflare 之後在瀏覽器裡編輯的人碰不到它。

想做的話路徑是清楚的：同一套比對搬進建置容器（Vite 已經在那裡跑），把差異當成 build
diagnostic 回報——按下 Build Preview 就直接說「第 12 行的寫法在編輯器裡會顯示不同」。

代價是解釋器也要送進容器，也就是容器裡多一份必須與編輯器同版本的程式碼；版本一旦
分岔，這個檢查本身就會開始說謊。真要做，解釋器得先有明確的版本邊界。

值得重新考慮的時機：**客戶或 AI agent 開始在部署後的編輯器裡寫主題程式碼**。在那之前
能引入新分歧的只有寫主題的人，而那個人在本機。

## 主題可用的第三方 runtime 套件（例如 Rive）

**決定：系統收完之前不加。** 每加一個有副作用的套件，就是在半成品上再開一個戰場。

技術路徑已經確認，之後照這個做即可：

- 建置端：加進 `DEFAULT_APPROVED_DEPENDENCIES` 即可，容器內的 Vite 會打包它；
  建置本來就保留二進位產物完整，`.riv` 這類資產不會被破壞。
- Live Preview：走既有的 `builtinComponents` 機制——主題 import 該套件時，解釋器
  直接換成平台提供的真實 React 元件（`@tanstack/react-router` 的 `Outlet` 就是這樣
  處理的）。解釋器不需要理解那個套件在做什麼。
- 前提：主題必須用**元件寫法**（`<Rive src="..." />`），不能用 hook 寫法
  （`useRive()` 需要解釋器能執行 hook 並解構結果，那是另一個層級的工作）。
- 兩個待決定：WASM 自行託管或走外部 CDN；以及編輯器 iframe 裡要不要真的執行
  第三方 WASM（跑＝所見即所得，不跑＝Live Preview 顯示佔位框、真實效果看
  Build Preview）。後者是安全決定，不是技術決定。

# Product Ceiling

完成主要階段後，Morph 可以成為：

> **一個 Cloudflare-native AI commerce platform：以 modular commerce backend 為資料核心，以 React code-backed theme 為 presentation 核心，提供 Visual AST Editor、AI Code Agent、immutable build/release、Edge Runtime 與 commerce-focused application generation。**

Morph 的競爭點不是「限制越少越好」，而是：

- AI 可以真的寫 code
- storefront 自由度高
- commerce data correctness 不犧牲
- production 不直接執行 AI 草稿
- 每個版本可以 build、preview、audit、publish、rollback
- content update 不必因為 code-backed theme 而每次 rebuild

---

# Cross-phase Invariants

所有 Phase 都必須維持：

- Commerce modules 是 commerce SSOT。
- React / TSX / Tailwind Theme Source 是 presentation SSOT。
- Page / Template Document 是 content / assembly SSOT。
- Visual Editor 不建立平行 presentation model。
- AI code 只能先進 authoring workspace。
- Build 只讀 immutable source revision。
- Untrusted code 只在 isolated build environment 執行。
- Failed build 不影響 active production release。
- AI 不可自行 publish / deploy / migrate / elevate permission。
- Content-only publish 不要求重新 build Theme。
- Production 永遠可 rollback 到已知 good release。
- Draft、Revision、Build、Preview、Release、Production 是不同 state。
- 新功能不得繞過 authorization、OCC、validation、audit、bounded work 與 rollback。
