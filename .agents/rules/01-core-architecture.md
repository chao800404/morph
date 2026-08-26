# Morph 核心架構規則

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

| 領域                                                                                             | Source of Truth                           |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| 商品、價格、庫存、選項、媒體、客戶、訂單、促銷、稅、sales channel                                | Commerce modules / D1                     |
| Storefront layout、樣式、responsive、motion、interaction、Canvas/WebGL/Three/GSAP implementation | React / TSX / CSS / Tailwind Theme Source |
| 可視化元件 implementation                                                                        | Theme Source                              |
| 文案、圖片選擇、SEO、commerce references、頁面 section instance 與 ordering                      | Versioned Page / Template Document        |
| Theme 的可編輯工作狀態                                                                           | Theme Workspace Files                     |
| 可重現的 Theme source snapshot                                                                   | Immutable Theme Source Revision           |
| 可執行前端結果                                                                                   | Immutable Theme Build Artifact            |
| 線上正在使用的 storefront 組合                                                                   | Storefront Release / Active Release       |
| 使用者登入、角色與 session                                                                       | Better Auth / existing auth helpers       |

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

### 2.5 Deployment Topology

Morph 目前是**單租戶交付**：每個客戶取得一份自己的 Morph 部署，跑在客戶自己的
Cloudflare 帳號。Theme Worker 是**同帳號內的一般 Worker**，由 Morph Core 以
service binding 呼叫。

- Workers for Platforms／dispatch namespace 是多租戶（Phase 8）的傳輸層，不得在單租戶
  路徑上引入。`ThemeRuntime` 介面已保留該實作，未來只換傳輸層，不改解析與授權邏輯。
- service binding 指向固定 script 名稱，所以**部署本身就是切換**。`active_release_id`
  仍是「哪個 release 應該在線上」的唯一 SSOT，而部署是讓現實對齊 SSOT 的動作。
- 因此啟用必須**先以 CAS 佔位、再部署**：佔位失敗者不得碰部署腳本。部署失敗必須還原
  佔位；還原也失敗時必須回報 drift，不得靜默讓 D1 指向未部署的 release。
- Publish 與 rollback 必須共用同一個部署核心。任何一條「只改 D1 不部署」的啟用路徑
  都會讓 dashboard 顯示已上線而網站仍是舊版，屬於禁止的靜默分歧。
- 客戶的 Cloudflare 憑證只能存成 Worker secret，只能出現在部署程序的執行環境，
  不得寫入 workspace、build 產物、log 或任何回傳給前端的訊息。部署容器必須與執行
  customer theme code 的 build 容器分離。

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
├─ routes/
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

### 4.1.1 Customer Theme 是獨立 TanStack Start storefront

Customer Theme 的最終 runtime contract 是一個可獨立 build 與執行的 TanStack Start storefront application，不是 Morph Core 內的 preview-only component renderer。

- Theme 使用標準 `src/routes/` file-based routing；`src/routes/about.tsx` 在該 Theme 的 generated route tree 中對應 `/about`。
- Theme 與 Morph Core / Dashboard 必須是兩個獨立 TanStack Start application、兩棵獨立 route tree 與兩個獨立 build input。Customer route 不得寫入、import 或修改 Morph Core 的 `src/routeTree.gen.ts`。
- `routeTree.gen.ts` 與其他 router generated output 只能由固定版本的 Theme build toolchain 在暫存 build workspace 產生；不是 mutable Theme Workspace 的人工編輯 SSOT。
- Theme Workspace 可包含 route components、nested layouts、loader 與 head metadata，但只能使用允許的 Theme dependency 與 Morph Storefront public runtime capability。不得取得 Dashboard auth context、private D1 binding、Morph Core secret 或未允許的 server / network / filesystem capability。
- Theme 的 `package.json`、TanStack / Vite plugin、server entry、Worker bindings 與 build configuration 必須經過平台 allowlist 與 Sandbox build policy；不可讓 customer source 藉由修改 build infrastructure 越界。
- Starter Theme 必須使用同一個 `src/routes/` contract 並能由正式 Theme build pipeline 產生可執行 storefront；相容性 renderer 只能是明確可移除的 migration path。

Theme 同時支援兩種頁面來源，不得強迫所有頁面只使用其中一種：

1. **Code-authored route**：由 `src/routes/**` 定義特殊 layout、loader、interaction 或完全自訂頁面；修改後必須建立新 Theme source revision / build / release。
2. **Content-backed dynamic route**：由已 build 的 `$handle` 或 splat route 解析 versioned D1 Page / Template Document；文案、asset reference、section instance 與 ordering 的修改不得要求重建 Theme。

Visual Editor 的 Page Registry 必須由「Theme build 產生的 route manifest + 有權限的 D1 Page / Template records」可重建地推導，不得手工維護第二份可漂移 route registry。

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

**Manifest 不得是唯一的能力宣告來源。** 元件可以在自己的原始碼裡宣告
`contentFields`，那份宣告與元件在同一個檔案、不可能漂移，且優先於 manifest。
Manifest 只作為尚未遷移元件的相容來源。編輯器表單與伺服器驗證必須用**同一個解析器**，
否則會出現「表單顯示得了、存檔卻被丟掉」的分歧。

### 4.5 Starter Workspace 升級

既有 Theme 的升級由 `STOREFRONT_STARTER_TEMPLATE_VERSION` 閘門控制。

- **新增任何升級規則都必須同時提升這個版本常數**，否則既有 Theme 永遠不會再跑升級，
  規則等於沒有生效。
- 平台擁有的 toolchain 版本（React、TanStack、Vite、Tailwind 等）必須**修正**，不是
  只在缺少時補上。build 契約以精確相等驗證，一個「存在但版本錯誤」的相依會讓 workspace
  永久無法 build，而純增量的升級救不回來。客戶自行加入的套件版本則必須保留。
- customer 可編輯的原始碼（route、component）只能在**內容完全等於某個已知舊範本**時
  才替換；被改過的檔案一律不動，改由使用者自行遷移。
- Theme 的根 route 必須擁有完整 document shell（`shellComponent`、`HeadContent`、
  `Scripts`、global stylesheet import）。少了它，build 會成功、編輯器預覽也正常
  （預覽的 HTML 由平台產生），但 production SSR 會端出沒有 `<html>`、沒有樣式、
  不會 hydration 的片段。
