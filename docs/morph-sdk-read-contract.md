# 統一 Morph SDK：既有能力盤點與讀取契約（設計草稿）

ROADMAP 1.4 第一階段「盤點與契約設計」的交付物。方向見 #244（ROADMAP 1.4，草稿）；共用讀取核心的原型與設計見 #221（草稿，`docs/content-read-core-design.md` 只在該 PR，main 上沒有，本文只引用 PR 編號，不複製其內容）。

**範圍。** 只寫設計，不含程式、測試或設定變更。不授權部署、npm 發布或合併。

**實作狀態。** SDK 讀取核心 v0 已由 #246 合併進 main（`468a9f4`），位置在 `packages/morph-sdk/`。§6.0 列出 v0 實際做到的事，附檔案與行號；其餘各節的【首版】是 v0 依循的契約，【目標】仍未實作。

**核對基準。** §3 的現況盤點核對於 main `52d1e3a`；§6.0 的 v0 行號核對於 main `468a9f4`。

## 0. 標記

本文把「現在的 API 怎麼做」和「SDK 將來要怎麼做」分開寫。凡是【目標】都**尚未實作**，不得當成可用的功能引用。

| 標記             | 意思                                                       |
| ---------------- | ---------------------------------------------------------- |
| 【現況】         | 現在的程式就是這樣運作。後面附核對程度。                   |
| 【已核對】       | 讀過所列程式碼。不等於執行過。                             |
| 【已核對＋測試】 | 讀過程式碼，並有既有測試涵蓋（列出測試名）。本輪沒有重跑。 |
| 【推論，未執行】 | 由程式碼推得，沒有用瀏覽器或真實請求驗證。                 |
| 【已實作 v0】    | `packages/morph-sdk/` 已有的行為，附檔案與行號（§6.0）。   |
| 【首版】         | 提案：首版 SDK 只包裝【現況】，不改伺服器行為。            |
| 【目標】         | 提案：將來的行為，需要改 API、Starter 或發布模型；未實作。 |
| 【延後】         | 不在首版，也還沒有設計。                                   |
| 【待決】         | 需要使用者決定，見 §9。                                    |

## 1. 已決定的方向（使用者，2026-10-16）

- 首版重用商家網域的既有 API；頁面先限伺服器端讀取；不額外強制加 key。
- **正式目標：Morph 作為獨立內容後台，外部網站不必在 Morph 建置或發布 Theme。** 現有 Theme／build 依賴只是首版限制，不是長期前提；也不得直接移除既有發布安全檢查來繞過（§4）。
- SDK 採一份框架無關核心，平台薄入口與外部套件共用（§7 是分階段方案）。
- `products.get` 查無商品回 `null`，其他錯誤一律拋出（§6.3）。
- 頁面「空內容」與「不存在」須分清楚。現況做不到，列為【目標】（§6.2）。

**2026-10-16 追加決定（使用者）。** 以下是決定，不是已實作的行為：

- **錯誤碼變更不綁在一起（A5）。** 不相關的錯誤碼變更，不得綁在隱藏區塊形狀的改變（#187 §3.2 的 `{}`）上一起發布。瀏覽器專用碼（§9 Q6）單獨決定。
- **整合前置條件。** SDK 列為 pnpm 工作區套件（§9 Q5）與 SDK 建置檢查（§9 Q7）都就位之前，第 2 階段（託管 Start Theme 改用 SDK）不開始（§7）。
- **【目標】維持延後、未決定。** 發布模型（§4.1）、內容網域（§4.3）、頁面不存在（§6.2）、`content_not_found` 改名（§6.2），都不因這次決定而改變狀態。

## 2. 一句話結論

- **【現況】** 在商家網域上，已發布頁面與公開商品用同一種方式決定範圍：Core 依網域解析商店，都不接受訪客的 key。
- **【首版】** SDK 可以只包裝這些 API，但有兩個限制：
  - 來源網域必須有已發布的 Theme release；
  - 頁面只能在伺服器端讀。
- **【已實作 v0】** 一份不依賴框架的讀取核心已在 `packages/morph-sdk/`（#246）：`createMorph`、`pages.get`、`products.list`、`products.get`，只包裝上述現有 API，沒有改伺服器（§6.0）。
- **【目標】** 要做到「不必有 Theme」與「分清楚空內容和不存在」，必須改動發布模型與 API 回應，不只是改文件。

## 3. 現況盤點

### 3.1 已發布頁面：`GET /_morph/content?path=`

【現況，已核對】`src/lib/storefront/service/storefront-production.service.ts`（`handleRequest`、`serveContent` 約 286 行起）、`storefront-content-runtime.ts`、`storefront-host-resolver.ts`。

- **只在商家網域。** 由 `StorefrontProductionService` 服務：先依 `Host` 執行 `resolveStorefrontHost`，再進入 `/_morph/content`。
- **範圍由網域決定。** 網域 → 商店 → `active_release_id` → release → 成功的 Theme build。內容只讀該 release 的 `contentPublicationId`，不讀草稿。不需要也不讀任何 key。
- **前提：必須有已發布的 Theme release。** 網域、商店、release、build 任一不成立就在進入內容端點前失敗：
  - `INVALID_HOSTNAME`：400。
  - `DOMAIN_NOT_FOUND`、`DOMAIN_NOT_ACTIVE`、`STOREFRONT_NOT_FOUND`、`STOREFRONT_NOT_PUBLISHED`、`NO_ACTIVE_RELEASE`：404。
  - `RELEASE_BUILD_UNAVAILABLE`：503。
  - 這些都是純文字回應，`Cache-Control: no-store`。
- **參數。** `path` 預設 `/`；必須以 `/` 開頭、最多 500 字元，否則 400 純文字。只接受 GET／HEAD，其他 405。沒有 `contentPorts` 時 503。
- **回應形狀。** `200 application/json`，內容為 `{ slots: Record<slotId, Record<string, unknown>>, hiddenSlots: string[] }`：
  - layout 文件先讀，路由文件後讀；同一個 slot id 以路由文件為準。
  - 停用的 section 列入 `hiddenSlots`，不給值。
  - 最多 `MAX_THEME_CONTENT_SLOTS = 200` 個 slot。
  - 路徑對應規則：`/pages/<handle>` 先找該 Page，找不到時退回 page template；沒有 template type 的路徑用 route document；其他用 template type。
- **空內容與不存在無法區分。**
  - 路徑沒有自己的文件時，仍回 200，不是 404。回應只含 layout 文件的內容；layout 也沒有時才是 `{ slots: {}, hiddenSlots: [] }`。程式註解說明這不是錯誤：對託管 Theme 而言，沒有 Document 的路由用元件預設值才正確。
  - 路徑有自己的文件但沒有任何 section 時，回應與上面相同。
  - 回應中沒有任何欄位能區分「這個路徑有文件」與「沒有」。
- **快取。**
  - 回應帶 `Cache-Control: public, max-age=60, must-revalidate`。
  - ETag 為 `"<releaseId>:<path>"`，路徑取請求的原字串。
  - 內容端點**不處理 `If-None-Match`**，不會回 304。同檔的媒體端點有處理。
- **CORS。** 不設任何 `Access-Control-*` 標頭，也不處理 OPTIONS（非 GET／HEAD 一律 405）。
- **Core 告知 Theme 的標頭。** 【已核對＋測試】`theme-runtimes.ts` 的 `applyStorefrontContext`：
  - 以 `set` 設定 `x-morph-content-origin`、`x-morph-storefront-host`、`x-morph-storefront-id`、`x-morph-release-id`、`x-morph-theme-build-id`，覆蓋訪客送來的同名標頭。
  - release 沒有 publication 時刪掉 `x-morph-content-publication-id`。
  - 測試：`storefront-production.service.test.ts` 的 "never lets a client spoof the content origin"、"strips a spoofed content publication header when the release has none"。
  - 正式 Cloudflare 上 Core 轉送到 Theme Worker 的完整信任邊界仍未驗證，見 #221 的驗證狀態。

### 3.2 公開商品：Store API

同一個處理函式 `handleStoreCatalogGet`（`src/lib/storefront/service/store-catalog-request.ts`）有**兩個入口**，範圍決定方式不同。

#### 3.2.1 商家網域上的 `/api/store/products`

【現況，已核對＋測試】`storefront-production.service.ts` 約 245 行、`src/server.ts` 的 `catalogHandler`；測試 "routes only read-only catalog requests using the resolved storefront"。

- 同樣先經 `resolveStorefrontHost`，所以前提與 §3.1 相同：需要已發布的 Theme release。網域解析失敗時回純文字 404／503。
- `catalogHandler` 只用解析出的 `hostname` 呼叫 `storeContextDal.resolveCatalog`，註解為 "Do not accept a visitor's publishable key, channel, or host override."
- 解析出的 `storefrontId` 與網域不符時，回純文字 503 "Catalog context unavailable"。
- 只接受 GET（405）。
- **結論：商家網域上，商品與頁面一樣由網域決定範圍，不用 key。** Starter 的 `src/morph/catalog.ts` 就是讀這個入口：伺服器端用 `x-morph-content-origin`，瀏覽器用相對路徑。

#### 3.2.2 平台網域上的 `/api/store/products`

【現況，已核對】`src/routes/_backend/api/store/$.ts` 的 `contextOf`、`src/lib/storefront/dal/store-context.dal.ts` 的 `resolveCatalog`。

- **範圍來源。**
  - `x-publishable-api-key`：驗證 key 存在、`type = publishable`、未撤銷、未刪除，並驗證 salt／token。取得 key 連結的銷售通路；沒有連結時拒絕。
  - `x-storefront-host`：指定網域。沒有 key 時退回 `Host` 標頭。網域須為 active。
  - 同時給 key 與網域時，網域的銷售通路必須在 key 的通路內，否則拒絕。
  - 兩者都沒有時拒絕。最後必須剛好一個未停用的銷售通路。
  - 失敗：`401 { error: "INVALID_STORE_CONTEXT", message }`，`private, no-store`。
- **`x-storefront-host` 沒有驗證來源。** 不帶 key 時，只要指定任一 active 網域，就取得該網域的公開目錄。目錄本來就公開在該商家網域上，所以這不是外洩；但這表示 publishable key 在公開目錄上是**範圍設定，不是存取控制**。
- **CORS。** `Access-Control-Allow-Origin: *`；允許標頭 `content-type, x-publishable-api-key, x-storefront-host`；OPTIONS 回 204。
- **快取。** 公開回應 `public, max-age=0, s-maxage=30, stale-while-revalidate=60`，`Vary: x-publishable-api-key, x-storefront-host`；錯誤的 context 為 `private, no-store`。

#### 3.2.3 參數與回應（兩個入口相同）

【現況，已核對】`src/lib/validations/store-api.ts`、`src/lib/storefront/dal/store-catalog.dal.ts`。

- **`GET products`**
  - 參數：
    - `q`：trim 後最多 200 字元，比對 title 或 handle 的部分字串。
    - `page`：1–10000，預設 1。
    - `limit`：1–100，預設 20。
    - `order`：`asc`／`desc`，預設 `desc`，依 `updatedAt` 排序。#244 沒有列出 `order`，但它已存在。
  - 只列 `status = published`、未刪除、屬於該銷售通路的商品。
  - 回應：`{ products, context, pagination: { page, limit, total, totalPages } }`。
  - 每個商品：`id, title, handle, subtitle, description, thumbnailUrl, collectionId, collectionTitle, updatedAt`。
  - 參數不合法時：`400 { error: "INVALID_REQUEST", message, details }`。
- **`GET products/<handle>`**
  - handle 規則：小寫英數與連字號，最多 255 字元。不合法時 400。
  - 找到時回 `{ product, context }`，價格依 context 的 region／currency。
  - 找不到時回 `404 { error: "NOT_FOUND", message: "Product not found" }`，JSON 格式。這個 404 走公開快取（30 秒）。
  - **商家網域上另有一種 404**：網域解析失敗的純文字 404（§3.1），不是 JSON。
- **`GET assets/<uuid>`**：只給該銷售通路已發布商品引用的資產。
- **`context`** 為 `StoreCatalogContextDTO`：`storeId, storefrontId, salesChannelId, regionId|null, currencyCode|null, automaticTaxes, isTaxInclusive, countryCode, localeCode`。
  - 平台入口可用 `region_id`、`country_code` 參數指定。商家入口不轉交這兩個參數。

### 3.3 發布模型對 Theme 的依賴

【現況，已核對】`src/db/storefront.schema.ts`、ROADMAP「Content-only release」。

- `storefront_releases` 的 `theme_id`、`source_revision_id`、`theme_build_id` 都是 `NOT NULL`；`content_publication_id` 可為 null。也就是說，**release 一定綁著一個 Theme build**。
- `storefront_content_publications` 只綁 `storefront_id`，不綁 Theme。
- **內容的歸屬分兩類。**
  - Page（`storefront_pages`）屬於商店。
  - template 文件（`storefront_theme_templates`，包含 layout 與 route document）屬於 Theme（`theme_id NOT NULL`）。
  - 因此首頁、layout 等非 Page 內容，目前在資料模型上依附某個 Theme。
- **純內容發布（content-only release）。** 不重新 build，但仍產生新的 release，並沿用「既有的成功 Theme build」。所以它沒有脫離 Theme。
- **既有發布安全檢查。** §4 的目標必須保留這些檢查：
  - 網域 → 商店 → release → build 的 fail-closed 解析鏈；
  - build 必須屬於同一商店與 Theme 的歸屬檢查；
  - `active_release_id` 是唯一的 live 指標；
  - publication 不可變；
  - 啟用時的 CAS；
  - 草稿不進公開讀取。

### 3.4 Starter 的讀取模組

【現況，已核對】`src/lib/storefront/starter-theme-v3-files.ts` 的 `STARTER_THEME_CONTENT_MODULE_SOURCE`（約 2136 行起）、`starter-theme-catalog-files.ts`。

- **頁面有兩套讀法並存。**
  - `content()`／`isSectionHidden()`：讀不到時回 `EMPTY_CONTENT`，也就是靜默顯示元件預設值。
  - `morph.pages.get(path)`／`morph.pages.isHidden()`：失敗一律丟 `MorphContentError`，不退回預設值。
- **`MorphPage` 形狀。** slot 值直接攤平在頁面物件上，隱藏清單放 `_hidden`。若回應含名為 `_hidden` 的 slot，丟 `reserved_slot`。
- **回應驗證只看 `slots` 與 `hiddenSlots`，其他欄位不影響。** 這讓 §6.2 的「新增欄位」對既有 Starter 相容。
- **10 個錯誤碼。**
  - `no_content_source`、`invalid_content_origin`、`invalid_path`、`store_unreachable`、`content_not_found`、`store_error`、`redirect_refused`、`invalid_response`、`response_too_large`、`reserved_slot`。
  - 錯誤文字寫死在模組內，不帶上游內容、網址或堆疊；細節只寫進伺服器 log。
- **來源。**
  - 伺服器端：先讀 `x-morph-content-origin`。沒有這個標頭時，只在開發模式讀 `MORPH_CONTENT_ORIGIN`。
  - 標頭存在但不可用時直接報錯，不退回本機設定。
  - 瀏覽器端：相對路徑 `/_morph/content`，也就是只讀同網域。
- **兩個錯誤碼宣告了但不會產生。** `fetchPage` 沒有設 `redirect`，所以採預設的跟隨轉址；也沒有回應大小上限。因此 `redirect_refused`、`response_too_large` 只會由本機開發代理以 JSON `code` 送出。
  - 同一個 Starter 的 `catalog.ts` 則用了 `redirect: "error"`。
  - 這就是 #221 待決問題 4。
- **`content_not_found` 的語意與實際不符。** 只在 HTTP 404 時產生。Core 的 404 只來自網域／release 解析（§3.1），所以這個碼實際代表「這個網域沒有可讀的已發布商店」，不是「這頁不存在」。
- **商品讀取不在 `morph` 物件上。** 由 `loadProducts`／`loadProduct` 提供；任何 404 都回 `{ product: null }`，包括網域解析失敗的 404。其他失敗丟一般 `Error`，沒有錯誤碼。

### 3.5 #221 原型

只引用，不複製：#221 的 `fixtures/morph/content-read-core/core.ts`（測試原型）與 `docs/content-read-core-design.md`。契約設計依賴其中的這些部分：

- `createMorph(source)`；
- 不依賴框架；
- 每次請求由接線提供來源；
- 錯誤碼與 Starter 逐字相同；
- 失敗不回預設值；
- workerd 並行隔離（測試原型層級）。

## 4. 正式目標：Morph 作為獨立內容後台

**目標。** 外部網站不必在 Morph 建置或發布 Theme，也能用 SDK 讀已發布內容與公開商品。

**這是架構變更，不只是文件。** 現況的讀取鏈是：網域 → 目前的 release → 內容發布版本，而 release 一定綁 Theme build（§3.3）。要達成目標，至少要先解決下面三件事，都需要另行設計與授權。

### 4.1 發布模型：內容發布必須能不靠 Theme build 被找到

兩個方向，都還沒有設計，本文不選定：

- **(A) 不含 Theme build 的 release。** 例如一種「純內容」release，讓 `theme_build_id` 在這種 release 上可以為空。這會改到 release 的 schema，以及所有假設 release 必有 build 的地方：解析、部署、rollback、release history。
- **(B) 讓內容發布版本有自己的 live 指標，與 release 分開。** 例如商店或內容網域上的「目前內容發布版本」。這需要定義它和 release 指標之間的一致性，以及 rollback 時兩者如何一起動。

兩者都必須：

- 保留 §3.3 列出的每一項發布安全檢查。不能用「跳過 build 檢查」來達成；要改成對新的發布種類做等價的檢查。
- 不建立第二條平行的發布路徑，要延伸既有的發布與 CAS 核心。
- 遷移在獨立 PR 進行，不碰遠端 D1。

### 4.2 內容的歸屬：非 Page 的內容目前屬於 Theme

- 首頁、layout、route document 屬於 Theme 的 template（§3.3）。
- 沒有 Theme 的商店目前只有 Page 這一類內容可以發布。
- 要決定的事：不靠 Theme 時，這些內容的「容器」是什麼（商店層的 template，或內容專用的結構），以及既有 Theme 的內容如何不遷移就繼續運作。
- 這與 #187（隱藏區塊）、#221（程式碼與 Document 的分工）都相關。

### 4.3 內容網域與網站網域分開

- 外部網站自己的網域（例如 `www.example.com`）指向外部主機，不能同時由 Morph 服務。
- 因此外部網站需要一個**由 Morph 服務的內容網域**，SDK 的 `baseUrl` 指向它。可以是：
  - 商家自訂的子網域，例如 `cms.example.com`；
  - 或平台提供的網址。
- **【首版】** 這個內容網域就是現有的商家網域，所以上面必須有已發布的 Theme release（首版限制）。
- **【目標】** 內容網域上有內容可讀，但不需要有 Theme。這和 §4.1 是同一件事。
- 要決定：
  - 內容網域是否沿用 `storefront_domains`（狀態、驗證、active 規則都沿用），或另一種網域種類；
  - 內容網域上要不要服務 Theme 頁面，或只服務 `/_morph/*` 與 Store API。

### 4.4 依賴與順序

- §4.1–§4.3 都依賴發布模型的設計審閱，排在 SDK 首版之後。首版不等它們。
- 外部網域的真實驗收需要部署好、外部可達的 Morph（另行授權）。
- ROADMAP 的描述由 #244 負責更新。本 PR 不改 #244。

## 5. 缺口

| #   | 缺口                                                                                                                                          | 依據                                                   | 處理                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------- |
| G1  | 讀內容與商家網域的商品，都要求網域有已發布的 Theme release。                                                                                  | 【已核對】`resolveStorefrontHost`、release schema      | 首版限制；【目標】§4             |
| G2  | `/_morph/content` 沒有 CORS，外部網域的瀏覽器讀取會被擋。                                                                                     | 【已核對】沒有標頭；【推論，未執行】瀏覽器行為         | 首版只在伺服器端讀頁面（§6.7）   |
| G3  | 圖片網址都是相對路徑：頁面媒體為 `/_storefront-media/<id>?version=…`，商品圖為 `/api/store/assets/<id>`。外部網域直接使用會解析到自己的網域。 | 【已核對】`publishedMediaPath`、`store-catalog.dal.ts` | §6.5                             |
| G4  | 在平台網域上，`<img>` 不會帶 key 或 `x-storefront-host`；這時 `contextOf` 退回 `Host`，也就是平台網域，商品圖可能回 401。                     | 【推論，未執行】                                       | 首版圖片指向內容網域（§6.5）     |
| G5  | 頁面空內容與不存在無法區分。                                                                                                                  | 【已核對】§3.1                                         | 【目標】§6.2                     |
| G6  | `content_not_found` 的語意是「沒有可讀的已發布商店」。                                                                                        | 【已核對】§3.4                                         | 【目標】§6.2                     |
| G7  | 錯誤格式不一：內容端點是純文字；Store API 是 `{ error, message, details? }`；Starter 用自己的碼。                                             | 【已核對】                                             | §6.4                             |
| G8  | 商家網域上「網域解析失敗的 404」與「查無商品的 404」狀態碼相同；Starter 的 `loadProduct` 把兩者都當成查無商品。                               | 【已核對】                                             | §6.3                             |
| G9  | 頁面讀取有宣告但未實作的轉址拒絕與大小上限。                                                                                                  | 【已核對】§3.4                                         | 對應 #221 待決 4；首版不宣稱支援 |
| G10 | 內容端點有 ETag 但不回 304。                                                                                                                  | 【已核對】                                             | 只影響效能；首版不依賴           |
| G11 | 舊讀法 `content()` 會靜默退回預設值，與 SDK「失敗不回預設」原則衝突。                                                                         | 【已核對】                                             | §7 第 2 階段的遷移               |
| G12 | 首頁、layout 等內容屬於 Theme。                                                                                                               | 【已核對】§3.3                                         | 【目標】§4.2                     |

## 6. 契約

每一項分成【首版】（只包裝現況，不改伺服器）與【目標】（未實作）。§6.0 是 v0 實際做到的部分；§6.1 起是契約本身。

### 6.0 已實作：SDK 讀取核心 v0（#246，main `468a9f4`）

以下都是【已實作 v0】。行號指 main `468a9f4` 上的 `packages/morph-sdk/src/`。

**入口與方法**

| 行為                                                                                                                                           | 位置                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `createMorph({ baseUrl, fetch? })` 只保存 origin 與 fetch，不保存任何每次請求的狀態（商店、預覽、憑證）                                        | `client.ts:130–133`                        |
| `baseUrl` 必須是 http／https 的 origin，可帶**一個**結尾 `/`（會被去掉）；帶其他路徑、查詢、`#`、帳密或其他協定一律丟 `invalid_content_origin` | `client.ts:42–58`                          |
| `pages.get(path)`：先驗證路徑（以 `/` 開頭、最多 500 字元，否則 `invalid_path`），再讀 `GET <baseUrl>/_morph/content?path=`                    | `client.ts:279–293`                        |
| `pages.get` 只在伺服器端讀：`window` 與 `document` 都存在時，在送出前丟 `invalid_content_origin`                                               | `client.ts:70–73`、`287`                   |
| `products.list({ q, page, limit, order })`：只接受這四個參數，送出前依 Store API 的範圍驗證，未知參數也拒絕（`invalid_request`）               | `client.ts:22`、`239–275`、`300–334`       |
| `products.get(handle)`：handle 依 Store API 規則驗證；**只有** Store API 回 JSON `404 { error: "NOT_FOUND" }` 時回 `null`                      | `client.ts:336–375`（`null` 在 `350–357`） |
| `products.get` 遇到網域查不到商店的純文字 404 時丟 `content_not_found`，不回 `null`                                                            | `client.ts:194–199`                        |
| 一律 `credentials: "omit"`，逾時 15 秒                                                                                                         | `client.ts:13`、`141–149`                  |

**每次讀取共用的規則**

| 行為                                                                                                                                                                                                        | 位置                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 不跟隨轉址：送出 `redirect: "manual"`；3xx（含 304）或 `opaqueredirect`（狀態 0）丟 `redirect_refused`，不讀回應內容。304 也算在內，因為 SDK 不送條件式請求，收到 304 只可能是異常                          | `client.ts:147`、`155–162` |
| 回應上限 2 MB，與本機開發代理 `morph-dev-content-proxy.ts` 的 `DEFAULT_MAX_BYTES` 相同。宣告的 `content-length` 超過時不讀就拒絕；否則邊讀串流邊計數，超過即停止並丟 `response_too_large`。剛好 2 MB 可以讀 | `client.ts:15`、`85–119`   |
| 只把兩種相對網址補成完整網址：`/_storefront-media/…`（頁面媒體）與 `/api/store/assets/…`（商品圖）。其他字串一律不動                                                                                        | `urls.ts:13–24`、`26–46`   |
| 解析出的 `__proto__` 鍵維持為一般鍵，不改原型                                                                                                                                                               | `urls.ts:34–42`            |

**錯誤碼與實際觸發條件**（`errors.ts:13–26`；判定在 `client.ts`）

| 碼                       | 實際觸發條件                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `invalid_content_origin` | `baseUrl` 不合法；或在瀏覽器中呼叫 `pages.get`                                                 |
| `invalid_path`           | 頁面路徑不以 `/` 開頭、超過 500 字元或不是字串（送出前）                                       |
| `invalid_request`        | 商品參數或 handle 不合法（送出前）；或 Store API 回 `400 INVALID_REQUEST`                      |
| `invalid_store_context`  | Store API 回 `401 INVALID_STORE_CONTEXT`                                                       |
| `content_not_found`      | 頁面讀取的任何 404；商品讀取的純文字 404（網域查不到已發布商店）。**不代表頁面不存在**（§6.2） |
| `store_unreachable`      | 網路失敗、逾時，或回應內容讀到一半中斷                                                         |
| `redirect_refused`       | 3xx（含 304）或 `opaqueredirect`                                                               |
| `response_too_large`     | 宣告或實際讀到的內容超過 2 MB；錯誤回應也適用                                                  |
| `store_error`            | 其他非 2xx，例如 503、500、非 `NOT_FOUND` 的 JSON 404                                          |
| `invalid_response`       | 不是 JSON，或形狀不符                                                                          |
| `reserved_slot`          | 回應含名為 `_hidden` 的 slot                                                                   |
| `no_content_source`      | 型別中保留，與 Starter 一致；v0 不會產生，因為一定有 `baseUrl`                                 |

- 錯誤訊息是固定字串，不帶回應內容、網址、查詢或底層錯誤，也不附 `cause`（`errors.ts:36–51`）。
- 任何失敗都丟錯，不退回 `{}`、空頁或空列表。例外見 §6.4。

**驗證（#246 的 PR 說明有完整紀錄）**

- 單元測試（假的 `fetch`）、直接呼叫 Morph 真正 handler 的行程內測試（`src/lib/storefront/service/morph-sdk-real-handlers.test.ts`）、兩個不同 `baseUrl` 的並行隔離測試、import 邊界測試（`packages/morph-sdk/src/boundary.test.ts`）。
- 反向檢查涵蓋：錯誤時退回空頁、請求狀態存在共用變數、任何 404 都回 `null`、核心 import React、媒體網址未補全、拿掉轉址處理、改回整份讀取。
- 行程內測試的資料庫層是假的；沒有經過真正的網路，也沒有在真的瀏覽器、Deno 或 Bun 驗證。

**交付限制【已實作 v0 的現況】**

- 套件標成 `private: true`，沒有發布到 npm。
- 不是 pnpm 工作區套件：`pnpm-workspace.yaml` 只列 `"."`，所以 repo 內不能用 `@morph/sdk` 這個名稱 import，測試以路徑引用。
- **`pnpm build` 不涵蓋 SDK**：app 沒有 import 它，Vite 建置不會經過它。目前只有 `tsc`（`pnpm typecheck`）與測試涵蓋。
- 沒有接進 app 或 Starter；託管 Theme 仍用 Starter 自己的讀取模組。

### 6.1 設定與來源

```ts
type MorphSource =
  // Hosted Theme: the origin comes from the request, set by Core
  // (x-morph-content-origin). The wiring supplies it per request.
  | { kind: "platform" }
  // A content domain served by Morph, e.g. https://cms.example.com.
  | { kind: "origin"; baseUrl: string };

createMorph({ source: MorphSource });
```

- `createMorph` 只保存不變的設定。每次請求的來源由平台或 integration 接線提供（沿用 #221），不得放進可變的全域狀態。
- `baseUrl` 必須是 http／https、不含帳密，並且等於 `new URL(baseUrl).origin`；v0 另外接受一個結尾 `/` 並去掉它（§6.0）。不合法時丟 `invalid_content_origin`。
- **【已實作 v0】** 只有 `source: origin` 這一種，介面寫成 `createMorph({ baseUrl, fetch? })`。`source: platform`（託管 Theme 由 Core 告知來源）屬於平台薄入口，仍是【目標】（§7 第 2 階段）。
- **【首版】**
  - `baseUrl` 是現有的商家網域；頁面與商品都從這裡讀。
  - 不用 key，也不接受 key 設定。
  - 限制：該網域必須有已發布的 Theme release（G1）。
- **【目標】** `baseUrl` 是不需要 Theme 的內容網域（§4.3）。SDK 介面不變。
- 平台網域的 publishable key 路徑首版不包裝。若之後要支援，作為選填設定另提，不能變成頁面讀取的必要條件。

### 6.2 `pages.get(path)`

- **【首版】**
  - 對應 `GET <baseUrl>/_morph/content?path=`。只在伺服器端執行，原因見 §6.7。
  - 參數規則沿用：以 `/` 開頭、最多 500 字元；違反時在發請求前丟 `invalid_path`。
  - 回傳 `MorphPage`：沿用 Starter 的形狀（slot 攤平＋`_hidden`）與 `isHidden()`。
  - **限制：無法區分空內容與不存在。** 兩種情況都回傳同一種頁面：只有 layout 的 slot，layout 也沒有時就是空頁面。文件與型別都要寫明這點，不得宣稱可以判斷頁面是否存在。
  - 網域、商店或 release 不存在：丟 `content_not_found`，沿用碼名。說明文字更正為「這個網域沒有可讀的已發布內容」。
  - release build 不可用（503）：丟 `store_error`。
- **【目標】空內容與不存在分清楚。**
  - 在 200 回應**新增**欄位，例如 `document: "found" | "none"`，不改狀態碼。
  - 不改狀態碼的原因：託管 Theme 上沒有 Document 的路由用預設值是正確結果；若改成回 404，既有 Starter 會把它變成 `content_not_found` 並報錯，等於把正常頁面變成錯誤。
  - 既有 Starter 只驗證 `slots` 與 `hiddenSlots`，新增欄位對它相容（§3.4）。
  - SDK 依新欄位：`none` 時回 `null`，或丟 `page_not_found`（見 §9 Q3）。
  - 需要：
    - 定義「頁面存在」：在獨立內容後台情境下，指發布版本中有文件涵蓋該路徑；託管 Theme 情境是否沿用，同列 §9 Q3。
    - Core 回應變更（含測試與反向檢查）。
    - Starter 升版，並經既有 Starter 升級流程。
- **【目標】改名 `content_not_found`。**
  - 改成符合實際語意的碼，例如 `content_source_unavailable`；`content_not_found` 改留給「頁面不存在」。
  - 這會改變錯誤碼集合，要 Starter 升版，並與 #221 的「錯誤碼逐字相同」一起改。
  - 必須和上一項同一個 Starter 版本發布，避免同一個碼在兩個版本代表不同意思。
- 草稿讀取【延後】，依賴 #214。

### 6.3 `products.list(params)`／`products.get(handle)`

- **【首版】`products.list({ q?, page?, limit?, order? })`**
  - 對應 `GET <baseUrl>/api/store/products`。
  - 參數範圍與預設值完全沿用 §3.2.3，包含 `order`。
  - SDK 端先做相同驗證，不合法時丟 `invalid_request`，不送出請求。
  - 回傳 `{ products, pagination: { page, limit, total, totalPages }, context }`，欄位沿用 DTO，不新增、不改名。
  - 沒有結果時回空陣列與 `total: 0`，不是錯誤。
- **【首版】`products.get(handle)`**
  - 對應 `GET <baseUrl>/api/store/products/<handle>`。handle 規則沿用；不合法時丟 `invalid_request`，不送出請求。
  - **只有「找不到商品」回 `null`。** 條件：狀態 404，而且回應是 JSON，`error === "NOT_FOUND"`。
  - 其他情況都拋出：

    | 情況                                               | 碼                      |
    | -------------------------------------------------- | ----------------------- |
    | 網域解析失敗的 404（純文字）                       | `content_not_found`     |
    | 401 `INVALID_STORE_CONTEXT`（範圍或權限不成立）    | `invalid_store_context` |
    | 400 `INVALID_REQUEST`                              | `invalid_request`       |
    | 網路失敗或逾時                                     | `store_unreachable`     |
    | 非 JSON 或形狀不符                                 | `invalid_response`      |
    | 其他非 2xx，包括 503 "Catalog context unavailable" | `store_error`           |

  - 這與 Starter 現行的 `loadProduct` 不同：它把任何 404 都當成查無商品（G8）。Starter 遷移到 SDK 時採用新規則。

- 價格、庫存與銷售通路沿用商務服務的結果。SDK 不計算、不快取價格。

### 6.4 錯誤模型

- **【首版】** 一個錯誤類別 `MorphError`：
  - `code`：封閉集合。
  - `resource`：`"page" | "product"`。
  - `message`：寫死的文字。
  - 錯誤物件不含上游內容、網址、key 或堆疊；細節只進伺服器 log。
- **【首版】頁面的碼：** 沿用 Starter 的 10 個碼，逐字相同。
  - **【已實作 v0】** `redirect_refused`、`response_too_large` 已會產生：轉址一律拒絕、回應上限 2 MB（§6.0）。這也回答了 #221 待決 4 在 SDK 這一側的部分；Starter 自己的讀取模組仍未實作這兩項。
- **【首版】商品新增兩個碼：** `invalid_request`、`invalid_store_context`。其他與頁面共用：`store_unreachable`、`invalid_response`、`store_error`、`content_not_found`，語意相同。
- **【目標】** §6.2 的改名與 `page_not_found`。
- **不變的原則：** 任何失敗都丟錯，不回空陣列、`{}` 或預設頁面。例外只有：
  - 首版頁面在路徑沒有自己的文件時的回應（§6.2 的限制）；
  - `products.get` 的 `null`；
  - `products.list` 的空結果。

### 6.5 相對網址

- **【首版】規則：** SDK 把回應中 Morph 自己的媒體路徑，以讀取時使用的來源補成絕對網址。
  - **【已實作 v0】** 以前綴判定，只處理 `/_storefront-media/…` 與 `/api/store/assets/…` 兩種，不論出現在哪個欄位（因此涵蓋商品的 `thumbnailUrl` 與資產 `url`）。其他以 `/` 開頭的字串不動，因為內容值沒有欄位型別，無法分辨媒體、連結和一般文字。
  - 已是 http／https 的網址不動。
  - 其他協定沿用 `isSafeThemeMediaUrl` 的結果（伺服器已過濾）。
  - 限制：作者存成相對路徑的外部媒體（例如 `/images/a.png`，指向 Theme 自己的檔案）不會被補全。
- **託管 Theme（`platform`）：** 維持相對網址，同網域，與現況相同。伺服器端渲染的輸出也維持相對，避免把 Core 內部轉送用的 origin 寫進頁面。
- **外部網站（`origin`）：** 一律補成 `<baseUrl>/…`。商品圖因此指向內容網域，避開 G4。
- 連結值（`resolveThemeLinksInSlotValues`）不屬於媒體。是否補成絕對網址要看連結指向商家站內頁還是外部網站自己的頁面，留到 §7 第 4 階段驗收時決定，首版不改寫。

### 6.6 分頁、快取、key

- **分頁【首版】：**
  - 只有商品有分頁：頁碼式（`page`／`limit`），回應帶 `total`、`totalPages`。
  - 上限沿用：`page ≤ 10000`、`limit ≤ 100`。
  - 不提供 cursor。之後的列表要沿用同一慣例，各資源保留自己的上限。
- **快取【首版】：**
  - SDK 不自建快取，沿用 HTTP 快取（§3.1、§3.2.2）。
  - 不在模組層保存任何回應，避免並行請求串資料。這與 #221 的反向檢查「core caches the source」同一原則。
  - 一律 `credentials: "omit"`。
  - 草稿讀取（延後）必須 `no-store`，且不得進入公開快取。
- **key：**

  | 種類                   | 現況                                   | SDK                                                |
  | ---------------------- | -------------------------------------- | -------------------------------------------------- |
  | 無 key，由網域決定範圍 | 商家網域上的頁面與商品                 | 【首版】唯一的來源方式                             |
  | publishable key        | 只有平台網域的 Store API；屬於範圍設定 | 首版不包裝；之後若加，只能是選填，不能限制頁面讀取 |
  | 私密或草稿憑證         | 不存在（#214 草稿）                    | 【延後】不得進瀏覽器程式包、網址或日誌             |
  | 後台或寫入             | 不在公開讀取 SDK                       | 不提供                                             |

### 6.7 伺服器端與瀏覽器

- **【首版】頁面只在伺服器端讀。**
  - `source: platform`：維持現況。瀏覽器端讀同網域的相對路徑（託管 Theme 的切頁），不受 CORS 影響。
  - `source: origin`：只在伺服器端讀。在瀏覽器端呼叫 `pages.get` 時直接丟 `invalid_content_origin`，不送出跨網域請求。
- **【首版】商品：** 商家網域的 Store API 已有 `Access-Control-Allow-Origin: *`（§3.2.2，由同一個 `handleStoreCatalogGet` 回應），瀏覽器端可以照現況讀。
- **【延後】** 頁面的瀏覽器跨網域讀取。可能做法是在 `/_morph/content` 加 CORS，或由外部網站自己的伺服器轉送。前者會改變 Core 的回應政策，需要另做安全審閱。

## 7. 分階段接線與版本交付

原則：

- **一份核心。** 核心原始碼只存在一處，不依賴框架，也不 import 平台程式碼。
- **兩種入口。** 平台薄入口與外部套件只做接線，不帶讀取邏輯。
- **任何階段都不得出現被修改過的核心副本。** 這延續 #221 的結構測試做法：核心 sha256 比對、Theme 不得自帶 reader。

| 階段 | 內容                                                                                                                                                            | 交付物                           | 驗收                                                                      | 授權                                                                                                                      |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 0    | #221 測試原型                                                                                                                                                   | 原型（現況）                     | 已完成原型層級的並行隔離                                                  | 已完成，草稿                                                                                                              |
| 1    | 核心定稿：依本契約實作 `pages.get`、`products.list`、`products.get`、錯誤與網址規則；核心在 repo 內單一位置                                                     | repo 內的核心模組，未發布        | 單元測試＋反向檢查：快取來源、靜默預設、null 誤用、錯誤帶網址             | **【已實作 v0】#246**（只有 `source: origin`）                                                                            |
| 2    | 託管 Start Theme 接線：Starter 的 `src/morph/` 改為引用核心的薄入口，接線放在 `.morph/` wrapper（#221 §4.5）；舊讀法 `content()` 經 Starter 升級流程遷移（G11） | 新 Starter 版本                  | 不改作者設定檔；真實 Start 執行；並行請求不串資料；升級衝突走既有衝突流程 | 實作與 Starter 升版需授權。**前置條件（使用者 2026-10-16 決定）：§9 Q5 工作區套件與 Q7 SDK 建置檢查都已就位，否則不開始** |
| 3    | 託管 Astro 接線：integration 掛在 Morph 的 Astro wrapper                                                                                                        | 同上                             | 真實 `astro dev`／`astro build`                                           | 需授權；排在 L1.5 之前                                                                                                    |
| 4    | 外部套件：同一份核心建置成可安裝套件，提供 `source: origin` 的伺服器端接線                                                                                      | 套件（先在 repo 內建置，不發布） | 外部 Start 專案從獨立網域讀內容網域；圖片網址補全；瀏覽器端拒絕           | npm 發布與部署另行授權                                                                                                    |
| 5    | 【目標】獨立內容後台：發布模型（§4.1）、內容歸屬（§4.2）、內容網域（§4.3）                                                                                      | 另一份設計與遷移                 | 沒有 Theme 的內容網域可讀；既有發布安全檢查全部保留，並有反向檢查         | 設計審閱後另行授權                                                                                                        |
| 6    | 【目標】API 變更：§6.2 的空內容／不存在、改名                                                                                                                   | Core 變更＋Starter 版本          | 舊 Starter 不受影響；新 Starter 能區分                                    | 需授權                                                                                                                    |

**版本規則【提案】：**

- **核心帶契約版本號。** 套件版本的 major 對應契約版本。
- **什麼算 breaking。**
  - 錯誤碼集合、`MorphPage` 形狀、null 規則的變更都算 breaking，要升 major。
  - 新增選填設定或回應欄位算 minor。
- **平台薄入口與外部套件從同一個 commit 的核心建置。** CI 比對兩者核心的 sha256；薄入口隨 Starter 版本鎖定精確版本。
- **伺服器 API 只做相容的新增**，例如 §6.2 的新欄位，讓仍在使用的舊版 Starter 與舊版套件繼續可用。
  - 不相容的變更要先讓所有支援中的版本升級，並且另行審閱。
- 第 6 階段的改名與新欄位必須在同一個 Starter 版本、同一個契約 major 發布。這兩項都是「頁面不存在」同一件事，所以綁在一起。
- **不相關的變更不綁在一起（使用者 2026-10-16 決定 A5）。** 每一項 breaking 變更依自己的理由決定時程，不為了「反正都要升 major」而併入另一項。具體來說，瀏覽器專用碼（§9 Q6）不跟隱藏區塊形狀的改變（#187 §3.2 的 `{}`）一起發布，也不跟第 6 階段綁在一起。

## 8. 延後

以下不在首版，SDK 不得宣稱支援：

- `pages.list`；
- 商品的分類、系列、價格區間等進階過濾；
- `updatedAt` 以外的排序；
- 欄位選取；
- 草稿讀取（#214）；
- GraphQL；
- 條件請求（`If-None-Match`）。v0 不送條件式請求；收到 304 當成轉址拒絕（§6.0）；
- 頁面的瀏覽器跨網域讀取；
- 平台網域的 publishable key 路徑；
- 平台薄入口（託管 Theme 改用 SDK，`source: platform`）；
- 套件發布、打包安裝、外部網站的部署驗收。

## 9. 待使用者決定

1. **發布模型方向（§4.1）。** 選 (A) 不含 Theme build 的 release，或 (B) 內容發布版本有自己的 live 指標。兩者都還沒有設計。建議先就這兩個方向做一份發布模型設計，再決定。
2. **內容網域（§4.3）。**
   - 沿用 `storefront_domains`，還是另一種網域種類。
   - 內容網域上是否也服務 Theme 頁面。
3. **「頁面不存在」的定義與 SDK 行為（§6.2 目標）。**
   - 託管 Theme 上沒有 Document 的路由算不算存在。建議算存在，維持現況的預設值行為。
   - `pages.get` 對不存在的頁面回 `null` 還是丟 `page_not_found`。建議丟錯，因為頁面讀取一向以失敗即拋出為原則；這與 `products.get` 不同，需要你確認。
4. **改名後的碼名（§6.2 目標）。** 建議 `content_source_unavailable`。
5. **工作區套件**：核心位置已由 #246 定為 `packages/morph-sdk/`（獨立目錄，`private: true`）。
   - **已決定（使用者 2026-10-16）**：列為 pnpm 工作區套件，是第 2 階段的**前置條件**；沒有就位，第 2 階段不開始（§7）。
   - **尚未做**：目前 `pnpm-workspace.yaml` 仍只列 `"."`。實作時機與方式（lockfile 變更、app 以套件名稱引用）另行授權。
6. **瀏覽器呼叫 `pages.get` 的錯誤碼。** v0 沿用 `invalid_content_origin`（§6.0），訊息「來源位址不可用」對這個情況會誤導。
   - **已決定（使用者 2026-10-16，A5）**：這一題**單獨決定**，不和隱藏區塊形狀的改變（#187 §3.2 的 `{}`）綁在一起，也不等待其他錯誤碼變更（§7 版本規則）。
   - **仍待決定**：要不要新增專用碼（例如 `server_only`）、何時新增。新增碼仍要和 Starter 的錯誤碼集合一致；若只在 SDK 新增，要另外說明兩者的差異。
7. **SDK 建置檢查。** `pnpm build` 不涵蓋 SDK，目前只有 typecheck 與測試保護它。
   - **已決定（使用者 2026-10-16）**：SDK 自己的建置檢查是第 2 階段的**前置條件**，不再等到第 4 階段（§7）。
   - **尚未做**：檢查內容（例如建置核心、確認沒有外部 import、產物可被 Start 與 Astro 載入）另行設計與授權。

## 10. 與其他 PR 的關係

- #244（ROADMAP，由本機主線負責）：本 PR 不修改。「外部網站不必建置或發布 Theme」這項目標與依賴，等本契約更新後由 #244 補上，避免兩邊各寫一份。
- #221：只引用 PR 編號。
- #246：SDK 讀取核心 v0 的實作，已合併（main `468a9f4`）。本文 §6.0 依它的程式更新。
- #187：讀取契約與隱藏區塊設計。`pages.get` 回傳的隱藏區塊形狀以本文 §6.2 與 §6.0 為準，#187 引用這裡，不另寫一份；隱藏區塊的最終形狀由 #187 決定。
- #214：草稿讀取的授權，依賴，不在本 PR 處理。
