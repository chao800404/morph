# Morph 安全、架構與 Visual Editor 後續規劃

日期：2026-09-05。基準：`d7f4c76` 加上工作樹內尚未提交的 image/video/media picker 修改。

本次是跨模組、依風險深入的程式碼審查，涵蓋入口路由、認證授權、Assets、購物車／庫存／付款、Theme Source、contentFields、Preview、Build、Release、production runtime、CI 與依賴。不是逐行證明整個 repository 安全，也不是對線上部署的滲透測試。沒有修改業務程式、資料庫或線上資源。

結論：Source／Document 分工與 immutable revision → build → release 的方向應保留。主要問題在跨步驟的一致性、失敗恢復、公開媒體交付，以及 Preview 與正式 runtime 的契約差異。現有測試通過不能排除以下問題；不宜把目前狀態當成 production 安全驗收完成。

## 已確認問題

P1：優先修復，涉及憑證、資料完整性、發布或主要功能正確性。P2：重要缺陷／架構缺口，安排在對應功能擴充前。以下「程式碼確認」不代表曾在線上觸發。

### SEC-01 · P1 · 去背請求把登入 Cookie 傳給呼叫者指定的 URL

- 證據：`src/server/asset/remove-background.serverFn.ts:43` 接受外部 `imageUrl`；`:62-75` 將原始請求的 Cookie 帶入 `fetch(targetUrl)`。`src/cms.config.ts:71` 啟用此功能。
- 觸發：已登入 admin 提交外部 URL，或被流程誘導處理外部圖片。
- 影響：程式會把登入憑證放進外送請求，另有任意目的地 server fetch 的 SSRF 風險。這不是已證實的未登入攻擊；Cloudflare 圖片服務最終如何處理 Cookie、私網可達性未做線上驗證。
- 修復：assetId 優先由 storage 讀取；外部圖片只走明確的 URL／redirect／目的地政策，絕不轉送 CMS Cookie；補 timeout、回應大小上限與外送 headers 測試。

### SEC-02 · P1 · 初始管理員建立不是原子操作

- 證據：`src/server/middleware/ensureNoAdmin.middleware.ts:6` 先查無 admin；`src/server/auth/create-first-admin.serverFn.ts:23` 再透過 Better Auth 建立 admin。兩者之間無共同原子 claim。
- 觸發：初始化時兩筆不同 email 的請求同時通過檢查。
- 影響：兩筆都可能取得 admin。既有 admin 存在時的正常拒絕，以及 email unique，都不能防止這個競態。
- 修復：沿用 Better Auth，增加單次 bootstrap claim／狀態與失敗恢復；測試兩個並行初始化只有一個能成功。公開部署的首次初始化另應有部署端 bootstrap credential。

### DATA-01 · P1 · 過期庫存保留可能重複釋放

- 證據：`src/lib/inventory/dal/cart-reservation.dal.ts:80-108` 先列出過期 reservation，減掉 reservedQuantity，再另行軟刪除 reservation；`:120` 在購物車同步時執行清理。
- 觸發：兩個購物車請求讀到同一筆尚未刪除的過期 reservation。
- 影響：同一筆數量被減兩次，可能吃掉其他有效 reservation 的計數，讓庫存可用量虛增。`max(0, ...)` 只防負數，不防重複釋放。
- 修復：reservation claim 與對應庫存變更同一 atomic batch；檢查未刪除／仍過期前提，失敗不消耗其他 reservation。補交錯清理、renew 與 cleanup 競態測試。

### DATA-02 · P1 · Capture／Refund 的金額前提不在原子寫入內

- 證據：`src/lib/payment/dal/order-payment.dal.ts:51-110`、`:119-169` 先讀 balance／呼叫 provider，再插入新交易及寫入 `alreadyCaptured + amount`／`alreadyRefunded + amount`；沒有 CAS 或 operation idempotency。
- 觸發：兩次操作讀到相同剩餘可請款／可退款金額。
- 影響：ledger 可出現兩筆，而 aggregate 只保留一次增量。例如 captured=100，兩次並行 refund 100 可記錄退款總和 200，欄位卻仍是 100。
- 範圍：目前 registry 使用 manual provider，尚未證實外部金流重複扣款；本地記帳一致性問題已可由流程確認。
- 修復：operation idempotency、guarded amount reservation、provider operation identity 與補償／重試狀態；不可只把 update 改成加法，仍須防止超過額度。

### DATA-03 · P2 · Channel 授權晚於副作用或 early return

- 證據：`src/routes/_backend/api/store/$.ts:334` 先 renew cart，再以 salesChannelId 查詢；`src/lib/order/dal/checkout.dal.ts:75-87` 在 channel-scoped cart 查詢前回傳 existing order。
- 觸發：channel A context 帶入已知的 channel B cart ID。
- 影響：即使 GET 回 404，仍可延長 B 的 reservation；已完成的 cart 可回傳 B 的 order ID／display ID。沒有證實 cart ID 枚舉。
- 修復：先驗證 scope，再執行 renewal／idempotent completion；DAL 自身也接受並強制使用 channel scope。

### REL-01 · P1 · activeRelease CAS 不涵蓋整段部署

- 證據：`src/lib/storefront/service/storefront-release-reconciler.ts` 的 `activateReleaseWithDeployment` 先 CAS，後 await deploy；`src/lib/storefront/dal/storefront-release.dal.ts:232` 只有 active pointer 相等條件，沒有 in-flight deployment ownership。
- 本機重現：直接呼叫 production reconciler，使用記憶體 CAS 與延後完成的 fake deployer。A 把 old 改成 first 後停在 deploy；B 讀到 first，成功改成 second 並完成；A 最後完成。結果：`firstSuccess=true, secondSuccess=true, active=second, deployed=first, drift=true`。
- 這是實際 service 邏輯重現，沒有連線 Cloudflare。現有「CAS loser 不得 deploy」測試只驗證同一個舊 expected 值，不涵蓋後續請求讀到已 claim 的新值。
- Publish 額外以 theme releaseGeneration 作 guard，跨 Theme publish／rollback 也不共用完整 storefront 部署互斥範圍。
- 修復：在現有 reconciler 增加 storefront-scoped deployment operation、lease／fencing 或等價序列化；lease 必須涵蓋部署完成及確認。Publish／rollback 共用，加入 A 慢 B 快、跨 Theme、timeout、失敗還原測試。

### REL-02 · P1 · 發布部署失敗後，重試可能假成功

- 證據：`src/server/storefront/storefront-themes.serverFn.ts:234` 遇到 unchanged 就成功返回；`:293-297` 部署失敗只回錯誤。`src/lib/storefront/dal/storefront-theme.dal.ts:917-921` unchanged 不檢查實際部署；`:1044` 已先更新 active_release_id。
- 觸發：publish 寫入 D1 成功，部署失敗；刷新後重新發布同一份內容／source。
- 影響：重試被判定 already published，不會進 deploy；active pointer 和實際 Worker 仍不同。也可能出現新版 client assets／content 配舊版 Worker。
- 修復：把 desired release、deployment attempt、確認完成／drift 回復收斂到同一 workflow。內容沒變不代表 deployment 完成；重試必須恢復既有 operation，不應要求再改一句內容才能觸發。

### EDIT-01 · P1 · Inspector 舊快照可覆蓋同一 section 的新內容

- 證據：`src/routes/_editor/-components/editor-style-inspector.tsx:591-595` 僅依 section.id 同步 localProps；`:1554-1573` 從 local snapshot 合併並送出整份 props。
- 觸發：同 section 的 query refresh、排序／undo 結果或相同 section ID 的 template 切換後，再修改另一欄。
- 影響：新 draft generation 可以搭配舊 payload 寫入；OCC 不會替 client 判斷無關欄位是否過時。
- 修復：明確保存 server baseline、field-level pending changes、resource identity 與 acknowledgement。根據新 baseline rebase 未送欄位；不可只加一個 effect 無條件蓋掉使用者正在輸入的值。

### EDIT-02 · P1 · 內容存檔失敗失去待重試資料

- 證據：`src/routes/_editor/-components/visual-editor-shell.tsx:4152-4167` await mutation 前刪掉 pending props／baseline；`:937-954` 失敗只顯示錯誤；`:4123-4126` 已先同步 preview。
- 影響：遭拒的內容仍可能顯示在 Inspector／Canvas，但不再保留在 pending queue，缺少明確 retry／rollback。
- 修復：共同 content mutation coordinator 管理 queued／inflight／acknowledged／rejected，失敗保留 payload 與 resource scope；提供 retry、重新載入及衝突處理。加入 debounce 失敗、網路中斷、template 切換與 reload 測試。

### EDIT-03 · P1 · 空／非法 source declaration 會恢復 manifest 舊欄位

- 證據：`src/lib/storefront/theme-content-capability-resolver.ts:143` 保留 manifest capability；`:199`、`:266` 跳過無有效 fields 的 source declaration。Inspector `:734` 丟掉 diagnostics。
- 本機重現：manifest 宣告 outdated 欄位；source 分別改成 `contentFields = {}` 與 `contentFields = makeFields()`；兩者仍解析出 outdated。後者雖有診斷，仍保留舊可寫欄位。
- 影響：source 無法撤回 manifest capability，非法宣告 fail open；server 與 client 共用錯誤行為，並不是兩邊 resolver 相同就代表正確。
- 修復：解析結果區分 absent／valid（可為空）／invalid。只有 absent 可 fallback；invalid 必須阻止相關 content write 並顯示診斷。

### MEDIA-01 · P1 · CMS 媒體尚未接通匿名 storefront 交付

- 證據：`src/server/asset/create-items.serverFn.ts:404-415` 保存 `/assets/...`；asset mapper `:24` 原样回傳 URL；`src/lib/storefront/theme-media.ts:116` 原样傳給 Theme。
- `src/routes/_backend/assets/$.ts` 需要 CMS session 及 admin/user role。`src/lib/storefront/service/storefront-production.service.ts:92-107` 對 merchant hostname 僅處理 content endpoint、build manifest client asset 與 Theme Worker；CMS R2 asset 不在 build manifest。
- 影響：Editor 登入狀態可以顯示 CMS 媒體，但匿名 merchant 訪客的相對 URL 走到 Theme route，通常是 404；改成 platform 絕對 URL 也仍受登入限制。
- 這使上一輪「媒體功能完成」只能成立於欄位／儲存層，尚未完成 production delivery。没有執行線上 publish 來驗證實際 HTTP 回應。
- 修復：沿用公開 asset serving／publication boundary，讓已發布 reference 解析為可匿名讀取的版本化 URL；不能直接把整個 CMS `/assets` route 改成公開。

### MEDIA-02 · P2 · Asset reference 尚未成為可驗證及保留的關聯

- 證據：`src/lib/storefront/theme-content-capabilities.ts:452-504` 僅驗證 assetId UUID、URL 及 mediaType 形狀；`src/lib/storefront/dal/storefront-theme.dal.ts:531-537` filter 後未查 asset identity／type／URL 關係。
- 本機重現：`allowExternal:false` 的 image 欄位接受合法 UUID 加上任意 `https://example.invalid/not-an-asset.png`，只要 source 標成 asset。
- `src/server/asset/delete-items.serverFn.ts:118-201` 的使用關聯只查 product／variant，後續會軟刪 asset 並封存／移除原 R2 key；未涵蓋 Theme ContentPublication references。
- 影響：asset-only 限制可被偽造結構繞過；資產刪除也會破壞已發布媒體及 rollback 所需 bytes。這不是已證實的跨租戶讀取。
- 修復：server 以 assetId 取得可信媒體類型與 delivery identity，拒絕不匹配值；publication 保存不可變媒體版本與 retention 引用；刪除流程共同檢查 retained references。

### MEDIA-03 · P2 · 新媒體控制項有失敗狀態缺口

- `src/routes/_editor/-components/editor-media-field.tsx:65` Clear 永遠送 external 空值；allowExternal=false 時自家 validator 拒絕，已用真實 filter 重現。
- 同檔 `:132-145` 未傳遞 disabled 且 onToggle 未 guard，停用的 Asset 欄位仍能 emit onChange。這是 UI 缺陷，不等同 server auth bypass。
- `src/components/asset/asset-library-picker.tsx:65-78` 未呈現 query error；failed response 會成為空列表，容易誤導成沒有資產。
- 修復：定義與 source 無關的正式空值、disabled propagation、error／retry；測試 clear→save→reload、disabled asset click、asset API failure。

### RUNTIME-01 · P2 · 隱藏 Section 在正式 Theme 可能恢復 default

- 證據：`src/lib/storefront/service/storefront-content-runtime.ts:85` 跳過 disabled section；`src/lib/storefront/starter-theme-v3-files.ts:528-530` 缺失 slot 返回 `{}`；`:582-587` 仍無條件 render 元件。
- 影響：`<Hero {...{}} />` 仍渲染 Hero default，刪除 slot 不等於不 render 元件。Compatibility resolver 的 `render:false` 與正式 code 行為不一致。
- 修復：在既有 slot contract 傳遞可辨識 enabled 狀態，route 明確依它決定呈現；不把 Document 變成另一份 route tree。補 real Theme render／build parity 測試，不能只 assert slots 缺 key。

### RUNTIME-02 · P2 · 正式內容解析仍以固定 URL 前綴對應 Template

- 證據：`src/lib/storefront/service/storefront-content-runtime.ts:16-27` 僅映射 `/`、`/products/`、`/collections/`、`/blogs/`、`/pages/`；`src/lib/storefront/dal/storefront-content-publication.dal.ts:303-340` 只讀 template item，沒有 page handle／page revision lookup。
- 影響：即使 publication 含 Page，這條 content endpoint 仍無法按 handle 讀取該 Page；自訂 route 會拿到空 slots。純 code-only route 沒 Document 正常，但 content-backed route 不能用相同 empty fallback 當完成。
- 修復：沿用 route registry 與 publication references，加入明確 pathname→content identity 解析；測試兩個獨立 Page、slug rename、custom route、not-found、rollback。

### ASSET-01 · P2 · 圖片處理繞過一般上傳驗證

- 證據：`src/server/asset/process-image.serverFn.ts:22-44` 只檢查 arrayBuffer 方法，直接讀全檔並存成 image/png；D1 更新失敗缺少該次 R2 object cleanup。
- 影響：admin 可存入不合法圖片或過大 payload，更新失敗留下 orphan bytes。已有 nosniff，未證實腳本執行。
- 修復：沿用正常 upload 的 size／type／signature validation、資源上限、補償清理，於寫 R2 前驗證目標與 save mode。

## 架構與依賴需要收斂的地方

### 權限能力尚未拆分

Source Save、Dependency 啟用、Publish／rollback 都使用 commerceAdminMiddleware，`src/auth/permissions.ts` 沒有獨立 Theme author／dependency approver／publisher capability。現行 admin-only 沒有因此變成未授權存取，但不符合規範要求的可分離權限，無法安全開放給內容人員或 AI。應擴充既有 Better Auth access control 與 server middleware，不新增第二套 auth。

### Build Sandbox 沒有 repository 層的 egress 政策

`src/server.ts:45` 直接 export SDK Sandbox；runner 有 source／output limits 與 exec timeout，但未找到 enableInternet／allowedHosts／outbound handler。Cloudflare 官方指出 Sandbox 預設允許 Internet。這不證明 credential leak：部署憑證容器目前與 build 分離，這個界線正確。缺口是沒有證據證明不可信 build 的網路出口有被限制，Cloudflare 帳號外部政策未檢查。

修復方向：依使用中的 SDK 版本驗證實際能力；build 使用最小 egress，deployment 使用獨立的必要 Cloudflare API egress；不要直接把最新 SDK 範例貼進舊版本。

官方依據：[Cloudflare Sandbox outbound traffic](https://developers.cloudflare.com/sandbox/guides/outbound-traffic/)、[security model](https://developers.cloudflare.com/sandbox/concepts/security/)。

### CI 可重現性與安全閘門

`.github/workflows/ci.yml:44` 使用 `pnpm install --no-frozen-lockfile`；CI 只有 typecheck/test/build，没有 dependency audit、typecheck:data 或 browser E2E。`package.json:5`／CI 指定 pnpm 9.15.4，同時 dependencies 帶 pnpm 10.26.0，應收斂工具鏈角色與版本。

本次 `pnpm audit --prod --json` 回報 99 筆風險計數：critical 2、high 49、moderate 43、low 5。不能解讀成 99 個公開可利用漏洞：

- critical `seroval@1.3.2` 經 Solid／devtools 引入；實際 TanStack router/start 的 lockfile 解析為 `seroval@1.5.6`，不能說正式 server deserializer 使用 1.3.2。
- critical `vitest@3.2.4` 經 Better Auth peer 被列入 production graph；問題要求 UI server 正在 listening，不等於正常 storefront request 能觸發。
- 多筆 Next.js 來自 `@unpic/react` 間接依賴；Morph 並非 Next server，不把其 App Router 漏洞直接套用本專案。
- Vite、Rollup、PostCSS、pnpm 的開發／build／install 風險仍需治理；DOMPurify 等需依實際使用路徑評估。

處理方式：依 dependency path 與可達性分批升级／移除未使用套件，固定 lockfile，重新驗證 Morph Core 與 Theme toolchain；不要直接 audit fix 強制升版。

官方依據：[Seroval advisory](https://github.com/lxsmnsyc/seroval/security/advisories/GHSA-mv8w-475r-vwqw) 指出修復版 1.5.3，需以 API／plugin 使用情境評估實際影響。

### Editor 職責集中與 Preview 定位

- `visual-editor-shell.tsx` 6,703 行、`editor-style-inspector.tsx` 4,315 行；大小本身不是 bug，但目前把選取、內容 baseline、debounce、persist、undo、錯誤處理集中，EDIT-01/02 正是跨職責錯誤。
- `visual-editor-shell.tsx:466` 固定 compatibility-renderer。它是有 bounded evaluator 的安全靜態投影，不執行任意 React interaction；正式 build 才是完整程式。規劃 GSAP／WebGL／互動元件前，要明確提供 isolated runtime preview 及 parity 驗收。
- 共用 element-target、source AST cache、workspace OCC、immutable build、artifact manifest allowlist、deployment secrets 分離都是已存在且值得延伸的基礎。

## Visual Editor 後續工作順序

| 階段 | 交付項目 | 完成條件／依賴 |
| --- | --- | --- |
| 0 安全與發布可靠性 | SEC-01/02、REL-01/02；若要營運交易，同步 DATA-01/02；依賴與 CI 收斂 | 並行 publish/rollback 不產生 drift；部署失敗可重試；bootstrap 只有一個 winner；外送圖片請求不含 CMS cookie |
| 1 編輯一致性 | 統一 Content mutation coordinator；baseline + pending changes + acknowledgement；source capability absent/empty/invalid 契約 | 同／跨 section、跨 template、undo、refresh、網路失敗、OCC rejection 都不跳回錯資料、不覆蓋無關欄位；pending edit 可 retry 或明確 discard |
| 2 媒體與內容完整鏈 | image/video reference 查證、匿名 delivery、publication retention、clear/disabled/error；影片 poster/alt 或 description、播放選項依內容／程式責任分類 | 外部 URL／Assets 各自通過 edit→save→reload→Build Preview→匿名 storefront；刪除／替換／rollback 不讓已發布內容破圖 |
| 3 真實 Preview 與頁面 | isolated runtime preview；static projection 顯示 unsupported diagnostic；共用 pathname/content resolver；Page/SEO 與 enabled parity | hooks／事件／loader 在隔離 preview 可驗證；自訂路由與兩個獨立 Page 可正確發布；hide/reload/rollback 與正式站一致 |
| 4 Commerce authoring | product／collection／navigation 正式 reference picker，動態列表 query、empty/loading/error，responsive / state preview 補齊 | Document 僅存 references／query；價格與庫存由公開 DTO 讀取；手機及空資料不壞版；不建立 presentation JSON |
| 5 AI authoring | 接通目前未連線的 Agent，scoped read→proposed patch→diff→OCC apply→bounded build/repair→preview | AI 使用同一 source/content mutation API；無 publish／dependency 自行提權；人可拒絕 diff，失敗保留上一版 |

階段 0 與 1 應先於新增大量 field type／動畫控制。階段 2 完成後才可將媒體功能視為完整交付。AI 排在編輯／preview／發布契約穩定之後，否則只會把既有競態放大。

建議依有意義的責任拆模組：Content mutation coordinator、Selection descriptor、Source mutation queue、Release operation，各自延伸既有 API。不要為了縮短檔案把相同 state 分散到更多 effects，也不需要重寫整個編輯器。

## 驗證與限制

- 新跑 `pnpm typecheck:data`：通過。
- 新跑 `pnpm typecheck`：通過。
- 新跑 `pnpm test`：248 test files passed / 1 skipped；1,730 tests passed / 1 skipped。
- `pnpm build`：執行中，完成後補記。
- focused editor/helper tests 另由交叉審查執行且通過；與全量測試重疊，不加總為獨立測試數。
- 真實 reconciler 的部署競態、source capability revocation、asset-only clear、偽造 asset reference、runtime 媒體 URL／disabled slot 均以隔離本機函數執行驗證；其他 findings 為完整相關程式路徑確認。
- 有限 tracked-file secret pattern scan 未命中；只代表這批模式無匹配，不代表 Git history 或所有 secrets 已全面掃描。未讀出使用者 credentials。
- 未執行線上 deploy、remote migration、實際扣款／退款、初始化管理員或匿名上線頁 E2E；沒有驗證 Cloudflare 帳號端的 WAF／egress／secrets 設定。
- 本次只新增這份審查文件；業務程式中的 findings 尚未修復。原有未提交媒體修改保留。
