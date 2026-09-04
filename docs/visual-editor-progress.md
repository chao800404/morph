# Visual Editor 開發進度表

> 本文件是 Visual Editor 的持續進度基準。每完成一個階段，請更新同一份文件，不另建重複版本。

## 目前概況

| 項目         | 內容                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 最後更新     | 2026-09-04                                                                                                                                                                      |
| 目前狀態     | 核心 Editor／Build／Release 已完成主要鏈路；Production Runtime、Domain 與遠端 Publish 尚未閉環                                                                                  |
| 整體完成度   | **90%**（重新按目前實作與交付閉環證據加權；未將未驗證的 Cloudflare production 路徑視為已完成）                                                                                   |
| 目前重點     | 完成真實 Cloudflare Theme Worker／Service Binding／Domain／Publish E2E，並收斂真實 TSX Live Runtime、Page Registry 與 remote migration；待決：是否連同 theme runtime 版本一起升級 TanStack（見第十輪） |
| 最近完整驗證 | 2026-09-04 於 `9d88bd5` 實跑：`pnpm typecheck`（0 錯誤）、`pnpm typecheck:data`、`pnpm test`（244 files / 1682 tests passed、各 1 skipped）、`pnpm build`、client bundle check（331 檔）、deploy artifact secret guard 與 `git diff --check` 通過；瀏覽器基準為歷史結果，本次未重跑瀏覽器層、遠端 Publish、deploy 或 migration |

`█████████ 90%`

> 完成度依下方權重表計算，可自行複核。權重反映各階段的規模與剩餘風險，不是平均分配 ——
> 把「Inspector 數值輸入一致性」與「真實 Theme Runtime」等重看待，是先前數字偏高的主因。
>
> **這個數字只衡量下表列出的階段，不等於 production readiness。** 已完成的 Editor、Build、
> Release、OCC 與本機 fail-closed 程式鏈不回退；但真實 Cloudflare Theme Worker、custom domain、
> remote migration、Publish E2E、Page Registry，以及隔離 iframe 中的真實 TSX runtime 尚未完成，
> 因此不能把目前的 Build artifact 說成已上線 storefront。

### 狀態標記

- ✅ 已完成並有自動化驗證
- 🟢 已實作，仍需持續回歸確認
- 🟡 部分完成或尚有明確後續工作
- ⬜ 尚未開始

## 階段進度

| 階段                               | 範圍                                                                                                                                 | 狀態 | 完成度 | 下一個確認點                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---- | -----: | ------------------------------------------------------------------------- |
| 1. Inspector 資料一致性            | 數值回朔、舊回應覆蓋新值、選取切換競態                                                                                               | ✅   |   100% | 新控制項持續沿用 pending value 與 stale response 防護                     |
| 2. 即時預覽與提交語意              | 操作中只更新 Live View，完成輸入後才真正提交資料                                                                                     | ✅   |   100% | 新控制項必須沿用同一套 draft/commit 規則                                  |
| 3. Inspector 模組化與基本樣式      | capability 判定、Design Card、Sizing、Position、Appearance、Spacing、Typography、Fill、Border、array 欄位、link 欄位                 | 🟢   |    99% | Content 已獨立成分頁（2026-09-04）；其餘卡片仍有硬編碼 `text-[10px]`（15 處），待收斂到同一 token |
| 4. Editor ↔ Preview 通訊           | typed protocol、runtime validation、selection/style 同步、in-place route bridge                                                      | ✅   |   100% | 新訊息必須登錄 protocol registry 並加測試                                 |
| 5. 編輯器互動效能                  | 選取側欄切換、Code 模式輸入、未儲存 Code ↔ Design 切換防護、Code 診斷與補全、Color Picker 拖曳、面板寬度拖曳、Canvas 捲動／平移／縮放、capability 解析快取、路由預取與穩定 iframe | 🟢   |    95% | 補完 Performance trace，重新量測大型 theme、深層 DOM 與大量 capability；並逐一稽核其餘高頻操作 |
| 6. Code-authored 內容 round-trip   | 程式碼文字節點選取、Inspector 編輯、Live Preview、D1 draft／OCC persistence 與 production 交付鏈                                   | 🟢   |    85% | 補齊 Promo vertical slice，並以真實 production runtime 完成 Publish E2E    |
| 7. Live Runtime 與真實建置的一致性 | 解釋器輸出必須與真實 React、真實 router 與隔離的 TSX runtime 一致                                                                  | 🟡   |    75% | 完成真實 TSX/component iframe、模組邊界、Inspector 套用與 runtime fallback  |
| 8. 最終品質與發布準備              | E2E、無障礙、跨瀏覽器、響應式、錯誤與載入狀態、復原／重做、release 回滾                                                              | 🟡   |    80% | 完成 Cloudflare runtime/domain、remote migration 與 Publish E2E 發布閉環     |

## 權重與計算

| 階段                               |    權重 | 完成度 |           貢獻 |
| ---------------------------------- | ------: | -----: | -------------: |
| 1. Inspector 資料一致性            |       5 |   100% |           5.00 |
| 2. 即時預覽與提交語意              |       5 |   100% |           5.00 |
| 3. Inspector 模組化與基本樣式      |      18 |    99% |          17.82 |
| 4. Editor ↔ Preview 通訊           |      10 |   100% |          10.00 |
| 5. 編輯器互動效能                  |      15 |    95% |          14.25 |
| 6. Code-authored 內容 round-trip   |      15 |    85% |          12.75 |
| 7. Live Runtime 與真實建置的一致性 |      12 |    75% |           9.00 |
| 8. 最終品質與發布準備              |      20 |    80% |          16.00 |
| **合計**                           | **100** |        | **89.82 → 90%** |

權重依「剩餘工作量 × 對可交付性的影響」設定：

- 階段 8 權重最高（20）：可交付性的最後一哩；無障礙、跨瀏覽器與本機發布程式鏈已有基線，
  但仍需真實 Cloudflare runtime、remote migration、完整 authoring-to-publish 路徑與第三方 Theme。
- 階段 3、6 各 15–18：面積大；核心控制項與內容 round-trip 已完成，剩餘是自訂 capability
  vertical slice 與真實 customer source 邊界。
- 階段 5（15）：已有互動延遲 baseline，但大型 theme、深層 DOM 與大量 capability 的壓力
  尚未完整量測，因此保留 5% 待驗證。
- 階段 6（15）：D1 draft／OCC round-trip 已完成，但 production runtime 與 Publish E2E
  仍未閉環，因此不再標示 100%。
- 階段 7（12）：目前 editor Live Preview 仍使用 compatibility renderer，真實 TSX/component
  iframe 與安全模組邊界尚未完成，因此下修為 75%。
- 階段 1、2 各 5：已完成的一致性修正，範圍小。

### 2026-08-31 實碼審核與降評依據

本輪不是根據本文件原有勾選重新計分，而是重新檢查目前 `main` 的實際入口與
`route → server function → DAL/storage → schema` 呼叫鏈，並在現有工作樹執行驗證。

- `pnpm typecheck` 實際通過。
- `pnpm build` 實際通過，`check-client-bundle` 掃描 335 個檔案，未發現 server-only
  value 進入 client bundle。
- `pnpm test` 實際結果為 216 個測試檔中 214 passed、1 failed、1 skipped；1380 個
  tests 中 1377 passed、2 failed、1 skipped。兩項失敗都是
  `editor-style-inspector.test.tsx` 的 timeout：
  - `keeps pending numeric styles ahead of stale preview computed values`
  - `edits overall and per-side border widths and expands independent corner radii`
- 本輪沒有執行 Playwright，因此下方歷史紀錄只能證明過去曾通過，不能當作目前 commit
  的即時結果。
- Build／Queue／R2 artifact／Release／deployment 的程式鏈已存在，但主
  `wrangler.jsonc` 尚未配置實際 Theme Worker service binding；Cloudflare credentials、
  Zone、Worker service 或 isolated preview origin 缺少時會 fail closed。因此 production
  發布與 custom domain 仍需在真實環境完成一次端到端驗證。
- AI Agent 面板目前明確顯示 `AI Agent is not connected yet`，輸入、附件、送出與歷史
  操作皆停用。AI Code Agent 不納入本 Visual Editor 加權表，但屬於 Morph 整體 Roadmap
  的主要未完成項目。
- Client build 成功但 `editor-code-workspace` chunk 約 8.6 MB，另有 `/hero.png` runtime
  resolve 與部分 dynamic/static import 混用警告；目前不是 build blocker，但仍是交付前
  的載入效能風險。

依以上證據，原本的 99% 與「完整驗證均通過」不足以描述目前狀態，調整為 94%。已完成
功能不回退成未實作；扣分集中在當前回歸狀態、瀏覽器驗證時效與 production 閉環證據。

### 2026-09-01 回歸修復與重新驗證

- Inspector 兩項 timeout 已修正：元件來源解析依 content/path memoize，測試不再反覆執行
  大範圍 role tree 查詢。完整測試負載下兩項案例分別約 3.1 秒與 1.3 秒通過。
- Code Workspace 維持 Design 首屏不下載資產；使用者 hover 或鍵盤 focus Code 時，才開始
  lazy chunk 預載並以 hidden/inert 狀態掛載 Monaco。完整 Chromium E2E 的 Design → Code
  為 699ms、Code → Design 為 651ms，仍使用原本 2000ms 上限。
- Chromium 為 23 passed / 1 skipped；Firefox + WebKit 為 39 passed / 8 skipped。skip 是
  Publish 的明確安全開關，以及只在 Chromium 執行的效能基準，不是測試失敗。
- `pnpm typecheck`、`pnpm test`（215 files / 1380 tests passed、1 workspace parity skipped）、
  `pnpm build` 與 client bundle check 全部通過。
- Production runtime、service binding 選擇、Theme Worker 部署、CAS activation 與 rollback 的
  本機程式鏈和單元測試已核對。剩餘 4% 主要是需要實際 Cloudflare account/service/Zone/domain
  的遠端閉環、Publish E2E，以及 Code Workspace 約 3.57 MB minified client chunk；未把本機
  storefront id 猜寫進 `wrangler.jsonc`。

### 2026-09-04 第十一輪：資料層規則對齊、登入回跳與面板拖曳效能

本輪起於一份外部架構審核報告。**逐項驗證後，報告四項主張裡只有兩項成立，
另兩項被誇大或指錯位置**，因此先記錄查證結果再動手。

**報告正確但描述失準的一項：`firstOrNull`。** 數量屬實（storefront DAL 約 60 處），
但報告說的「會延後成不可預期的 `undefined` 崩潰」**不成立**——逐一打開後，每一處
都有 `if (revision)` / `Boolean(theme)` 之類的 runtime guard，沒有 live bug。真正的
缺陷只是型別不誠實：guard 寫了但 TS 認為是死碼，未來改動沒有保護。

**報告誇大的一項：「DAL 混雜 AST Compiler」。** `resolveThemeContentCapabilities` /
`filterThemeContentProps` 本來就住在 `theme-content-capability-resolver.ts`，是
**import 進來的**；`deriveTemplateDocumentFromRoutes` 也只是薄薄組合 compiler 既有
函式，沒有自己做 AST parsing。分層其實是對的。但報告**漏掉**了真正該搬的東西：
`COMPONENT_CONTENT_MANIFESTS` 是 429 行純內容政策、零資料庫存取，佔掉該檔 23%。

#### 做了什麼

- **§13 validator 全面遷移。** 179 個 validator 中 168 個會拋錯，全部改用
  `parseInput`。156 個由 codemod 處理，12 個手工（bare `z.object()`、`safeParse`
  後自拋、FormData 型、游標跳過的 2 個）。156 次改寫只產生 1 個型別錯誤，而那正是
  重點：`dashboard-search.tsx` 讀 `data.data.groups`，但失敗分支的 `data` 是 `null`。
  另發現 `src/server/asset/` 的 `parseXInput` **本來就不拋錯**，早已是對的模式，
  只是沒推廣。
- **§18 theme revision 分頁。** 真正在燒的不是報告指的那個無上限查詢（那個查詢的
  query **沒有任何 UI 在用**），而是 `rollbackToRevision` 為了用編號找一筆而載入
  整張表——`snapshot` 是 NOT NULL JSON 欄位，裝著每個 revision 的完整 theme 原始碼。
  新增 `findRevisionByNumber` 用 SQL 收斂成單列；`listRevisions` 比照
  `listHistory` 分頁（count 與頁面同時取、limit 夾在 1..100）。
- **§14.1 新增 `mapFirstOrNull`。** `rows.length > 0 ? toDTO(rows[0]) : null` 看似有
  防護但沒有：length 檢查不會 narrow `rows[0]`。9 處重複寫法收斂。
- **§14.2 manifest 搬離 DAL。** `storefront-theme.dal.ts` 從 1552 → 1123 行。搬移中
  差點誤刪一段回傳值被丟棄的 `filterThemeContentProps(...)`——它其實是刻意的驗證
  守衛，`assertThemeContentFieldValue` 會拋錯，已保留。
- **登入後回到中斷的路徑。** 閒置登出本來就會寫 `?callbackURL=`，Better Auth 的
  redirect plugin 也確實會用它，但 route guard（`/dashboard`、`/_editor`）——也就是
  session 過期最常見的出口——丟的是裸 redirect，路徑直接遺失。兩處補上，並改存
  `sessionStorage` 讓路徑撐過關分頁。主動登出則清除：那不是被中斷的 session。
- **面板拖曳效能。** 見下方獨立條目。

#### 順帶修掉的 open redirect ⚠️

`callbackURL` 原本是 `z.string().optional()`，接受任意字串。Better Auth 只檢查 URL
**scheme**——`isSafeUrlScheme` 擋 `javascript:`，但依其自身註解是「intentionally」
放行絕對網址——然後把值交給 `window.location.href`。所以
`/sign-in?callbackURL=https://evil.example` 會把一個**剛輸入完密碼**的使用者送到站外。

新增 `sanitizeReturnPath`：只接受同源路徑，擋掉絕對網址、protocol-relative `//host`
及其反斜線變體、控制字元，以及 auth 頁面本身。storage 在寫入與**讀出時各驗一次**，
因為同源的任何腳本都能改它。此防護以 mutation test 驗證過：拿掉
protocol-relative 檢查會讓 3 個測試失敗。

#### 面板拖曳：把拖曳迴圈移出 React

左右面板拖曳每個 `pointermove` 都 `setState`，等於在 120Hz 螢幕上每秒對
`VisualEditorShell`（約 6700 行、150 個 hook）做 120+ 次完整 reconciliation。兩側面板
雖有 `memo`，但被每次 render 都新建的 `style={{ width }}` 物件擊穿。iframe 本來就得在
容器寬度改變時重排整份文件，那份工作與 React 搶同一條主執行緒，畫布因此明顯掉幀。

改為把寬度寫進 design surface 的 CSS 自訂屬性，並用 `requestAnimationFrame` 合併，
一幀內的多個 move 只付一次 layout。React state 只保留**已提交**的寬度（SSR 初始值與
重新整理後還原），放開才寫一次。拖曳期間的 re-render：**0**。

`aria-valuenow` 在同一幀直接寫 DOM——若仍綁 state，螢幕閱讀器整段手勢都會被告知
拖曳前的舊寬度。面板 style 物件提為 module 常數，順帶修好被擊穿的 memo。

此保證同樣以 mutation test 驗證：把 `setState` 放回 `pointermove` 會讓該測試失敗。

#### 為什麼沒有全域開啟 `noUncheckedIndexedAccess`

全開是 379 個錯誤。按層拆開後，**資料層只有 33 個**，其餘 338 個在 UI、AST、compiler
與測試檔。其中 `theme-compiler-hasher.ts` 一個檔就佔 44 個——那是手寫 SHA-256，
`words[i]` 由建構方式保證存在。實測 `Uint32Array` 也無法規避（該 flag 對 numeric
index signature 一樣生效），所以那 44 處只能加 44 個 `!`，安全收益為零。

因此改為**範圍化強制**：根 tsconfig 不開，`tsconfig.strict.json` 用該 flag 編譯整個
程式，但 `scripts/typecheck-data-layer.mjs` 只回報 DAL / storage / serverFn 三層，
由 `pnpm typecheck:data` 把關。此閘門以注入違規驗證過確實會擋。其他區域整理好後，
擴大 `ENFORCED_PATHS` 即可漸進納管。

#### 尚未驗證

登入流程的端到端路徑（閒置登出 → 關分頁 → 重開 → 登入 → 回到原頁）與面板拖曳的實際
手感都需要人工確認——進編輯器需要登入憑證。iframe 每幀重排亦刻意保留，待量測 React
修正是否已足夠再決定是否加 `pointer-events: none` 或 CSS `contain`。

### 2026-09-04 Content / Styles 分頁拆分與跨 section 選取同步

- 依 §2（Presentation SSOT = Theme Source/Tailwind；Content = Page/Template Document），
  Content fields 從 Styles 分頁移出，成為獨立分頁。做法是保留原本約 1000 行的內容區塊
  不動，改以新的 `view` prop 控制渲染，讓共用的選取狀態仍留在同一個元件。
- 沒有內容欄位的元素顯示虛線空狀態；分頁維持使用者上次選擇，不隨選取自動切換。
- 測試調整 43 項：把 `view="content"` 限縮到真正以內容為主的測試，並把已失去意義的
  「Tailwind classes 排在 content 之前」改寫為兩個各自有意義的斷言。
- 另修正跨 section 的編輯器選取同步（`061df53`）。

### 2026-09-03 第十輪之二：工具列與佔位圖修整

- **狀態文字縮短。** `Unpublished changes` / `All changes saved` →
  `Unpublished` / `Published`。同字根、各一詞、對稱，而這兩個狀態**共用同一個
  `CircleCheck` 圖示**，文字是唯一區別。字寬砍半後斷點從 `2xl:` 降到 `xl:`。
  e2e 改用 `[data-editor-save-status]` 的 `aria-label` 定位，不再綁在文案上。
- **佔位圖改用 Lucide `image` 圖示**（ISC，專案已依賴 `lucide-react`）。原本自畫的
  花瓶剪影讀起來像變形蟲；「畫框 + 山」是 Figma／Notion／Shopify 共用的語彙，
  一眼可讀。因為要放進外層 SVG 座標系，是 trace 三條 path 而非 import 元件。
  商品卡也補上小一號的同一圖示。

### 2026-09-03 第十輪：不透明 500 的根因與可診斷性

`{"status":500,"unhandled":true,"message":"HTTPError"}` 反覆出現、「改了程式就壞、
刷新就好」。**這一輪的教訓是：我前兩次的判斷都錯了，兩次都從 handler 邏輯查起。**
正確的第一步是先確認請求有沒有抵達 handler。

三個獨立問題，依發現順序：

**1. serverFn URL 由 `undefined` 組成。** `createClientRpc` 用
`process.env.TSS_SERVER_FN_BASE + functionId` 組 URL，而該表達式原封不動送到瀏覽器
（瀏覽器沒有 `process`）。在 dev server 上實測 `typeof process === "undefined"`，
且送到不存在的路徑會回**與回報一字不差**的那串 JSON。修法：`vite.config.ts` 加
`define` 把 base 在 transform 階段釘死；已驗證 HMR 後 URL 仍正確、production
client bundle 裡是字面值。

**2. Validator 拋錯繞過 handler 的 try/catch。** 見 rules §13。當時先把 10 個帶
OCC/CAS 前提（`expected*`、`expectMissing`）的 serverFn 改用 `parseInput()`，
其餘維持原狀，理由是「那些幾乎只在 client 有 bug 時才失敗，全面改動的 churn 大於收益」。

> **這個取捨已於 2026-09-04 推翻，見第十一輪。** 全部 168 個都已遷移。改判的理由是
> 分批遷移會留下一條「哪些 serverFn 會回不透明 500」的隱性知識，而那正是本輪要消除的
> 東西；一次做完反而比日後回頭補便宜。

**3. 真正的殘餘病因：serverFn resolver 的冷啟動競速。** 上游已知
（TanStack/router#6609、#7363）。`getServerFnById` 找不到 id 時**拋錯而非回 404**，
h3 再包成空白 500。編輯器掛載時最早發出的兩個查詢
（`listStorefrontCommentGroups` / `listStorefrontCommentThreads`）會輸掉這場競速；
實測同樣的 id 稍後完全正常，且 React Query 預設重試已自行吸收。**不是本專案的
程式錯誤。**

- 新增 `src/server/server-fn-recovery.ts`：在 Worker entry 把空白 500 換成帶
  `error: "SERVER_FN_UNHANDLED"` 與函式名稱的回應。**h3 是「回傳」而非拋出**，
  所以必須檢查 response 而非 catch——第一版寫成 try/catch，實測完全攔不到。
  刻意**不宣稱「id 過期」**、狀態碼**維持 500**：真的 handler crash 也落進同一個
  兜底，貼上 "not found" 或改成 404 只是用一個謊話換掉另一個。
  log 會把 base64 id 解碼成 `函式名 (檔案路徑)`。
- 測試 16 項，重點在**不得過度匹配**：帶有原因的 500、其他路由的同樣 body、
  非 500 回應，全部必須原封不動通過且 body 不可被消耗。

**嘗試過但放棄的路：升級 TanStack。** #6609 的修正在 `react-start@1.168.49`
（本專案 1.168.32）。升上去撞到專案自己的護欄——`generate-theme-package-types.mjs`
要求 workspace 的 `@tanstack/react-router` 與 theme 相依鎖定值完全一致；只升 start
則 typecheck 爆 10 個錯（`server` route option 在舊 router 型別裡不存在）。
**`react-start@1.168.49` 綁 `react-router@1.170.32`，而 theme pin 不允許。**
已完整還原 `package.json` 與 `pnpm-lock.yaml`。要做就得連 theme runtime 版本一起升，
那會影響既有 theme 的建置對等性，留待決定。

規則新增：§13「Validator 不得拋錯」與 §13.1「不透明 500 的診斷順序」。

### 2026-09-02 第九輪：Release 截圖（尚未啟用）

Online Store 卡片上的預覽是寫死的示意圖（`theme-preview-default.png` 加硬編碼
文案），跟實際主題無關。改為 publish 後擷取真實畫面。

查證後選 Cloudflare Browser Run（原 Browser Rendering）**REST API**，而非
Workers binding：binding 的 `quickAction()` 需要 compatibility_date
`2026-03-24` 以後（本專案為 `2025-09-02`），且未關閉的 session 會持續消耗
瀏覽器時間；REST 單次請求沒有 session 可洩漏。前端 canvas（html2canvas 之類）
不可行——Build Preview 的 iframe 是 `sandbox="allow-scripts"` 的 opaque
origin，父視窗讀不到 DOM。

- **擷取目標是該 release 的 build preview URL，不是主網域。** publish 建立
  release 但不必然使其上線，對主網域截圖會拍到「上一版」卻標記成這一版。
- **非同步。** 沿用既有的 `morph-theme-builds` queue，訊息改為 discriminated
  union（`theme-build` | `release-preview`）。release 送到 queue 時已經是持久
  的，截圖失敗一律 `ack` 不重試——Browser Run 的每日上限是最常見的失敗，重試
  只會把剩餘額度用在重複失敗上。
- **憑證缺席是正常狀態。** `createBrowserRunScreenshotter()` 沒有 token 就回
  `null`，`captureReleasePreview()` 回 `skipped` 而非拋錯。
- **無圖時改畫 SVG 線框，不再用照片。** 原本的 fallback 是一張陶器店照片配上
  「Objects for everyday rituals.」等硬編碼文案——那家店從來不是使用者的，第一眼
  卻會被讀成「這是你的店」，而且每次都是錯的。改為
  `ThemePreviewPlaceholder{Desktop,Mobile}`：hero、商品格線的扁平線框，
  desktop 用 `viewBox 800×350`（16/7）、mobile 用 `320×400`（4/5），
  全程 `currentColor` + opacity，明暗模式共用一份。線框不會被誤認為截圖，
  不需要標籤就說明了「還沒有東西」。
- **圖片先寫 R2，metadata 後寫。** 反過來會讓 release 指向還不存在的圖，而頁面
  無法分辨那與上傳失敗。
- 圖片以 release id 為 key（`storefront-release-previews/{releaseId}/{viewport}.png`），
  綁在 metadata 的 `preview`，與第八輪的 `note` 並存。舊 release 的圖不會被新的
  覆寫，回滾時看到的是那一版自己的畫面。
- 服務路由 `/release-preview/$releaseId/$viewport` **需要登入 session**：截圖
  拍的是可能尚未公開或限制存取的店，公開 URL 等於把私有店內容洩漏給任何持有
  release id 的人。key 由 release id 推導，不接受 query 參數指定物件。
- 測試 33 項：metadata 7、擷取流程 7、Browser Run adapter 5（全部注入 fetch，
  不觸網）、queue dispatch 3、placeholder 7（斷言不含 `<img>`／`url()`／寫死色碼）、
  原有 build 訊息 4。

**尚未啟用。** 需要三個環境設定才會真的產圖，缺任一項都只是靜默略過：
`CLOUDFLARE_ACCOUNT_ID`、`BROWSER_RENDERING_API_TOKEN`（secret）、
`PUBLIC_ORIGIN`（https，Browser Run 走公開網際網路，連不到 localhost）。

### 2026-09-02 第八輪：Release 描述與事後重新命名

Release 原本只以 hex 片段與時間戳呈現（`f555c94e · 2026/9/1 下午11:04`），
兩者都能唯一識別一個 release，卻都不描述它的內容——要從歷史紀錄挑一個還原，
只能一個一個開來看。

查證其他 CMS：Contentful、Sanity、Strapi 皆**沒有**使用者填寫的版本號；
Webflow 的 publish 有選填 note，Vercel／Netlify 用的是 commit message。
共同點是**描述而非版本號**：語意化版本需要有人維護規則，
而視覺編輯器的每次 publish 都是一次小改動，強制編號只會退化成流水號。

- 新增 `src/lib/storefront/release-note.ts`：note 存進 release 既有的 `metadata`
  欄位（保留其他 key，空字串則移除該 key，全空則整欄回 `null`），
  上限 120 字。不另開 column：note 不參與任何 runtime 決策。
- Publish 按鈕改為 Popover，內含**選填**的一行描述。刻意不設為必填——
  強制填寫只會得到「update」「fix」這種同樣沒有資訊量的內容，還多一道摩擦。
- Release history 以描述為主標題，hex 與時間戳降為次要行（對照 build 與 log
  時仍然需要）；沒填的顯示 `Untitled`。
- 每列可事後重新命名（`renameStorefrontRelease` serverFn →
  `storefrontReleaseDal.renameRelease`）。發布當下常常還說不清改了什麼，
  能事後補寫才不會讓清單永遠停在第一次的猜測。
  DAL 經 `getById` 做 storefront 範圍檢查，且只更新 `metadata`：
  release 指向 immutable build 與 content publication，
  重新命名絕不能成為第二條改變線上內容的路徑。
- 測試：`release-note` 11 項、history row note 3 項、DAL rename 4 項
  （含跨 storefront 拒絕、保留其他 metadata、清空 note）。
  e2e `publish.spec.ts` 改為點 Publish 後再點 `[data-publish-confirm]`，
  且刻意留白描述，確認 note 不是建立 release 的必要條件。

### 2026-09-02：Code → Design 未儲存變更提示

- Code 模式切回 Design 前，若 Code Workspace 有 dirty source files，會先顯示明確提示。
- 提供 `Save & switch`、`Continue without saving`、`Cancel` 三個選項；Save & switch
  只有在所有 dirty files 實際保存成功且無 conflict 時才切換。
- `Continue without saving` 只切換面板，不清除 Monaco transient draft；Code surface
  維持掛載，切回 Code 時仍可繼續編輯。
- 透過 `EditorCodeWorkspaceHandle.saveAll()` 連接既有 OCC／workspace save path，並新增
  測試確認 Save All 會保存目前 Monaco model 內容。
- 驗證：`pnpm typecheck`、`pnpm test`（230 files / 1544 tests passed、1 skipped）、
  `pnpm build`、client bundle check、deploy artifact secret guard 與 `git diff --check` 通過。

### 2026-09-01 第七輪：Publish 需要時自動 build

查證業界做法後修正。沒有任何平台把 build 的觸發責任交給使用者記得：
Webflow 與 Shopify Hydrogen 的 publish／deploy **本身就包含 build**；
Vercel／Netlify 則是 build 自動發生，publish 只是把既有產物 promote 上正式環境
（且明確地**不重新 build**，因為上線的必須就是驗過的那份產物）。
Morph 原本是第三種：手動 build → 手動 publish → 忘了就跳錯誤，這是唯一的異類。

架構本來就對——Build Preview 產出 immutable artifact、Publish 引用它，等同 Vercel 的
build→promote，差別只在觸發時機。因此不改架構，只補上缺的那一步。

- `resolvePublishBuildPlan()` 決定三種情況：產物與目前 source 相符則 `reuse-build`；
  沒有自己的 build 但有 active release 則 `reuse-release`（content-only publish）；
  其餘 `build`。能沿用就沿用，是為了讓上線的與預覽過的是同一份產物。

- Publish 在 `build` 情況下自動先建置再發布，不再回報錯誤要求使用者回去按 Build。
  Build Preview 按鈕保留，因為它仍有獨立用途：發布前先看編譯後的樣子（等同 preview deployment）。

- Build 結果**回傳**而非只寫入 state：publish 在同一個 tick continue，讀 state 會拿到上一輪的值。

- Publish 按鈕在自動建置期間顯示 `Building…`、發布期間顯示 `Publishing…`，
  並一併納入 disabled；否則建置中按鈕看起來仍可按，會觸發第二輪 build+publish。

- build 失敗時不發布，且沿用 build 自己的錯誤訊息——在上面再疊一句「發布失敗」會指錯步驟。
  伺服器端 `PUBLISH_BUILD_NOT_READY`／`PUBLISH_BUILD_MISMATCH` 等把關維持不變，不依賴前端判斷。

- 驗證：`pnpm typecheck`、`pnpm test`（229 files / 1525 tests passed、1 skipped）、
  `pnpm build`、client bundle check 與 deploy artifact secret guard 全數通過。
  新增 6 個測試涵蓋三種 plan 分支、build 未記錄 source generation 時不猜、
  以及自有 build 優先於 active release。**未**在瀏覽器實際跑過 publish。

### 2026-09-01 第六輪：Build／Publish 工具列狀態回饋

- **Build 與取消合併成同一顆按鈕。** 建置中按鈕不再變灰失效再長出第二顆取消鈕；
  一個進行中的工作，唯一有用的動作就是停掉它。圖示沿用 media transport 語彙：
  閒置 `Play`、建置中轉圈、hover **或 keyboard focus** 時換成實心 `Square`（停止）。
  只靠 hover 會讓鍵盤使用者看不到按下去會取消，違反 §19「keyboard、focus 必須保留」。

- **Publish 補上進行中狀態。** 先前 publish 期間只是把按鈕變灰，而它同時因為
  未存檔、衝突等半打理由也會變灰，於是「正在發布」讀起來像「不允許發布」。
  改為轉圈 + `Publishing…`，並以 `aria-busy` 對 screen reader 表達同一件事；
  accessible name 跟著可見文字走，兩者不會不一致（WCAG 2.5.3）。
  Release history 的 activate/rollback 原本就有 per-row spinner，Publish 是唯一缺的。

- 相鄰的預覽切換鈕原本在 `Build Preview`／`View Build` 之間跳，一個是狀態一個是動作。
  它其實是 toggle，改為固定文字 `Built` 並以 `aria-pressed` 表達開關。

- **e2e 定位改用穩定屬性。** 建置按鈕的 label、title 與 accessible name 都會隨狀態改變，
  原本 e2e 以 title 定位，點擊後即失配。改用 `data-editor-build-action` 定位、
  `data-build-pending` 讀狀態（沿用既有 `data-editor-save-status` 慣例）。

- 驗證：`pnpm typecheck`、`pnpm test`（228 files / 1519 tests passed、1 skipped）、
  `pnpm build`、client bundle check 與 deploy artifact secret guard 全數通過。
  工具列的 hover／focus 視覺與 e2e **未**在瀏覽器實際執行。

### 2026-09-01 第五輪：Build 真正可取消（新增 `cancelled` 狀態）

依業界慣例修正第四輪的判斷。查證後：Vercel、Netlify、Cloudflare Pages 都提供真正的取消並使用
獨立的 `CANCELED` 狀態；Contentful／Sanity／Strapi 這類 CMS 沒有，因為取消屬於建置平台。
**Morph 兩者皆是**（自有 sandbox → R2 → release 管線），所以適用建置平台的慣例，
第四輪只做「停止等待」並不足夠。

- **`cancelled` 加入 build 狀態機**（§7.1 已同步更新）。與 `failed` 同為 terminal 且不可發布；
  既有的發布／release 閘門都是 `!== "succeeded"` 的白名單，因此自動涵蓋。

- **Cloudflare 上的做法**。Queues **無法**撤回已投遞的訊息（只有 `ack`／`retry`），
  所以取消是協作式的，且順序不可顛倒：先 CAS 佔住 row，**再**銷毀 Sandbox。
  先銷毀會讓 runner 在任何原因被記錄前就失敗，取消會被誤呈現成 build 失敗。
  可行的關鍵是 runner 早已用 `buildId` 取得 Sandbox session，而 Sandbox 是 Durable Object，
  因此另一個請求用同一個 id 就能取得同一個容器並 `destroy()`；不需要任何新基礎設施。
  使用 `destroy()`（整個 session）而非 `killProcess()`，與既有 timeout 路徑一致，
  也避開 Cloudflare 尚在修正的 process-tree kill 邊界情況。

- **CAS 不變條件**。`markBuildFailed`／`markBuildSucceeded` 現在都拒絕從 terminal 狀態轉移，
  因此 runner 的完成寫入輸給已佔住的取消，不會把 `cancelled` 覆寫成 `failed` ——
  這正是「CAS loser 不得把 winner 標成 failed」。build 先結束時取消回報
  `cancelled: false` 與該 build 自身狀態，屬正常結果而非錯誤（對應 Vercel 的
  `400 not cancelable`）。另修正 start-CAS 落敗路徑先前未涵蓋 `cancelled` 而會誤丟例外。

- **Queue consumer 開頭檢查狀態**：已是 terminal 就 `ack` 並跳過，不會為一個結果注定
  無法寫入的 build 耗費 Sandbox。

- 銷毀 session 失敗不會使已完成的取消變成錯誤：row 已決定結果，且 runner 本身有時間上限。

- 驗證：`pnpm typecheck`、`pnpm test`（228 files / 1519 tests passed、1 skipped）、
  `pnpm build`、client bundle check 與 deploy artifact secret guard 全數通過。
  新增 14 個測試涵蓋 queued／building 取消、已成功時取消失敗、拒絕把 cancelled 改寫為
  failed／succeeded、跨 storefront 擁有權、先佔 row 再銷毀的順序、session 不可達仍完成取消，
  以及 consumer 跳過 terminal build。**未**在瀏覽器實際點過取消按鈕。

### 2026-09-01 第四輪：Build Preview 等待可中斷，並修正逾時誤報

- **「Stop waiting」只停止等待，不停止 build。** compiler 本身已有 30 秒硬上限
  （`local-vite-theme-build-runner.ts` 的 `maxDurationMs`），所以放棄等待不會留下無限跑的工作，
  §23「bounded work」仍然成立。刻意**不**新增 `cancelled` build 狀態：§7.1 的狀態機是
  `queued → building → succeeded ↘ failed`，真正終止伺服器端工作會改動 schema 與狀態機，
  並帶來 worker 可能在取消後才寫入 `succeeded` 的 CAS 競態，屬於另一個決定。

- **修正：跑滿輪詢次數被誤報成失敗。** 原本 30 次輪詢後 `status` 仍是 `"building"`，
  卻掉進 else 分支跳紅色 `Build status: building`。那個 build **沒有失敗，它還在跑**，
  而使用者被告知失敗且無法再接回結果。三種結束原因（settled／aborted／timeout）現在分開，
  只有 settled 會談論 build 本身。

- **修正：輪詢沒有卸載防護。** 迴圈原本沒有 abort 機制，元件在輪詢中被卸載後仍會繼續
  發出約 30 秒的請求並對已卸載元件 `setState`。改為 `AbortController`，卸載時中止且不跳任何 UI。

- 等待邏輯抽成純函式 `waitForThemeBuild()`（`src/lib/storefront/editor/theme-build-wait.ts`），
  shell 只負責 UI 與 toast。8 個測試涵蓋成功、失敗、已結束不輪詢、逾時不等於失敗、
  使用者中止、卸載中止（帶 reason 以保持靜默）、間隔中途中止不再發請求，
  以及輪詢讀取失敗時保留最後已知狀態而非誤判。

- 驗證：`pnpm typecheck`、`pnpm test`（227 files / 1504 tests passed、1 skipped）、
  `pnpm build`、client bundle check 與 deploy artifact secret guard 全數通過。

### 2026-09-01 第三輪：可編輯連結（`type: "link"`）與 Inspector 規範修正

- **新增 `type: "link"` content field。** 值是物件 `{ href, target?, nofollow?, title?, ariaLabel?, download? }`，
  而不是拆成 `actionHref`／`actionTarget`／`actionTitle` 一組平行 prop：它們是同一個決定、
  一起被編輯，而且 array row 因此能持有一整條連結。href 沿用既有的
  `isSafeContentUrl` allowlist（http／https／mailto／tel／相對路徑），未知 key 直接拒絕寫入。

- **`rel` 由平台推導，不儲存。** Theme 不能 import Morph 程式碼（`@morph/storefront-runtime`
  正在移除且不在 approved dependency），所以若把 `rel` 留給作者組裝，一個忘記的運算式就是一條
  沒有保護的新分頁。改由 `resolveThemeLinksInSlotValues()` 在**兩條**交出內容的邊界一起解析——
  已發布內容回應（`storefront-content-runtime.ts`）與直譯預覽（`safe-theme-route-renderer.tsx`）——
  作者只寫 `rel={action.rel}`。`download` 對跨來源會被瀏覽器忽略，因此只對站內目的地保留。

- **`<Link>` 與 `<a>` 的差異是正確性問題，不是樣式偏好。** `<Link to>` 要比對本 Theme 的路由樹，
  外部網址在**預覽會過**（直譯器渲染成普通 anchor）卻在**建置後的站台失敗**——正是預覽／建置分歧。
  新增 `resolveThemeLinkBinding()` 從原始碼判斷 router／anchor／追不到，Inspector 據此決定
  控制項；`patchThemeLinkElement()` 讓「站內／外部」切換直接改寫元件原始碼（含 `to`↔`href`、
  開合標籤、必要時併入既有的 `@tanstack/react-router` import），並在**同一欄位綁到多條連結**或
  **目的地是動態運算式**時拒絕動手而不是猜。

- **修好一個推論漏洞。** `CONTENT_BEARING_ATTRIBUTES` 只看 `src`／`href`，漏了 `to` ——
  `<Link>` 是這些 Theme 最常見的連結形式,卻是欄位推論唯一看不見的一種。已補上。

- **Starter Header／Footer 導覽改為 props 驅動。** 原本 `<a href="/collections/all">Shop</a>`
  這類寫死連結改成 `navItems` / `exploreItems` / `helpItems` array，每列含 `label` 與
  `type: "link"`，店家因此能在 Inspector 增刪選單項目、逐項選站內頁或外部網址。

- **依 `.agents/rules/04-ui-quality-security.md` §19／§19.3 修正 Inspector 樣式。** 本輪先前
  自行拼樣式，違反兩條規則並已修正：欄位名稱混用硬編碼 `text-[10px]` 與 `text-[11px]`
  造成相鄰標籤大小不一（§19.3）；boolean 欄位使用裸 `<input type="checkbox">` 而非 shared
  `Checkbox` primitive（§19）。改為單一 `inspectorFieldLabelClassName` token 與
  `InspectorToggleField`，並加測試鎖住這兩點以免回歸。模式切換移到卡片標題列右側，
  與 Media Image 的 position select 相同位置。

- 驗證：`pnpm typecheck`、`pnpm test`（226 files / 1496 tests passed、1 skipped）、
  `pnpm build`、client bundle check 與 deploy artifact secret guard 全數通過。
  首次跑全套時 5 個案例因平行負載 timeout，單獨與重跑均通過，非實質失敗。
  本輪**未**重跑 Playwright 瀏覽器層。

### 2026-09-01 第二輪：Code Workspace chunk 拆分與 `<Link>` parity 缺口

- **階段 5 由 97% 調為 100%。** `editor-code-workspace` client chunk 由 3.5 MB
  minified（約 515 KB gzip）降為 **268 KB minified（66 KB gzip）**。原因不是 Monaco，
  而是 `editor-code-package-types.generated.ts` 內含 3.3 MB 的 `.d.ts` 字串：檔案同時
  匯出小型 metadata 陣列，被同步引用後整包都進了 workspace chunk。
  產生器改為輸出兩個檔案，宣告內容移到
  `editor-code-package-declarations.generated.ts`，由
  `preloadGeneratedThemePackageDeclarations()` 動態載入成獨立 chunk。
  宣告尚未載入時 `configureThemeTypeScript` 走既有的 synthetic fallback（也就是產生器
  沒跑過時的既定行為），不會出現 "cannot find module"；載入完成後透過 ref 重新套用設定，
  不觸發 re-render——初版用 state 觸發，會在互動中重繪而弄掉開啟中的 context menu，
  已由 `editor-code-workspace.test.tsx` 的 8 個失敗案例證實並改掉。

- **階段 7 由 90% 調為 92%，並修掉一個真實缺陷。** 這正是先前記錄「要等真實第三方主題
  當 fixture 才找得到」的那類問題：把 `workspace-theme-parity` 對真實工作區主題跑起來後，
  `Hero.tsx` 直接被解釋器拒絕——
  **`Component <Link> is not a local Theme Workspace component.`**
  `<Link>` 的 builtin 只掛在 route renderer 上，而 header／footer／hero 這些元件是走
  `renderSafeThemeComponent` 單獨渲染的（`storefront-preview.tsx` 的
  `renderStoredLayoutSlot` 即是此路徑），所以任何在版面元件裡用 `<Link>` 的主題，
  預覽會顯示診斷訊息而不是自己的導覽列。已把 link builtin 抽到
  `safe-theme-router-link.tsx`，並在 component renderer 設為預設 builtin；
  route renderer 仍可覆寫以提供 `Outlet`。新增
  `safe-theme-router-link.test.tsx`（4 個案例，涵蓋 href 內插、router-only props 不外洩、
  `javascript:` 阻擋）讓這個修正進入預設 CI，而不是只被 opt-in 的 parity 測試守住。

- parity 測試本身也補強：兩條路徑都包進真實 router（`<Link>` 沒有 router context 會直接
  throw），並用 `preloadPackages` 讓 loader 與測試共用同一份 ESM 模組實例——否則 loader 走
  CJS，`<Link>` 讀到的是另一個 React context，看不到外層 provider。
  無 `to` 的 `<Link>` 由真實 router 解析成當前位置（`href`、`data-status`、`aria-current`
  與 active class），而這裡的「當前位置」是測試自己的合成 `/` 路由、不是元件真正所在的頁面，
  屬於 harness 產物而非作者 markup，因此在比對前正規化掉；`to` 實際產生的 href 由
  `safe-theme-route-renderer.test.tsx` 直接斷言。工作區主題 13 個元件現已全部逐字相同。

- 驗證：`pnpm typecheck`、`pnpm test`（218 files / 1392 tests passed、1 skipped）、
  `pnpm build`、client bundle check 與 deploy artifact secret guard 全數通過。
  剩餘缺口仍是需要真實 Cloudflare account/service/Zone/domain 的遠端閉環與 Publish E2E。

### 重新配權：階段 7 由 25 降為 12（2026-08-28）

**這次整體完成度從 88% 跳到 93%，是重新配權的結果，不是做了 5% 的工作。**
數字的意義變了，所以放在這裡說清楚，而不是讓它悄悄變好看。

原本給 25 的假設是「解釋器最終一定要被換掉，而且換掉會連帶改寫選取模型、
Inspector 與 section 推導」。這個假設被證據推翻了：新增的一致性測試拿同一份
starter 主題原始碼，一邊走解釋器、一邊用 esbuild 編譯後交給真的 React 渲染，
比對正規化後的 DOM——**九個案例逐字相同**，包含最難的 `Principles`
（跨檔案 import + `map` 內的元件邊界 + `clsx`）。

關鍵前提是主題的依賴是**封閉白名單**（`react`、`clsx`、`lucide-react`、
`tailwind-merge`、`@tanstack/react-router` 等），不是任意 npm。解釋器要追的
不是整個 React 生態，而是一個平台自己控制的小子集。

今天實際遇到的解釋器缺口（`createContext()`、平台 content 模組要當成內建、
`useRouteContext()`）全部落在**框架整合層**，沒有一個落在元件渲染層。所以這個
階段被重新定義為「補齊框架整合層的缺口，並用一致性測試防止回歸」——範圍小很多、
而且有明確邊界。釋出的權重移到階段 3、5、8，因為那三者剩下的都是尚未量測、
尚未覆蓋的真實風險。

### 本次調整的依據（2026-08-26 第二輪）

- 階段 3 由 97% 調為 **98%**：新增 `array` 內容欄位的 Inspector 呈現，含逐列欄位、
  新增／刪除與 `minRows`／`maxRows` 邊界。
- 階段 5 由 97% 調為 **98%**：capability 解析加上以原始碼內容為鍵的快取，Code 模式
  每次輸入不再重新解析每個有宣告的元件。
- 階段 7 由 57% 調為 **60%**：編輯器仍走解釋器，此階段本質未變。但解釋器已能處理
  **完全無標記的元件**、跨檔案的 row 元件與 slot section，與真實 runtime 的語意差距
  明顯縮小，替換時要改寫的面積跟著變小。

## 已完成內容

### 對照真實工作區主題的一致性檢查（2026-08-28）

- 新增 `pnpm test:parity`（腳本：`src/lib/storefront/workspace-theme-parity.test.ts`），
  直接讀取本地測試資料庫（D1 / `DATABASE`）中真實的 starter 主題原始碼，比對解釋器輸出與
  真實 React 渲染的 DOM。
- 測試使用快照比對，在沒有資料庫時會自動 skip，不影響一般 CI；設 `MORPH_THEME_PARITY=1`
  時強制執行。
- 覆蓋首頁全部 12 個主要元件（Hero、Principles、PrincipleCard、Products、ProductCard、
  FeaturedProduct、Story、FAQ、FAQItem、Newsletter、Footer、SocialLinks），全部逐字一致。
- 變異驗證：刻意修改任一元件的 class 會使 5 個以上的測試失敗，確認測試有真實攔截力。
- 模組載入器去重：把 `theme-ast-interpreter.test.ts` 與 `workspace-theme-parity.test.ts`
  重複的 mock loader 收斂為 `src/lib/storefront/ast/test-theme-loader.ts`。

### 對抗性模式測試與五個解釋器缺口（2026-08-28）

- 撰寫 `src/lib/storefront/ast/theme-ast-adversarial-patterns.test.ts`，針對 15 個
  **starter 主題未曾用過但標準 React 常見的語法模式**進行對抗測試：
  1. 解構 default props (`{ variant = 'primary' }`)
  2. Spread props 轉發 (`<button {...rest}>`)
  3. JSX 文字空白保留 (`Hello {' '} world`)
  4. 算術運算子組合（`%`、`**`）
  5. 三元運算子巢狀
  6. 物件方法鏈（`Object.keys().map()`）
  7. 陣列 `filter().map()` 組合
  8. 空字串 falsy 條件渲染
  9. Fragment 簡寫 (`<>...</>`)
  10. 閉包中的 `map` 巢狀
  11. `typeof` 條件分支
  12. 空陣列 `length > 0` 守衛
  13. 多元 `&&` 鏈式條件
  14. 逗號運算子
  15. 巢狀解構 (`{ user: { name } }`)
- **找出並修復 5 個真實解釋器缺口**：
  1. Spread props：AST 的 `JSXSpreadAttribute` 未被處理，導致 `...rest` 靜默遺失。
  2. JSX 文字空白：多行 JSX 之間的空白常被跳過，導致單字連在一起。
  3. 算術運算子 `%`：不在 binary operator 清單內，靜默回傳 `undefined`。
  4. 陣列方法 `filter`：不在方法白名單內被拒絕執行。
  5. 未知運算子改為明確拋錯，而非靜默回傳 `undefined`，避免靜默產生錯誤 DOM。
- 每個缺口皆包含變異驗證：恢復舊行為後，對應測試立即失敗。

### Inspector 版面檢查與測試共用化（2026-08-28）

- 新增 `src/routes/_editor/-components/inspector-panel-bounds.test.tsx`，在 280px、
  320px、360px 三個側欄寬度下渲染真實 Inspector，確認：
  - 各 control group（Design Card、Typography、Fill、Border、Spacing）不超出容器。
  - Color Picker popover 在所有寬度下皆有正確 offset 與 containment。
  - 數值輸入框（Sizing、Spacing、Radius）不會因窄寬度被截斷。
- 抽出 `e2e/helpers.ts` 共用函式（登入、開啟主題、重設選取、等待畫布），消除 4 個 spec
  之間的重複代碼。
- 修正 E2E 中寫死的點擊座標（例如點擊 `(100, 100)` 重設選取在窄視窗會點到側邊欄）問題。

### 互動延遲基準（2026-08-28）

- 撰寫 `e2e/performance.spec.ts`，建立四項核心互動的延遲量測基準與上限：
  1. 畫布選取切換（Canvas Selection）：基準上限 600ms。
  2. 左側樹狀點擊選取（Tree Selection）：基準上限 400ms。
  3. Mode 切換（Design ↔ Code ↔ Preview）：基準上限 800ms。
  4. Inspector 展開／收合：基準上限 300ms。
- 在量測過程中發現並修復一處效能問題：左側樹狀點擊原本需等待畫布 iframe postMessage
  確認後才更新高亮，造成有感延遲；改為點擊當下立即樂觀更新樹狀高亮，延遲由 **933ms 降至 151ms**。
- 靈敏度校準：刻意將上限設為 1000ms 會擦邊通過，調緊至 600ms 才能有效攔截退化。

### 發布迴圈實測（2026-08-28）

- 撰寫 `e2e/publish-lifecycle.spec.ts`，驗證完整的「修改 → 儲存 → 建置 → 發布 → Release 產生
  → Active 指標移動 → Rollback」生命週期：
  1. 修改 Section 文字並確認 D1 draft 寫入。
  2. 觸發 Build 並確認產生新的 immutable artifact。
  3. 執行 Publish 並確認資料庫中的 releases 筆數增加、active release 指標更新。
  4. 驗證 Publish 在「沒有任何新變更」時會正確停用按鈕，避免重複發布。
  5. 驗證 History 面板能讀到最新發布紀錄，且 Rollback 按鈕可用。
- 過程中修正三處測試與介面缺陷：
  - 建置完成後的按鈕文字歧義（Build vs Rebuild）。
  - Publish 在無變更時的 disabled 狀態判斷。
  - History 面板快取導致未即時顯示最新 release 的問題。

### 路由層一致性與三引擎覆蓋（2026-08-28）

- 新增 `src/lib/storefront/compiler/theme-route-consistency.test.ts`，以真實
  TanStack Router 渲染 starter 主題全部路由（`/`、`/about`、`/products`、`/products/$id`），
  比對與解釋器在路由層的行為一致性：
  - `beforeLoad` 注入的 context。
  - `createIsomorphicFn` 的 client/server 判定。
  - `Outlet` 巢狀渲染。
  - 404 / NotFoundComponent。
- Playwright 測試覆蓋全部三個主要引擎（Chromium、Firefox、WebKit），透過 `E2E_BROWSERS`
  環境變數支援本機與 CI 的彈性切換。

### 無障礙（2026-08-28）

- 使用 `@axe-core/playwright` 對 Visual Editor 所有主要面板進行無障礙自動化掃描：
  - 左側側欄（Sections、Pages、Theme、Components）。
  - 右側 Inspector（Design Card、Typography、Fill、Border、Spacing 等各 group）。
  - Top bar（Mode switcher、Viewport switcher、Undo/Redo、Build/Publish）。
- 修復 4 個無障礙缺陷：
  1. 對話框開啟後焦點未正確鎖定在對話框內。
  2. 關閉彈出層後焦點未歸還至觸發按鈕。
  3. 部分顏色選擇器控制項缺少 `aria-label`。
  4. 鍵盤 Tab 順序在某些折疊面板中跳躍。

### 響應式與跨瀏覽器（2026-08-28）

- 撰寫 `e2e/responsive.spec.ts`，在 1024px、1280px、1440px、1920px 四種常見螢幕解析度下
  驗證版面完整性。
- 修復在 1024px 與 1280px 窄螢幕下，Top bar 的「中間 Viewport 切換器」與「右側發布按鈕群」
  可能發生的重疊問題；加入自動化重疊比對斷言。
- 跨瀏覽器測試（Firefox、WebKit）確認所有核心行為與 Chromium 一致。

### Release history 分頁（2026-08-28）

- 實作 History 面板的 release 列表分頁功能，支援多於 10 筆 release 時的載入更多與分頁切換。
- 保留 active release 的明確標記，無論位於哪一頁皆可快速辨識當前線上版本。

### 解釋器與真實 React 的一致性測試（2026-08-28）

- 新增 `src/lib/storefront/ast/theme-ast-real-react-consistency.test.ts`：
  - 拿 starter 主題原始碼，一邊走 `evaluateThemeAst`，一邊以 `esbuild` 在記憶體編譯後交給
    真正的 `react-dom/server` 渲染。
  - 比對兩者產生的正規化 HTML 字串。
  - 覆蓋 9 個真實元件，逐字完全相同。
- 靈敏度驗證：
  - 變異 1：在解釋器輸出多加一個 class → 測試失敗。
  - 變異 2：改動標籤名稱 → 測試失敗。
- 據此進行「重新配權」：階段 7 由 25 降為 12，釋出的權重移至階段 3、5、8。

### 瀏覽器層測試（2026-08-27）

- 建立基於 Playwright 的完整瀏覽器 E2E 測試架構：
  - 獨立目錄 `e2e/`，與 Vitest 單元測試完全分離。
  - 透過未追蹤的本地環境檔讀取認證資訊，無環境時自動跳過，確保 CI 不受阻。
  - 涵蓋登入、工作區導覽、Visual Editor 載入與畫布選取。
- 過程中修正兩次因非預期非同步 timing 造成的「假通過」測試。

### 認證表單的送出方式（2026-08-27）

- 修復登入／註冊表單在 JavaScript hydration 完成前被送出時，瀏覽器預設行為會以 `GET`
  方法把密碼明文附加在 URL query string 的嚴重安全性缺陷。
- 表單明確標記 `method="POST"` 並加入 progressive enhancement 處理。

### Release history 與回滾介面（2026-08-27）

- 接上後端已實作但缺乏 UI 的 release history 與 rollback server functions。
- 提供視覺化的 release 時間軸、發布者資訊、變更摘要與一鍵回滾按鈕。
- 回滾操作使用與發布相同的 CAS / OCC 安全防護，避免併發覆蓋。

### 復原歷史改為逐檔堆疊（2026-08-27）

- 將原本單一全域的 Undo/Redo 歷史改為「逐檔案獨立堆疊」與「全域動作堆疊」並行模型。
- 修復跨檔案編輯（例如同時修改 TSX 與 CSS）時，復原順序混亂或遺漏旁路寫入的問題。

### 畫布與樹狀的互動修正（2026-08-27）

- 修復 LivePreview iframe 高度在動態內容載入時只增不減的量測迴圈。
- 修復在畫布上進行原生拖曳（例如拖曳圖片或文字）時，外層畫布無法正常捲動的問題。
- 修復左側結構樹無法選取「僅有來源位置標記但無獨立 section id」之行內元素的問題。

### 結構樹（2026-08-27）

- 支援在畫布與左側結構樹中直接拖放調整 Section 順序。
- 順序調整直接改寫路由原始碼（TSX AST），不建立額外的外掛式排序資料庫，保持 React 原始碼
  為唯一的 Presentation SSOT。

### Code Mode Explorer 與 VS Code 式檔案操作（2026-08-31 補登）

- [x] Code Mode Explorer 支援新建檔案／資料夾、重新命名、刪除、複製、貼上與拖放移動。
- [x] 複製／貼上與複製（Duplicate）支援檔案、資料夾與整個目錄樹；自動遞增 `copy`／數字尾綴，
      整個資料夾樹的原子計畫，保留空資料夾並拒絕自我複製。
- [x] 刪除檔案不會因為剛好刪掉最後一個檔案而移除作者明確建立的空資料夾；資料夾刪除改為獨立
      的明確確認與 batch operation，且唯讀 `src/routeTree.gen.ts` 不可刪除或修改。
- [x] 檔案／資料夾拖放搬移會同步改寫相對 import、TanStack route literal 與 component reference，
      並以 OCC／atomic batch 寫入；覆蓋、解析失敗、自我／子孫搬移會 fail closed。
- [x] Explorer 鍵盤操作補上 Arrow、Enter、F2、Delete、Ctrl/Cmd+C/V；右鍵操作使用同一套確認與
      錯誤回饋，不再依賴瀏覽器原生 alert。

### 路由與左側樹狀同步（2026-08-31）

- [x] **明確的 source route 現在是左側樹狀與畫布的共同來源**：從 Pages 選取 `/about`、`/product`
      等路由時，編輯器會同步 route context、畫布內容與來源檔案，不再沿用上一個 Home template 的
      sections。
- [x] **直接路由即使沒有 `content(...)` 也不會顯示過期 sections**。當該路由沒有可持久化的 section
      設定，但預覽仍有可編輯 DOM 時，面板會依 source section 分組顯示唯讀 route/DOM tree；這些
      虛擬根節點不會被誤當成可排序、隱藏或刪除的真實 section。
- [x] 路由來源檔案透過既有 template path mapping 導覽，並維持 TanStack route path 與目前頁面一致。
- [x] 保留舊主題／非明確 route 的 document fallback，避免破壞既有相容路徑；只有使用者明確選取
      source route 時才以該 route 的結構取代 fallback。

### 路由預取與無重載切頁（2026-08-31）

- [x] Editor 與 Live Preview loader 會並行 hydrate Theme 詳細資料與完整 source file tree，
      避免首次渲染先顯示 starter template 再切換成目前頁面。
- [x] 依 workspace source revision 建立 route structure cache；切換路由時直接讀取既有結構，
      不再等待預覽回傳後才重建左側樹狀。
- [x] Pages 面板與底部 route navigator 在滑鼠移入／鍵盤聚焦時預熱同一份 Query cache，
      並保留現有 source route registry 作為唯一路由來源。
- [x] iframe key 不再隨目前 route 改變；透過 typed `morph:storefront-preview-set-route` bridge
      在同一個預覽文件內切換，避免黑屏、整頁 loading 與畫布重置。只有明確 Refresh／Build Preview
      才會重新建立 iframe。
- [x] route message 的 `routePath` 支援 `null`，模板模式不會被誤判成首頁 `/`；訊息仍受長度與
      型別驗證保護。

### 復原／重做（2026-08-27）

- [x] **單一歷史堆疊，包含所有可復原操作**：Section 新增／刪除／重新排序、屬性修改、樣式調整、
      Code 模式檔案編輯、全域設定變更皆進入同一個歷史堆疊。
- [x] **快捷鍵支援**：Cmd/Ctrl+Z 復原、Cmd/Ctrl+Shift+Z 或 Cmd/Ctrl+Y 重做。
- [x] **Top bar 視覺按鈕**：顯示目前可復原／可重做狀態（disabled 樣式）與操作說明 tooltip。
- [x] **跨模式一致**：在 Design 模式做的修改，切換到 Code 模式後仍可復原，且 Monaco 編輯器
      會自動同步反映復原後的原始碼。
- [x] **批次操作原子性**：複合操作（如拖放排序同時更新 AST 與樣式）在歷史中視為單一步驟，
      復原時一次回到操作前狀態，不產生中間破碎狀態。

### 內容鏈跨層整合測試（2026-08-26）

- [x] 撰寫整合測試驗證「Inspector 修改 → Live Preview 即時呈現 → D1 draft 持久化 → 頁面重新整理
      → 正確載入修改後內容」完整流程。
- [x] 驗證在網路斷線或 server 回傳錯誤時，Inspector 顯示明確錯誤提示，並保留使用者輸入值
      不被強制重設。
- [x] 驗證併發編輯（Concurrent edit）場景下的 OCC 版本衝突處理：後送出的請求收到版本過期
      錯誤，並提示使用者重新整理。

### 內容契約由元件原始碼決定（2026-08-26）

- [x] 廢棄集中式 `schema.json` 宣告；元件所需內容欄位改由元件自身原始碼中宣告
      （`export const contentFields = [...]`）作為 Single Source of Truth。
- [x] 支援型別包含：`text`、`textarea`、`image`、`link`、`select`、`boolean`、`color`、
      `array`（巢狀陣列）。
- [x] 平台提供靜態分析工具在 Theme 載入時自動提取所有元件的 `contentFields` 並建立能力快取。

### section 由路由推導（2026-08-26）

- [x] 頁面中的 Section 清單不再依賴資料庫中額外儲存的 section list，改由路由元件（`src/routes/**`）
      的 JSX 結構直接推導。
- [x] 新增／刪除 Section 即為在路由 TSX 中新增／刪除對應的 JSX 節點。

### 無標記元件（2026-08-26）

- [x] 支援沒有任何自訂 `data-*` 標記的純淨 React 元件。
- [x] 解釋器透過 Babel AST source mapping 自動為 DOM 節點關聯來源檔案位置（`file:line:column`）。
- [x] Inspector 能根據來源位置正確選取元件並提供對應的樣式與屬性編輯。

### Inspector 架構

- [x] 模組化設計：將龐大的 Inspector 拆分為獨立的 Control Group（Design Card、Sizing、
      Position、Appearance、Spacing、Typography、Fill、Border、Radius）。
- [x] Capability 驅動：根據目前選取節點的能力（如是否支援文字編輯、是否為容器等）動態顯示
      對應的控制群組。

### 數值與輸入行為

- [x] 支援像素（`px`）、百分比（`%`）、`rem`、`em`、`auto` 等單位切換。
- [x] 拖曳調整數值（Scrubber）：在數值標籤上按住並左右拖曳可平滑增減數值。
- [x] 鍵盤上下鍵微調（上下鍵 ±1，Shift+上下鍵 ±10）。
- [x] Draft / Commit 語意：輸入過程中即時更新 Live Preview，失焦（blur）或 Enter 時才提交
      持久化寫入。

### 顏色、背景、Border 與 Radius

- [x] 視覺化 Color Picker：支援 HEX、RGBA、HSL 與漸層顏色選取。
- [x] 獨立四邊 Border 控制（Top、Right、Bottom、Left 的寬度、顏色、樣式）。
- [x] 獨立四角 Radius 控制（Top-Left、Top-Right、Bottom-Right、Bottom-Left）。
- [x] 樣式變更直接產生 Tailwind class 或 instance-scoped CSS。

### Preview 與效能

- [x] 命令式選取框（Overlay）：選取框與 hover 提示不進入 React render tree，由直接 DOM
      操作驅動，確保 60fps 順暢度。
- [x] Canvas 平移與縮放（Pan & Zoom）：支援空白鍵+拖曳平移、Ctrl/Cmd+滾輪縮放。
- [x] 節流與防抖（Throttle & Debounce）：高頻操作（如顏色拖曳、數值 scrub）在 idle 後才送出
      寫入請求。

### Code-authored 元件與內容 round-trip

- [x] 在 Code Mode 修改 TSX 程式碼後，Live Preview 即時熱更新。
- [x] 在 Design Mode 透過 Inspector 修改的文字與樣式，精確回寫至 TSX 原始碼對應位置。
- [x] AST 解析保留原有程式碼排版與註解（Format-preserving AST transform）。

### Customer Theme TanStack Start authoring 與 build contract

- [x] 符合標準 TanStack Start 專案結構（`src/routes/`、`src/components/`、`app.config.ts` 等）。
- [x] Build materializer 驗證 Start package/router 合約並拒絕 customer-authored `routeTree.gen.ts`、Vite／Wrangler 等平台 build 檔案。
- [x] R2 canonical manifest 保存 Worker entry、client assets directory 與 Editor preview entry；缺少任何 runtime artifact 都會在上傳前 fail closed。
- [x] Visual Editor 左側 Pages 可讀取目前 workspace 的 code-authored routes，點擊後開啟對應 Code source；Monaco 已提供受管理的 TanStack Router declaration。
- [x] Code Mode Explorer 顯示唯讀虛擬 `src/routeTree.gen.ts`，由同一份 bounded route registry 產生 literal path/type 補全；不寫回 Theme Workspace。
- [x] `Link to`、`createFileRoute` 與相關 route literal 會從目前 `src/routes/**` registry 提供路徑提示；路由 tree projection 與真正 build 產物共用同一份 registry，不再依賴手寫路徑清單。
- [x] 新增 route 後只有通過 route diagnostics、Preview 與 immutable build 才算可執行；editor projection 不會冒充正式 generated artifact。
- [x] Code Mode、Local Vite 與 Cloudflare Sandbox 共用 TanStack Start import protection：檢查 reachable `.server`／`.client` graph、marker 與 Start server/client specifier，保留 compiler-recognized boundary 的安全例外。
- [x] `tsconfig.json`／`jsconfig.json` 的 `baseUrl`、`paths` 由受限 resolver 同步給 Monaco、Vite 與 import graph；支援 JSONC、wildcard／exact alias 與 baseUrl bare import，越界設定會在建置前拒絕。
- [x] Starter bootstrap 支援 preview/apply plan、版本閘門、source generation/OCC 與 authored file 保留；套用成功不等同 Publish。
- [x] `cms.config.ts` 提供平台核准套件與精確版本，dependency request 經 CMS admin capability 後進入 queued／building／ready／failed 狀態。
- [x] Code Mode 已提供 customer-facing dependency catalog／request UI；只顯示 `cms.config.ts` 的平台核准套件，並以最新成功 Build Preview 的 source revision 作為請求閘門。套件請求會顯示 queued／building／ready／failed 狀態，建置完成前不會標示為可用。
- [x] Visual Editor 模式切換版面穩定化：各模式面板（Design / Code / Preview / Theme / Content / History / Settings）改以 `opacity`、`pointer-events` 與 `z-index` 保持 DOM 掛載與尺寸穩定，消除過去使用 `display: none` 導致之 iframe resize／重新量測造成的 preview layout shift。
- [x] Starter Theme 乾淨 React/TSX 化：移除 starter 元件中平台特有的自訂 data attributes，確保原始碼為標準 React / Tailwind 程式碼，由 AST transformer 與 Preview protocol 提供雙向編輯與定位支援。
- [x] TanStack Router 預覽安全渲染與 Context Menu：支援預覽內 Link 導覽安全攔截與樣式選單自訂化。
- [x] Code Search、全域指令中心（Command Center）與完整檔案操作生命週期（建立、重新命名、刪除、複製、移動）。
- [x] 既有無 router metadata 的 Theme 保留 legacy component build 相容路徑。

## 尚未完成／需持續確認

### 最高優先：Theme-level 內容欄位 capability

- [x] 元件可在同一 source file 以 `export const contentFields` 宣告 bounded schema，包含欄位 key、type、label、限制與有限選項。
- [x] Resolver 會掃描所有 Theme source；source-colocated declaration 優先，`morph.theme.json` 的 `contentFields` 僅作為舊元件 compatibility fallback。
- [x] 保留 server-side allowlist、型別／長度／安全 URL 驗證、ownership、source generation 與 OCC；未知 `componentRef` 或未宣告欄位 fail closed。
- [x] 明確維持「程式碼 default 不會自動寫入 D1；使用者首次 Design 修改才建立 Document override」語意。
- [ ] 補齊自訂 `Promo` vertical slice：source component → selection → Inspector → Live Preview → D1 draft → reload → Publish。

### 後續：真實 Theme Source Live Runtime

- [x] 產生真正 TanStack Start Cloudflare Worker runtime build；Editor 預覽仍刻意使用隔離的 client adapter，兩者同時寫入同一 immutable artifact。
- [ ] 串接 production Theme Worker service binding／deployment plane，讓 custom domain 依 active release 執行 immutable Worker；未完成前不得把 build artifact 說成已上線 runtime。
- [ ] 讓 Page Registry 組合 Theme build route manifest 與有權限的 D1 Page records，並支援 route navigation、空白頁建立與 Design 編輯。
- [ ] 在隔離 iframe 中執行目前 theme 的真實 TSX/component tree。
- [ ] 定義安全的模組載入、允許清單與 runtime 邊界。
- [ ] 讓 Inspector draft 覆寫套用到真實元件，而非固定 Storefront 相容 renderer。
- [ ] Runtime 編譯或渲染失敗時保留上一個可用畫面，並提供明確錯誤狀態。
- [ ] 確保 draft-first，只有明確 Publish 才能更新公開內容。

### 效能與互動驗證

- [ ] 使用瀏覽器 Performance trace 驗證選取不同元件時的延遲來源。
- [ ] 建立選取切換、拖曳數值、Color Picker、Code 輸入的可量測基準。
- [ ] 確認大型 theme、深層 DOM 與大量 Inspector capability 時仍無明顯卡頓。
- [ ] 檢查所有高頻操作都沒有在 pointer move/key stroke 期間送出持久更新。
  - 2026-09-04：**已發現並修復一例**——左右面板拖曳在每個 `pointermove` 都 `setState`，
    使整個 shell 每幀重繪並拖垮預覽 iframe（見第十一輪）。其餘高頻操作尚未逐一稽核，
    因此本項維持未完成。

### 最終 UI／E2E 驗收

- [ ] 桌面、平板、手機 viewport 的 Inspector 排版與浮層定位。
- [ ] Color Picker 在視窗四角、側欄捲動及縮放後的定位。
- [ ] Keyboard、focus、Escape、Enter 與 screen reader 行為。
- [ ] 長文字、極端數值、不同 CSS 單位與無效輸入。
- [ ] 建立從選取元件到 Publish 前的完整 E2E 測試。

### Source revision storage 收斂

- [x] 新 revision 將完整 source bytes 寫入 R2 content-addressed blobs，D1 revision 只寫入 source manifest 與空的 legacy snapshot 欄位；materializer 會驗證 digest、大小與 UTF-8。
- [x] 加入 `drizzle/0052_theme_source_manifest.sql`；正式 D1 尚未套用 remote migration，需在授權的部署窗口執行。
- [ ] D1 僅保留 revision metadata、manifest、generation、actor 與時間；既有 compatibility path 必須有明確遷移與 sunset。

## 驗證基準

最近一次完整驗證結果（2026-09-04，於 WSL checkout 針對 `9d88bd5` 實際執行）：

| 檢查             | 結果    | 備註                                            |
| ---------------- | ------- | ----------------------------------------------- |
| `pnpm typecheck` | ✅ 通過 | 0 個 TypeScript 錯誤                                     |
| `pnpm typecheck:data` | ✅ 通過 | 資料層在 `noUncheckedIndexedAccess` 下無違規；閘門已以注入違規驗證確實會擋 |
| `pnpm test`      | ✅ 通過 | 244 個測試檔通過、1 個 skipped；1682 個 tests 通過、1 個 skipped |
| `pnpm build`     | ✅ 通過 | 正式建置、server-only、client bundle（331 檔）與 deploy artifact secret guard 檢查通過 |
| `git diff --check` | ✅ 通過 | 工作樹差異沒有 whitespace error                         |

已知非阻擋警告：

- 部分 bundle chunk size 警告仍存在，後續效能階段處理。
- 本次未重跑 Playwright；未執行遠端 D1 migration、Cloudflare production deploy 或 Publish。

## 下一階段建議

### Stage A — Theme-level content capability contract

- [x] 定義並驗證 source-colocated `export const contentFields` 的 bounded schema。
- [x] 讓 server-side content filtering 從 source declaration 解析，並保留 `morph.theme.json` 的 legacy compatibility fallback。
- [x] 完成自訂文字欄位的 Preview、commit、D1 draft 與 reload focused tests。
- [x] 驗證未知欄位、錯誤型別、超長內容、不安全 URL 與 select 值都會 fail closed，並以既有 ownership／OCC 加上 source-generation guard 保護寫入。
- [ ] 補齊自訂內容欄位與 immutable source revision 綁定的 Publish E2E。

### Stage B — True Live Runtime 設計與最小垂直切片

- [ ] 先完成一個真實 section 的 TSX runtime 渲染。
- [ ] Inspector 修改可以即時套用，但不寫入 source/public content。
- [ ] 編譯失敗能回復上一個成功版本。
- [ ] 完成 focused tests 與安全邊界 review。

### Stage C — Runtime 擴展與完整 Inspector 對接

- [ ] 擴展至文字、圖片、容器與 nested component。
- [ ] 對接目前 capability registry 與所有基本樣式控制。
- [ ] 完成選取、重新載入、切換 section 與 stale response 回歸。

### Stage D — 發布前品質門檻

- [ ] 完成 browser trace、E2E、無障礙與跨 viewport 驗收。
- [ ] 執行完整 `pnpm typecheck`、`pnpm test`、`pnpm build`。
- [ ] 確認 Publish 是唯一可更新公開內容的路徑。

## 更新規則

每完成一個階段時：

1. 更新「最後更新」、「整體完成度」與進度條。
2. 更新階段表的狀態、百分比與下一個確認點。
3. 只有實際完成且有相應驗證的項目才能標成 ✅。
4. 在下方新增一筆更新紀錄，寫明實作範圍與實際執行的檢查。
5. 保留既有未提交修改，不使用 reset 或覆蓋使用者變更。
6. 一般程式碼階段結束前，必須實際執行 `pnpm typecheck`、`pnpm test`、`pnpm build`。

## 更新紀錄

| 日期       | 階段／內容                                                                                                                                                                                                                                                                                                                                                                                                                                             | 驗證                                                                                                                                                                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-09-04 | 資料層規則對齊、登入回跳與面板拖曳效能（第十一輪）：168 個會拋錯的 serverFn validator 全面改用 `parseInput`（推翻 2026-09-03「其餘 137 個維持原狀」的取捨）；theme revision 加分頁並新增 `findRevisionByNumber`，讓 rollback 不再為找一筆而載入全部 snapshot；新增 `mapFirstOrNull`；429 行內容政策搬離 theme DAL；新增 `pnpm typecheck:data` 以範圍化方式強制 §14.1；登入後回到中斷路徑並修補 `callbackURL` 的 open redirect；面板拖曳改以 CSS 變數 + rAF，拖曳期間 re-render 由每幀一次降為 0；Content 獨立成分頁 | `pnpm typecheck`（0 錯誤）、`pnpm typecheck:data`、`pnpm test`（244 files / 1682 tests passed、各 1 skipped）、`pnpm build`、client bundle check（331 檔）、deploy artifact secret guard、`git diff --check` 通過；open redirect 防護與「拖曳不 re-render」皆以 mutation test 驗證；**未執行**瀏覽器 E2E、遠端 Publish／deploy／migration，登入流程與拖曳手感需人工確認 |
| 2026-09-02 | Code → Design 切換加入未儲存 Code 變更提示：可選擇儲存並切換、保留 draft 後切換或取消；Save & switch 透過 Code Workspace imperative handle 實際保存全部 dirty files，失敗／conflict 時 fail closed；新增 Monaco draft Save All 測試 | `pnpm typecheck`、`pnpm test`（230 files / 1544 tests passed / 1 skipped）、`pnpm build`、client bundle check、deploy artifact secret guard、`git diff --check` 通過；未執行瀏覽器 E2E、遠端 Publish／deploy／migration |
| 2026-09-02 | 依目前 repository 實作重新盤點並校正進度：核對 Theme Workspace → R2 source manifest → Build Queue／Sandbox → immutable artifact → Release／activeRelease CAS → hostname／Theme Runtime；保留已完成的 Editor、Build、Release 與 OCC 功能，不再把尚未接通的 production Theme Worker、custom domain、Page Registry、真實 TSX iframe、remote migration 與 Publish E2E 計入已完成；整體完成度由 97% 調整為 90% | `pnpm typecheck`、`pnpm test`（230 files passed / 1 skipped；1543 tests passed / 1 skipped）、`pnpm build`、client bundle check、deploy artifact secret guard、`git diff --check` 通過；未執行瀏覽器 E2E、遠端 Publish／deploy／migration；保留既有未提交的 `visual-editor-shell.tsx` 修改 |
| 2026-09-01 | 第二輪修正：Code Workspace 改以真實 cold click 量測並壓縮 Monaco declaration payload；immutable source revision 接上 R2 content-addressed blobs、D1 manifest、digest／size／UTF-8 fail-closed 與 legacy snapshot fallback；OTP sign-in／email-verification 改走 email adapter 並移除收件者 PII log；Tailwind 排除測試來源並加入 deploy artifact secret guard | `pnpm typecheck`、`pnpm test`（217 files / 1388 tests，1 skipped）、`pnpm build`、client bundle check、deploy artifact secret guard、R2 blob focused tests、email focused tests、`git diff --check` 通過；未執行遠端 Publish／deploy |
| 2026-09-01 | 修正 Inspector 來源重複解析造成的兩項測試逾時；Code 模式改為意圖式預載並 hidden/inert 預掛載 Monaco；同步修正 Release history E2E 的 accessible-name 契約，重跑 Chromium、Firefox、WebKit，並核對 production Theme Worker／service binding／domain／rollback 本機程式鏈 | `pnpm typecheck`、`pnpm test`（215 files / 1380 tests，1 skipped）、`pnpm build`、client bundle check、Chromium E2E（23 passed / 1 skipped）、Firefox + WebKit E2E（39 passed / 8 skipped）、`git diff --check` 通過；未執行遠端 Publish／deploy |
| 2026-08-31 | 完成 Visual Editor Shell 模式切換防抖動、Starter Clean TSX 標準化與 Preview Protocol 強化：面板切換改以 opacity / z-index 消除 preview layout shift；移除 starter 自訂 data attribute 回歸標準 React；支援 safe TanStack Router link 預覽導覽、Context Menu 自訂化與 AST transform / E2E 測試補強 | `pnpm typecheck`、`pnpm test`（215 files / 1376 tests，1 skipped）、`pnpm build`、client bundle check、`git diff --check` 通過 |
| 2026-08-31 | 完成主題相依套件管理（Dependency Manager）、建置佇列處理（Build Queue）與 Editor 依賴追蹤介面；整合 Code Search 全域指令中心（Command Center）與完整檔案管理生命週期 | `pnpm typecheck`、`pnpm test`、`pnpm build` 通過 |
| 2026-08-31 | 完成路由預取與無重載切頁：Editor／Preview 並行 hydrate，source route structure cache，Pages／底部路徑選單 hover／focus 預熱；保留單一 iframe 並以 typed route bridge 切換，避免畫布 loading、黑屏與樹狀短暫顯示舊頁                                                                                                                                                                                                                                    | `pnpm typecheck`、`pnpm test`（215 files / 1376 tests，1 skipped）、`pnpm build`、client bundle check、`git diff --check` 通過                                                                                                                                                                                                 |
| 2026-08-31 | 修正 Design 模式左側樹狀結構與目前 source-authored route 不同步：明確 route 不再退回 Home sections；無 `content(...)` 的直接路由顯示唯讀 route/DOM tree；Pages 選取同步畫布、route context 與來源檔案                                                                                                                                                                                                                                                  | `pnpm typecheck`、`pnpm test`（215 files / 1376 tests，1 skipped）、`pnpm build`、client bundle check、`git diff --check` 通過                                                                                                                                                                                                 |
| 2026-08-31 | 補登此前已完成但原先只散落在測試與 ROADMAP 的 Code Mode Explorer 操作、空白／預設內容保留、Live Preview 雙擊編輯、DOM／section 刪除，以及 `Link to` 路徑提示；確認這些項目已納入目前的功能清單                                                                                                                                                                                                                                                         | `editor-code-workspace.test.tsx`、`theme-file-move.test.ts`、`theme-file-copy.test.ts`、`editor-sections-panel.test.tsx`、`selection-content-value.test.ts`、`preview-empty-text-layout.test.ts`、`inline-text-edit.test.ts`、`editor-code-language-support.test.ts` 均包含於 `pnpm test`（215 files / 1376 tests，1 skipped） |
| 2026-08-30 | Code Mode 加入唯讀虛擬 `src/routeTree.gen.ts`，由 bounded route registry 提供 TanStack path/type 補全；同步確認正式 route tree 只由 build toolchain 產生，並整理 Starter bootstrap 與 platform-owned dependency queue contract                                                                                                                                                                                                                         | `editor-code-language-support.test.ts`（16 tests）、`pnpm typecheck`、`pnpm test`（212 files / 1322 tests，1 skipped）、`pnpm build` 通過                                                                                                                                                                                      |
| 2026-08-28 | 新增 `pnpm test:parity`：直接對照工作區資料庫裡的真實主題跑解釋器與真實 React 的比對（快照讀取、預設略過）；並把重複的模組載入器收斂為共用測試工具                                                                                                                                                                                                                                                                                                     | `pnpm test`（198 files / 1211 tests，1 skipped）、`MORPH_THEME_PARITY=1` 下 12 個元件全部一致；變異驗證：改掉任一個 class 會使 5 個測試失敗                                                                                                                                                                                    |
| 2026-08-28 | 對抗性模式測試（15 個 starter 未用過的 React 模式），找出並修好五個解釋器缺口：`{...rest}` 轉發、JSX 文字空白、`%` 運算子靜默回傳 undefined、`filter`／字串方法被拒；未知運算子改為明確拋錯                                                                                                                                                                                                                                                            | `pnpm test`（198 files / 1211 tests）、`pnpm test:e2e`（21 passed）通過；三個修正各自以變異驗證確認測試會失敗                                                                                                                                                                                                                  |
| 2026-08-28 | Inspector 面板邊界檢查（三個寬度）；抽出 `e2e/helpers.ts` 並修正各 spec 寫死的畫布重設座標在窄視窗會點到側邊欄；延遲量測限定 Chromium                                                                                                                                                                                                                                                                                                                  | `pnpm test`（197 files / 1196 tests）、`E2E_BROWSERS=firefox,webkit pnpm test:e2e` 通過                                                                                                                                                                                                                                        |
| 2026-08-28 | 建立互動延遲基準（畫布選取、樹狀選取、模式切換），量測過程發現樹狀點擊需等畫布確認而慢一倍，改為樂觀顯示後 933ms → 151ms                                                                                                                                                                                                                                                                                                                               | `pnpm test`（197 files / 1196 tests）、`pnpm test:e2e`（18 passed）通過；上限經變異驗證校準（1000ms 擦邊通過，改為 600ms 後可攔下）                                                                                                                                                                                            |
| 2026-08-28 | 發布迴圈實測通過（編譯 → 發布 → release → 指標移動），並修正測試三處：建置成功後的同名按鈕、Publish 在無變更時正確停用、History 面板的快取讀取                                                                                                                                                                                                                                                                                                         | `E2E_ALLOW_PUBLISH=1 pnpm test:e2e` 通過；資料庫前後對照確認 release 由 3 筆增為 7 筆、active 指向最新、路由 section 順序不變                                                                                                                                                                                                  |
| 2026-08-28 | 路由層一致性：以真實 TanStack Router 渲染 starter 主題首頁並與解釋器逐字比對（含 `beforeLoad`、`createIsomorphicFn`、React context、`Outlet`）；WebKit 安裝後三個引擎全數通過                                                                                                                                                                                                                                                                          | `pnpm typecheck`、`pnpm test`（197 files / 1195 tests）、`E2E_BROWSERS=firefox,webkit pnpm test:e2e`（43 passed）通過；變異驗證：`Outlet` 渲染成空或多加一個屬性都會使一致性測試失敗                                                                                                                                           |
| 2026-08-28 | 無障礙（axe 掃描 + 對話框狀態 + 鍵盤場景，修好四個缺陷含焦點未歸還）；響應式（修好 1024/1280 的 header 重疊，加上重疊比對測試）；跨瀏覽器（Firefox 全過，以 `E2E_BROWSERS` 開關）；release history 分頁                                                                                                                                                                                                                                                | `pnpm typecheck`、`pnpm test`（197 files / 1194 tests）、`E2E_BROWSERS=firefox pnpm test:e2e`（29 passed）通過；每項修正皆以變異驗證確認測試會失敗                                                                                                                                                                             |
| 2026-08-28 | 新增解釋器與真實 React 的一致性測試（esbuild 記憶體編譯、依賴白名單照建置規則解析、九個案例逐字相同、靈敏度以兩次變異驗證）；據此重新配權：階段 7 由 25 降為 12 並重新定義為「補齊框架整合層缺口」，釋出的權重移到階段 3、5、8                                                                                                                                                                                                                         | `pnpm typecheck`、`pnpm test`（197 files / 1192 tests）通過；變異驗證：改動解釋器輸出的 class 或標籤都會使一致性測試失敗                                                                                                                                                                                                       |
| 2026-08-27 | 建立瀏覽器層測試（Playwright，與單元測試分離、憑證走未追蹤的環境檔、無憑證時自行 skip），三個場景皆經變異驗證，過程中修正兩次假通過；並修復認證表單在 hydration 前送出會以 GET 把密碼寫進網址的缺陷                                                                                                                                                                                                                                                    | `pnpm typecheck`、`pnpm test`（196 files / 1183 tests）、`pnpm test:e2e`（4 passed）、`pnpm build` 通過；拿掉被守護的比對分支後 E2E 確實失敗                                                                                                                                                                                   |
| 2026-08-27 | 接上 release history 與回滾介面（原本兩個 server function 沒有任何呼叫端，回滾需改資料庫）；復原歷史改為逐檔堆疊並補上兩個未記錄的寫入旁路；修正 LivePreview 高度只增不減的量測回圈、原生拖曳期間無法捲動畫布、樹狀無法選取只有來源位置的元素；section 可在畫布上互換，改寫路由檔而不新增寫入路徑                                                                                                                                                      | `pnpm typecheck`、`pnpm test`（196 files / 1183 tests）、`pnpm build` 通過；新增測試皆以變異驗證確認會攔下缺陷；畫布拖曳、預覽高度、樹狀選取由使用者在瀏覽器實測確認                                                                                                                                                           |
| 2026-08-26 | 打通零標記元件的完整編輯鏈路：解釋器輸出 source position、元件根部即 section 邊界、AST 以 `line:column` 定位、Inspector 鎖定判斷與即時樣式預覽統一改用共用的 `element-target` 解析；修復重繪後選取框消失與 padding 值閃跳（inline 預覽跨重繪存活）。建立 `content("slot")` 契約：解釋器支援、Document section id 即 slot id、starter 升級至版本 11 並植入平台 content 模組                                                                             | `pnpm typecheck`、`pnpm test`（1019 tests）、`pnpm build` 通過；並以真實 workspace 實測渲染與選取收集                                                                                                                                                                                                                          |
| 2026-08-26 | 完成 production runtime 與部署平面：hostname → active release → artifact 的 fail-closed 解析、preview／production 共用 serving core、`ThemeRuntime` 傳輸抽象（service binding／local／dispatch／unavailable）、Sandbox wrangler 部署與憑證隔離、CAS 先佔位後部署的啟用順序、Publish 與 rollback 共用部署核心；並完成零標記元素識別：解釋器產生 source position、元件根部即 section 邊界、收集／點擊／還原三段統一，Inspector 不再要求 Document section | `pnpm typecheck`、`pnpm test`（978 tests）、`pnpm build` 通過；並以真實 workspace 實測 Live 預覽渲染與選取收集                                                                                                                                                                                                                 |
| 2026-08-25 | 完成 Customer Theme TanStack Start build contract：加入固定 package/toolchain、Starter v5 OCC additive upgrade、真正 Cloudflare multi-environment Worker build、platform-owned generated/config path、Worker/client/preview artifact contract 與 R2 manifest fail-closed 驗證；production Worker dispatch 與 D1 Page Registry 組合仍明確列為後續                                                                                                       | `pnpm typecheck`、`pnpm test`（162 files / 793 tests）、`pnpm build`、`git diff --check` 通過                                                                                                                                                                                                                                  |
| 2026-08-25 | 完成 Theme-level `contentFields` capability：共用 bounded manifest parser、Inspector 自訂欄位與 code default、server-authoritative D1 Workspace 驗證、safe URL／型別／長度／select 限制、source-generation + draft OCC guard、partial edit 資料保留及內建 manifest 相容 adapter                                                                                                                                                                        | `pnpm typecheck`、`pnpm test`（159 files / 766 tests）、`pnpm build`、`git diff --check` 通過                                                                                                                                                                                                                                  |
| 2026-08-25 | 完成 code-authored primitive 文字內容 round-trip：Preview protocol 傳遞 bounded `contentValue`、Inspector 顯示目前文字、已登記 component 可即時預覽並透過 debounce／OCC 寫入 D1 draft；確認下一個缺口為 Theme-level `contentFields` capability，而非自動把程式碼 default 寫入資料庫                                                                                                                                                                    | `pnpm typecheck`、`pnpm test`（158 files / 758 tests）、`pnpm build`、`git diff --check` 通過                                                                                                                                                                                                                                  |
| 2026-08-23 | 修復 Code Mode 相對 import 與 clsx 的假錯誤：每個 Theme 使用隔離 URI workspace 並預載全部來源 model，加入受管理的 dependency declaration 與 scoped cleanup，保留真正 TypeScript 診斷                                                                                                                                                                                                                                                                   | pnpm typecheck、pnpm test、pnpm build 通過                                                                                                                                                                                                                                                                                     |
| 2026-08-23 | 將重複陣列樣式收斂為穩定 item id 與元件內 `morphInstanceClasses` 靜態 class map；首次確認樣式修改會補 id，Preview parser／renderer 可解析套用，排序後樣式仍跟隨原 item，舊 CSS／巨大 selector 僅作遷移輸入                                                                                                                                                                                                                                             | `pnpm typecheck`、`pnpm test`（148 files / 673 tests）、`pnpm build` 通過                                                                                                                                                                                                                                                      |
| 2026-08-22 | 將重複陣列 instance 樣式改為直接寫回元件 TSX 的 `cn()` 靜態 Tailwind arbitrary variant；停止新增 global/獨立 CSS 規則，舊 CSS 在再次編輯時遷移並清除空 import，Code Mode 回到元件來源                                                                                                                                                                                                                                                                  | `pnpm typecheck`、`pnpm test`（148 files / 669 tests）、`pnpm build` 通過                                                                                                                                                                                                                                                      |
| 2026-08-22 | 將陣列 instance 樣式移至元件旁的 `.morph.css`，首次建立即納入 Live Preview 與 OCC 儲存；`global.css` 僅保留 import，Code Mode 可定位 marker，並支援舊規則逐筆遷移                                                                                                                                                                                                                                                                                      | `pnpm typecheck`、`pnpm test`（148 files / 667 tests）、`pnpm build` 通過                                                                                                                                                                                                                                                      |
| 2026-08-22 | 加入 Live Preview 拖曳縮圖、完整合法交換位置提示與目前落點狀態；所有回饋沿用命令式 overlay，不在 dragover 熱路徑觸發 React render                                                                                                                                                                                                                                                                                                                      | `pnpm typecheck`、`pnpm test`（148 files / 665 tests）、`pnpm build` 通過                                                                                                                                                                                                                                                      |
| 2026-08-22 | 將 Live Preview 排序入口收斂到 selection label 的專用 Grip；取消整張選取元件的 draggable 行為，並補齊 grab / grabbing 狀態與可排序時才顯示的規則                                                                                                                                                                                                                                                                                                       | `pnpm typecheck`、`pnpm test`（148 files / 665 tests）、`pnpm build` 通過                                                                                                                                                                                                                                                      |
| 2026-08-22 | 修復 Principle Card 無法互換：Preview 以 `items.<index>` 識別重複 item，同陣列 drop 後只提交一次 Section props draft；加入安全路徑解析、immutable swap、typed protocol 與失敗選取回滾                                                                                                                                                                                                                                                                  | `pnpm typecheck`、`pnpm test`（148 files / 665 tests）、`pnpm build` 通過                                                                                                                                                                                                                                                      |
| 2026-08-22 | 修復重複陣列 item 樣式互相污染：以 Section id + 完整 field path 建立 instance-scoped Theme CSS，並修正 Preview 重綁、Live draft 與 Inspector identity 的 repeated-node 定位                                                                                                                                                                                                                                                                            | `pnpm typecheck`、`pnpm test`（147 files / 660 tests）、`pnpm build` 通過                                                                                                                                                                                                                                                      |
| 2026-08-22 | 完成 Live Preview 畫布互動第二階段效能修復：wheel、抓取平移與縮放統一由 ref、單一 rAF 與 CSS variables 驅動，移除每幀 React state 更新，並加入 Canvas containment 與 idle 狀態提交                                                                                                                                                                                                                                                                     | `pnpm typecheck`、`pnpm test`（146 files / 654 tests）、`pnpm build` 通過                                                                                                                                                                                                                                                      |
| 2026-08-22 | 修復 Live Preview 捲動低幀率：wheel 熱路徑脫離整棵 Editor React render、每幀合併 Canvas DOM transform、idle 後提交最終狀態，overlay scroll/resize 量測同步節流；同步補入效能規則                                                                                                                                                                                                                                                                       | `pnpm typecheck`、`pnpm test`（146 files / 654 tests）、`pnpm build` 通過                                                                                                                                                                                                                                                      |
| 2026-08-22 | 新增 Live Preview 安全 sibling 拖放交換、AST source swap、typed protocol、一次性 draft 儲存、失敗回復與選取維持；同步補入 Visual Editor 規則                                                                                                                                                                                                                                                                                                           | `pnpm typecheck`、`pnpm test`（146 files / 654 tests）、`pnpm build` 通過                                                                                                                                                                                                                                                      |
| 2026-08-22 | 修復 Code Workspace 合法 TSX 的錯誤診斷；新增限定於靜態 `className`／`class` 字串的 Tailwind CSS class 補全與 provider 清理                                                                                                                                                                                                                                                                                                                            | `pnpm typecheck`、`pnpm test`（146 files / 650 tests）、`pnpm build` 通過                                                                                                                                                                                                                                                      |
| 2026-08-22 | 完成 Styles Inspector idle 預渲染、保留掛載與穩定 callback，降低第一次從 Agent 切換 Styles 的同步工作量                                                                                                                                                                                                                                                                                                                                                | `pnpm typecheck`、`pnpm test`（145 files / 644 tests）、`pnpm build` 通過                                                                                                                                                                                                                                                      |
| 2026-08-22 | 完成 Live Preview 選取來源感知的 Code 模式導覽；支援 Section、同檔 DOM、獨立子元件來源與安全 fallback                                                                                                                                                                                                                                                                                                                                                  | `pnpm typecheck`、`pnpm test`（144 files / 642 tests）、`pnpm build` 通過                                                                                                                                                                                                                                                      |
| 2026-08-22 | 建立進度基準；整理 Inspector 架構、同步穩定性、控制項、Color Picker、Border/Radius、Preview protocol 與效能改善現況                                                                                                                                                                                                                                                                                                                                    | `pnpm typecheck`、`pnpm test`（143 files / 638 tests）、`pnpm build` 通過                                                                                                                                                                                                                                                      |
