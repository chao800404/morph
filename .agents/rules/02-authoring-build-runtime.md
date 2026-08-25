# Morph Authoring、Build 與 Runtime 規則

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

### 5.3.1 Code-authored component round-trip

React / TSX / CSS / Tailwind Theme Source 是 Code Mode、Live Preview、Visual Editor 與正式 build 共用的 presentation SSOT。

- 使用者可以在既有 Theme Workspace 中新增合法 component、JSX structure 與 interaction；只要通過 path、dependency、compiler 與 sandbox policy，就必須由既有 source → preview → revision → build pipeline 處理，不得要求先建立另一份 presentation schema。
- Live Preview 必須反映實際 Theme Source 或由它直接推導的 compiled output。Compatibility／專用 renderer 不得靜默遺失 source 中帶有 `data-morph-*` 的 element、nesting、`className` 或 metadata；暫時仍需 renderer adapter 時，必須透過共用 source mapping 與 contract test 證明 round-trip，不得逐元件硬編碼第二份 UI。
- 希望由 Design Mode 修改的 JSX node 必須提供靜態、同檔唯一的 `data-morph-node`；`data-morph-element` 只描述 `container`、`heading`、`image`、`action` 等語意，不可取代穩定 node identity。
- 無法由 AST 證明可安全改寫的 dynamic expression、computed structure 或 runtime-only node 可以正常 build / preview，但 Inspector 必須明確顯示 code-only／unsupported，或回報 bounded diagnostic；不得猜測後覆寫 source。
- Repeater 的 Design identity 必須同時包含 source node identity、持久 item／instance identity 與完整 field path；不得用 array index 或單一 `data-morph-node` 假裝能唯一識別所有 runtime instance。
- Code Save 只能更新 mutable draft workspace 與 Live Preview；Immutable Build Preview 必須來自 frozen source revision，Production 只能由明確授權的 Publish／release activation 更新。

### 5.3.2 Theme content field capability

Customer Theme 若要讓 code-authored component props 可由 Design Mode 編輯，必須在同一份 Theme Source 的 `morph.theme.json` 宣告 bounded `contentFields` capability。

- `contentFields` 只描述 content authoring capability：欄位 key、控制型別、label、長度／數值限制與有限選項；不得包含 callback、任意 validator、JS expression、HTML renderer 或 presentation implementation。
- Theme component 的程式碼 default prop 仍是 source fallback。儲存 Theme source 不得自動把 default 寫入 D1；只有使用者首次確認 Design content 修改時，才透過既有 versioned Page／Template Document draft 與 OCC/CAS 建立 override。
- Client manifest 解析只負責呈現 Inspector。Server mutation 必須從該 storefront／theme 的已保存 Theme Workspace 或對應 immutable source revision 重新讀取並驗證 capability，不得相信 client 傳入的 field definition。
- `contentFields` 是可寫欄位 allowlist，不是完整 runtime props schema。Content mutation 只能新增或修改已宣告欄位，但不得因 partial edit 刪除 Document 中既有的非 editable reference／assembly props。
- 未知 `componentRef`、未宣告欄位、錯誤型別、超過限制或不安全 URL 必須 fail closed；presentation class、任意 object 或 executable value 不得藉由 content mutation 寫入 Document。
- Capability 變更與 content mutation 的競態必須由 server-side source generation guard 處理；不可只靠 Inspector 當下看到的 manifest。
- 第一版支援的 bounded control type 為 `text`、`textarea`、`url`、`number`、`boolean` 與有限 `select`。需要 asset／commerce reference picker 時應擴充正式 reference field contract，不得先用任意字串假裝完成關聯能力。

### 5.4 AST 安全邊界

Visual Editor 只能在 transformer 能證明安全時自動 patch source。

例如：

- 靜態字串 `className="..."` 可以修改。
- 可定位的 literal/default prop 可以修改。
- `className={complexExpression(...)}` 不應被 regex 粗暴覆寫。
- 無法安全修改時，Inspector 應顯示 unsupported / code-only，或導向 Code Workspace。

禁止用 regex 當作通用 TSX parser。

`map()`／repeater 產生的 runtime instance 必須區分「共用 component
presentation」與「單一 content instance presentation」：

- `data-morph-node` 只定位 source JSX node；同一 source node 經 `map()` render
  多次時，不得只靠它識別 runtime instance。
- 陣列 item 必須有持久且唯一的 `id`。完整
  `data-storefront-field-path`（例如 `items.2.title`）仍負責 content binding、選取與
  Preview selection rebind；單一 instance presentation 則必須以 item id 綁定，不能以
  會因排序改變的 array index 當 style identity。
- 舊資料缺少 item id 時，只能在使用者確認第一筆 instance style 修改時補上一個 id，
  並透過既有 versioned Document draft / CAS 流程保存；拖曳 preview、pointer move 或
  React 暫存 state 不得反覆產生 id。
- 沒有數字 index 的 style 修改仍 patch 共用 TSX `className`。帶數字 index 的單一
  instance override 必須留在同一 component source，以靜態
  `morphInstanceClasses: Record<string, string>` object 保存完整 Tailwind utility
  字串，key 使用 `<item-id>:<data-morph-node>`。
- repeater JSX 只可用受支援的簡短查找，例如
  `cn("shared classes", morphInstanceClasses[\`\${item.id}:principle-title\`])`。
  object value 必須是 source scanner 可直接看到的完整靜態字串；動態 key 只負責選擇
  已宣告的靜態 value，不得在 runtime 組合 Tailwind utility。
- Visual Editor 產生的 instance override 不得寫入 `src/styles/global.css`，不得建立
  `<Component>.morph.css`，也不得把巨大 arbitrary selector 重複塞入每個 JSX
  `className`。global stylesheet 只保留真正的 global import、token 與 reset。
- 只有在 AST 能證明目標位於可識別的 `.map()` callback，且 `className` 是靜態
  字串、缺省 attribute，或只含靜態字串與受支援 instance lookup 的 `cn(...)` 時，
  才能自動寫入。其他動態 expression 必須保留 component logic 並導向 Code Mode。
- 舊的 global / adjacent CSS marker 與舊 arbitrary-variant selector 只可作為遷移輸入；
  對該 target 再次修改時，應移入 component-local map 並移除舊規則、import 或舊
  `cn()` argument。
- Instance override 是 Theme Source presentation；item `id` 只是 content identity。
  utility 不得存入 Page / Template Document props，也不得只留在 React state 或 iframe
  inline style。
- Reorder 必須搬動完整 item（包含 `id`），不得依新 index 重寫 style map key。因此
  排序後樣式會跟著 item 移動，而不是留在舊位置。
- 如果 Theme 沒有可安全寫入的 TSX、field path 不完整、item identity 無法持久化，或
  scope 無法證明唯一，Inspector 必須導向 Code Mode，不得退化成修改全部 item。

Live Preview 的 DOM 排序必須依修改來源分流：

- Section 順序沿用 versioned page/template document 的既有 reorder/CAS 流程。
- 一般 source DOM 只允許交換同一 source file、同一直接 JSX parent 下，且 `data-morph-node` 可證明唯一的靜態 sibling。
- `map()` 產生的重複節點、跨 parent、跨檔案、動態 identity 或無法唯一定位的節點不得直接搬移 DOM 後寫回 source；這類排序必須修改對應資料陣列或導向 Code Mode。
- Repeater item 只有在拖曳節點與落點都提供「陣列 item 根路徑」（例如 `items.0`、`items.2`）、兩者屬於同一 Section 與同一陣列、index 均有效時，才能在 drop 後交換 versioned Section props 中的兩筆資料；`items.0.title` 這類子欄位不得被當作可排序 item root。
- 陣列 item drop 必須只送出一筆 typed reorder intent，Editor 以目前 Section props 合併尚未提交的 pending props 後做 immutable swap，透過既有 template draft generation CAS 寫入；不得修改共用 JSX source、不得直接發布，也不得讓 Preview DOM 成為資料真相。
- 可排序節點只能從 selection overlay 標籤內的明確 drag handle 啟動拖放；被選取 DOM 的內容區仍只負責選取與編輯，不得把整張 component surface 設為 draggable，以避免誤觸排序。
- 拖曳開始後必須顯示可辨識的被拖元件 preview，並一次標示所有通過相同 parent、Section、source 與 array scope 驗證的合法交換目標；目前指向的落點要有更強的獨立狀態，不合法節點不得顯示成可交換。
- 拖動期間只允許本地 Live Preview 與落點提示；pointer/drop 完成時最多提交一次 draft source 更新，失敗必須以 workspace source 回復 Preview。
- 重新編譯或 DOM 替換後必須依穩定 identity 維持原選取節點，不得因 drop 後的 click 事件改選目標節點。

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

### 5.6 Preview selection 與 Inspector 效能

Preview node selection 是高頻、延遲敏感的 editor interaction，必須保持在
client-side editor selection state；只有可分享、可還原的語意狀態（例如實際切換
section / template）才同步到 route search params。

- 點選同一 section 內的不同 node 不得重複觸發相同的 route navigation。
- 進入 Styles tab 時應啟用 canvas Select Mode；若此模式是由 tab 自動啟用，離開
  Styles 時才恢復進入前狀態。使用者在 Styles 期間手動切換 toolbar mode 後，必須
  尊重該選擇，不得由 effect 強制重新啟用或覆寫。
- Canvas selection outline / overlay 必須先提供即時回饋，不得等待 AST parse、
  Inspector module render、source save 或 route commit。
- Inspector 不得因 node 或 section selection 改變而透過 React `key` 整棵
  unmount / remount；應保留穩定 instance，讓 module 依自身輸入局部更新。
- 收合或不適用的 Inspector module 不得建立完整 field control tree；內容應在
  展開且 capability 適用時才 render。

Source AST 是由 Theme Source 推導的資料，不是 selection state：

- AST parse 結果必須以穩定的 source identity（至少包含 file path 與 content / source
  revision）快取。
- 同一份 source 內切換 node 必須重用 parse 結果；只有 source identity 改變才失效。
- 不得為了避免 React render 而建立另一份可漂移的 AST/source truth；cache 只能是
  可丟棄、可由目前 source 重建的 derived data。

Preview DOM measurement 必須避免 layout thrashing：

- 在同一 interaction frame 內先批次讀取 rect / computed style，再批次更新 overlay DOM。
- 不得在迴圈或同一熱路徑中交錯 layout-affecting write 與 layout read。
- computed-style snapshot 只收集目前 selection / Inspector capability 所需資料；不得把
  source mutation、save 或 preview rebuild 塞進 selection click 的同步熱路徑。
- wheel、pointermove 等每秒可觸發多次的 Canvas gesture 必須先合併到每個 animation frame；
  拖動、捲動與縮放中的暫時 x / y / scale 必須以 ref 保存並透過同一組 Canvas CSS variables
  直接更新 DOM，不得在任何 gesture 的逐幀路徑呼叫 React state setter 或重 render Editor shell。
- React state 只在 gesture 結束或短暫 idle 後同步一次最後 transform；cursor、active gesture 等
  純命令式視覺狀態優先使用 DOM attribute / ref，普通垂直捲動不得每次都讀取
  iframe / viewport 的 bounding rect，只有依游標定位的 zoom 才能在該 frame 量測必要 geometry。
- selection overlay 的 scroll / resize 重新定位必須用 animation frame 合併，避免同一 frame 重複
  `getBoundingClientRect()` 與 overlay style write。

新增或調整 selection / Inspector 熱路徑時，必須用 React Profiler 或 browser
Performance trace 比較修改前後，並至少覆蓋：同 section node 切換、跨 section 切換、
source revision 變更後 cache 失效，以及快速連續 selection 的最新值正確性。

Code Mode 的 Monaco 輸入同樣是高頻熱路徑：

- Monaco 必須將同一 Theme 的全部來源檔註冊到同一個隔離的 file URI tree，
  不得只建立目前開啟分頁的 model；否則 TypeScript worker 無法解析合法的相對 import。
- Browser 內無法直接讀取伺服器 node_modules。Theme 允許清單內的 package 必須由平台提供
  精確且受管理的 declaration；不得以關閉 semantic diagnostics 或 wildcard module declaration
  隱藏真正錯誤，正式 build 仍是最終驗證來源。
- 切換 Theme 或卸載 Code Workspace 時，只能清理該 Theme URI scope 的 Monaco models，
  並保留目前 Theme 各檔案尚未儲存的 draft 語意。
- 打字期間由 Monaco model 保存尚未確認的文字，不得把每個 keystroke 的完整檔案內容
  寫入會讓 Editor shell、檔案樹、Preview 或 Inspector 訂閱的 React state / store slice。
- dirty 狀態只在 clean → dirty 等語意狀態改變時通知 React；不得因內容每個字元不同而
  重 render 整個 Code Workspace。
- 切換檔案時必須保留各 Monaco model 的未儲存內容；關閉並 discard 時則還原該檔案的
  server/source baseline。
- Ctrl+S 或明確 Save 才把完整 model content 送入 Theme Source workspace、OCC save 與
  Live Preview/source-derived UI 收斂流程。隱藏中的 Design Inspector 不得在打字期間重 parse AST。
- Code Mode 輸入效能回歸至少要覆蓋：連續輸入不逐字通知外層、dirty 只通知一次、切檔保留
  draft、Save 使用最新 model content，以及 discard 不保留舊 draft。

---

## 6. Page / Template Content Authoring

Content 修改與 source 修改是兩種不同 mutation。

### 6.0 TanStack Start route authoring

Code Mode 、AI Authoring 與 Theme import 可以在 Customer Theme 的 `src/routes/` 新增、修改或移除 TanStack Start route source，但必須共用既有 Theme Workspace 與 publish boundary：

```text
Theme route source save
        → workspace OCC
        → bounded route scan / diagnostics
        → isolated incremental Live Preview build
        → freeze immutable source revision
        → full Theme build
        → explicit authorized release activation
```

- 新增 `src/routes/about.tsx` 後，`/about` 只能在該 Theme 的 route generation / Preview build 成功後顯示；不可用只修改 Editor React state 的假 route 冒充完成。
- Code Save 不得重啟或接管使用者的 Morph dev server。Live Preview 必須使用 Theme-scoped incremental compiler / sandbox lifecycle，並且只有該 Theme source generation 變更時失效。
- Route discovery 必須遵守 TanStack file-route convention，並對 duplicate path、invalid route path、缺少 root route、越界 import 與不允許 server capability fail closed。
- Visual Editor 必須可從 Page Registry 開啟 code-authored route；route 內具有穩定 `data-morph-*` 與可安全 AST 定位的 node 可進行 Design round-trip，其他 node 必須標示 code-only / unsupported。
- Design Canvas 必須執行所選 pathname 對應的 `src/routes/**` component tree，且 route source 必須以一般相對 import 明確組合 `src/components/**`。Route component tree 是頁面結構與組件順序的 SSOT；不得以 `StorefrontPage`、隱藏 outlet 或 route 外的通用 section renderer 產生另一棵頁面。
- Versioned D1 Page／Template Document 只能把內容 props、enabled state 與 instance metadata 配對至 route 中實際存在的 component instance，不得自行新增、刪除、重新排序 route component。Design 的安全 renderer、Preview 與正式 runtime 必須遵守同一個 route-first pairing contract。
- AI 新增 route 必須走與人類 Code Mode 相同的 workspace mutation、OCC、diagnostics、Preview、revision、build 與 Publish 流程；不得直接修改 generated route tree 或 active release。
- 由 Visual Editor 建立的一般內容頁應建立 versioned D1 Page Document，並由已存在的 dynamic route 解析；不得為了新增文案頁而無條件產生 route source 或要求 Theme rebuild。

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

### 8.3 Untrusted Live Preview isolation

一旦 Live Preview 執行使用者可修改的 JavaScript／React component，就必須視為不可信執行環境。

- Production Editor 必須使用明確設定、與 Editor／Dashboard 不同 origin 的 Preview host；缺少或解析失敗時必須 fail closed，不得靜默退回同源可執行 Preview。
- iframe sandbox 採最小權限。`allow-scripts` 與 `allow-same-origin` 只有在 Preview 確實位於隔離 cross-origin host、功能必需且有 contract test 時才能同時使用；同源 Editor／Preview 禁止此組合。
- Parent 與 Preview 只能透過既有 bounded protocol 溝通，並驗證精確 origin、`event.source`、message schema、session nonce／preview capability、storefront／theme scope 與單調 source revision；Preview 不得要求 save、build、publish 或權限提升。
- Preview 不得取得 Better Auth／admin cookie、production secret、D1／R2 credential 或 general admin token。Preview capability 必須 short-lived、purpose-scoped、resource-scoped，且不得被當成 release／deploy credential。
- 自訂 source 的編譯、dependency resolution 與 artifact creation 必須沿用既有 Sandbox／Container runner、dependency allowlist、path containment 與 resource／network limits；Node `vm` 或 request Worker 內 `eval` 不得被當成 untrusted-code sandbox。

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
