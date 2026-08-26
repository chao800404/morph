# Morph Product Roadmap

本文件描述 Morph 從目前 repository foundation 演進成 **AI-native Code-backed Commerce Platform** 的產品路線。

它是方向與交付順序，不是日期承諾。

工程 invariants 以 [`.agent/rules.md`](./.agent/rules.md) 為準。

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
- build resource limits
- R2 artifact store
- canonical build manifest
- immutable build preview service
- preview capability token
- sandboxed iframe preview
- source-authored `src/routes/` registry、fail-closed route diagnostics、真正 TanStack Start Cloudflare Worker build 與隔離的 TanStack Router client preview adapter

### Production Runtime / Deployment（2026-08 新增）

已具備：

- hostname → 已驗證 domain → published storefront → `active_release_id` → available release → succeeded build 的 fail-closed 解析鏈
- preview 與 production 共用的 artifact serving core（manifest 邊界、path sanitize、ETag／304、快取與安全標頭），差異只由 serving policy 表達
- `ThemeRuntime` 傳輸抽象：service binding（生產）、local direct（開發）、dispatch namespace（保留給 Phase 8）、unavailable（fail-closed）
- storefront hostname 與平台 hostname 的精確分流；storefront 網域上不得出現 dashboard／editor／server function 路由
- Theme Worker 部署平面：deployment plan（含 forbidden binding 檢查）、Sandbox 內以固定版本 wrangler 部署、憑證只存在於 exec environment 且失敗輸出會清洗
- Publish 與 rollback 兩條路徑共用同一個部署核心
- artifact smoke-run harness：本地實際啟動 `runtime/server/index.js` 驗證 build 產物真的可執行
- **Theme artifact + Page Document 的 runtime 組合已閉環**：Morph Core 以 `/_morph/content` 提供 active release 的已發布內容，Theme 在 root route `beforeLoad` 以 server-only 分支取回並經 router context 序列化到 client。編輯器解釋器、Build Preview 與 production 三個平面共用同一份 root route source
- Morph Core 以 `x-morph-content-origin` 明確告知回撥位址，Theme 不需從 hostname 猜測 scheme／port；該 header 為 set 而非 merge，外部無法偽造

### 尚未完整閉環

目前主要缺口：

- release history UI（`activateStorefrontRelease` 已可用，但沒有切換介面）
- content-only publish without rebuild 的完整 production flow
- section 排序仍寫入 Document，但 production 依 route 的 JSX 順序渲染
- 純程式碼元件的內容欄位（需要 source 宣告的 content slot）
- custom domain 憑證與 DNS 生命週期
- AI Code Agent backend workflow
- AI patch / diff / repair orchestration
- production-grade observability / metering / tenant isolation

---

# Phase 0 — Architecture Alignment

## Goal

讓 repository 文件、AI coding rules 與實際 Code-backed implementation 完全一致。

## Deliverables

- 重寫 `.agent/rules.md`
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

### Morph component metadata

擴充 `morph.theme.json`：

- component id
- source path
- entry
- display name
- visual-editor capability
- optional inspector metadata
- bounded `contentFields` capability，讓 customer code-authored props 可安全接入 versioned Page／Template content draft

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

待完成：

- release history UI
- audit/history presentation
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
