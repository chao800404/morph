# 內容綁定契約（設計草稿）

狀態：**草稿。** 2026-10-12 審閱：設計原則獲認可，尚未授權實作。所述「現況」已於 2026-10-12 對照 `main`（`02024d9`）核對。

## 0. 這份文件解決什麼

Design 在畫布上點選一個元素、在 Inspector 修改、寫回 Document 之前，要能確認：**這個元素顯示的是哪個頁面、哪個區塊實例、哪一列、哪個欄位，依據的是哪一版原始碼與內容**。任一項無法確認，就停止這次視覺寫入，而不是猜。

產品目標（ROADMAP 1.2，草稿見 #203）：作者用框架原本的寫法撰寫 Theme；Design 逐步接上這些寫法，不要求作者為了 Design 改寫。只能執行、Design 卻認不出綁定，不算達成目標。

與其他文件的關係：

- **讀取與隱藏契約**（#187，`docs/content-read-contract-design.md`）：定義內容讀到什麼形狀、隱藏怎麼成立。本文件依賴它，但不重複它。
- **Astro L1.5**（#191）：`.astro` 的點選定位與欄位，是本契約在 Astro 的實作計畫之一。
- 本文件核准後，才能據以實作伺服器端探測、Astro L1.5b 的綁定與兩個正式驗收案例（§6）。

非目標：

- 不承諾自動理解任意資料轉換。
- 不為個別語法加零散特例；先定契約與案例清單，再實作。
- 不改變權限、OCC、發布規則。**Core 的授權與 OCC 不等於綁定正確**：它們防止越權與過時寫入，不能證明點到的元素就是那個欄位；也不能由「寫入被接受」反推綁定正確。

## 1. 綁定要確認的六件事

一次視覺寫入，必須同時確認下列六項。每一項都要說明「證據從哪裡來」與「無法確認時怎麼辦」。

| # | 項目 | 指的是 | 現況（main `02024d9`） |
|---|---|---|---|
| 1 | **頁面身分** | 哪個 route／Document（含 layout Document） | 編輯器以 route 與 template 對應 Document；layout slot 由 `deriveThemeLayoutSections` 推導 |
| 2 | **區塊實例身分** | 同一元件出現兩次時是哪一個；必須是穩定 id，不是渲染順序 | TSX：元件對應到 Document 區塊時，預覽注入 `data-storefront-section-id`（`data-morph-section` 是作者可選的標記，不是必要條件）；同元件兩實例各自獨立（`content-fields-sidecar` E2E） |
| 3 | **重複列身分** | 陣列中的哪一列；以 Document 的列 `id` 確認，不只靠 index | #198：`data-storefront-item-id`，同一清單內重複或缺少 id 時拒絕；元件自己渲染的列有拒絕原因碼 |
| 4 | **欄位路徑與宣告** | 原始欄位路徑（例如 `items.2.title`），且在 `contentFields`／`.fields.ts` 宣告過 | 編譯時注入 `data-storefront-field(-path)`；伺服器端以內容能力（`theme-content-capabilities`，DAL）拒絕未宣告欄位；手寫標記不得蓋過可確認的來源（#209） |
| 5 | **來源版本** | 畫面依據的是哪一版原始碼 | 預覽檔案更新帶 `sourceGeneration`，但**畫布選取本身不帶來源版本**；寫入時沒有比對 |
| 6 | **內容版本** | 畫面依據的是哪一版 Document／內容快照 | 預覽快照有 `contentTicket`／`contentHash`（#181、#185）；Document 寫入有 OCC；**選取與寫入之間沒有比對畫面所依據的內容版本** |

第 5、6 項是目前最大的缺口：選取發生時與寫入發生時，原始碼或內容可能已經不同，寫入仍可能被 OCC 接受，卻寫到另一版畫面上的意思。這是**風險**，不是已證明的缺陷：沒有選取版本欄位，不代表現有的寫入都會出錯。實作比對之前，先用受控案例確認哪些情況真的會寫錯目的地（例如選取後另一分頁改了列順序、Code 改了元件、預覽重新整理成新內容）。

## 2. 證據的來源：三種，同一套驗證

| 來源 | 適用 | 說明 |
|---|---|---|
| **編譯時注入** | TSX（已有，`injectPreviewBindings`）；`.astro`（L1.5，#191，未實作） | 從原始碼證明「這個元素顯示這個 prop」，在預覽產物上寫入身分屬性；作者原始碼不變 |
| **執行時探測** | 瀏覽器端資料流（實驗，#187 附錄）；伺服器端資料流（未設計） | 把欄位換成唯一探針，讓頁面照作者程式重跑，看探針出現在哪個元素 |
| **可選的明確綁定出口** | 自動辨識做不到的寫法 | 作者標明「這個元件實例對應 `/home` 的 `hero`」，不改變原本的資料載入方式，也不靠猜變數名稱。**可選**，不是必要條件 |

三種來源都只產生一份「綁定主張」（頁面、實例、列、欄位路徑），**全部經過同一套驗證**（§3），沒有哪一種可以直接決定寫入。手寫標記（`data-storefront-field`、`data-morph-element`）只是提示（規則 02 §8.5、#209）：與可確認的來源衝突，或來源無法確認時，停止寫入。

綁定出口不解決執行期的問題：它只告訴 Morph「這是哪個實例」，不會讓已經先執行的運算不執行（見 #187 §4.2）。

## 3. 寫入前的驗證

視覺寫入只在以下全部成立時進行，否則停止這次寫入，並以原因碼說明（沿用 `ContentUnavailableReason` 的做法）；Code 照常可編輯：

1. 綁定主張的每一項都有證據，而且三種來源之間沒有矛盾。
2. 欄位在**該次預覽所依據的原始碼版本**的宣告中存在，型別相符（伺服器端再以內容能力檢查一次）。
3. 區塊實例與列 id 在**目前**畫面上唯一，與選取時一致（#198 已有列的部分）。
4. 寫入依據的**編輯基線**仍然有效（見下方「編輯基線」）；失效就要求重新選取，不自動改寫目的地。
5. 寫入沿用既有的權限、source generation 與 OCC，不另開寫入路徑。

### 3.1 編輯基線：自己的儲存前進，外部變更失效

選取時記錄一份編輯基線：來源版本、內容版本，以及這次選取的實例與列 id。不能要求「寫入時版本與選取時完全相同」：第一筆自動儲存成功後內容版本就前進，下一次輸入會被自己的儲存擋住。

**可以安全前進基線的條件（全部成立）：**

- 版本的變化來自**這個編輯器自己送出、且已確認成功**的寫入（以送出的寫入識別對應回應，不是看到版本變大就算）；
- 新版本是基線版本的**直接後繼**：中間沒有其他寫入（OCC 的預期版本鏈連續）；
- 這筆寫入改的是同一個區塊實例或同一份 Document 中、不影響本次綁定的部分（例如同一欄位的連續輸入、同區塊其他欄位）；改到列順序、列的增刪、區塊結構時，重新確認實例與列 id；
- 來源版本沒有變。原始碼的任何變更（包括同一分頁 Code 模式的儲存）都讓視覺綁定重新確認，因為元件可能已經改了顯示的欄位。

**一律讓基線失效、要求重新選取：**

- 另一個分頁、另一位作者或伺服器端造成的內容或來源變更；
- 結果不明的寫入（回應遺失；沿用 #192 的未確認儲存處理），在確認之前不前進基線；
- 預覽重新載入後的內容雜湊，無法由自己已確認的寫入解釋。

外部變更不得默默沿用舊基線繼續寫入。

### 3.2 探測結果：命中不等於證明

執行時探測把欄位換成唯一探針，再看探針出現在哪裡。探針本身會改變輸入，所以「探針文字出現在某個元素」只是候選，不是證明：

- **探測必須對回原畫面**：探測執行的來源版本、內容版本、路由與實例，必須和使用者看到的畫面相同；對不回去就不採用。
- **結構必須一致**：帶探針的渲染與原畫面相比，元素結構（同一實例內的元素路徑與數量）要相同。探針改變了條件分支（例如空字串 vs 非空、長度判斷、數值比較）、讓某段不渲染或多渲染，就是歧義。
- **出現方式必須單純**：探針完整、原樣出現在單一元素才算候選；出現在多處、被截斷、格式化、大小寫轉換或與其他欄位拼接，只能當作「這個欄位影響這裡」，不能開放畫布直接編輯（依 §4 交給 Inspector 編原始值）。
- **型別要能承受探針**：數字、布林、日期、URL、圖片等欄位，探針值可能改變執行狀態或被拒絕；這些欄位需要各自的探測方式，不能直接套用文字探針。
- **與其他證據一致**：探測結果與編譯時注入或綁定出口矛盾時，停止寫入。
- 探測只產生綁定主張的候選，仍要經過 §3 的全部驗證。

## 4. 衍生值：回到原始欄位，不反推顯示文字

| 畫面上的值 | Design 的行為 |
|---|---|
| 就是儲存值（逐字相同） | 可在畫布上直接編輯，也可在 Inspector 編輯 |
| 經轉換（`toUpperCase()`、格式化、`slice()`…） | 畫布上不編輯；Inspector 顯示並編輯**原始儲存值**（#186 已實作這條規則）；不從顯示文字反推 |
| 多欄位拼接（`first + " " + last`） | 畫布上不編輯；Inspector 分別列出每個來源欄位 |
| 無法追到單一欄位 | 不提供內容編輯；說明原因；Code 可改 |
| CSS 造成的外觀變化（`text-transform`） | 不是值的轉換：可直接編輯，存作者打的字（#186） |

選取整個區塊時，Inspector 仍列出所有宣告的欄位，讓作者即使在畫布上點不到，也能編輯。

## 5. 伺服器端資料流

server function → loader → `useLoaderData()` 的資料在伺服器讀取，瀏覽器端快照的探針到不了（#187 附錄）。可能的證據來源：

- **編譯時追蹤**：證明 loader 回傳的物件直接來自 `morph.pages.get()` 的某個路徑，元件 props 再直接來自 `useLoaderData()` 的對應路徑。只處理能證明的形狀。
- **伺服器端探測**：需要先完成隔離設計（專屬實驗預覽、不寫入 Document 或工作區、不覆蓋使用者的新修改、中斷不殘留、副作用隔離、確認當次探測版本、不交換共用容器的快照）。預設 Live Preview 是純前端模式，server function 不能執行；需要完整 Start 預覽（是否改為預設另做決定）。

兩者都還沒有實作。**先研究編譯時追蹤**（使用者 2026-10-12）：它不重新執行作者的伺服器程式，沒有副作用與隔離成本。會重跑伺服器程式的探測，副作用與隔離成本較高，留作後續選項，不當首選。

### 5.1 案例 B 的盤點（2026-10-12，唯讀，main `02024d9`）

**今天的辨識到哪裡為止**

| 環節 | 現況 | 程式位置 |
|---|---|---|
| 區塊身分（route 層） | 只在 JSX 呼叫處辨識兩種寫法：`{...content("x")}`，或 `{...page.x}`／`{...page["x"]}`，其中 `page` 是**同一檔案**裡 `const page = await morph.pages.get("字面路徑")` 宣告的變數（只看名稱，不追 scope）。解構刻意不辨識：模組註解說明，解構的 pattern 被頁面上所有區塊共用，新增、移動、刪除區塊時會需要改第二個地方 | `ast/theme-content-binding.ts`；`inject-preview-bindings.ts` `readSectionSlotId`；`theme-route-sections.ts` `readSlotId` |
| 區塊包裝與 Document 區塊 | 上述寫法才會在預覽包上 `data-storefront-section-id`，也才會出現在 route 的區塊清單（`deriveThemeRouteSections` → `mergeDocumentWithRouteSections`），Document 才有這個區塊可寫 | 同上 |
| 欄位（元件層） | 元件內 prop → JSX 的推導與呼叫處無關：`<Hero {...hero} />` 裡 Hero 的元素仍會帶 `data-storefront-field`，但外面沒有區塊包裝，編輯器不知道這是哪個 Document 區塊 | `inject-preview-bindings.ts`、`theme-field-binding.ts` |
| server function、loader、`useLoaderData()` | 完全沒有辨識 | — |
| 跨檔案 | 元件與列元件的相對 import 有解析（`resolveLocalModulePathFromFiles`：`./x`、`.tsx`、`.jsx`、`/index`）；`morph` 只從 `morph/content` 模組的具名 import 辨識 | `theme-content-capability-resolver.ts` |

**案例 B 斷在哪裡**：`<Hero {...hero} />` 的 `hero` 來自 `Route.useLoaderData()` 的解構，不是上表兩種寫法，所以 route 層既不包區塊、也不列入區塊清單。元件內的欄位屬性還在，但沒有區塊身分，點選後無法對到 Document 的 `hero`。

**第一版可證明的形狀（提案）**

只接受下面每一環都是「直接傳遞、不加工」的形狀；任何一環不符合，整條鏈不成立，該元素顯示為「由程式碼控制」。

1. **server function**：模組層的 `const getX = createServerFn(…).handler(<函式>)`（中間可以有不使用輸入的 `.middleware()`），函式本體**直接回傳** `morph.pages.get("字面路徑")`，或 `const p = await morph.pages.get("字面路徑"); return p;`。`morph` 必須是從 Theme 內容模組具名 import 的。
2. **loader**：route options 的 `loader` 直接回傳那個 server function 的呼叫結果（`() => getX()`、`async () => await getX()`、`async () => getX()`），不包成物件、不合併、不挑選欄位。
3. **元件**：同一個 route 的 `component` 內，`const { hero } = Route.useLoaderData()`（可改名 `{ hero: h }`），或 `const home = Route.useLoaderData()` 再以字面 key 讀 `home.hero`；變數是 `const`，之後沒有重新指定。
4. **呼叫處**：`<Hero {...hero} />` 展開單一 slot。逐欄傳值（`<Hero title={hero.title} subtitle={hero.subtitle} />`，全部來自同一個 slot）列為第二版，要另外定義「全部 props 來自同一 slot」的判斷。
5. **頁面一致**：`morph.pages.get` 的路徑必須就是這個 route 對應的頁面；讀別的頁面的內容（例如 `/` 的 route 讀 `/about`）第一版不開放，避免從一個畫布寫到另一頁的 Document。

**跨檔案範圍（第一版）**

- server function 可以在同一個 route 檔，或由 route 以**相對路徑**直接 import 的 Theme 原始碼檔案（一層）。用既有的 `resolveLocalModulePathFromFiles` 解析。
- 不跟：re-export／barrel 檔、路徑別名（`@/…`）、動態 `import()`、`node_modules`、跨兩層以上的轉手。
- 元件仍沿用既有的相對 import 解析。

**拒絕條件（任一成立就不綁定，並給原因）**

- `pages.get` 的路徑不是字串字面值（變數、模板字串含運算式、由 server function 的輸入決定）。
- handler 對結果做任何加工：轉換、合併、展開、條件分支、讀多個頁面。
- loader 包裝或加工結果（`{ home: await getX() }`、`.then(…)`、挑選欄位）。第一版不追物件包裝；之後可另加「包一層、以字面 key 取回」的形狀。
- 解構帶預設值（`{ hero = {} }`）、rest（`...rest`）、計算 key、兩層以上的巢狀解構；變數用 `let` 或之後被重新指定或修改。
- 同一個 slot 在同一頁出現兩次以上（實例身分不明）。
- 讀取的頁面不是這個 route 的頁面（第 5 點）。
- 需要跨出上面「跨檔案範圍」才能確認的任何一環。

**與結構編輯分開**：辨識解構寫法是為了**內容編輯**。新增、移動、刪除區塊會改寫 route 原始碼，目前只會產生 `content("x")` 這種自成一處的寫法；對使用解構的 route，結構編輯先維持不開放，避免改寫作者的資料流。

**執行環境**：預設 Live Preview 是純前端模式，案例 B 的頁面在那裡無法執行（#187 §6、2026-10-10 實驗）。案例 B 的畫布驗收需要完整 Start 預覽（`MORPH_THEME_PREVIEW_RUNTIME=start`，非預設）。編譯時追蹤本身不需要執行頁面。

**測試工具（`src/lib/test-utils/live-preview-render.ts`）的能力**

- 能做：用產品自己的預覽 source pass、真 React、真 TanStack router 渲染 route，**會執行 route 的 loader**，`useLoaderData()` 可用；內容經 Theme 自己的 `content.ts` client 分支向 `/_morph/content` 取得，由預覽的 resolver 回答。
- 不能做：它替 `@tanstack/react-start` 只提供 `createIsomorphicFn`，**沒有 `createServerFn`**，使用它的 route 載入時就會失敗；它只走 client 分支，不模擬伺服器端執行或完整 Start 預覽。

## 6. 兩個正式驗收案例

以下兩例**都通過**，才能宣稱支援「不限制寫法」的綁定。每例都要確認四件事：

1. **點選**：畫布點選選到正確的頁面、實例與欄位；
2. **Inspector**：修改後畫布更新；
3. **Document**：寫入的是原始值，不是 Theme 轉換後的文字；
4. **重新載入**：畫布、Inspector、Document 三者一致。

並加上反向檢查：同一元件兩個實例互不串寫；被隱藏的區塊不可選取；手寫標記衝突時停止寫入；原始碼在選取後改變時要求重新選取。

**案例 A：Astro frontmatter 解構**

```astro
---
const home = await morph.pages.get("/home");
const { hero } = home;
---
<Hero {...hero} />
```

前置：

- **Astro 可用的內容讀取模組。** 目前 Starter 的 `src/morph/content.ts` 使用 Start 與 React 的 API（`createIsomorphicFn`、`@tanstack/react-start/server` 的 `getRequest`、React context），不能假設原樣放進純 Astro 專案就能用。Astro 需要自己的讀取模組：在 frontmatter（伺服器端）讀取、處理平台轉送的內容來源位址、與 Start 版回傳同樣的頁面形狀與錯誤碼，並遵守 #187 的讀取契約。這份模組要先定義與驗收。
- `.astro` 的來源位置與實例識別（L1.5a、L1.5b，#191）。L1.5a 目前只部分驗收。
- 解析 Worker（L1.5b 的原生綁定經由它）。
- 驗收用純 Astro 的 Theme，不用疊在 Start Starter 上的混合 fixture。

**案例 B：TanStack Start server function → loader → `useLoaderData()`**

```tsx
const getHome = createServerFn().handler(() => morph.pages.get("/home"));
export const Route = createFileRoute("/")({
  loader: () => getHome(),
  component: Home,
});
function Home() {
  const { hero } = Route.useLoaderData();
  return <Hero {...hero} />;
}
```

前置：§5 的伺服器端證據來源、完整 Start 預覽。

兩例都要在真實的預覽路徑上驗收（Astro 用真正的 `.astro` 頁面，不用帶 Start TSX 的網站代替）。

## 7. 認不出時

- 程式照常執行、預覽、建置，Code 照常可編輯。
- 該元素在 Design 顯示為「由程式碼控制」，附原因；不猜測，不寫回。
- 選取整個區塊時，Inspector 仍列出宣告的欄位。
- 這是 Morph 目前的能力限制，不是作者的錯；文件與介面都不寫成「請改寫」。

## 8. 待決事項

- §1 第 5、6 項：先用受控案例確認風險，再定比對方式；§3.1 編輯基線的寫入識別如何取得（沿用既有寫入路徑的哪個欄位）。
- §2 明確綁定出口的形式（元件包裝、屬性、旁設檔案…），以及它在 TSX 與 `.astro` 是否同一種寫法。
- §3.2 非文字欄位的探測方式。
- 完整 Start 預覽是否改為預設（另一個開放決策）。
- Astro 內容讀取模組的形式與交付方式（§6 案例 A 前置）。
- 重複列、圖片與非文字欄位、會變動的內容的案例清單。

已定（使用者 2026-10-12）：設計原則獲認可，尚未授權整套實作；案例 B 先做，先研究可證明的編譯時資料流追蹤（§5）。
