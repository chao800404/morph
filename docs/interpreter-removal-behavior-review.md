# 舊直譯器移除：行為差異與決策表

狀態：**審閱草稿，不授權刪除或移植程式。** 2026-10-12 以 main `145a3ec` 唯讀盤點。本文只新增文件，沒有執行舊路由、瀏覽器或部署驗收。

## 1. 範圍與現況

正式編輯器使用 Theme Source 的真實 Live Preview。舊路由仍保留相容性直譯器，兩者不能長期各自成為 presentation 的真相。

- 舊入口：`src/routes/_editor/store/$storefrontId/themes/$themeId/preview.tsx`。
- 舊渲染鏈：`storefront-preview.tsx` → `safe-theme-route-renderer.tsx`／`safe-theme-component-renderer.tsx`，以及 `storefront-document-renderer.tsx` 的內建渲染。
- 現行選取、樣式與內容：preview bridge → `visual-editor-shell.tsx` → 既有 AST／Document 寫入與 OCC。
- 區塊來源：`theme-route-sections.ts`；#212 已辨識第一版 Start loader 資料流，但它的完整畫布自動更新仍等 A6b-2。

#193 將產品保證搬到真實 React harness；#198、#199、#208、#209 四項前置修正已合併。這不等於已完成移除，也不代表新的案例 B 已完整驗收。

交接檔是歷史線索，不是目前程式的權威：其中「欄位標記只在本機」「#198 尚未合併」等狀態已過時。刪除 PR 開工時必須重新核對入口、import graph、測試與最新 main。

## 2. 可觀察的差異與需保留的保證

| 項目               | 舊鏈的行為／證據                                                                            | 現行鏈與移除後的要求                                                                                                                              | 判斷                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 執行作者程式       | safe renderer 解析並解釋一部分 TSX；不等於框架原生執行                                      | 真實 React／框架預覽；未知綁定只限制 Design，不因直譯器不支援而拒絕合法程式                                                                       | 不移植舊語法白名單或另一套 runtime                                              |
| 元件的預設值與樣式 | 舊 renderer 會處理 props／style；Document renderer 另有 fallback 與 presentation style 組合 | presentation 保持 Theme Source 為真相；Inspector 編原始 Document 值                                                                               | 先分辨作者 presentation、必要編輯器 UI 與純舊鏈 fallback，不能整份搬移          |
| 元素識別           | 作者標記與舊 renderer 的 source location                                                    | 編譯時注入位置、現行 preview selection 與共用 element target；持久 row id 仍必要                                                                  | 保留現行識別與測試，不要求作者新增標記                                          |
| 樣式拖動即時回饋   | 舊路由有暫時 inline style、selection overlay 與 revision 套用                               | 現行 bridge／Inspector／workspace safe patch 必須維持相同行為；暫時樣式不是持久真相                                                               | 只有現行消費者缺少而且有受控反例的功能才補，不複製舊 overlay                    |
| 刪除一般 JSX 元素  | 舊頁面本身不是內容／原始碼的權威；需追到 parent 寫入 handler 才能比較                       | `handleDeleteEditableNode` 以 file＋唯一 node／location 交給 `removeJsxElement`，走 unified source save；動態、重複列、共用 layout 或無來源時拒絕 | 保留拒絕與 OCC；不能用「刪掉畫布 DOM」代替存檔                                  |
| 刪除 Document 區塊 | 舊渲染從 Document 顯示區塊，不能從渲染結果推定刪除語意                                      | `handleDeleteSection` 與 route-section helper 是另外一條操作；#212 的 loader 綁定 route 暫不開放結構編輯                                          | 不把刪元素、刪區塊、刪檔案、刪頁面混成一件事                                    |
| 刪除元件檔案       | 本次未驗證舊／新 Code 操作的完整引用處理                                                    | 需列出使用該元件的 route、其他元件與 Document；原始碼錯誤要可見且能修復                                                                           | 待具體差異與案例確認，本文不核准行為變更                                        |
| 編譯錯誤與恢復     | 舊 Document renderer 有「safe Design preview 不支援」訊息及 fallback                        | 真實編譯錯誤可見，Code 可操作、草稿保留；修好 import 後能恢復，不靜默改成預設元件                                                                 | 保留 #194／#193 的真實預覽保證，不只驗證「不是白頁」                            |
| 預覽 origin        | `live-preview-security.ts` 的 compatibility 分支允許 editor origin                          | user-code 必須跨 origin；缺少／錯誤／同源設定 fail closed                                                                                         | 刪 compatibility 分支不能放寬 user-code 安全設定；補 INVALID_EDITOR_ORIGIN 測試 |
| 舊預覽網址         | 舊 route／`buildLivePreviewUrl` 仍存在                                                      | 移除後真實 HTTP 404，不保留 renderer、不自動啟動容器                                                                                              | 可提供安全的編輯器連結，見 §5                                                   |
| Build／發布／回滾  | 不應從可變的 preview 推導正式結果                                                           | immutable revision＋build＋內容 publication／release，既有授權與 CAS 不變                                                                         | 不在移除 PR 改發布或儲存契約                                                    |

本表的程式行為來自靜態閱讀，不把它寫成已跑過的舊／新瀏覽器對照。尤其「舊鏈是否曾允許某種刪除」目前沒有完整舊路由實測，不能憑移除行數宣稱無退步。

## 3. 待決一：語法與樣式要不要移植

建議原則：**保留使用者能力，不保留直譯器架構。**

1. 作者 TSX／CSS／Tailwind 與元件預設值由現行框架執行，不另建解釋器。
2. 現行 preview 的選取、hover、spacing、拖曳與 inline editing 樣式由現行 bridge 擁有；若與舊頁面不同，先提出一個真實使用者案例與最小差異，再延伸 shared primitive。
3. `storefront-document-renderer.tsx` 的內建 presentation fallback、Document-to-style 與只在舊鏈用到的 render helper，不因為曾存在就全部移植。
4. Monaco 的語法高亮／diagnostics 是 Code 的獨立功能，不屬於刪除直譯器的目標；不得連帶刪除或停用。
5. 實作 PR 必須附「舊 symbol → 現行 consumer／替代測試／沒有 consumer」清單。查不到 consumer 不是單憑文字搜尋就宣稱不可達，還要核對動態 import、route 和測試入口。

**待核准：** 是否接受上述保留界線，以及盤點發現的具體缺口是否另案。本文沒有核准任何移植或功能刪除。

## 4. 待決二：刪除元件的行為

請先將「元件」拆成以下操作，逐項提供舊／新對照，再取得行為變更授權：

| 操作                  | 必須證明                                                                 |
| --------------------- | ------------------------------------------------------------------------ |
| 刪某個靜態 JSX 子元素 | 只修改可證明唯一的 source 節點；存檔失敗不假裝刪除成功                   |
| 刪某個重複列          | 改正確的 Document row id，不能移除所有列共用的 JSX                       |
| 刪整個 Document 區塊  | 區塊身分、route 改寫與內容保留政策一致；loader route 的結構鎖不能被繞過  |
| 刪元件來源檔          | 明確呈現仍有引用的影響；不刪掉其他頁面的內容或自動轉成別的元件           |
| 刪頁面 route          | 與歷史 release／Document 保留和回滾政策分開；不為清理而新增硬刪 Document |

已有的拒絕應維持。若要改成以前拒絕、現在允許（或相反），須列出 UI、來源變更、Document 變更、受影響頁面和復原方式，不能順帶夾在刪除 PR 裡。

## 5. 待決三：舊網址 404 與編輯器連結

建議保留既定的 404，不自動 redirect 或啟動任何預覽。

- 可提供「開啟編輯器」連結，目的地只用既有 editor route／URL builder，不接受任意 redirect URL。
- 連結不代表有權限；editor loader／server 仍重新驗證登入、storefront 與 Theme。
- 404 頁不得取出或顯示私人 Theme 內容、原預覽 capability、token 或草稿。
- 不可信 template／route query 不能原樣搬進連結；未能驗證時只提供一般返回入口。
- 驗證舊 route 真正回 404，沒有 renderer、iframe 編輯通道或容器啟動；另驗證未登入與無權限使用者。

**待核准：** 是否附上述連結。連結只是錯誤頁導引，不是舊預覽的相容入口。

## 6. 移除 PR 的交付邊界

- 重新核對四項前置修正、#193 的原始保證及相關測試是否已轉正。新案例 B 的 A6b-2 預期失敗另列，不把它誤算成舊直譯器的產品保證。
- 移除舊入口／僅它使用的模組、`test:parity` 與已搬移的重複測試；保留 `test:workspace-preview` 和現行產品測試。
- route tree、bridge 與其他生成檔只跑既有 generator，不手改。
- 規則與文件將「直譯器產生位置」改為「Live Preview 編譯時注入」；不能把合法作者語法整體拒絕。
- Browser Tailwind compiler、原始碼格式整理、預覽存取修正與 A6b-2 不混進刪除範圍。
- 完整 typecheck／test／build；相關 E2E 只走 `pnpm test:e2e:local-preview`，保留失敗證據，不加 retry 或放寬斷言。

本次文件沒有跑這些產品驗證，也沒有授權開工、合併、部署、刪分支或清理 worktree。
