# 預覽存取與撤銷規格

狀態：**設計草稿，尚未實作或安全驗收。** 2026-10-12 最初以 main `145a3ec` 唯讀核對程式，後續一般 merge main `48330aa` 並更新 #216 的交付狀態。目標是「預設私人草稿；分享是明確建立、可到期與撤銷的能力」，不是宣稱目前的預覽已符合此模型。

## 1. 產品界線

| 入口                   | 目標讀取權限                                                               | 可改什麼                                                               |
| ---------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Live Authoring Preview | 目前有權操作該 storefront／Theme 的作者；不得單憑持有 Sandbox URL 視為作者 | 所有儲存仍回既有 Morph server、欄位宣告與 OCC；iframe 不能自行授權寫入 |
| 私人 Build Preview     | 指定的成功 immutable build／必要的內容 publication，加上有效作者授權       | 唯讀，不包含編輯通道                                                   |
| 明確分享的 preview     | 作者刻意核發、有目的／資源／期限且可撤銷的 read-only capability            | 不可儲存、啟動／同步預覽、取得其他 Theme 或 admin 能力                 |
| 已發布網站             | 依既有 production release 的公開規則                                       | 不以草稿或分享能力代替正式發布                                         |
| 本機開發               | loopback 開發模式，不能當 production 的授權替代                            | 控制通道沿用本機 token；不要將開發執行器公開到 LAN／Internet           |

分享第一版優先使用 immutable build／內容快照，而不是隨作者修改而變動的 Live Preview；這是待核准的選擇。若要分享 live draft，必須另行明確決定可看到哪些未來修改及撤銷語意，不能默認。

## 2. 已核對的現況與證據限制

| 項目                    | 程式證據                                                                                                 | 本次能下的結論                                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 容器 Live Preview 入口  | `src/server.ts` 的 `proxyPreviewRequest`，轉交 Sandbox SDK `proxyToSandbox`                              | 此函式本身沒有 Morph 作者 session／Theme read 授權判定；不能把 URL 的不可猜測性當成撤銷能力                                                  |
| 平台憑證隔離            | `preview-proxy-credentials.ts` 的 `previewRequestFor`／`previewRequestHeaders`／`withoutPlatformCookies` | 去除 Morph 的平台憑證 cookie 與 `x-morph-*`；不是 preview read 的授權檢查。Theme 自己的 Authorization 與 cookie 另有用途，不能全刪來替代授權 |
| 本機 sidecar 控制通道   | `local-preview-sidecar.ts`／`.protocol.ts`                                                               | 控制 API 有 process token、loopback 和 production refusal；不能誤寫成「sidecar 所有接口都沒有認證」                                          |
| 本機 Theme 預覽內容     | 前次 #206 的瀏覽器觀察：iframe 對 preview 的請求未帶 Morph cookie，已同步內容在鎖定後仍可載入            | 是前次本機證據；本次沒有重跑，不能推定容器也完全相同                                                                                         |
| 編輯器帳號鎖            | `editor-read-lock.ts`、`send-editor-write.ts`、shell 的現行 gate                                         | 保留草稿在記憶體，隱藏／inert 與禁止儲存不是資料隔離。不能保證另一帳號用 devtools 讀不到原資料                                               |
| 私人 Build Preview 能力 | `build-preview/build-preview-capability.ts` 的 `verifyBuildPreviewCapability`                            | 有 stored token hash、期限、撤銷、user／build／release 檢查，可作延伸起點，不代表容器 Live Preview 已套用                                    |
| 其他 preview token      | `theme-build-preview-token.ts`、preview-media 簽章及各自的 consumer                                      | 各自有範圍；不能把一條已驗證路徑當成所有入口都受同樣保護                                                                                     |

容器權限撤銷、URL 的實際生命週期、直接 SDK endpoint／預覽 host 是否存在繞過、長連線的撤銷，以及跨 origin 作者認證，均未在本次實測。先前對 token 位元數的描述不是本規格的安全證明。

## 3. 私人預覽的必要條件

1. Core 是授權來源，使用既有登入／角色／ownership helper；不能相信 iframe 傳來的帳號、Theme、權限或 cookie 名稱。
2. 驗證 storefront、Theme、preview session／build，以及存取目的；其他帳號或資源的能力不可混用。
3. 私人 preview 的開啟或續期，必須來自目前有效作者授權。跨 origin iframe 所需的 credential exchange 留待實作設計，不能把 admin cookie 送進 Theme，也不能僅靠 editor 的鎖定畫面保護資源。
4. 撤銷 Theme 權限、偵測換帳號、Theme 刪除、preview 停止後，舊憑證不能讀取新回應；不因「之前驗證過」或 keepalive 自動延長。
5. 登出政策要區分私人作者預覽與另行核發的分享。私人作者憑證在登出／帳號切換後失效；明確分享能否獨立存在由分享政策決定，不能讓私人 URL 默默變成分享 URL。
6. 網路／500／驗證無回應不是已撤銷的證據，但也不能當成授權成功；既有 UI 保留草稿，受保護資源驗證不明時 fail closed。

「權限撤銷後不能再讀」指伺服器發出的新資料，不保證抹除已交付的 bytes、瀏覽器 DOM、記憶體、截圖或下載檔案。

## 4. 分享能力的必要條件

- 明確的核發動作、可辨識的分享狀態、到期時間、作者與稽核紀錄；尚未做這個動作的 URL 不視為公開分享。
- resource scope 至少涵蓋 storefront、Theme、固定 build／publication（若是 live，另含 session）；purpose 固定 preview-read。
- 過期、撤銷、資源消失或建立者不再有核發權限時拒絕；預設不得自動續期。可否轉移核發者、哪些權限變更使分享失效，需明確定案並測試。
- 不暴露原始碼、其他草稿、其他 preview、內部控制 API、資產庫查詢或一般 admin token；正常供 Theme 執行的必要資源另訂 bounded allowlist。
- 持有分享 URL 的人可能轉傳；不宣稱 bearer URL 等同「僅某位受邀者可看」。若要指定收件人，另加身分要求。
- 不允許 share holder 透過 postMessage 或 browser request 保存、建置、發布、延長／重啟 session。

## 5. 所有資料入口都要受同一邊界保護

必須盤點 document、內容 JSON、JS／CSS／圖片、Vite 模組、source map、HTTP HMR relay、WebSocket／SSE、preview media 與重啟後的舊 URL。

- 即使只取得 JS／JSON，也可能得到草稿；不能只保護 HTML。
- Worker 檢查只有在所有可達入口都經過它時才有效。直接 Sandbox／SDK origin 或別名能繞過時，先關閉繞過或讓同一授權檢查覆蓋它，不新增第二套 auth。
- SDK 的 port token 是基礎設施能力，不自動等於 Morph 的作者／分享授權。只輪換它可能影響其他作者的共用 session，須先證明資源粒度。
- 撤銷後拒絕新請求並終止已建立的授權資料流；選擇可保證的期限／檢查機制。未完成長連線與 cache 驗證前不得宣稱即時撤銷。
- 私人回應不能落入可被別人命中的共享 cache。測試含撤銷後 cache hit、conditional GET／304、跨資源能力重放；必要標頭與快取政策由 serving shared primitive 收斂。
- URL、token、credential exchange 與 referer／log 的處理需避免外流；報告只保留去識別化資料。短期限不取代撤銷。

## 6. 延伸既有架構，不新增平行通道

實作前追查各入口的 route → server／proxy → service → DAL／capability → preview runtime。以現有 Build Preview capability、授權與 serving 邊界作候選延伸點，而不是新造通用 token service。

需要另外確認：跨 origin 私人預覽如何拿到受約束的 browser credential；現有 verifier 是否覆蓋目前 Theme 的 ownership／角色撤銷；SDK URL 是否可繞過；撤銷事件如何與 request、已送出的寫入與 session 終止競態配合。

既有 Document／source 儲存、OCC、content ticket、fenced workspace 寫入、發布與 rollback 不變。A6b-2 的內容同步已在 #216 合併，不在本規格實作；完整 Start 的主要流程與本機 Astro 容器同步／island HMR 有驗收證據，但不等於 Astro Design、正式 Cloudflare 全面支援或 preview read 授權已完成。

## 7. 專用資源驗收矩陣

本表是**未執行的驗收計畫**。先另行取得本機／Cloudflare 專用資源與部署授權，不使用正式商店、其他 session 的容器或共用 credential。

| 案例                             | 必須觀察                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| 作者 A 正常開啟私人 preview      | HTML、JSON、模組等必要請求可用；Theme 不收到平台 session／secret                    |
| 帳號 B、未登入、其他 Theme 能力  | 不交付 A 的私人 bytes；不得依賴 UI 隱藏作判定                                       |
| A 的 Theme 權限撤銷              | 原 URL／credential 的 HTML、內容與模組請求被拒；不是僅讓保存失敗                    |
| 帳號切換／登出後重開舊 URL       | 私人憑證不能繼續取得原帳號的草稿；UI 留存資料與伺服器新回應分開記錄                 |
| 關閉、重啟、重建預覽             | 舊 session 能力無效；新 session、其他作者的 preview 不被錯殺                        |
| 明確分享                         | 指定快照唯讀可看，其他資源拒絕；到期、撤銷及核發者失去權限後舊 URL 被拒             |
| 撤銷時仍有 HMR／長連線           | 既有資料流終止，重連被拒；不能繼續接收後續草稿                                      |
| 已快取、304、直接 SDK／替代 host | 不能透過 cache／別名繞過驗證；已下載內容不宣稱能收回                                |
| debounce／佇列／已送出的寫入     | 保留 #206 的 gate 行為；新保存不送出，既有請求結果不解鎖／自動重送                  |
| 本機 sidecar                     | 控制 token、loopback、production refusal 不退步；另量測 Theme dev-server 的內容入口 |
| transport 差異                   | 本機證據不當成 Cloudflare 容器證據；兩種傳輸分開驗收                                |

每次記錄固定 head、transport、角色／資源狀態、回應與去識別化 trace；有 output 但缺平台證據時不當成正式通過。

## 8. 仍待決與本次不做

- 首版分享只接受 immutable build／publication，或要包含 live draft。
- 私人預覽 credential 的期限、撤銷檢查與長連線截止機制；不把 SDK token 熵當產品授權。
- 舊預覽 URL／已存在能力的遷移政策，不能在未驗證時假裝它們已撤銷。
- cloud 資源、實測、程式變更、migration、部署與合併均需另外授權。

本 PR 只有規格。沒有新增權限路徑、建立分享 UI、輪換 token、關閉 preview 或處理既有使用者資料。
