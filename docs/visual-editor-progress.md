# Visual Editor 開發進度表

> 本文件是 Visual Editor 的持續進度基準。每完成一個階段，請更新同一份文件，不另建重複版本。

## 目前概況

| 項目         | 內容                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------- |
| 最後更新     | 2026-08-22                                                                                     |
| 目前狀態     | 開發中                                                                                         |
| 整體完成度   | **87%**                                                                                        |
| 目前重點     | Code Workspace 診斷與 Tailwind 補全完成後，進入真實 Theme Source Live Runtime 與瀏覽器量測階段 |
| 最近完整驗證 | `pnpm typecheck`、`pnpm test`、`pnpm build` 均通過                                             |

`████████▋░ 87%`

> 完成度是依功能、架構與驗證結果加權估算，不代表已達正式發布標準。

### 狀態標記

- ✅ 已完成並有自動化驗證
- 🟢 已實作，仍需持續回歸確認
- 🟡 部分完成或尚有明確後續工作
- ⬜ 尚未開始

## 階段進度

| 階段                              | 範圍                                                                                          | 狀態 | 完成度 | 下一個確認點                                |
| --------------------------------- | --------------------------------------------------------------------------------------------- | ---- | -----: | ------------------------------------------- |
| 1. Inspector 資料一致性           | 數值回朔、舊回應覆蓋新值、選取切換競態                                                        | ✅   |   100% | 維持 stale-response 回歸測試                |
| 2. 即時預覽與提交語意             | 操作中只更新 Live View，完成輸入後才真正提交資料                                              | ✅   |   100% | 新控制項必須沿用同一套 draft/commit 規則    |
| 3. Inspector 模組化與基本樣式     | capability 判定、Design Card、Sizing、Position、Appearance、Spacing、Typography、Fill、Border | 🟢   |    95% | 補齊跨尺寸與真實瀏覽器視覺檢查              |
| 4. Editor ↔ Preview 通訊          | typed protocol、runtime validation、selection/style 同步                                      | ✅   |   100% | 新訊息必須登錄 protocol registry 並加測試   |
| 5. 編輯器互動效能                 | 選取側欄切換、Code 模式輸入、Code 診斷與補全、Color Picker 拖曳、Canvas 捲動／平移／縮放      | 🟢   |    97% | 以瀏覽器 Performance trace 建立實際延遲基準 |
| 6. 真實 Theme Source Live Runtime | 在隔離 iframe 執行真實 TSX/theme runtime，不再依賴固定相容 renderer                           | 🟡   |    25% | 完成 runtime 邊界、模組載入與失敗回復設計   |
| 7. 最終品質與發布準備             | E2E、無障礙、跨瀏覽器、響應式、錯誤與載入狀態                                                 | 🟡   |    60% | 建立完整互動驗收矩陣                        |

## 已完成內容

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
- [x] `className`／`class` 靜態字串支援 Tailwind CSS class 補全，沿用既有 suggestion engine、variant 排序與重複 class 排除；補全 provider 生命週期獨立於 Monaco model draft。
- [x] Live Preview 支援安全的來源 sibling 拖放交換：只允許同檔案、同直接 JSX parent、唯一靜態 `data-morph-node`；drop 後只提交一次 draft source，失敗回復 Preview 並維持原選取節點。
- [x] Section 排序、靜態 JSX sibling 與 `map()`／資料陣列排序已明確分流；重複 identity、跨父層與跨檔案拖放會被拒絕。
- [x] Live Preview 捲動、抓取平移與縮放共用同一條 animation-frame 命令式管線；暫時 x / y / scale 由 ref 與 CSS variables 更新，停止操作後才同步一次 React state，並移除普通捲動不必要的 geometry 量測。
- [x] Selection overlay 的 scroll / resize 定位已用 animation frame 合併，避免同一 frame 重複 layout measurement。

## 尚未完成／需持續確認

### 最高優先：真實 Theme Source Live Runtime

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

## 驗證基準

最近一次完整驗證結果：

| 檢查             | 結果    | 備註                                   |
| ---------------- | ------- | -------------------------------------- |
| `pnpm typecheck` | ✅ 通過 | TypeScript 型別檢查完成                |
| `pnpm test`      | ✅ 通過 | 146 個測試檔、654 個測試通過           |
| `pnpm build`     | ✅ 通過 | 正式建置與 server-only bundle 檢查通過 |

已知非阻擋警告：

- `/hero.png` 在建置時保留為 runtime resolution。
- 部分 bundle chunk size 警告仍存在，後續效能階段處理。

## 下一階段建議

### Stage A — True Live Runtime 設計與最小垂直切片

- [ ] 先完成一個真實 section 的 TSX runtime 渲染。
- [ ] Inspector 修改可以即時套用，但不寫入 source/public content。
- [ ] 編譯失敗能回復上一個成功版本。
- [ ] 完成 focused tests 與安全邊界 review。

### Stage B — Runtime 擴展與完整 Inspector 對接

- [ ] 擴展至文字、圖片、容器與 nested component。
- [ ] 對接目前 capability registry 與所有基本樣式控制。
- [ ] 完成選取、重新載入、切換 section 與 stale response 回歸。

### Stage C — 發布前品質門檻

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

| 日期       | 階段／內容                                                                                                                                                                         | 驗證                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 2026-08-22 | 完成 Live Preview 畫布互動第二階段效能修復：wheel、抓取平移與縮放統一由 ref、單一 rAF 與 CSS variables 驅動，移除每幀 React state 更新，並加入 Canvas containment 與 idle 狀態提交 | `pnpm typecheck`、`pnpm test`（146 files / 654 tests）、`pnpm build` 通過 |
| 2026-08-22 | 修復 Live Preview 捲動低幀率：wheel 熱路徑脫離整棵 Editor React render、每幀合併 Canvas DOM transform、idle 後提交最終狀態，overlay scroll/resize 量測同步節流；同步補入效能規則   | `pnpm typecheck`、`pnpm test`（146 files / 654 tests）、`pnpm build` 通過 |
| 2026-08-22 | 新增 Live Preview 安全 sibling 拖放交換、AST source swap、typed protocol、一次性 draft 儲存、失敗回復與選取維持；同步補入 Visual Editor 規則                                       | `pnpm typecheck`、`pnpm test`（146 files / 654 tests）、`pnpm build` 通過 |
| 2026-08-22 | 修復 Code Workspace 合法 TSX 的錯誤診斷；新增限定於靜態 `className`／`class` 字串的 Tailwind CSS class 補全與 provider 清理                                                        | `pnpm typecheck`、`pnpm test`（146 files / 650 tests）、`pnpm build` 通過 |
| 2026-08-22 | 完成 Styles Inspector idle 預渲染、保留掛載與穩定 callback，降低第一次從 Agent 切換 Styles 的同步工作量                                                                            | `pnpm typecheck`、`pnpm test`（145 files / 644 tests）、`pnpm build` 通過 |
| 2026-08-22 | 完成 Live Preview 選取來源感知的 Code 模式導覽；支援 Section、同檔 DOM、獨立子元件來源與安全 fallback                                                                              | `pnpm typecheck`、`pnpm test`（144 files / 642 tests）、`pnpm build` 通過 |
| 2026-08-22 | 建立進度基準；整理 Inspector 架構、同步穩定性、控制項、Color Picker、Border/Radius、Preview protocol 與效能改善現況                                                                | `pnpm typecheck`、`pnpm test`（143 files / 638 tests）、`pnpm build` 通過 |
