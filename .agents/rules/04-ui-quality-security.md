# Morph UI、Quality、Security 與 Migration 規則

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
