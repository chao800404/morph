# 統一 Morph SDK：既有能力盤點與讀取契約（設計草稿）

ROADMAP 1.4 第一階段「盤點與契約設計」的交付物。方向見 #244（ROADMAP 1.4，草稿）；共用讀取核心的原型與設計見 #221（草稿，`docs/content-read-core-design.md` 只在該 PR，main 上沒有，本文只引用 PR 編號，不複製其內容）。

**範圍。** 只寫設計，不含程式、測試或設定變更。不授權實作、部署、npm 發布。契約只描述既有能力；尚未實作的能力一律標為【延後】，不寫成已支援。

**核對基準。** main `52d1e3a`。

## 0. 標記

| 標記             | 意思                                                       |
| ---------------- | ---------------------------------------------------------- |
| 【已核對】       | 讀過所列程式碼。不等於執行過。                             |
| 【已核對＋測試】 | 讀過程式碼，並有既有測試涵蓋（列出測試名）。本輪沒有重跑。 |
| 【推論，未執行】 | 由程式碼推得，沒有用瀏覽器或真實請求驗證。                 |
| 【提案】         | 本文提出的契約，待審閱。                                   |
| 【延後】         | 不在首版契約內。                                           |
| 【待決】         | 需要使用者決定，見 §6。                                    |

## 1. 一句話結論

已發布頁面與公開商品**在商家網域上已經用同一種方式決定範圍**：都由 Core 依網域解析商店，都不接受訪客的 key。差異在三處：頁面端點沒有 CORS、平台網域上的 Store API 另有一條用 publishable key 的路徑、兩邊的錯誤與查無資料的語意不同。統一 SDK 首版可以只包裝這些既有能力；外部網域從瀏覽器讀頁面、圖片網址跨網域可用，是首版前必須決定的缺口（§3、§6）。

## 2. 既有能力盤點

### 2.1 已發布頁面：`GET /_morph/content?path=`

【已核對】`src/lib/storefront/service/storefront-production.service.ts`（`handleRequest`、`serveContent` 約 286 行起）、`storefront-content-runtime.ts`、`storefront-host-resolver.ts`。

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
- **查無資料。** 路徑沒有任何文件時回 `200 { slots: {}, hiddenSlots: [] }`，不是 404。程式註解明確說這不是錯誤：元件預設值就是正確結果。
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

### 2.2 公開商品：Store API

同一個處理函式 `handleStoreCatalogGet`（`src/lib/storefront/service/store-catalog-request.ts`）有**兩個入口**，範圍決定方式不同。

#### 2.2.1 商家網域上的 `/api/store/products`

【已核對＋測試】`storefront-production.service.ts` 約 245 行、`src/server.ts` 的 `catalogHandler`；測試 "routes only read-only catalog requests using the resolved storefront"。

- 同樣先經 `resolveStorefrontHost`，所以前提與 §2.1 相同：需要已發布的 Theme release。
- `catalogHandler` 只用解析出的 `hostname` 呼叫 `storeContextDal.resolveCatalog`，註解為 "Do not accept a visitor's publishable key, channel, or host override."
- 解析出的 `storefrontId` 與網域不符時回 503。
- 只接受 GET（405）。
- **結論：商家網域上，商品與頁面一樣由網域決定範圍，不用 key。** Starter 的 `src/morph/catalog.ts` 就是讀這個入口：伺服器端用 `x-morph-content-origin`，瀏覽器用相對路徑。

#### 2.2.2 平台網域上的 `/api/store/products`

【已核對】`src/routes/_backend/api/store/$.ts` 的 `contextOf`、`src/lib/storefront/dal/store-context.dal.ts` 的 `resolveCatalog`。

- **範圍來源。**
  - `x-publishable-api-key`：驗證 key 存在、`type = publishable`、未撤銷、未刪除，並驗證 salt／token。取得 key 連結的銷售通路；沒有連結時拒絕。
  - `x-storefront-host`：指定網域。沒有 key 時退回 `Host` 標頭。網域須為 active。
  - 同時給 key 與網域時，網域的銷售通路必須在 key 的通路內，否則拒絕。
  - 兩者都沒有時拒絕。最後必須剛好一個未停用的銷售通路。
  - 失敗：`401 { error: "INVALID_STORE_CONTEXT", message }`，`private, no-store`。
- **`x-storefront-host` 沒有驗證來源。** 不帶 key 時，只要指定任一 active 網域，就取得該網域的公開目錄。目錄本來就公開在該商家網域上，所以這不是外洩；但這表示 publishable key 在公開目錄上是**範圍設定，不是存取控制**。
- **CORS。** `Access-Control-Allow-Origin: *`；允許標頭 `content-type, x-publishable-api-key, x-storefront-host`；OPTIONS 回 204。
- **快取。** 公開回應 `public, max-age=0, s-maxage=30, stale-while-revalidate=60`，`Vary: x-publishable-api-key, x-storefront-host`；錯誤的 context 為 `private, no-store`。

#### 2.2.3 參數與回應（兩個入口相同）

【已核對】`src/lib/validations/store-api.ts`、`src/lib/storefront/dal/store-catalog.dal.ts`。

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
  - 找不到時回 `404 { error: "NOT_FOUND", message: "Product not found" }`。這個 404 走公開快取（30 秒）。
- **`GET assets/<uuid>`**：只給該銷售通路已發布商品引用的資產。
- **`context`** 為 `StoreCatalogContextDTO`：`storeId, storefrontId, salesChannelId, regionId|null, currencyCode|null, automaticTaxes, isTaxInclusive, countryCode, localeCode`。
  - 平台入口可用 `region_id`、`country_code` 參數指定。商家入口不轉交這兩個參數。

### 2.3 Starter 的讀取模組

【已核對】`src/lib/storefront/starter-theme-v3-files.ts` 的 `STARTER_THEME_CONTENT_MODULE_SOURCE`（約 2136 行起）、`starter-theme-catalog-files.ts`。

- **頁面有兩套讀法並存。**
  - `content()`／`isSectionHidden()`：讀不到時回 `EMPTY_CONTENT`，也就是靜默顯示元件預設值。
  - `morph.pages.get(path)`／`morph.pages.isHidden()`：失敗一律丟 `MorphContentError`，不退回預設值。
- **`MorphPage` 形狀。** slot 值直接攤平在頁面物件上，隱藏清單放 `_hidden`。若回應含名為 `_hidden` 的 slot，丟 `reserved_slot`。
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
- **`content_not_found` 的語意與實際不符。** 只在 HTTP 404 時產生。Core 的 404 只來自網域／release 解析（§2.1）；不存在的頁面路徑回 200 空內容。所以這個碼實際代表「這個網域沒有可讀的已發布商店」，不是「這頁沒有內容」。
- **商品讀取不在 `morph` 物件上。** 由 `loadProducts`／`loadProduct` 提供；查無商品回 `{ product: null }`，其他失敗丟一般 `Error`，沒有錯誤碼。

### 2.4 #221 原型

只引用，不複製：#221 的 `fixtures/morph/content-read-core/core.ts`（測試原型）與 `docs/content-read-core-design.md`。契約設計依賴其中的這些部分：

- `createMorph(source)`；
- 不依賴框架；
- 每次請求由接線提供來源；
- 錯誤碼與 Starter 逐字相同；
- 失敗不回預設值；
- workerd 並行隔離（測試原型層級）。

## 3. 缺口

| #   | 缺口                                                                                                                                          | 依據                                                                  | 影響                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| G1  | 頁面與商家網域商品的前提是「網域有已發布的 Theme release」。完全不由 Morph 託管 Theme 的外部網站，目前讀不到內容。                            | 【已核對】`resolveStorefrontHost` 對所有路徑都先檢查 release 與 build | 外部網站必須先有一個已發布的 Morph storefront 作為來源；是否放寬屬於另一項設計，本文不提案 |
| G2  | `/_morph/content` 沒有 CORS，外部網域的瀏覽器讀取會被擋。                                                                                     | 【已核對】沒有標頭；【推論，未執行】瀏覽器行為                        | 外部網站在瀏覽器切頁時無法直接讀頁面（§6 Q2）                                              |
| G3  | 圖片網址都是相對路徑：頁面媒體為 `/_storefront-media/<id>?version=…`，商品圖為 `/api/store/assets/<id>`。外部網域直接使用會解析到自己的網域。 | 【已核對】`publishedMediaPath`、`store-catalog.dal.ts`                | SDK 必須以來源網址補成絕對網址（§4.7）                                                     |
| G4  | 在平台網域上，`<img>` 不會帶 key 或 `x-storefront-host`；這時 `contextOf` 退回 `Host`，也就是平台網域，商品圖可能回 401。                     | 【推論，未執行】                                                      | 外部網站的商品圖應指向商家網域，而不是平台網域（§4.7）                                     |
| G5  | 查無資料語意不一：未知頁面回 200 空內容；網域／release 不存在回 404 純文字；商品回 404 JSON。                                                 | 【已核對】                                                            | SDK 需要統一對外語意（§4.5）                                                               |
| G6  | 錯誤格式不一：內容端點是純文字；Store API 是 `{ error, message, details? }`；Starter 用自己的碼。                                             | 【已核對】                                                            | 統一錯誤模型（§4.4）                                                                       |
| G7  | 頁面讀取有宣告但未實作的轉址拒絕與大小上限。                                                                                                  | 【已核對】§2.3                                                        | 對應 #221 待決 4；不在首版契約宣稱已支援                                                   |
| G8  | 內容端點有 ETag 但不回 304。                                                                                                                  | 【已核對】                                                            | 只影響效能；首版不依賴條件請求                                                             |
| G9  | 舊讀法 `content()` 會靜默退回預設值，與 SDK「失敗不回預設」原則衝突。                                                                         | 【已核對】                                                            | Starter 遷移路徑（#221 待決 5）                                                            |
| G10 | 商品讀取沒有錯誤碼，失敗是一般 `Error`。                                                                                                      | 【已核對】                                                            | 統一錯誤模型（§4.4）                                                                       |

## 4. 契約提案

以下全部是【提案】，只包裝 §2 的既有能力。

### 4.1 設定與來源

```ts
type MorphSource =
  // Hosted Theme: the origin comes from the request, set by Core
  // (x-morph-content-origin). The wiring supplies it per request.
  | { kind: "platform" }
  // An explicitly named merchant storefront origin, e.g. https://shop.example.
  | { kind: "origin"; origin: string };

createMorph({ source: MorphSource /* , publishableKey? see §6 Q1 */ });
```

- `createMorph` 只保存不變的設定。每次請求的來源由平台或 integration 接線提供（沿用 #221），不得放進可變的全域狀態。
- `origin` 必須是 http／https、不含帳密、等於 `new URL(origin).origin`，與 Starter 的 `catalog.ts` 檢查一致。不合法時丟 `invalid_content_origin`。
- **首版以商家網域作為頁面與商品的單一來源。** 理由：
  - §2.2.1 已證明商家網域上兩者範圍相同，都由網域決定、都不用 key。
  - 這不需要新端點，也不需要為頁面加 key。
  - 平台網域的 key 路徑保留給 §6 Q1 決定。

### 4.2 `pages.get(path)`

- 對應 `GET <origin>/_morph/content?path=`。
- 參數規則沿用：以 `/` 開頭、最多 500 字元；違反時在發請求前丟 `invalid_path`。
- 回傳 `MorphPage`：沿用 Starter 的形狀（slot 攤平＋`_hidden`）與 `isHidden()`。
- 隱藏區塊的最終形狀依 #187 決定，本契約不改。
- 只讀已發布內容。草稿讀取【延後】，依賴 #214。

### 4.3 `products.list(params)`／`products.get(handle)`

- `products.list({ q?, page?, limit?, order? })` 對應 `GET <origin>/api/store/products`。
  - 參數範圍與預設值完全沿用 §2.2.3，包含 `order`。
  - SDK 端先做相同驗證，不合法時丟 `invalid_request`，不送出請求。
  - 回傳 `{ products, pagination: { page, limit, total, totalPages }, context }`，欄位沿用 DTO，不新增、不改名。
- `products.get(handle)` 對應 `GET <origin>/api/store/products/<handle>`。
  - handle 規則沿用。
  - 回傳 `{ product, context }`；查無時回 `null`，見 §4.5。
- 價格、庫存與銷售通路沿用商務服務的結果。SDK 不計算、不快取價格。

### 4.4 錯誤模型

- 一個錯誤類別 `MorphError`：
  - `code`：封閉集合。
  - `resource`：`"page" | "product"`。
  - `message`：寫死的文字。
  - 錯誤物件不含上游內容、網址、key 或堆疊；細節只進伺服器 log。
- **頁面的碼：** 沿用 Starter 的 10 個碼，逐字相同（#221 的要求）。
- **商品的碼：**

  | 情況                        | 碼                                |
  | --------------------------- | --------------------------------- |
  | 400 `INVALID_REQUEST`       | `invalid_request`                 |
  | 401 `INVALID_STORE_CONTEXT` | `invalid_store_context`           |
  | 網路失敗                    | `store_unreachable`（與頁面共用） |
  | 非 JSON 或形狀不符          | `invalid_response`（共用）        |
  | 其他非 2xx                  | `store_error`（共用）             |
  - 共用的碼語意相同。新增的碼只有 `invalid_request`、`invalid_store_context`。

- **不變的原則：** 任何失敗都丟錯，不回空陣列、`{}` 或預設頁面。
  - 例外只有 §4.5 列出的「查無資料」。

### 4.5 查無資料

| 情況                        | 既有回應        | SDK 行為                                                                   |
| --------------------------- | --------------- | -------------------------------------------------------------------------- |
| 頁面路徑沒有文件            | 200 空內容      | 回傳空頁面（`_hidden: []`、無 slot）。這是既有語意：元件預設值是正確結果。 |
| 網域、商店或 release 不存在 | 404 純文字      | 丟錯。碼為 `content_not_found`（沿用）；是否改名為更貼切的碼見 §6 Q4       |
| release build 不可用        | 503 純文字      | 丟 `store_error`                                                           |
| `products.get` 查無商品     | 404 `NOT_FOUND` | 回 `null`，與 Starter `loadProduct` 一致                                   |
| `products.list` 沒有結果    | 200 空陣列      | 回空陣列，`total: 0`                                                       |

### 4.6 分頁

- 只有商品有分頁：頁碼式（`page`／`limit`），回應帶 `total`、`totalPages`，上限沿用（`page ≤ 10000`、`limit ≤ 100`）。
- 不提供 cursor。之後 `pages.list` 等列表要沿用同一個慣例，但各資源保留自己的上限（ROADMAP 1.4 第 4 階段）。

### 4.7 相對網址

- **規則：** SDK 把回應中以 `/` 開頭的媒體網址，以讀取時使用的來源補成絕對網址。
  - 範圍是 `_storefront-media/…`，以及商品的 `thumbnailUrl`、資產 `url`。
  - 已是 http／https 的網址不動。
  - 其他協定沿用 `isSafeThemeMediaUrl` 的結果（伺服器已過濾）。
- **託管 Theme（`platform`）：** 瀏覽器端維持相對網址，同網域，與現況相同。伺服器端渲染輸出的網址也維持相對，避免把 Core 內部轉送用的 origin 寫進頁面。
- **外部網站（`origin`）：** 一律補成 `<origin>/…`。商品圖因此指向商家網域，避開 G4。
- 連結值（`resolveThemeLinksInSlotValues`）不屬於媒體。是否補成絕對網址要看連結指向的是商家站內頁還是外部網站自己的頁面，留到第 3 階段驗收時決定，首版不改寫。

### 4.8 快取

- SDK 首版**不自建快取**，沿用 HTTP 快取：
  - 頁面為 `public, max-age=60, must-revalidate`，ETag 以 release 區分；
  - 商品為 `s-maxage=30, stale-while-revalidate=60`，`Vary` 依 key 與 host。
- 不在模組層快取任何回應，避免並行請求串資料。這與 #221 的反向檢查「core caches the source」同一原則。
- 不送憑證（`credentials: "omit"`），回應可以安全進入公開快取。
- 草稿讀取（延後）必須 `no-store`，且不得進入公開快取。

### 4.9 key 種類

| 種類                   | 現況                                             | 首版 SDK                                 |
| ---------------------- | ------------------------------------------------ | ---------------------------------------- |
| 無 key，由網域決定範圍 | 商家網域上的頁面與商品                           | 預設來源（§4.1）                         |
| publishable key        | 只有平台網域的 Store API；屬於範圍設定，不是秘密 | 【待決】§6 Q1                            |
| 私密或草稿憑證         | 不存在（#214 草稿）                              | 【延後】。不得進瀏覽器程式包、網址或日誌 |
| 後台或寫入             | 不在公開讀取 SDK                                 | 不提供                                   |

## 5. 延後

以下不在首版契約內，SDK 不得宣稱支援：

- `pages.list`；
- 商品的分類、系列、價格區間等進階過濾；
- `updatedAt` 以外的排序；
- 欄位選取；
- 草稿讀取（#214）；
- GraphQL；
- 條件請求（304）；
- 轉址拒絕與大小上限的正式行為（#221 待決 4）；
- 平台網域以外的商品圖存取方式（G4）。

## 6. 待使用者決定

1. **頁面與商品如何統一來源設定；頁面要不要用 key。**
   - (a) 【建議】首版以商家網域 `origin` 作為兩者的單一來源，不用 key。這是現有行為，不需新端點。
   - (b) 外部網站改用平台網域，加上 publishable key。這只對商品可行；頁面要用 key 就得在平台網域新增讀取路徑，違反「不預設另建端點」。
   - (c) 兩者並存：`createMorph` 接受選填的 `publishableKey`，只用在平台網域的商品讀取。
   - 代價：(a) 外部網站必須有一個已發布的 Morph storefront 網域（G1）；(c) 會出現兩條範圍規則，需要寫清楚衝突時以誰為準。
2. **外部網域從瀏覽器讀頁面時，跨網域怎麼處理。**
   - (a) 【建議首版】外部網站只在伺服器端讀頁面；SDK 在瀏覽器端遇到跨網域來源時直接丟 `invalid_content_origin`，不嘗試讀取。
   - (b) `/_morph/content` 加 `Access-Control-Allow-Origin: *`。內容本來就公開在該網域，但這會改變 Core 的回應政策，需要另做安全審閱，並決定 `Vary`、OPTIONS 與 ETag 的處理。
   - (c) 由外部網站自己的伺服器轉送。不需改 Core，但 SDK 要提供轉送用的路徑設定。
3. **平台薄入口和外部套件怎麼共用同一份核心。**
   - (a) 一個套件，平台薄入口依賴同一版本；Starter 鎖定版本，由既有的 Starter 升級工具更新。
   - (b) 平台由同一份原始碼產生檔案放進 Theme，外部套件從同一份原始碼建置，以 sha256 比對保證相同（沿用 #221 的結構測試做法）。
   - 兩者都要符合「不得出現被修改過的核心副本」。#221 §4.6 的比較建議平台維護核心＋作者薄入口；本文不重複其論證。
4. **`content_not_found` 是否改名。** 實際語意是「網域沒有可讀的已發布商店」（§2.3）。改名需要 Starter 升版，並與 #221 的「錯誤碼逐字相同」一起改。建議：首版沿用，只更正說明文字。
5. **`products.get` 查無時回 `null` 還是丟錯。** 建議回 `null`，與 Starter 一致；頁面則因既有語意回空頁面。

## 7. 下一步（都需另行授權）

- 依 ROADMAP 順序：案例 B 剩下的項目 → 本契約審閱（與 #244 一起看）→ 共用讀取核心正式接線（#221）→ 第 2 階段實作。
- 本文不改 #244、#221，也不改任何程式。
