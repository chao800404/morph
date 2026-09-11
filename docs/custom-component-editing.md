# 從零建立可編輯元件

刪除 Starter components 後可以建立自己的頁面；先修正所有 route / layout import，並保留 Theme 的 router、document shell、平台 content helpers 與 build 設定。只刪除檔案而留下失效 import 不會產生可用頁面。

- 在元件 source 匯出合法的 `contentFields`，宣告可編輯內容。
- 路由透過 `<MyBanner {...content("my-banner")} />` 配對 Document slot。
- 未在 manifest 註冊的元件使用來源路徑作為 `componentRef`，例如 `src/components/MyBanner.tsx`。不要自行猜測 `my-banner.default`。
- 不需要手寫 `data-*`；也不禁止使用合法的穩定識別標記。沒有標記時，平台以可唯一辨識的 source position 定位。重複列另需穩定 item identity。
- 樣式只支援 AST 可安全改寫的 source。動態 expression、不唯一或不支援的結構需使用 Code Mode。
- 元件內宣告優先於 manifest fallback。Starter 對已遷移元件不再複製 manifest 欄位宣告；自訂元件與尚未遷移元件的 fallback 保留。

## 驗證範圍

`authored-from-scratch.test.tsx` 是解析、渲染、欄位過濾與 source patch 的契約測試，不是瀏覽器或 server endpoint 的端到端測試。

`storefront-theme.dal.test.ts` 的 unregistered component 測試將 Inspector 操作接到真實 DAL 與測試 SQLite，儲存後重新讀取 draft 並重建 Inspector，檢查內容、連結、保留欄位、immutable revision 及 generation conflict。它不涵蓋 HTTP authentication、瀏覽器 iframe 或完整 Styles 儲存流程。

`e2e/authored-content.spec.ts` 另行驗證真實瀏覽器的內容與樣式修改在重新載入後仍存在。需設定登入與獨立測試 Theme；未執行或 skip 都不代表通過。
