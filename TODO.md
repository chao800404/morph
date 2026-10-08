# 未完事項列表

這份清單記錄尚未決定實作方式的事項。完成前先保留目前架構與安全邊界，不以暫時性的 UI 或資料欄位假裝已完成。

## 正式部署前必須完成（阻擋項）

合併程式碼不等於核准部署。以下事項在正式部署前必須完成；未完成就不部署。

- [ ] 在獨立測試環境，用正式建置產物做完整驗收（2026-10-08，#159）
  - 範圍：Code 儲存、Design 修改、Live Preview、建置、發布與回滾。
  - 原因：伺服器產物改由 `morphServerOutput` 輸出（ASCII、無空白），只在建置時生效；本機 E2E 跑的是 `vite dev`，測不到它。#159 只以量測流程對建置產物做了煙霧測試（SSR、登入後 17 個編輯步驟、全部 chunk 載入）。
  - 以 `vite preview` 跑完整編輯器 E2E 時，基線與變更後都在 Live Preview 的前置檢查失敗，原因尚未定位；未執行的測試不算通過。
- [ ] 確認正式環境的錯誤堆疊能經上傳的 source map 還原到 Morph 原始碼（`upload_source_maps`，#159）。
- [ ] 依各套件授權要求核對授權註解。伺服器與瀏覽器產物目前都不保留（Vite 預設 `legalComments: "none"`）；「之前就是零個」不代表符合要求。
- [ ] 主 Worker 的尖峰記憶體：#158（約 6.3 MiB）與 #159（約 15.3–15.7 MiB）各自量測，只證明 GC 後的常駐量下降；GC 前在編輯 session 後仍可到 130 MiB。正式環境的計算方式與尖峰仍需在雲端量測，且不作為把解析器放回主 Worker 的理由。
- [ ] 建置容器關閉外連（2026-10-08 確認目前可以外連）
  - 現況：建置用的 `Sandbox` 類別沒有設定 `enableInternet`，SDK 預設為 `true`；兩種預覽容器已設為 `false`。
  - 建置與部署共用這個類別（容器不同：建置以 `buildId`、部署以 storefront 與 release 為 id；憑證只在部署那一次
    `exec` 的環境變數中；兩者結束後都銷毀），所以不能直接關閉，否則部署會失敗。
  - 要做：建置拆成自己的類別並關閉外連；部署類別依實際需要的目的地（Cloudflare API）另定允許清單，不永久自由外連。
  - 這是獨立項目，Astro A2 完成不會勾掉它。
- [ ] 容器規格（#157）在雲端的實際驗證，以及最壞情況用量：`max_instances`、`sleepAfter` 各套用在哪些容器類別、同時開啟的預覽數上限。

## 待決定

- [ ] 在 Domains 頁面加入 CMS 網址設定流程
  - 目前 Domains 頁面只管理 storefront 網址，例如 `www.example.com`。
  - CMS 網址（例如 `shop.example.com`）屬於平台層設定，不應直接與 storefront 網域共用同一筆資料或權限流程。
  - 後續需決定是否在同一頁加入獨立的 CMS 網址區塊，以及是否提供設定、驗證、切換與回滾流程。
  - 實作時需同步處理 Cloudflare Custom Domain、`PUBLIC_URL`、`MORPH_CMS_HOSTNAME`、Better Auth trusted origins 與主機路由分流。
  - CMS 網址變更前需保留舊網址，確認新網址可用後才切換，避免管理後台被鎖定。

- [ ] SVG 進入 Theme `public/` 的方式（第 6 項）
  - v1 關閉，因為 SVG 可以夾帶腳本。
  - 需決定：上傳時清理（sanitize）並拒絕 script／外部參照、以 `Content-Security-Policy` 與 `Content-Disposition` 限制執行，或只允許以 `<img>` 引用。

- [ ] 專用 `.astro` 解析 Worker 的部署（2026-10-08）
  - M1（#141）量出解析器放不進 Morph 主 Worker；候選是專用解析 Worker 加 service binding，備選是 Sandbox 中的官方 Node 解析器。
  - 新增部署單位需要使用者核准。本機實驗 M1c 已完成（#145）：機制運作，但 GC 前的取樣在多個條件下超過 128 MB。部署後的雲端驗證（M1c-C）2026-10-08 以測試資源通過（Astro 計畫 3.1、8.2）。剩下的決定：是否正式部署解析器 Worker（新的部署單位）。

- [ ] 通用 Vite 託管（L1）的依賴與工具鏈政策（2026-10-08）
  - 要支援任意 Vite 框架，需決定建置 plugin 與工具鏈套件的放行方式、供應鏈風險、建置容器外連與建置時間（多框架計畫「未決事項」）。

- [ ] R2 未引用 blob 的清理與保留期（第 7 項）
  - `theme-source/{sha256}` 被 workspace、revision manifest、build 與 release 共用；只看 workspace 判定「未使用」會刪掉可回滾版本的檔案。
  - 需決定保留期、哪些 revision／release 受保護，以及清理的執行位置與稽核方式。
