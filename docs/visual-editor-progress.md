# Visual Editor 開發進度表

> 本文件是 Visual Editor 的持續進度基準。每完成一個階段，請更新同一份文件，不另建重複版本。

## 目前概況

| 項目         | 內容                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------ |
| 最後更新     | 2026-08-27                                                                                       |
| 目前狀態     | 開發中                                                                                           |
| 整體完成度   | **85%**（加權，權重表見下）                                                                                  |
| 目前重點     | 復原／重做已覆蓋全部八條寫入路徑；下一步是 release history UI 與真實瀏覽器 E2E                        |
| 最近完整驗證 | `pnpm typecheck`、`pnpm test`（193 files / 1161 tests）、`pnpm build` 均通過；另有 production 內容路徑、Ctrl+Z 與結構樹的手動驗證 |

`████████ 85%`

> 完成度依下方權重表計算，可自行複核。權重反映各階段的規模與剩餘風險，不是平均分配 ——
> 把「Inspector 數值輸入一致性」與「真實 Theme Runtime」等重看待，是先前數字偏高的主因。
>
> **這個數字只衡量下表列出的階段。** 先前列在此處的三項產品缺口——「內容值通到 production」
> 「排序改走 source」「純程式碼元件的 content slot」——都已閉環，改由 ROADMAP 記錄為已具備。
> 仍未涵蓋的是 release history UI、content-only publish 與瀏覽器層 E2E，因此 84% 不代表
> Visual Editor 接近可交付。

### 狀態標記

- ✅ 已完成並有自動化驗證
- 🟢 已實作，仍需持續回歸確認
- 🟡 部分完成或尚有明確後續工作
- ⬜ 尚未開始

## 階段進度

| 階段                              | 範圍                                                                                          | 狀態 | 完成度 | 下一個確認點                                 |
| --------------------------------- | --------------------------------------------------------------------------------------------- | ---- | -----: | -------------------------------------------- |
| 1. Inspector 資料一致性           | 數值回朔、舊回應覆蓋新值、選取切換競態                                                        | ✅   |   100% | 維持 stale-response 回歸測試                 |
| 2. 即時預覽與提交語意             | 操作中只更新 Live View，完成輸入後才真正提交資料                                              | ✅   |   100% | 新控制項必須沿用同一套 draft/commit 規則     |
| 3. Inspector 模組化與基本樣式     | capability 判定、Design Card、Sizing、Position、Appearance、Spacing、Typography、Fill、Border、array 欄位 | 🟢   |    98% | 補齊跨尺寸與真實瀏覽器視覺檢查               |
| 4. Editor ↔ Preview 通訊          | typed protocol、runtime validation、selection/style 同步                                      | ✅   |   100% | 新訊息必須登錄 protocol registry 並加測試    |
| 5. 編輯器互動效能                 | 選取側欄切換、Code 模式輸入、Code 診斷與補全、Color Picker 拖曳、Canvas 捲動／平移／縮放、capability 解析快取 | 🟢   |    98% | 以瀏覽器 Performance trace 建立實際延遲基準  |
| 6. Code-authored 內容 round-trip  | 程式碼文字節點選取、Inspector 編輯、Live Preview、D1 draft／OCC persistence、production runtime | ✅   |   100% | 純程式碼元件的 content slot 由 ROADMAP 追蹤     |
| 7. 真實 Theme Source Live Runtime | 在隔離 iframe 執行真實 TSX/theme runtime，不再依賴固定相容 renderer                           | 🟡   |    60% | Live 仍走解釋器；解釋器已能處理無標記元件、跨檔案 row 元件與 slot section |
| 8. 最終品質與發布準備             | E2E、無障礙、跨瀏覽器、響應式、錯誤與載入狀態、復原／重做                                     | 🟡   |    70% | 復原已覆蓋全部寫入路徑；仍缺真實瀏覽器的指標與互動驗證 |

## 權重與計算

| 階段                              | 權重 | 完成度 | 貢獻 |
| --------------------------------- | ---: | -----: | ---: |
| 1. Inspector 資料一致性           |    5 |   100% | 5.00 |
| 2. 即時預覽與提交語意             |    5 |   100% | 5.00 |
| 3. Inspector 模組化與基本樣式     |   15 |    98% | 14.70 |
| 4. Editor ↔ Preview 通訊          |   10 |   100% | 10.00 |
| 5. 編輯器互動效能                 |   10 |    98% | 9.80 |
| 6. Code-authored 內容 round-trip  |   15 |   100% | 15.00 |
| 7. 真實 Theme Source Live Runtime |   25 |    60% | 15.00 |
| 8. 最終品質與發布準備             |   15 |    70% | 10.50 |
| **合計**                          | **100** |    | **85.0 → 85%** |

權重依「剩餘工作量 × 對可交付性的影響」設定：

- 階段 7 權重最高（25）：解釋器是編輯器的核心限制，替換它會連帶改動選取模型、
  Inspector 與 section 推導，是唯一還會大幅改寫既有程式碼的階段。
- 階段 3、6、8 各 15：面積大或直接決定可交付性。
- 階段 1、2 各 5：已完成的一致性修正，範圍小。

### 本次調整的依據（2026-08-26 第二輪）

- 階段 3 由 97% 調為 **98%**：新增 `array` 內容欄位的 Inspector 呈現，含逐列欄位、
  新增／刪除與 `minRows`／`maxRows` 邊界。
- 階段 5 由 97% 調為 **98%**：capability 解析加上以原始碼內容為鍵的快取，Code 模式
  每次輸入不再重新解析每個有宣告的元件。
- 階段 7 由 57% 調為 **60%**：編輯器仍走解釋器，此階段本質未變。但解釋器已能處理
  **完全無標記的元件**、跨檔案的 row 元件與 slot section，與真實 runtime 的語意差距
  明顯縮小，替換時要改寫的面積跟著變小。
- 階段 8（前一輪）由 58% 調為 **64%**：先補了單點回歸測試，再補上跨層整合測試——真實直譯器輸出
  餵進真實預覽解析，斷言宣告的欄位都選得到。三次靜默回歸逐一重現後都會被攔下。
  剩下的缺口是**真實瀏覽器**才能量的東西：實際互動延遲、跨瀏覽器行為、響應式斷點，
  以及需要登入的完整編輯迴圈。
- 階段 8 由 66% 調為 **70%**（2026-08-27 第二輪）：復原／重做覆蓋全部寫入路徑，
  且對「沉默失敗」這一類問題補上了系統性的緩解——協定拒絕訊息時會出聲。本輪那個
  結構樹缺陷正是靠這類可見性才定位出來的，而它在此之前已經存在一段時間。

## 已完成內容

### 結構樹（2026-08-27）

- [x] **修正一個讓整棵樹停在舊資料的缺陷**：預覽送出的結構訊息在協定驗證被整包拒絕，
      因為身分清單漏了 `sourceLocation`。無標記元件產生的節點只有來源位置，被判定
      「沒有身分」；而一個節點不合法就丟掉整包，所以一個無標記元素就足以讓 48 個節點
      全部消失，面板繼續顯示上一份合法資料（17 個節點的舊結構）。
- [x] `sourceLocation` 同時補上傳遞——原本就算通過驗證也會在 target 中被丟棄，
      無標記元素重新渲染後會失去選取還原的依據。
- [x] **訊息被驗證拒絕時在 dev 模式發出警告**。整段過程沒有任何錯誤訊息，正是這個缺陷
      難以定位的原因：預覽端正確、資料庫正確、面板端也正確，中間那一段完全沉默。
- [x] 有穩定身分的節點在樹上以小圓點標示，並區分「作者命名」與「編輯器自動加入」。
      不用 id 取代標籤——平台寫入的 id 形如 `el-a3f9c2b4d1e0`，放在 `Heading` 的位置
      會讓整棵樹無法閱讀。判定 `isGeneratedElementName` 放在產生器旁邊，兩者不會分岔。

### 復原／重做（2026-08-27）

- [x] 以 Command pattern 實作，不是狀態快照。每次編輯已經寫入儲存，所以復原是**一次反向的
      真實寫入**，走既有的儲存路徑，因而自動繼承 OCC 版本檢查、debounce 與預覽同步。
- [x] 範圍是單一分頁的編輯 session，不持久化（與 Figma 相同）。這和 release history 解決
      不同的問題：一個是「剛剛改錯了」，一個是「上線後才發現有問題」。
- [x] **已覆蓋全部八條寫入路徑**：樣式、內容、同層排序、陣列列排序、section 排序、
      新增 section、啟用切換、Code 模式存檔。其中四條檔案類的紀錄寫在
      `handleUnifiedSaveFile` 一處——它們本來就都經過那裡，分開寫會是同一段
      before/after 記帳複製四份。
- [x] 只有真的落地且內容有變的寫入才進歷史：被取代或衝突的儲存提前返回，
      內容相同則不記錄（否則按一次復原會什麼都不發生）。
- [x] 連續按鍵會序列化，避免兩次寫入亂序抵達；反向寫入被拒絕時該筆留在堆疊上供重試。
- [x] 沒有落地的寫入不會留在歷史：衝突或被取代的儲存會把該筆丟棄，否則復原會反轉一個
      從未發生的變更。
- [x] **歷史之外的寫入會讓相關歷史失效**。一筆紀錄存的是編輯前的完整內容，所以任何
      不經過歷史的寫入都讓它過期——在 Code 模式打完字再按復原，會把舊內容寫回去、
      靜靜蓋掉剛打的東西。每筆紀錄標記自己描述的範圍（某個主題檔案、某個 section），
      非歷史的寫入會退掉該範圍的所有紀錄。
- [x] 打字以 debounce 視窗為單位記錄，一個詞是一次復原，不是每個字元一次。

**修掉的三個問題，都是實測才發現的：**

- 焦點在 Inspector 欄位時快捷鍵失效。原本讓開所有 input，但那些是受控的屬性控制項，
  瀏覽器原生復原在那裡不會有任何效果。現在只有 Monaco 與 contenteditable 保留快捷鍵。
- 焦點在畫布時快捷鍵失效。畫布是 iframe，按鍵不會傳到父視窗——而點選元素正是最可能
  接著按復原的時刻。iframe 現在會把快捷鍵轉發給編輯器。
- 復原時畫面先跳到未套用樣式的尺寸再落到正確值。Tailwind 的重新編譯是非同步的，DOM
  會先拿到新 class，CSS 後到；拖曳編輯靠即時預覽的內聯樣式蓋住這個空窗，而復原沒有
  拖曳，所以要自己釘住當下外觀並跨過重新渲染，等新樣式到位後才解除。

### 內容鏈跨層整合測試（2026-08-26）

- [x] `editor-content-reachability.test.tsx` 以**真實直譯器輸出**餵進**真實預覽解析**
      （`collectPreviewEditableNodes`），斷言「元件宣告的每個欄位都必須能被選到」。
- [x] 這條不變式涵蓋先前三次靜默回歸：從未編輯過的元件、無標記元件、同頁兩個相同元件。
      三個回歸各自重現後都會讓測試失敗（已逐一驗證）。
- [x] 同一檢查套用在出貨的 starter 主題上，避免新客戶拿到「原始碼看得到但編輯器點不到」
      的欄位。
- [x] `actionHref`／`imageAlt` 明列為 section 層級欄位：它們是真實可編輯值，但不是任何
      元素的內容，畫布上沒有東西可點，只能由選取 section 編輯。明列而非推斷，
      是為了讓其他欄位真的失去綁定時仍然失敗。

### 內容契約由元件原始碼決定（2026-08-26）

- [x] 元件以 `export const contentFields` 宣告自己的可編輯欄位；**不需要登記在
      `morph.theme.json`**。掃描涵蓋所有 `src/**/*.tsx`，以來源路徑為身分。
- [x] `morph.theme.json` 的 capability 已完全退役——manifest 內不再有任何 `contentFields`。
- [x] 沒有宣告時，欄位由 JSX 自動推導：`<h1>{heading}</h1>` 產生 `heading` 欄位。
      判定依據是**元件簽章宣告了哪些 prop**，不是這次渲染收到什麼——否則從未編輯過的
      元件會永遠無法編輯，因為它需要的綁定只在被編輯後才出現。
- [x] 表達式必須明確指向單一 prop；`{a + b}` 或區域變數不會產生欄位。
- [x] 欄位型別：`text`、`textarea`、`url`、`number`、`boolean`、`select`、`array`。
- [x] `array` 欄位支援 `minRows`／`maxRows`、逐列欄位、新增／刪除（新列一出生就帶
      穩定 `id` 與每個欄位的初始值）。
- [x] row 可抽成獨立元件，以 `of: "./Card"` 參照；row 元件保有自己的宣告。
      `fields` 與 `of` 兩種寫法並存，但必須且只能擇一。
- [x] array 不可巢狀 array（與 Sanity 同樣的限制）；row 形狀已是物件，未來要放寬
      只需調整深度檢查。

### section 由路由推導（2026-08-26）

- [x] `content("slot")` 呼叫決定頁面有哪些 section 與順序；Document 只存值。
- [x] 同一元件可在同頁出現多次，各自由 slot id 區分身分與內容。
- [x] 左側樹的排序與「Add section」直接改寫路由 JSX（含 import 與縮排）。
- [x] 路由若尚未宣告任何 slot，沿用既存 Document——採用 slot 是每個路由各自的選擇，
      既有主題不會被打斷。
- [x] `descendantFields` 帶上所屬 section，選取父層時不會把兩個實例的同名欄位混在一起。

### 無標記元件（2026-08-26）

- [x] 選取、樣式編輯、結構樹、內容編輯都不再需要 `data-morph-section`／`-node`／`-element`。
- [x] 同層拖放排序改以 source location 定位，無標記元件也可排序。
- [x] instance 樣式需要跨編輯穩定的身分，因此平台會在**首次寫入時自動補上**
      `data-morph-node`——作者永遠不必手寫。
- [x] row 抽成獨立元件後，身分改由元件自己的 `id` prop 提供，既有 instance 樣式不失效。


### Inspector 架構

- [x] 依選取 DOM/block capability 決定側邊欄顯示的控制模組。
- [x] 基本樣式控制整合在同一張 `Design` Card；Tailwind CSS Classes 與特殊屬性維持獨立卡片。
- [x] 共用數值、單位、選單、展開控制與欄位樣式，減少各區塊重複實作。
- [x] Styles 面板啟用時同步進入 Select Mode。
- [x] Inspector 輸入欄位與選單視覺規範已統一，移除多餘的雙層 focus 邊框。

### 數值與輸入行為

- [x] 修復 Inspector 欄位在編輯期間被舊資料回朔覆蓋。
- [x] 使用 revision/selection guard 阻擋過期回應寫回目前欄位。
- [x] 數值拖曳、文字輸入與顏色調整採 draft-first；操作期間即時更新 Live View。
- [x] blur、Enter、pointer release 等使用者確認點才提交持久更新。
- [x] 修復 padding 調整期間選取外框反覆放大縮小與值重設問題。
- [x] Sizing 支援 `auto`、多種單位以及 min/max width/height。
- [x] Padding、Radius、Border width 支援單位切換與展開細項。

### 顏色、背景、Border 與 Radius

- [x] 文字元件可顯示文字色與背景色控制。
- [x] Color Picker 已拆成獨立元件並透過 Portal 掛載到 `body`。
- [x] Color Picker 依 anchor 與 viewport 定位，避免被 Inspector 裁切或覆蓋側欄。
- [x] 點擊外部關閉，並移除開啟過渡動畫。
- [x] 支援 HEX、RGB、HSL 與透明度輸入。
- [x] 支援 Solid / Gradient，兩種模式分別保留暫存值以便往返切換。
- [x] 支援清除顏色，並以透明/斜線狀態呈現，不再以白色代替。
- [x] Border 支援寬度、樣式、顏色；Radius 支援整體與四角展開控制。
- [x] Border 與 Radius 在操作期間即時反映至 Live View。

### Preview 與效能

- [x] Editor/Preview 訊息集中成 typed protocol registry，並做 runtime validation。
- [x] 修復 Preview 初次載入先顯示舊版本再跳到修改版本的閃爍問題。
- [x] 修復 Preview 因等待狀態未結束而持續顯示 loading 的問題。
- [x] Code 模式使用本地 transient model，避免每次按鍵驅動整頁 React state 更新。
- [x] Color Picker 拖曳期間以 imperative/ref 更新高頻畫面，提交時才同步正式狀態。
- [x] 選取 Live Preview 元件時減少不必要的 Inspector 重算與重建。
- [x] 從 Live Preview 切換到 Code 模式時，優先開啟被選取元件的來源檔案並跳到對應 AST 位置；無法唯一解析時安全退回目前 Section 檔案。
- [x] 初次進入 Editor 後於瀏覽器 idle 時預渲染 Styles Inspector，切換分頁時保留同一個 Inspector 實例，避免首次點擊才同步解析與建立全部控制項。
- [x] Code Workspace 啟用 Theme TSX/JSX 語言設定與 Morph JSX intrinsic declarations，移除合法 JSX 被整頁誤判為錯誤的紅線，同時保留真正語法與語意診斷。
- [x] Code Workspace 將同一 Theme 的全部來源檔預載到隔離的 file URI Monaco model tree，使相對 import 可被 TypeScript worker 正確解析；允許的 clsx 由平台提供精確 declaration，不以關閉診斷掩蓋錯誤。
- [x] `className`／`class` 靜態字串支援 Tailwind CSS class 補全，沿用既有 suggestion engine、variant 排序與重複 class 排除；補全 provider 生命週期獨立於 Monaco model draft。
- [x] Live Preview 支援安全的來源 sibling 拖放交換：只允許同檔案、同直接 JSX parent、唯一靜態 `data-morph-node`；drop 後只提交一次 draft source，失敗回復 Preview 並維持原選取節點。
- [x] Section 排序、靜態 JSX sibling 與 `map()`／資料陣列排序已明確分流；重複 identity、跨父層與跨檔案拖放會被拒絕。
- [x] Live Preview 捲動、抓取平移與縮放共用同一條 animation-frame 命令式管線；暫時 x / y / scale 由 ref 與 CSS variables 更新，停止操作後才同步一次 React state，並移除普通捲動不必要的 geometry 量測。
- [x] Selection overlay 的 scroll / resize 定位已用 animation frame 合併，避免同一 frame 重複 layout measurement。
- [x] 重複陣列 item 以持久化 item id 維持樣式 identity；`data-storefront-field-path` 僅負責 selection／content 定位，交換順序時 id 與 instance 樣式會一起移動。
- [x] Instance-scoped 樣式寫在元件 TSX 的 `morphInstanceClasses` 靜態字串表，JSX 僅以 ``cn(base, morphInstanceClasses[\`${item.id}:${nodeId}\`])`` 查表；Tailwind v4 可直接掃描，且不再新增 `global.css`、`.morph.css` 或巨大 arbitrary selector class。
- [x] 重複 item 的 Preview 重綁、Live draft 套用與 Inspector optimistic identity 都優先使用完整 field path，避免重新選到第一個 item 或沿用其他 item 的暫存值。
- [x] 重複陣列 item 可依完整 root field path 在同一陣列內拖放交換；資料以 immutable swap 更新 Section draft，儲存失敗時回復資料與原選取 item，不修改共用 JSX source。
- [x] 可排序元件只從 selection overlay 標籤的 Grip 啟動拖放；元件內容區維持純選取／編輯用途，避免誤觸排序。
- [x] 拖放時以實際元件縮圖作為 drag preview，並同時標示所有安全可交換的同層位置；目前落點使用獨立綠色狀態，無效節點不顯示交換提示。

### Code-authored 元件與內容 round-trip

- [x] Code Mode 新增的合法 JSX 與穩定 `data-morph-node`／`data-morph-element` 可進入 Preview selection taxonomy 與左側結構樹。
- [x] Preview protocol 傳遞選取文字的 `contentValue`，並以 bounded runtime schema 驗證 payload。
- [x] Inspector 可讀取 code-authored primitive 文字節點的目前值，已知 component capability 可顯示並修改對應內容欄位。
- [x] 已登記 component 的內容修改先同步 Live Preview，再以每個 section 的 debounce、draft generation 與 OCC/CAS 寫入 versioned Template Document。
- [x] Safe Theme renderer 可將 primitive prop override 套用到單一 primitive child；Code 預設值在沒有 Document override 時仍是 fallback。
- [x] `principles.default.label` 已完成 Code default → Design edit → D1 draft → reload 的既有 capability 接線。
- [x] `morph.theme.json` 支援 bounded `contentFields`，第一版控制型別為 text、textarea、url、number、boolean 與有限 select。
- [x] Inspector 從 Theme manifest 顯示自訂欄位、code default 與限制；typing 期間只送 Live Preview，blur／選擇確認時才提交。
- [x] DAL 從 D1 Theme Workspace 重新讀取 capability，並以 source generation guard、ownership、draft generation 與 OCC/CAS 保護寫入。
- [x] Theme `contentFields` 只限制本次可寫欄位，不會因 partial edit 刪除既有非 editable runtime／reference props。

### Customer Theme TanStack Start authoring 與 build contract

- [x] Starter Theme 以 `src/routes/__root.tsx`、`src/routes/index.tsx` 與獨立 `StorefrontLayout` 宣告 route contract；完整 starter 頁面內容仍由 versioned D1 Template Document 組合，不寫死在 route component。
- [x] `morph.theme.json.entry` 是 immutable build input 的 entry SSOT，舊 `isEntry` 僅保留相容 fallback。
- [x] 以靜態 AST 掃描建立 bounded route registry，不執行 customer code；duplicate path、invalid/static path、缺少 root、route module 未宣告與語法錯誤會 fail closed。
- [x] Local 與 Cloudflare Sandbox build 共用平台產生的臨時 route tree；generated output 不寫回 Theme Workspace，dependency 仍受 allowlist 與 sandbox containment 保護。
- [x] Starter `package.json` 宣告固定支援版本的 TanStack Start、Router、Vite、Tailwind 與 Cloudflare build toolchain；既有 Starter 透過第 5 版 OCC revision 升級只補缺少項目，不覆寫 authored dependency。
- [x] Local runner 使用 Cloudflare multi-environment builder，Sandbox runner 使用受控 Vite config，兩者都實際產生 `runtime/server/index.js`、`runtime/client/**` 與獨立 `preview/index.html`。
- [x] Build materializer 驗證 Start package/router 合約並拒絕 customer-authored `routeTree.gen.ts`、Vite／Wrangler 等平台 build 檔案。
- [x] R2 canonical manifest 保存 Worker entry、client assets directory 與 Editor preview entry；缺少任何 runtime artifact 都會在上傳前 fail closed。
- [x] Visual Editor 左側 Pages 可讀取目前 workspace 的 code-authored routes，點擊後開啟對應 Code source；Monaco 已提供受管理的 TanStack Router declaration。
- [x] 既有無 router metadata 的 Theme 保留 legacy component build 相容路徑。

## 尚未完成／需持續確認

### 最高優先：Theme-level 內容欄位 capability

- [x] 在 `morph.theme.json` 定義 bounded `contentFields` schema，包含欄位 key、type、label、限制與有限選項。
- [x] 從已保存的 Theme Workspace 解析並驗證 component capability，不再要求 Morph Core 為每個 customer component 手動加入內容白名單。
- [x] 保留 server-side allowlist、型別／長度／安全 URL 驗證、ownership、source generation 與 OCC；未知 `componentRef` 或未宣告欄位 fail closed。
- [x] 明確維持「程式碼 default 不會自動寫入 D1；使用者首次 Design 修改才建立 Document override」語意。
- [ ] 補齊自訂 `Promo` vertical slice：source component → selection → Inspector → Live Preview → D1 draft → reload → Publish。

### 後續：真實 Theme Source Live Runtime

- [x] 產生真正 TanStack Start Cloudflare Worker runtime build；Editor 預覽仍刻意使用隔離的 client adapter，兩者同時寫入同一 immutable artifact。
- [ ] 串接 production Workers for Platforms dispatch／deployment plane，讓 custom domain 依 active release 執行 immutable Worker；未完成前不得把 build artifact 說成已上線 runtime。
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

### 最終 UI／E2E 驗收

- [ ] 桌面、平板、手機 viewport 的 Inspector 排版與浮層定位。
- [ ] Color Picker 在視窗四角、側欄捲動及縮放後的定位。
- [ ] Keyboard、focus、Escape、Enter 與 screen reader 行為。
- [ ] 長文字、極端數值、不同 CSS 單位與無效輸入。
- [ ] 建立從選取元件到 Publish 前的完整 E2E 測試。

### Source revision storage 收斂

- [ ] 將 immutable Theme Source Revision 的完整 source bytes 從 D1 compatibility snapshot 收斂至 R2 content-addressed blobs。
- [ ] D1 僅保留 revision metadata、manifest、generation、actor 與時間；既有 compatibility path 必須有明確遷移與 sunset。

## 驗證基準

最近一次完整驗證結果：

| 檢查             | 結果    | 備註                                   |
| ---------------- | ------- | -------------------------------------- |
| `pnpm typecheck` | ✅ 通過 | TypeScript 型別檢查完成                |
| `pnpm test`      | ✅ 通過 | 162 個測試檔、787 個測試通過           |
| `pnpm build`     | ✅ 通過 | 正式建置與 server-only bundle 檢查通過 |

已知非阻擋警告：

- `/hero.png` 在建置時保留為 runtime resolution。
- 部分 bundle chunk size 警告仍存在，後續效能階段處理。

## 下一階段建議

### Stage A — Theme-level content capability contract

- [x] 定義並驗證 `morph.theme.json` 的 `contentFields` schema。
- [x] 讓 server-side content filtering 從可信 manifest capability 解析，並保留內建元件的相容 adapter。
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

| 日期       | 階段／內容                                                                                                                                                                                                                                                                          | 驗證                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 2026-08-26 | 打通零標記元件的完整編輯鏈路：解釋器輸出 source position、元件根部即 section 邊界、AST 以 `line:column` 定位、Inspector 鎖定判斷與即時樣式預覽統一改用共用的 `element-target` 解析；修復重繪後選取框消失與 padding 值閃跳（inline 預覽跨重繪存活）。建立 `content("slot")` 契約：解釋器支援、Document section id 即 slot id、starter 升級至版本 11 並植入平台 content 模組 | `pnpm typecheck`、`pnpm test`（1019 tests）、`pnpm build` 通過；並以真實 workspace 實測渲染與選取收集 |
| 2026-08-26 | 完成 production runtime 與部署平面：hostname → active release → artifact 的 fail-closed 解析、preview／production 共用 serving core、`ThemeRuntime` 傳輸抽象（service binding／local／dispatch／unavailable）、Sandbox wrangler 部署與憑證隔離、CAS 先佔位後部署的啟用順序、Publish 與 rollback 共用部署核心；並完成零標記元素識別：解釋器產生 source position、元件根部即 section 邊界、收集／點擊／還原三段統一，Inspector 不再要求 Document section | `pnpm typecheck`、`pnpm test`（978 tests）、`pnpm build` 通過；並以真實 workspace 實測 Live 預覽渲染與選取收集 |
| 2026-08-25 | 完成 Customer Theme TanStack Start build contract：加入固定 package/toolchain、Starter v5 OCC additive upgrade、真正 Cloudflare multi-environment Worker build、platform-owned generated/config path、Worker/client/preview artifact contract 與 R2 manifest fail-closed 驗證；production Worker dispatch 與 D1 Page Registry 組合仍明確列為後續 | `pnpm typecheck`、`pnpm test`（162 files / 793 tests）、`pnpm build`、`git diff --check` 通過 |
| 2026-08-25 | 完成 Theme-level `contentFields` capability：共用 bounded manifest parser、Inspector 自訂欄位與 code default、server-authoritative D1 Workspace 驗證、safe URL／型別／長度／select 限制、source-generation + draft OCC guard、partial edit 資料保留及內建 manifest 相容 adapter | `pnpm typecheck`、`pnpm test`（159 files / 766 tests）、`pnpm build`、`git diff --check` 通過 |
| 2026-08-25 | 完成 code-authored primitive 文字內容 round-trip：Preview protocol 傳遞 bounded `contentValue`、Inspector 顯示目前文字、已登記 component 可即時預覽並透過 debounce／OCC 寫入 D1 draft；確認下一個缺口為 Theme-level `contentFields` capability，而非自動把程式碼 default 寫入資料庫 | `pnpm typecheck`、`pnpm test`（158 files / 758 tests）、`pnpm build`、`git diff --check` 通過 |
| 2026-08-23 | 修復 Code Mode 相對 import 與 clsx 的假錯誤：每個 Theme 使用隔離 URI workspace 並預載全部來源 model，加入受管理的 dependency declaration 與 scoped cleanup，保留真正 TypeScript 診斷                                                                                                | pnpm typecheck、pnpm test、pnpm build 通過                                                    |
| 2026-08-23 | 將重複陣列樣式收斂為穩定 item id 與元件內 `morphInstanceClasses` 靜態 class map；首次確認樣式修改會補 id，Preview parser／renderer 可解析套用，排序後樣式仍跟隨原 item，舊 CSS／巨大 selector 僅作遷移輸入                                                                          | `pnpm typecheck`、`pnpm test`（148 files / 673 tests）、`pnpm build` 通過                     |
| 2026-08-22 | 將重複陣列 instance 樣式改為直接寫回元件 TSX 的 `cn()` 靜態 Tailwind arbitrary variant；停止新增 global/獨立 CSS 規則，舊 CSS 在再次編輯時遷移並清除空 import，Code Mode 回到元件來源                                                                                               | `pnpm typecheck`、`pnpm test`（148 files / 669 tests）、`pnpm build` 通過                     |
| 2026-08-22 | 將陣列 instance 樣式移至元件旁的 `.morph.css`，首次建立即納入 Live Preview 與 OCC 儲存；`global.css` 僅保留 import，Code Mode 可定位 marker，並支援舊規則逐筆遷移                                                                                                                   | `pnpm typecheck`、`pnpm test`（148 files / 667 tests）、`pnpm build` 通過                     |
| 2026-08-22 | 加入 Live Preview 拖曳縮圖、完整合法交換位置提示與目前落點狀態；所有回饋沿用命令式 overlay，不在 dragover 熱路徑觸發 React render                                                                                                                                                   | `pnpm typecheck`、`pnpm test`（148 files / 665 tests）、`pnpm build` 通過                     |
| 2026-08-22 | 將 Live Preview 排序入口收斂到 selection label 的專用 Grip；取消整張選取元件的 draggable 行為，並補齊 grab / grabbing 狀態與可排序時才顯示的規則                                                                                                                                    | `pnpm typecheck`、`pnpm test`（148 files / 665 tests）、`pnpm build` 通過                     |
| 2026-08-22 | 修復 Principle Card 無法互換：Preview 以 `items.<index>` 識別重複 item，同陣列 drop 後只提交一次 Section props draft；加入安全路徑解析、immutable swap、typed protocol 與失敗選取回滾                                                                                               | `pnpm typecheck`、`pnpm test`（148 files / 665 tests）、`pnpm build` 通過                     |
| 2026-08-22 | 修復重複陣列 item 樣式互相污染：以 Section id + 完整 field path 建立 instance-scoped Theme CSS，並修正 Preview 重綁、Live draft 與 Inspector identity 的 repeated-node 定位                                                                                                         | `pnpm typecheck`、`pnpm test`（147 files / 660 tests）、`pnpm build` 通過                     |
| 2026-08-22 | 完成 Live Preview 畫布互動第二階段效能修復：wheel、抓取平移與縮放統一由 ref、單一 rAF 與 CSS variables 驅動，移除每幀 React state 更新，並加入 Canvas containment 與 idle 狀態提交                                                                                                  | `pnpm typecheck`、`pnpm test`（146 files / 654 tests）、`pnpm build` 通過                     |
| 2026-08-22 | 修復 Live Preview 捲動低幀率：wheel 熱路徑脫離整棵 Editor React render、每幀合併 Canvas DOM transform、idle 後提交最終狀態，overlay scroll/resize 量測同步節流；同步補入效能規則                                                                                                    | `pnpm typecheck`、`pnpm test`（146 files / 654 tests）、`pnpm build` 通過                     |
| 2026-08-22 | 新增 Live Preview 安全 sibling 拖放交換、AST source swap、typed protocol、一次性 draft 儲存、失敗回復與選取維持；同步補入 Visual Editor 規則                                                                                                                                        | `pnpm typecheck`、`pnpm test`（146 files / 654 tests）、`pnpm build` 通過                     |
| 2026-08-22 | 修復 Code Workspace 合法 TSX 的錯誤診斷；新增限定於靜態 `className`／`class` 字串的 Tailwind CSS class 補全與 provider 清理                                                                                                                                                         | `pnpm typecheck`、`pnpm test`（146 files / 650 tests）、`pnpm build` 通過                     |
| 2026-08-22 | 完成 Styles Inspector idle 預渲染、保留掛載與穩定 callback，降低第一次從 Agent 切換 Styles 的同步工作量                                                                                                                                                                             | `pnpm typecheck`、`pnpm test`（145 files / 644 tests）、`pnpm build` 通過                     |
| 2026-08-22 | 完成 Live Preview 選取來源感知的 Code 模式導覽；支援 Section、同檔 DOM、獨立子元件來源與安全 fallback                                                                                                                                                                               | `pnpm typecheck`、`pnpm test`（144 files / 642 tests）、`pnpm build` 通過                     |
| 2026-08-22 | 建立進度基準；整理 Inspector 架構、同步穩定性、控制項、Color Picker、Border/Radius、Preview protocol 與效能改善現況                                                                                                                                                                 | `pnpm typecheck`、`pnpm test`（143 files / 638 tests）、`pnpm build` 通過                     |
