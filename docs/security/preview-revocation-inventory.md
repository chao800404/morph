# 預覽存取撤銷：現況盤點（唯讀）

**狀態。** 現況盤點，不是設計，也不是修正。不改產品程式，沒有對 Cloudflare 執行任何東西，沒有跑任何新測試。
**核對基準。** main `468a9f4`；`@cloudflare/sandbox` 0.12.7（`package.json:68`），SDK 行號指 `node_modules/@cloudflare/sandbox/dist/sandbox-CcCJwCbh.js`。
**問題。** Live Preview 透過帶 token 的能力網址（capability URL）取用。持有網址的人，在作者失去存取權（被移出、登出、角色改變），或預覽停止又重新啟動之後，是否還能繼續讀到草稿內容？
**前提（使用者的框架）。** 能力網址本身是可接受的授權方式。網址使用隨機 token，目前主要風險不是被猜中，而是撤銷是否符合產品承諾。

本文不放任何真實 token、預覽主機名稱或密鑰；主機一律寫成 `<previewHostname>` 之類的佔位符。本文不分嚴重度。

## 0. 標記

| 標記       | 意思                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| 【程式碼】 | 讀過所列程式碼（observed in code）。不等於執行過。                                                    |
| 【推論】   | 由程式碼推得，沒有任何執行證據（inferred）。                                                          |
| **A**      | 已撤銷**且已驗證**：有人實際跑過的測試或執行，證明舊網址或 token 不再提供內容。只讀程式碼不能列為 A。 |
| **B**      | 有撤銷動作但**未驗證**：程式會刪除或作廢某些東西，但沒有人證明舊網址之後確實失效。                    |
| **C**      | **沒有處理**，或**刻意保留**。每項寫明是哪一種。                                                      |

## 1. 會把預覽內容送到瀏覽器的路徑，與各自的授權檢查

### 1.1 Live Preview（Cloudflare Sandbox 容器）

- **網址形狀**：`<port>-<sandbox>-<token>.<previewHostname>`。token 在主機名稱的第一個 label 裡。
- **伺服端入口**：Worker 的 `proxyPreviewRequest`（`src/server.ts:248–303`，在 `:334–337` 呼叫；`/api/store/*` 不經過它）。
  - `isSandboxPreviewRequest` 只檢查主機名稱的**形狀**是否在 `THEME_PREVIEW_HOSTNAME` 之下（`src/lib/storefront/service/preview-proxy-credentials.ts:44–57`）。
  - `previewRequestFor` 移除平台 cookie 與 `x-morph-*` 標頭（同檔 `:60–82`），再交給 SDK 的 `proxyToSandbox`。
  - SDK 依 port 與 token 比對 Durable Object 裡存的 token，並要求該 port 已在**目前的 runtime** 啟用（`validatePreviewURLForRuntime`，SDK `:10124–10175`；在 `:9074` 呼叫）。
- **授權檢查**：**只有 token**。不檢查 Morph 登入、使用者、角色或 session【程式碼】。
- **容器內提供的內容**：容器啟動時收到已授權讀出的草稿快照（`src/server.ts:331–333` 註解），之後 `syncThemePreviewContent` 會把已存的草稿推進同一個容器（`src/server/storefront/storefront-theme-preview-server.serverFn.ts:391`）。所以持有網址的人看到的是**作者目前同步進去的最新草稿**，以及 Vite dev server 提供給預覽頁的 Theme 原始碼模組【推論：後者由 dev server 的運作方式推得，未逐一核對可讀路徑】。

### 1.2 取得 Live Preview 網址的 server function

都經過 `commerceAdminMiddleware`（全域 `admin` 角色，`src/server/middleware/auth.middleware.ts:180–183`），在**呼叫當下**檢查。

| server function                                         | 位置                  | 回傳網址？                                                   |
| ------------------------------------------------------- | --------------------- | ------------------------------------------------------------ |
| `startThemePreviewServer`                               | `serverFn.ts:115–286` | 是（`:266–270`，先經 `admitAddress` 再檢查一次，`:246–264`） |
| `applyThemePreviewFiles`                                | `serverFn.ts:777` 起  | 必要時重新 expose（`:881–909`），回傳的是位址摘要，不是網址  |
| `syncThemePreviewContent`、`confirmThemePreviewContent` | `:391`、`:475`        | 否                                                           |
| `touchThemePreviewServer`、`probeThemePreviewAddress`   | `:620`、`:679`        | 否；網址由編輯器放在 POST body 傳入，伺服器只記摘要          |
| `stopThemePreviewServer`                                | `:577–600`            | 否                                                           |

- `startThemePreviewServer`、`applyThemePreviewFiles` 與上表其他五個預覽 server function，都以**呼叫者自己的** `context.user.id` 推導 `previewId`（`serverFn.ts:132–136, 404–408, 499–503, 584–588, 639–643, 695–699, 796–800`；推導在 `src/lib/storefront/service/theme-preview-session-id.ts:56–83`，內容為 `storefrontId + themeId + userId` 的 SHA-256）【程式碼】。
- Morph session 有 5 分鐘的 cookie 快取（`src/auth/index.ts:109–113`）。角色降級或 session 撤銷，最多可能要約 5 分鐘才會被這些 server function 看到【推論，依 Better Auth 行為】。

### 1.3 Build Preview（隔離建置預覽）與發布版預覽

- **網址形狀**：`bp-<token>.<previewHostname>`。token 是 20 bytes 亂數、hex 編碼（`src/lib/storefront/service/build-preview/build-preview-capability.ts:34–35, 71–73`），主機在 `:84–89` 組成。
- **伺服端入口**：`src/server.ts:325–329` → `serveBuildPreviewRequest` → `handleBuildPreviewRequest`（`src/lib/storefront/service/build-preview/build-preview-request.ts:262–336`）。
- **授權檢查**：**每個請求**都跑 `verifyBuildPreviewCapability`（`build-preview-capability.ts:199–240`）。檢查以下各項：
  - token 雜湊存在；
  - 未撤銷；
  - 未過期（預設 1 小時，`:33, :168–170`）；
  - 持有者仍存在、未被封鎖、**目前**仍是 `admin`（`mayPreview`，`:114–116`）；
  - build／release 仍可預覽。

  不檢查 Morph session【程式碼】。

- **取得網址**：`openBuildPreview`、`openReleasePreview`（`src/server/storefront/build-preview.serverFn.ts:83–137, 149–207`），都經過 `commerceAdminMiddleware`。
- **儲存**：只存 SHA-256（`build-preview-capability.ts:75–81`；`storefront_build_preview_capabilities`，`src/db/storefront.schema.ts:689–719`）。

### 1.4 舊式靜態建置預覽 `/preview-build/<buildId>/<token>/`

- **網址形狀**：Morph 自己網域上的路徑（`src/routes/preview-build/$buildId/$token/$.ts`）。
- **token**：無狀態的 HMAC，內容含 build、商店、Theme、`expiresAt`、nonce，**不含使用者**（`src/lib/storefront/service/theme-build-preview-token.ts:16–24`），有效期 1 小時。
- **授權檢查**：帶 token 時只驗 HMAC 與有效期，不檢查 session（`src/lib/storefront/service/theme-build-preview.service.ts:158–202`）【程式碼】。
- **發放**：`createThemeBuild`、`getPreviewBuildToken`（`src/server/storefront/storefront-theme-builds.serverFn.ts:105–118, 333–342`），以及發布截圖（`src/server/release-preview-capture.ts:57`）。

### 1.5 本機 sidecar（只在開發）

- **sidecar 本身**：明確綁定 `127.0.0.1`（`src/lib/storefront/service/local-preview-sidecar.ts:397–406`），正式環境拒絕啟動（`:141–145`）。每個請求要帶 `x-morph-local-preview-token`，以常數時間比對（`local-preview-sidecar.protocol.ts:85, 195–231`）。這是一個靜態的操作者 token，不分使用者。
- **編輯器 iframe**：直接載入 sidecar 啟動的 dev server，`http://127.0.0.1:<port>/…`，沒有 token（`src/lib/storefront/compiler/local-vite-preview-server.ts:717, 800–801`；`theme-preview-server-origin.ts:186–214`）。同一台機器上的其他程式或網頁都能連到它【推論】。

### 1.6 編輯器的 iframe

都在 `src/routes/_editor/-components/visual-editor-shell.tsx`：

| iframe        | 位置           | `sandbox`                                                                                                           | `referrerPolicy` |
| ------------- | -------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Live Preview  | `:11808–11829` | `allow-same-origin allow-scripts`（跨網域時才產生網址，`src/lib/storefront/editor/live-preview-security.ts:35–77`） | `same-origin`    |
| Build Preview | `:11579–11587` | 同上                                                                                                                | `no-referrer`    |
| 發布版預覽    | `:11536–11544` | 同上                                                                                                                | `no-referrer`    |
| 舊式靜態預覽  | `:11589–11596` | `allow-scripts`                                                                                                     | `no-referrer`    |

iframe 的 `referrerPolicy` 只管編輯器載入這個 frame 的那一個請求，管不到預覽頁自己發出的請求（見 §4）。

## 2. Live Preview token 的生命週期

| 時點                 | 行為                                                                                                                                                                                                                | 依據                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 產生                 | 12 bytes 亂數，base64 後把 `+`、`/` 都換成 `_`、去掉 `=`、轉小寫                                                                                                                                                    | SDK `:10219–10223`【程式碼】                                                                                   |
| 何時產生             | `exposePort` 時，若該 port **沒有既存 token** 且呼叫者沒指定 token 才產生；Morph 不指定 token                                                                                                                       | SDK `:9920`；Morph 呼叫在 `cloudflare-sandbox-vite-preview-server.ts:996–999`、`serverFn.ts:898–904`【程式碼】 |
| 儲存                 | SDK 的 Durable Object 儲存 `portTokens`，明文                                                                                                                                                                       | SDK `:7175, :9917–9929`【程式碼】                                                                              |
| 回給用戶端           | `startThemePreviewServer` 回傳完整網址，編輯器直接設成 iframe `src`                                                                                                                                                 | `serverFn.ts:266–270`；shell `:11808–11829`【程式碼】                                                          |
| 沿用                 | 同一個 port 已是 active 時，Morph 直接沿用該網址                                                                                                                                                                    | `cloudflare-sandbox-vite-preview-server.ts:984–994`【程式碼】                                                  |
| 再次 expose          | 該 port 的 token 還在 `portTokens` 裡時，**沿用同一個 token**                                                                                                                                                       | SDK `:9920`（`options.token ?? existingEntry?.token ?? generatePortToken()`）【程式碼】                        |
| 輪替                 | 沒有任何程式主動輪替                                                                                                                                                                                                | 【程式碼】                                                                                                     |
| 作廢：`unexposePort` | 刪除該 port 的 token 與 activation                                                                                                                                                                                  | SDK `:9962–9980`【程式碼】                                                                                     |
| 作廢：`destroy()`    | 刪除整個 `portTokens` 與所有 activation                                                                                                                                                                             | SDK `:8508–8516`【程式碼】                                                                                     |
| 閒置休眠             | 10 分鐘（`setSleepAfter`，`cloudflare-sandbox-vite-preview-server.ts:446, :1015`）。**沒有刪除 token 的程式**；`portTokens` 只在 `destroy()` 被刪（SDK `:8515` 是唯一的 `storage.delete(PORT_TOKENS_STORAGE_KEY)`） | 【程式碼】                                                                                                     |
| 休眠後               | activation 不屬於新 runtime，請求被判為 `stale`（SDK `:10140–10175`）；下次 `start` 或 `apply` 重新 expose 時，依上面那一列，會沿用舊 token                                                                         | 【推論】，見下方矛盾                                                                                           |

**程式碼註解互相矛盾，沒有人驗證過。**

- **Morph 的說法**：`touchThemePreviewServer` 的註解寫「re-exposing mints a new address while the old one stops resolving」（`serverFn.ts:605–618`）。
- **SDK 的程式碼**：在 0.12.7 的程式碼中，休眠不會刪除 `portTokens`，而重新 expose 會沿用既存的 token。
- 兩者說法不同，而且都沒有執行證據。
- 依 SDK 的程式碼推論：預覽從休眠醒來、重新 expose 之後，**同一個舊網址會再次提供內容**。這只是推論。

## 3. 撤銷時會發生什麼

**整體結論。**

- **沒有任何程式**會在使用者被降級、被封鎖、被刪除、登出或 session 被撤銷時，去動預覽相關的狀態，包括已 expose 的 port、sandbox、Build Preview 能力、內容 ticket。
- 這個系統**沒有「商店成員」模型**：角色是全域的（`admin`／`user`／`guest`，`src/auth/permissions.ts:15–30`），沒有 organization 或 member 資料表。所以「被移出商店」只可能是全域角色改變、被封鎖或被刪除。

| #   | 事件或機制                                               | 程式行為                                                                                                                                                                              | 依據                                                                                                                                                                                                                                                                                                   | 狀態                                                                                  |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| R1  | 角色降級、封鎖、刪除使用者 → **Live Preview 網址**       | 沒有任何程式反應；代理只看 token                                                                                                                                                      | `src/server.ts:248–303`；Better Auth 只有 `user.create.before` 一個 hook（`src/auth/index.ts:145–160`）                                                                                                                                                                                                | **C：沒有處理**                                                                       |
| R2  | 登出、撤銷 session、閒置自動登出 → **Live Preview 網址** | 沒有任何程式反應                                                                                                                                                                      | `src/components/nav/app-sidebar.tsx:105–111`、`src/components/provider/idle-timer-provider.tsx:84`、`src/server/auth/revoke-session.serverFn.ts:10–65`                                                                                                                                                 | **C：沒有處理**                                                                       |
| R3  | 作者主動停止預覽 → `stopThemePreviewServer`              | 呼叫 `unexposePort` 與 `destroy()`，刪除 token（`cloudflare-sandbox-vite-preview-server.ts:1383–1389`）。但**編輯器介面從不呼叫它**，只有 E2E 與啟動失敗路徑（`serverFn.ts:251`）呼叫 | E2E `e2e/astro-preview-container.spec.ts:211` 呼叫它，但只驗證重啟後顯示新草稿，**沒有驗證舊網址失效**                                                                                                                                                                                                 | **B**（產品中實際上不會觸發）                                                         |
| R4  | 閒置 10 分鐘休眠                                         | 容器休眠；token 留在 DO；舊網址在休眠期間被判為 `stale`                                                                                                                               | SDK `:10140–10175`                                                                                                                                                                                                                                                                                     | **C：沒有處理**（休眠不是撤銷；是否刻意未知）                                         |
| R5  | 休眠後重新 expose（作者再次開啟編輯器）                  | 依 SDK 程式碼沿用舊 token；舊網址會再次提供內容                                                                                                                                       | 【推論】§2；和 Morph 註解矛盾                                                                                                                                                                                                                                                                          | **C：沒有處理**（若推論成立；需驗證，見 G3）                                          |
| R6  | 角色降級、封鎖、刪除 → **Build Preview 能力**            | 每個請求都重新檢查持有者目前的角色與封鎖狀態                                                                                                                                          | `build-preview-capability.ts:114–116, 216–218`；測試 `build-preview-capability.test.ts:188`「stops working when its user loses access」，以真實 SQLite 與遷移檔，把角色改成 guest、封鎖、刪除，三種都被拒。該測試在 #248 的 CI run 38891682353（merge `dfb4486`，基於 main `468a9f4`）的單元測試中通過 | **A**（驗證的是 `verifyBuildPreviewCapability`；沒有驗證經過真實 HTTP 的 `bp-` 主機） |
| R7  | 登出或撤銷 session → **Build Preview 能力**              | 不檢查 session，所以沒有影響；直到 1 小時過期                                                                                                                                         | `build-preview-capability.ts:199–240`                                                                                                                                                                                                                                                                  | **C：沒有處理**                                                                       |
| R8  | 重新開啟同一個 build／release 的預覽                     | 作廢同一使用者先前的能力                                                                                                                                                              | DAL `storefront-build-preview-capability.dal.ts:54–92`；測試 `build-preview-capability.test.ts:168`                                                                                                                                                                                                    | **A**（同 R6 的範圍限制）                                                             |
| R9  | **舊式靜態預覽** HMAC token                              | 不含使用者，無法撤銷；1 小時過期，或輪替密鑰時失效                                                                                                                                    | `theme-build-preview-token.ts:16–24, 142–145`                                                                                                                                                                                                                                                          | **C：沒有處理**                                                                       |
| R10 | Theme sync 能力（`morph-sync`），角色降級、封鎖、刪除    | 每個請求重新檢查角色與封鎖狀態                                                                                                                                                        | `theme-sync-capability.ts:88–90, 154–156`；測試 `theme-sync-capability.test.ts:115`                                                                                                                                                                                                                    | **A**（不屬於預覽，但同類；登出不影響它，屬 C）                                       |
| R11 | 預覽內容 ticket                                          | 沒有 user 欄位、沒有到期、沒有刪除；只在商店或 Theme 刪除時隨 FK 刪除                                                                                                                 | `src/lib/storefront/dal/storefront-preview-content-ticket.dal.ts`；`src/db/storefront.schema.ts:771–784`                                                                                                                                                                                               | **C：沒有處理**（ticket 只排序同步，本身不給讀取權）                                  |
| R12 | 使用者被刪除後的能力資料列                               | `user_id` 沒有 FK，資料列留著；驗證時 join 不到使用者而拒絕                                                                                                                           | `schema.ts:706, :744`                                                                                                                                                                                                                                                                                  | Build Preview 屬 **A**（同 R6 測試的刪除情境）；資料列殘留屬 **C**（沒有清理工作）    |

**第二位作者能否取得或重用同一個網址。**

- 透過 Morph 的 API：**不能**。上述七個 server function 都以呼叫者自己的使用者 ID 推導 `previewId`，所以第二位作者只會啟動、取得他自己的預覽【程式碼】。
- 透過其他途徑：唯一的方式是網址被分享或外洩（§4）。
- `previewId` 是商店、Theme、使用者 ID 的 SHA-256（`theme-preview-session-id.ts:72–82`），不是祕密。但它只決定 sandbox 名稱，取得內容仍需要 token【程式碼】。
- 因此「停止或輪替預覽會影響其他作者」的情況，在目前的資料模型下不存在：每位作者各自一個 sandbox。

## 4. 網址可能外洩的地方

| #   | 位置                                                                                                                                                                                                                         | 帶完整 token？                                                                                             | 依據                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | **Build Preview 的出站 log**：`[build-preview-egress]` 記錄 `destination`，也就是 `protocol//host`；而容器讀內容的來源就是 `bp-<token>` 主機。每次讀自己的內容都記一行（每個容器最多 20 行）；被拒時，拒絕訊息的內容也包含它 | **是**                                                                                                     | `build-preview-egress.ts:50–57, 65–89, 91–96, 136`；內容來源 `build-preview-request.ts:226–233, 244`；Workers observability 開啟（`wrangler.jsonc:39–41`），所以會進入 Cloudflare log【推論】 |
| L2  | Live Preview 代理的觀察 log                                                                                                                                                                                                  | 否：只有 sandbox id、port、pathname，刻意不含 token                                                        | `preview-proxy-observation.ts:27–44, 138–148`                                                                                                                                                 |
| L3  | 啟動、續期、探測的 log                                                                                                                                                                                                       | 否：主機的 12 字元 SHA-256 摘要                                                                            | `preview-server-observation.ts:230–239`；`serverFn.ts:737–743`                                                                                                                                |
| L4  | Live Preview 的出站拒絕 log                                                                                                                                                                                                  | 只記主機名稱；只有 Theme 的伺服端程式去連自己的預覽主機時，才會帶到 token【推論，邊緣情況】                | `preview-egress-policy.ts:23–59`                                                                                                                                                              |
| L5  | 回給用戶端的錯誤訊息                                                                                                                                                                                                         | 否：只有原因碼                                                                                             | `build-preview-request.ts:54–73`；`serverFn.ts:238–263`                                                                                                                                       |
| L6  | **預覽回應沒有 `Referrer-Policy`**：預覽頁自己向第三方發請求時，瀏覽器預設的 `strict-origin-when-cross-origin` 仍會在 `Referer`／`Origin` 送出含 token 的主機名稱                                                            | **是**（主機名稱即 token）【推論】                                                                         | `preview-proxy-response.ts:128–132`；`build-preview-request.ts:391–399`；全專案只有正式店面設定了 `Referrer-Policy`（`storefront-production.service.ts:80`）                                  |
| L7  | 產品顯示或可分享的連結                                                                                                                                                                                                       | 否：「在新分頁開啟預覽」已停用；沒有複製或分享預覽網址的功能                                               | shell `:12377–12386, :11515–11526`                                                                                                                                                            |
| L8  | 持久化                                                                                                                                                                                                                       | Live Preview token 明文存在 SDK 的 DO；Build Preview 只存雜湊；編輯器只放在 React state，不寫 localStorage | SDK `:9917–9929`；`build-preview-capability.ts:75–81`；shell `:7088, :10611`                                                                                                                  |
| L9  | 編輯器傳回伺服器                                                                                                                                                                                                             | 是：`touch`／`probe` 的 POST body 帶完整來源，伺服器只記摘要                                               | `serverFn.ts:94–104, 627, 686`                                                                                                                                                                |
| L10 | 第三方服務                                                                                                                                                                                                                   | 是：發布截圖把舊式 `/preview-build/<buildId>/<token>/` 網址送到 Cloudflare Browser Rendering               | `src/server/release-preview-capture.ts:41–76`；`browser-run-screenshot.service.ts:43–52`                                                                                                      |

## 5. 缺口清單與測試設計（只設計，不執行）

所有測試都必須在**專用的測試資源**上跑：專用的 Cloudflare 帳號或 sandbox namespace、專用預覽網域、專用測試使用者。不得使用任何正式資源。測試輸出不得記錄真實 token；比較時只記雜湊。

| #   | 缺口                                                                         | 證據                                        | 狀態                                                             | 測試要證明什麼                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | 角色降級、封鎖、刪除後，Live Preview 舊網址仍提供草稿                        | R1；代理只看 token                          | **C：沒有處理**                                                  | 作者 A 啟動預覽並記下網址 → 以第二個 admin 把 A 降成 guest（或封鎖、刪除）→ 等過 5 分鐘 cookie 快取 → 以**未登入**的用戶端請求舊網址：仍回 200 並含 A 的最新草稿，就證實缺口存在                            |
| G2  | 登出或撤銷 session 後，舊網址仍提供草稿                                      | R2                                          | **C：沒有處理**                                                  | 同 G1，改成 A 登出或撤銷所有 session                                                                                                                                                                        |
| G3  | 休眠醒來後舊網址再次提供內容                                                 | R4、R5；SDK 沿用 token，與 Morph 註解矛盾   | **C：沒有處理**（推論，未驗證）                                  | 啟動並記下網址 → 不再 touch，等超過 10 分鐘 → 請求舊網址，預期非 200 → A 重新開啟編輯器（觸發重新 expose）→ 比較新舊網址的 token 雜湊是否相同，並再請求舊網址。若回 200，就證實「重新 expose 沿用舊 token」 |
| G4  | 產品中沒有任何路徑會 `unexposePort`／`destroy`                               | R3；`stopThemePreviewServer` 沒有介面呼叫者 | **C：沒有處理**                                                  | 確認編輯器關閉、登出時都沒有請求打到 `stopThemePreviewServer`（網路紀錄），且舊網址在休眠前仍回 200                                                                                                         |
| G5  | `stop` 之後舊網址失效，從未被驗證                                            | R3                                          | **B**                                                            | 啟動並記下網址 → 呼叫 `stopThemePreviewServer` → 請求舊網址，預期非 200 → 再啟動，確認新網址的 token 雜湊與舊的不同                                                                                         |
| G6  | Build Preview：登出不影響，最多再有效 1 小時                                 | R7                                          | **C：沒有處理**                                                  | 開啟 Build Preview 並記下網址 → 登出 → 請求舊網址，仍回 200 就證實                                                                                                                                          |
| G7  | Build Preview：降級後拒絕只在函式層驗證過，經過 HTTP 的 `bp-` 主機沒有驗證過 | R6                                          | **A**（函式層）；HTTP 層屬 **B**                                 | 開啟後降級 → 請求舊網址，預期 403 `USER_NOT_AUTHORIZED`                                                                                                                                                     |
| G8  | 舊式 HMAC token 無法撤銷                                                     | R9                                          | **C：沒有處理**                                                  | 取得 token → 降級或刪除使用者 → 1 小時內仍可讀，就證實                                                                                                                                                      |
| G9  | Build Preview token 完整寫進 log                                             | L1                                          | **C：沒有處理**                                                  | 在測試環境開啟一次 Build Preview，搜尋 Workers log 中 `[build-preview-egress]` 那幾行，確認是否含 `bp-` 加 token 的主機（只比對雜湊，不保存原文）                                                           |
| G10 | 預覽頁對第三方送出含 token 的 `Referer`／`Origin`                            | L6                                          | **C：沒有處理**（推論）                                          | 在測試 Theme 中向測試用的第三方端點發出請求，檢查收到的 `Referer`／`Origin` 是否含預覽主機                                                                                                                  |
| G11 | 本機 dev server 的預覽沒有 token                                             | §1.5                                        | **C：刻意保留**（只在開發、只綁 loopback；是否接受由使用者決定） | 不需要遠端資源；在本機確認另一個本機程式可以直接讀取                                                                                                                                                        |
| G12 | session 角色有約 5 分鐘延遲                                                  | §1.2                                        | **C：刻意保留**（Better Auth 的快取設定；是否接受由使用者決定）  | 降級後，在 5 分鐘內呼叫 `startThemePreviewServer` 是否仍成功                                                                                                                                                |

## 6. 可能的方向（只列選項，不設計、不實作）

存取模型必須先決定。任何修正都要走既有的授權與預覽 ticket 契約，不另建機制。

- 停止或休眠時一律 `unexposePort`，讓每次重新開啟都產生新 token，並把「作者離開」接到既有的停止路徑。
- 代理請求時，對照目前的授權（例如經由既有的預覽 ticket 或能力記錄）再檢查一次，做法與 Build Preview 每次請求都驗證一樣。
- 在降級、封鎖、刪除、登出的路徑上，主動停止該使用者的預覽；但目前沒有「使用者 → 預覽」的索引（只能由商店、Theme、使用者推導）。
- 預覽回應加上 `Referrer-Policy`；Build Preview 的出站 log 改記主機摘要。

## 7. 需要使用者決定的產品問題

1. **預覽是可以分享的連結，還是只給「目前有權限的作者」看？** 如果可以分享，R1、R2 可能屬於刻意保留；如果不行，它們是缺口。
2. **一個預覽網址可以存活多久？** 目前 Live Preview 沒有固定期限，作者持續開著就一直有效；Build Preview 是 1 小時。
3. **草稿可能包含什麼？** 例如尚未公開的價格、文案、內部連結；Theme 原始碼是否也算在預覽的保護範圍內。
4. **休眠後重新開啟，是否應該換一個新網址？**（G3）
5. **本機開發的預覽沒有 token，是否可以接受？**（G11）
