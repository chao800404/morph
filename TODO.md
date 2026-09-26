# 未完事項列表

這份清單記錄尚未決定實作方式的事項。完成前先保留目前架構與安全邊界，不以暫時性的 UI 或資料欄位假裝已完成。

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

- [ ] R2 未引用 blob 的清理與保留期（第 7 項）
  - `theme-source/{sha256}` 被 workspace、revision manifest、build 與 release 共用；只看 workspace 判定「未使用」會刪掉可回滾版本的檔案。
  - 需決定保留期、哪些 revision／release 受保護，以及清理的執行位置與稽核方式。
