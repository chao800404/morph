# 從零建立可編輯元件

刪除 Starter components 後可以建立自己的頁面；先修正所有 route / layout import，並保留 Theme 的 router、document shell、平台 content helpers 與 build 設定。只刪除檔案而留下失效 import 不會產生可用頁面。

- 在元件 source 匯出合法的 `contentFields`，宣告可編輯內容。
- 路由透過 `<MyBanner {...content("my-banner")} />` 配對 Document slot。
- 未在 manifest 註冊的元件使用來源路徑作為 `componentRef`，例如 `src/components/MyBanner.tsx`。不要自行猜測 `my-banner.default`。
- 元件放進 `src/components/sections/` 就成為 section 候選，不必在 manifest 註冊，也不必匯出 `contentFields`。入口只有兩種形狀：`src/components/sections/Hero.tsx`，或 `src/components/sections/hero/index.tsx`（以資料夾命名，不叫 `index`）。再深一層的檔案、`*.test.tsx`／`*.spec.tsx`、以及資料夾根目錄的 `index` 都不算入口。同一個檔案若 manifest 已宣告，仍以 manifest 的 `componentRef` 為準，不會重複列出。
- 路由直接 render 元件（`<Promo title={product.name} />`）而沒有 `content(...)` 時，元件照常 render，但編輯器看不到它。這類位置會列在 Sections 面板的「Sections needing binding」下，可一鍵綁定；綁定會把 `{...content("...")}` 插在該元素**自己的屬性之前**，所以作者寫的顯式 prop 優先於 slot 值。只有直接 JSX 位置可以綁定 —— 條件式、`map` callback、任意 expression 一律拒絕並附上原因，因為同一個 source 位置可能代表 0 個或多個渲染實例，一個 slot 描述不了。
- 候選會標示綁定寫進哪個檔案：`This page` 寫進 route，`Every page` 寫進 layout。layout 候選在每一頁都看得到，綁一次會影響所有頁面。綁定前會以當前 source 重新推導並比對位置、元件名與來源檔案，source 已變更時拒絕寫入，而不是把 slot 補到別的元件上。
- 沒有 `contentFields` 時，編輯器會從 source 推導欄位：字面量預設值、行內型別標註、同檔的 `type`／`interface`。需要型別檢查器才讀得到的（跨檔匯入型別、泛型、條件型別）與執行期值一律不推導，欄位留空 —— 這種情況請改用 `contentFields` 宣告。`v?: string` 與 `v: string | undefined` 視為同一件事；`null` 不算 optional，`string | null` 維持不推導。
- 已宣告的 `contentFields` 一律優先於推導，宣告無效時也一樣：無效宣告不會退回推導，而是讓該欄位留空。
- 不需要手寫 `data-*`；也不禁止使用合法的穩定識別標記。沒有標記時，平台以可唯一辨識的 source position 定位。重複列另需穩定 item identity。
- 樣式只支援 AST 可安全改寫的 source。動態 expression、不唯一或不支援的結構需使用 Code Mode。
- 元件內宣告優先於 manifest fallback。Starter 對已遷移元件不再複製 manifest 欄位宣告；自訂元件與尚未遷移元件的 fallback 保留。

## 驗證範圍

`authored-from-scratch.test.tsx` 是解析、渲染、欄位過濾與 source patch 的契約測試，不是瀏覽器或 server endpoint 的端到端測試。

`storefront-theme.dal.test.ts` 的 unregistered component 測試將 Inspector 操作接到真實 DAL 與測試 SQLite，儲存後重新讀取 draft 並重建 Inspector，檢查內容、連結、保留欄位、immutable revision 及 generation conflict。它不涵蓋 HTTP authentication、瀏覽器 iframe 或完整 Styles 儲存流程。

`e2e/authored-content.spec.ts` 另行驗證真實瀏覽器的內容與樣式修改在重新載入後仍存在。需設定登入與獨立測試 Theme；未執行或 skip 都不代表通過。

綁定與欄位推導是單元契約測試：`theme-route-sections.test.ts` 覆蓋候選推導、綁定插入位置與 stale 防護，`infer-theme-content-fields.test.ts` 覆蓋推導與拒絕的邊界，`editor-section-model.test.ts` 固定候選的 owner 標示。三者都在 source 層，不涵蓋瀏覽器裡實際按下 Bind 的流程。
