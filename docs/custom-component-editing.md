# 從零建立可編輯元件

刪除 Starter components 後可以建立自己的頁面；先修正所有 route / layout import，並保留 Theme 的 router、document shell、平台 content helpers 與 build 設定。只刪除檔案而留下失效 import 不會產生可用頁面。

- 在元件 source 匯出合法的 `contentFields`，宣告可編輯內容。
- 路由透過 `<MyBanner {...content("my-banner")} />` 配對 Document slot。
- 未在 manifest 註冊的元件使用來源路徑作為 `componentRef`，例如 `src/components/MyBanner.tsx`。不要自行猜測 `my-banner.default`。
- 元件放進 `src/components/sections/` 就成為 Add section 候選，不需要在 manifest 登記。入口只有兩種形狀：`src/components/sections/Hero.tsx`，或 `src/components/sections/hero/index.tsx`（以資料夾命名，不叫 `index`）。再深一層的檔案、`*.test.tsx`／`*.spec.tsx`、以及資料夾根目錄的 `index` 都不算入口。即使 `morph.theme.json` 的 `components` 仍列出同一個檔案，Add section 仍以 section folder 的路徑與名稱為準；manifest 只保留給既有 Theme 的相容解析。
- `sections/` 是範本庫，route 不直接 import 它。Add section 會把範本複製成該頁專屬的實例：`src/components/page-sections/<route key>/<slot id>/index.tsx`。route key 是 route 檔路徑的 TanStack flat 寫法（`src/routes/products/$slug.tsx` → `products.$slug`），所以動態 route 的副本屬於整個模板，不是某一個商品。同頁加兩個 Hero 會得到 `hero/` 與 `hero-2/` 兩份。改範本只影響之後新增的 section，已加入的副本不會跟著變。
- 複製的邊界：單檔 section 複製該檔；資料夾 section 整個資料夾一起複製，內部 import 指向副本；`ui/`、hooks、content contract 等外部依賴繼續共用。入口若只是 `export { default } from "../Hero"` 這類轉出，複製的是它指向的實作。section 若 import 另一個 section 會拒絕新增，因為副本無法獨立。
- 從頁面移除 section 時，它專屬的資料夾在同一個 revision 內一起刪除，undo 會一起還原。若該資料夾仍被其他檔案 import，則保留檔案；若檔案有未儲存修改，則拒絕移除。頁面有哪些 section 由 route source 決定，Document 只提供值：還原舊的 Document 版本不會讓已移除的 section 重新出現，要找回它請還原來源版本（route 與副本在同一個 revision，會一起回來）。
- 仍直接 render `sections/` 範本的 route（採用這個慣例之前建立的頁面）會標示為 Template，並提供「建立頁面副本」。Design 模式不寫入範本 source：樣式、元素排序與刪除、連結切換、預設 props 都會被拒絕並提示分離。範圍包含範本入口轉出的實作檔，例如 `sections/Hero.tsx` 只寫 `export { default } from "../Hero"` 時，`src/components/Hero.tsx` 也算範本。範本只在 Code 模式修改。
- 早期 detach 產生的單檔副本（`page-sections/<URL key>/Hero.tsx`，例如 `home`、`products-slug`）在移除 section 時也會一起刪除，前提是它位於該 route 的 URL key 下且沒有其他檔案 import。
- 頁面副本若失去 `content(...)` 綁定，會出現在「Sections needing binding」，可以重新綁定；但它不會出現在 Add section 候選中。
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
