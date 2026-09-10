# Morph UI、Quality、Security 與 Migration 規則

## 本檔鐵則

1. **不可宣稱 typecheck／test／build 通過而未實際執行。** 未跑就說「未驗證」，
   不推測、不省略。（§25）
2. **測試失敗時先問測試是不是對的，再問程式是不是錯的** —— 兩者都可能。要改斷言，
   必須寫清楚原斷言錯在哪，不可為了變綠而調整。（§24）
3. **環境造成的測試失敗要當成問題處理，不是背景雜訊。** 一批長期紅燈的檔案會遮蔽真實
   失敗：`better-sqlite3` 原生模組未編譯讓 16 個檔案一律報錯，蓋住了 4 個真的壞掉的測試。（§24）
4. **優先延伸 shared primitive**，不在單一頁面複製 Dialog、Table、field 等既有元件。（§19）

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
- CSS 長度欄位應使用共用的 length control，並依 property 提供合法單位切換；
  Width / Height 可提供 `Auto`，Padding / Radius 不得提供 CSS 不支援的 `Auto`。
- Width、Height、Padding 與 Radius 的 source utility 單位是 Inspector 的顯示
  authoritative value；computed style 解析出的 px 只能作為無法解析舊 utility 時的 fallback，
  不得在重新 selection、measurement 或 render 時把 `%`、`rem`、`em`、`vw`、`vh`
  回朔成 px。
- 切換單位或 `Auto` 是一次已確認的操作：先同步更新 Live View，再只提交一次 source
  patch。數值 scrub / typing 期間仍只 preview，於 pointer up、blur 或 Enter 才 commit。
- 分邊 Padding 與分角 Radius 展開後必須沿用同一個 length control 與相同單位規則，
  不得各自建立不同的輸入與同步機制。

### 19.3 Inspector field disclosure

Inspector 的 Input 或 Select 若有分軸、進階或其他延伸值：

- 如 Padding 這類單一數值列，欄位名稱必須放在主要 Input 外框內，不得另外占用一列標題。
- 同一 Inspector module 的欄位名稱必須使用相同 typography token；不得混用 `text-xs` 與硬編碼 `text-[10px]` 造成相鄰標籤大小不一。
- 展開控制必須放在主要欄位同一列的最右側，並作為主要 Input / Select 外框之外、緊鄰欄位的獨立 trailing action；不得塞進欄位外框內，也不得分離到欄位標題列。
- 點擊後，延伸值應緊接在主要欄位下方向下展開；主要欄位保持可見。
- 展開按鈕必須提供 `aria-expanded`、`aria-controls` 與明確 accessible label。
- 不得在 Select trigger 等互動元素內巢狀另一個 button；應使用同一欄位容器中的相鄰 trailing action。
- 展開／收合只屬於暫時 UI state，不得因此寫入 domain/source；延伸欄位仍遵循 preview during edit、commit on completion。
- 相同 disclosure affordance 出現兩次以上時應抽成共用 Inspector primitive，不在各模組各自重做。

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

### 23.1 Code authoring 與 Preview security contract

- Code Mode、dependency approval 與 Publish／release activation 必須是可分離的 server-authorized capability；能編輯 Theme source 不代表能新增任意 dependency 或發布 production release。
- Production Live Preview origin 必須由集中 config／environment schema 驗證，並與 Editor origin 比較；缺少、無效或同源時必須顯示明確 unavailable／configuration error，不得降級成不安全 iframe。
- Preview message handler 必須同時驗證精確 origin、預期 iframe window、bounded discriminated schema、session nonce／capability、resource scope、payload size 與 revision。不可只靠 client state、模糊 domain suffix 或 message type 字串。
- Preview response 應套用最小 CSP、`frame-ancestors`、`nosniff` 與 Permissions Policy；允許的 script、style、image、font、connect、form、navigation capability 必須逐項列出，不使用無邊界 wildcard。
- Preview 與 compiler 不得接收 Editor session、production secret 或 storage credential。需要 storefront data 時只能使用 purpose-scoped、short-lived、read-bounded capability 或公開 DTO。
- Theme import、build filesystem、network、CPU、duration、memory、source bytes、file count、artifact bytes 與 artifact path 必須 bounded；新增 allowlist dependency 要有 deny test、版本／license／runtime compatibility review。
- 所有 Preview isolation 變更至少測試：production 缺少 origin fail closed、same-origin reject、允許的 cross-origin、錯誤 origin/source/nonce/revision reject、sandbox token contract、超限 payload reject，以及 Code Save 不會繞過 immutable build／Publish。

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

### 24.1 測試紅燈時的判斷順序

測試失敗代表**程式與測試對某件事的看法不一致**，不預設哪一邊錯。

- 先讀測試想守住什麼，再讀程式實際做了什麼，然後判斷該改哪一邊。
- 要改斷言，必須在該測試（或 commit）寫清楚原斷言錯在哪、新斷言守住什麼。
  **不可為了讓它變綠而調整斷言。**
- 一個斷言若同時要求兩件事，很可能是兩條規則被併在一起。曾經有一個測試用
  `expect(Object.keys(props)).toHaveLength(0)` 同時表達「拒絕傳入值」與「清空既有值」——
  前者是要守的邊界，後者其實是資料遺失。拆開之後兩件事才談得下去。

### 24.2 環境造成的紅燈不是背景雜訊

一批因環境而長期失敗的測試會**遮蔽真實失敗**，而且遮蔽得毫無聲息。

- 不可把「這幾個檔案本來就紅」當成可接受的常態，也不可只用「跟 baseline 一樣」就放行 ——
  baseline 本身可能就是壞的。
- 實例：`better-sqlite3` 原生模組未編譯，16 個測試檔一律以 `Could not locate the bindings
file` 失敗。這個狀態被當成環境問題略過，實際上蓋住了 4 個真的壞掉的測試，其中一個是
  fail-closed 邊界被破壞。修好原生模組後才浮現。
- 遇到疑似環境問題：先修環境，再看測試結果。修不了就明確記錄「因環境未驗證」，
  不可讓它靜靜留在紅燈清單裡。

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

### 26.0 內容形狀的 migration 要寫成腳本

改動元件宣告的欄位形狀（例如把平坦的 `actionHref` 收斂成一個 `link` 欄位）時，既有
Document 不會自己跟上。元件讀不到舊鍵，就渲染預設值 —— **內容還在，只是沒有人在看它**，
畫面上看起來像資料不見了，資料庫裡卻好端端的。

- 這類遷移要寫成 `scripts/` 下可重複執行的腳本，不可只在開發機用手動 SQL 改一次。
  `.wrangler/state/` 不在版控裡：換一台機器、重建資料庫，手動改的東西就沒了，
  staging 與正式環境也永遠不會拿到。
- 腳本必須 **idempotent**：已經是新形狀的文件原樣跳過，重跑不產生任何寫入。
- **必須同時處理 draft revision。** Template 的 `document` 欄位不是編輯器與 runtime 實際
  讀的東西 —— 它們讀 `draft_revision_id` 指向的 revision。只改 `document` 欄位，資料表看
  起來對了，畫面卻還是舊的，而且沒有任何錯誤訊息。
- Revision 不可竄改。需要遷移時**寫一筆新的 revision** 並移動 draft 指標，舊的原樣保留 ——
  這同時就是 rollback 路徑。
- 遠端資料庫無法直接開成 sqlite，腳本應能輸出 SQL 供
  `wrangler d1 execute DATABASE --remote --file` 套用。

現行實例：`pnpm migrate:content-links`（`scripts/migrate-content-link-fields.mjs`）。

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
