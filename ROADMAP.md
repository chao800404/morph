# Morph Product Roadmap

本文件描述 Morph 從目前 repository foundation 演進成 **AI-native Code-backed Commerce Platform** 的產品路線。

它是方向與交付順序，不是日期承諾。

工程 invariants 以 [`AGENTS.md`](./AGENTS.md) 與 [`.agents/rules/`](./.agents/rules/) 為準。

---

## 1. Product Vision

Morph 的目標不是只做另一個 Shopify section builder，也不是做完全無限制的 Base44 / Lovable clone。

Morph 的定位是：

> **一個以 commerce correctness 為底座、以 React code 為 storefront presentation source、同時提供 Visual Editor 與 AI Code Agent 的 Cloudflare-native commerce platform。**

Morph 希望同時具備：

- Medusa-style modular commerce backend
- Shopify-style Online Store management
- React / Tailwind Code-backed Themes
- Visual AST editing
- AI source generation and modification
- real Canvas / WebGL / Three / GSAP capability
- immutable builds and previews
- atomic releases and rollback
- Cloudflare edge storefront runtime
- eventually commerce-focused app generation

### 1.1 產品形態（2026-09 確認）

每個商店是**一個網站工作區**，不是「從多個主題中挑一個」：

- 不提供主題選擇器或主題市集；程式碼中的 Theme 指的是這個網站的 presentation source workspace。
- 客戶以平台與自己做好的 sections 組合頁面（Design 模式），或在 Code 模式新增元件、修改樣式。
- 開發者可以在本地以標準 TanStack Start 專案撰寫，之後匯入同一個工作區（匯入流程列在後續項目最後）。

### 1.2 Morph 配合框架的寫法，不是作者配合 Morph（2026-10-09 確認）

**產品目標。** 作者用框架原本的寫法撰寫 Theme；Design 逐步接上這些寫法，而不是要求作者為了 Design 改寫。只能執行、Design 卻認不出內容綁定，不算達成這個目標。這是產品要完成的方向，不是拒絕程式的規則：Morph 不因為認不出綁定而拒絕、改寫或限制作者的程式。

**不約制的是資料載入與傳遞方式。**

- 內容經 Morph 的讀取呼叫取得（例如 `morph.pages.get()`），與任何 headless CMS 相同。
- 讀到之後怎麼傳由作者決定：解構、別名、Astro frontmatter、TanStack Start 的 server function → loader → `useLoaderData()`。
- 不要求固定寫成 `home.hero`、不要求手寫標記或特定 wrapper 元件。

**仍要遵守的是欄位契約。** 可以在 Design 視覺寫入的欄位，必須由既有的 `contentFields`／`.fields.ts` 宣告欄位與型別、限制。這規定的是「哪些欄位可寫、怎麼驗證」，不是程式怎麼寫。元件的預設值仍寫在元件程式裡，不要求在宣告中再寫一份，避免兩份真相。

**正式驗收條件（不是未來目標）。** 以下兩例必須通過才能宣稱支援，每例都要確認四件事：畫布點選選到正確的欄位、Inspector 修改後畫布更新、Document 寫入的是原始值（不是 Theme 轉換後的文字）、重新載入後三者一致。

- Astro：首頁 `/` 的 frontmatter 中 `const home = await morph.pages.get("/"); const { hero } = home;`，再 `<Hero {...hero} />`。
- TanStack Start：首頁 `/` 的 `createServerFn` handler 回傳 `morph.pages.get("/")`，route `loader` 呼叫它，元件以 `Route.useLoaderData()` 解構出 `hero`，再 `<Hero {...hero} />`。

**做法分兩層，共用一份契約。**

- 常見的原生寫法逐步完成自動辨識：直接取值、解構、別名、標準 loader／server function 回傳，每種框架以真實案例驗收。
- 複雜寫法可以使用**可選的**明確綁定出口：作者標明「這個元件實例對應 `/home` 的 `hero`」，不必改原本的資料載入方式，也不靠猜變數名稱。不強迫作者重構成可辨識的形狀。
- 契約要說明如何確認：頁面身分、section／列（重複項目）的實例身分、欄位路徑、欄位宣告，以及畫面所依據的來源版本。任一項不明確就停止寫入。

**Core 的授權與 OCC 不等於綁定正確。** 它們防止越權與過時寫入，但不能證明點到的元素就是那個欄位。綁定的正確性要由上面的契約確認，不能只信任畫布傳來的標記，也不能由「寫入被接受」反推。

**認不出時。** 程式照常執行，Code 照常可編輯；該處在 Design 中顯示為由程式碼控制，不猜測、不寫回。不承諾自動理解任意資料轉換；不為每種語法加零散特例，先定契約與案例清單再實作。

**綁定驗收規範（2026-10-21 使用者確認方向，草稿待核准）。**

核心：作者不必為 Design 改寫合法程式。內容的讀取、渲染與保存不得依賴可視化綁定。Morph 應自動追蹤 CMS 資料來源：

- 已證明來源唯一、而且可以安全寫回時，提供直接編輯。
- 已定位來源、但無法唯一反推時，提供原始欄位編輯，不猜測寫回。例如標題由「姓＋名」組成，改整段文字時，不擅自決定怎麼拆回兩個欄位，而是定位到兩個原始欄位讓作者編輯。
- 來源追蹤不足時，明確標示能力缺口，不猜測、不誤寫，也不宣稱已完成支援。

1. **讀取不依賴綁定（硬規則）。** 在支援的框架與執行環境內，Design 認不出資料流時，不得導致內容被過濾、刪除或改變：存著的 Document 必須照常讀取、渲染、保留與發布。這條規則不保證任何程式都能執行成功；作者程式本身的錯誤、外部 API 的失敗另當別論。
2. **相同資料流，得到相同綁定。** 逐欄傳值、解構、別名、spread、多層轉傳，只要最後用的是同一個 CMS 欄位，就應自動對應到它。不要求作者改成 `{...hero}`，也不要求手動加標記。
3. **辨認實際來源與實例。** 不能只看變數名稱、欄位同名或文字相同。覆蓋順序、條件分支、列表中的哪一筆、同一個元件的多個實例，都必須正確處理；證明不了就不宣稱。
4. **驗收案例集，不是語法白名單。** 自動綁定的進度，用一份驗收案例集逐案驗收，並持續擴充。案例集以外的合法程式，仍然必須正常執行、保留內容。尚未能自動綁定的寫法列為能力缺口，不能反過來要求作者換寫法。
5. **共用規則與資料模型，不寫元件特例。** 解構、覆蓋、函式呼叫、跨檔案等，各自需要明確的分析規則。這些規則共用同一套資料流模型，而不是替每個元件或每種寫法加特例。跨函式分析有精確度、時間與記憶體成本，涵蓋範圍隨驗收案例集逐步擴大，不預先承諾全部涵蓋。
6. **Design 與 Inspector 明確區分狀態與寫入路徑，不混成一句「由程式碼控制」：**
   - **CMS 欄位寫入**：已證明為唯一 CMS 欄位來源且可安全反推時，在 Design／Inspector 提供直接編輯，寫入目標 CMS 欄位（Page／Document）；若來源已知但不能反推（如「姓＋名」），提供原始欄位編輯，不猜測寫回。
   - **#290 的 code-default 原始碼預設值編輯**：可證明的元件預設值，且呼叫處未傳入該 prop／spread；若允許修改原始碼，透過專屬的原始碼編輯路徑安全寫入元件檔案預設值，而不是寫入 CMS Document。
   - **無法證明時的拒寫（安全拒絕）**：覆蓋與跨區塊引用只有在實際來源無法證明時才安全拒寫，能證明時應對應實際來源；來源尚未能證明或追蹤不足時，明確安全拒絕寫入並在 Inspector 標示由程式碼控制／能力缺口，不猜測、不誤寫、不損壞內容。追蹤能力不足的直接傳值列為待辦缺口，不能永久當成不支援。
7. **研究項目，不列保證。** 執行時的來源紀錄（「影子紀錄」：不修改字串，只記錄屬性值的來源）列為研究。它必須證明不影響執行順序、React 渲染、SSR 與 hydration，並且能正確區分文件、欄位與重複實例；看到一次執行結果，不代表所有情境都成立。隱藏字元（stega）只作為測試裡的輔助探測，不作為產品機制。
8. **交付順序不是寫法限制。** 第一輪案例是 1.5 的 B1（2026-10-21 核准，提前自 M4，並納入 M1 的完成條件）：
   - `<Hero title={title} desc={desc} />`；
   - 別名；
   - spread 與字面值的覆蓋順序；
   - 兩個實例。

   B1「#295 第一輪 Start 案例已合併」：已完成上述第一輪 Start 案例在完整預覽下的分片驗收，兩個實例不串寫，以及 spread 與字面值的先後覆蓋順序（字面值在 spread 前由展開值覆蓋並綁定，字面值在 spread 後覆蓋展開值且不宣稱）。這只代表已驗收的第一輪能力，不宣稱所有合法寫法或其他框架均已支援；C4b 提案（以其他區塊欄位覆蓋 spread）、多層傳遞、複雜表達式與其他框架留待 M4、M6。M1 其餘固定版本與發布驗收仍按實際證據標示，尚未完成；未解決的寫法列為能力缺口，不能以「安全拒絕」代替通過。

**目前進度（2026-10-26 更新，main `bb263ec`）。**

標示：

- 【已完成】已合併，且有驗證；
- 【已確認缺口】有測試或證據；
- 【進行中】尚未合併；
- 【待決】需使用者決定。

未跑到的驗收不寫成通過。**各 PR 分別通過，不等於正式案例通過。**正式案例必須在同一個固定版本上完成四項驗收，見 1.5。

- **距離產品目標的狀態（TanStack Start；正式案例尚未在固定版本上驗收）。** 目標是：作者照習慣寫元件 → 正常讀取內容 → Design 正確定位與修改 → 發布、重新載入後一致。依五個面向記錄，不用百分比：

  | 面向 | 現況 |
  |---|---|
  | 內容讀取與保留 | 【安全修復已完成，非全量已完成】讀取與寫入一律以存著的 Document 為基準，路由分析認不出的已存區塊照常保留，編輯同頁其他區塊不再將其自 Document 刪除（#291）。已經被刪除的內容不會自動恢復；認不出的區塊在 Design 仍不可編輯，含未綁定區塊時排序安全拒絕；任意資料載入或轉換寫法的讀取保留尚未在固定版本上完成整體驗收。 |
  | 自動綁定 | B1 第一輪已合併（#295）：支援逐欄傳值（`<Hero title={title} desc={desc} />`）、別名，以及 spread 與字面值的先後覆蓋順序（字面值在 spread 前由展開值覆蓋並綁定，字面值在 spread 後覆蓋展開值且不宣稱），以及兩個實例不串寫，經 3 個完整 Start 分片驗收。C4b 提案（以其他區塊欄位覆蓋 spread）、多層傳遞、複雜表達式與其他框架均留在 M4、M6，尚未支援。 |
  | 正確寫入（只改目標欄位） | 已驗收的案例中，兩個實例不串寫（#228）；追蹤不到來源的特定寫法不再宣稱欄位（#283）；在 spread 之後覆蓋的屬性安全拒絕宣稱與寫入，不再誤寫入該展開區塊（#289，如 `<Hero {...content("hero")} title={other.title} />` 不再誤寫入 `hero.title`；但 C4b 提案之自動綁定至 `other.title` 仍屬未實作缺口）。未逐一驗收的寫法，不代表已安全涵蓋。 |
  | 發布閉環 | 尚未在同一個固定版本上完成發布、重新載入與回滾的整體驗收。 |
  | 跨框架 | 只有 TanStack Start 有上述證據；Astro 尚未開始。 |

- **已合併的修正，安全成果與可編輯能力分開記錄。** 安全成果是「不再寫錯、不再弄丟」；可編輯能力是「作者的寫法能在 Design 正確編輯」。前者不能抵銷後者的缺口。
  - 【已完成】綁定：server function → loader → `useLoaderData()` 解構後展開，可以被辨識（#211 測試基線、#212）。
  - 【已完成】畫布即時更新：預覽從伺服器讀內容，存檔後同步並確認才刷新（A6b-2，#216）。
  - 【已完成】選取之後原始碼被改：伺服器拒絕舊選取的寫入；編輯器以欄位為單位保留輸入，並要求重新選取（#217、#225）。
  - 【已完成】完整 Start 預覽的 E2E 已進 CI（#219）。
  - 【已完成】隱藏區塊不能選取：畫布、Sections 列、網址都無法開啟它的內容編輯（#224）。
  - 【已完成】兩個實例完整儲存時不串寫；手寫標記衝突時不寫入（#228）。
  - 【已完成】預覽換 frame 後，重播要等新 frame 確認路由（#252）。
  - 【已完成】作者在預覽裡切頁時，編輯器跟著切到同一頁；屬於其他頁的寫入被拒絕（#270）。
  - 【已完成】欄位選取的更新訊息帶上區塊 id，不會套到別的區塊（#274）。
  - 【已完成】預覽頁面身分：iframe 每次載入的頁面都有自己的身分，編輯器只接受目前這次載入的回報；直接在畫布改字期間，暫緩送往畫布的更新（#278）。這是預覽頁面的身分，不是 CMS 儲存的 Document 版本。
  - #283：
    - 安全成果【已完成】：已驗收的案例（三元運算、巢狀元件內的同名欄位）不再宣稱屬於該區塊，也不寫入。其他寫法未逐一驗收。
    - 能力缺口【已確認缺口】：區塊內同名轉傳（`<Heading title={title} />`）因此也被拒絕，目前無法自動綁定，待來源追蹤補回。
  - #281、#286：
    - 【已完成】Code 模式：收到回應的存檔只確認它自己那一次寫入，不再覆蓋送出之後的輸入、undo 與 redo（#281）；延遲確認的存檔不再覆蓋其後的編輯與歷史紀錄（#286）。
  - #289：
    - 安全成果【已完成】：在 spread 之後被覆蓋的屬性（如字面值、另一區塊欄位 `<Hero {...content("hero")} title={other.title} />`、後續 spread）不再宣稱屬於該展開區塊，防止寫錯欄位；Inspector 顯示由程式碼控制並拒絕寫入。
    - 能力缺口【已確認缺口】：**保留 C4b 提案與安全拒絕的區別**。C4b 提案（覆蓋屬性若來自另一區塊欄位時，自動綁定至真正的來源 `other.title` 並允許在 Design 編輯）尚未實作；#289 僅做到安全拒絕（不寫入 `hero.title`），不能視為已完成 C4b 提案。
  - #291：
    - 安全成果【已完成】：讀取與寫入一律以存著的 Document 為基準，路由分析認不出的已存區塊照常保留，同頁其他區塊的編輯不再將其自 Document 刪除。已經被刪除的內容不會自動恢復。
    - 能力缺口【已確認缺口】：認不出的區塊在 Design 仍不可編輯；若頁面含有未綁定區塊，排序操作會被安全拒絕（不寫入）。此修正為「不再弄丟」的安全成果，非全量支援任意寫法讀取保留的【已完成】。
  - B1 原生屬性來源追蹤與自動綁定（#295）：
    - 能力成果【已完成第一輪】：支援逐欄傳值（`<Hero title={title} desc={desc} />`）、別名（如解構改名 `const { desc: heading } = hero; title={heading}`）、spread 與字面值的先後覆蓋順序（字面值在 spread 前由展開值覆蓋並綁定，字面值在 spread 後覆蓋展開值且不宣稱），以及兩個實例不串寫，經 3 個完整 Start 分片驗收。
    - 能力缺口【已確認缺口】：C4b 提案（以其他區塊欄位覆蓋 spread）、多層傳遞、複雜表達式轉換與其他框架均留在 M4、M6，尚未支援。
  - 【已完成】首頁 stand-in 與逐欄程式預設值寫入（#290）：首頁由程式碼控制時顯示 stand-in，伺服器驗證來源後安全寫入。
  - 【已完成】SDK README 內部文件連結修正（#280）。
  - 【已完成】ROADMAP #224 歷史狀態修正（#282）。
  - 【已完成】CI Start 分片與驗收測試重平衡、防止 D1 SQLITE_BUSY 鎖衝突（#293、#296、#297）。
  - 【已完成】E2E 延遲依賴重新最佳化記錄器（#292）。
  - 【已完成】純前端預覽遇到 server function 時提示作者，並列出檔案位置（#262）；每個 Theme 可記錄自己的預覽模式，作者可在編輯器切換，未記錄時沿用部署預設（#271，見 1.5 D1）。既有 Theme 都未記錄，部署預設仍是純前端模式，不執行 server function；目前的 Starter 版本也還不會替新 Theme 記錄完整 Start。
  - 【已確認缺口】Design 還沒有「不是 CMS 資料／來源尚未追蹤／來源已知但不能反推」三種狀態。
  - 【已確認缺口】隱藏之後仍顯示元件預設值。隱藏是獨立的里程碑（1.5 M3），不屬於本案例的驗收範圍。
  - 以上各項不代表 Start 正式案例已通過。
- **Astro 案例：尚未開始。** 前置準備是草稿 #221：一份共用讀取核心原型、純 Astro 與純 Start fixture，定位為「原型可行、平台尚未完成」。L1.5 設計草稿 #191 未合併。
- 契約文件：綁定契約草稿 #210、讀取契約草稿 #187，設計原則已認可，細節未定，未授權整套實作。
- 2026-10-12 之前的探測實驗（#187 草稿附錄）只是有限證據，不是正式支援。

### 1.3 所有框架用同一套內容 API；程式碼管呈現、Document 管內容（2026-10-13 確認方向）

**方向。** Morph 以前後端分離 CMS 的方式提供內容：作者照原生 Astro、React、Vue 等框架的寫法撰寫網站，所有框架都用同一套 Morph API 讀內容。Design 是編輯這些內容的工具，不要求作者把網站改成 Morph 指定的寫法。不推翻 1.2 與既有的分工。

**分工。**

- 程式碼：元件實作、排版、樣式、互動，以及路由頁面上有哪些區塊、區塊的排列順序。已依程式碼核對：Design 移動區塊時改寫路由的 JSX（`reorderThemeRouteSections`），執行期以區塊 id 對應值（`resolveStorefrontContent`），不讀 Document 裡的排列順序。
- Document：區塊的值（文字、圖片選擇）與隱藏狀態（已核對）。導覽項目、商品列這類「內容陣列」的項目與順序可能也屬於 Document，尚未逐一核對，不一概而論。
- 視覺編輯器依操作種類修改對應的權威來源；同一件事不在兩邊各存一份。
- Code 模式編輯的是原始碼，不是把原始碼搬進內容 API。

**讀取共用，寫入權限分開。**

- 公開網站：只讀指定 release 的已發布快照，不讀最新草稿。
- 預覽：讀草稿，權限受控且可撤銷（規格草稿 #214）。
- Design 存檔：走授權過的寫入 API，保留版本檢查與 OCC。
- 畫面上的任何標記只是定位線索，不是寫入許可（同 1.2）。

**統一 API 不等於各框架完全不需要接線。** 讀取呼叫（例如 `morph.pages.get("/")`）跨框架一致，讀取核心不依賴 React 或 Astro。預覽憑證、每次請求的上下文、存檔後怎麼刷新畫面，仍可能需要少量框架接線；這些由平台或 integration 處理，不變成作者每個頁面都要配合的寫法。

**轉換過的值。** 例如 `hero.title.toUpperCase()`：只要能確認來源是 `hero.title`，Inspector 可以顯示並編輯原始值，再由網站重新計算；不從轉換後的文字反推。來源不明或涉及多個欄位時不猜，改列出來源欄位，或標示由程式碼控制，不要求作者改寫。

**待驗證，不是已完成，也不是承諾。**

1. **共用讀取核心**（#221，草稿）：原型已證明一份核心能在純 Astro 與純 Start 執行，Astro integration 能自動掛上 middleware，作者不必手寫。並行隔離（2026-10-15，#221 測試原型）：在本機 workerd 執行建置後的純 Astro 與純 Start Worker，兩個並行請求各帶不同的內容來源，各自只讀到自己的資料，沒有來源的請求被拒絕（6/6，含反向檢查）；這只涵蓋建置後的 Worker 在本機 workerd，預覽 dev server、正式 Cloudflare 與正式 SDK 仍未驗證。尚未證明：不改作者設定檔就完成接線。【待決，原則已認可】接線放在 Morph 產生的 wrapper（`.morph/`）。SDK 交付（2026-10-16 更新）：同一份核心，由平台薄入口與可安裝的外部套件共用，見 1.4；取代原先「不發 npm 套件」的建議。具體方案仍需審閱，正式 SDK 實作未授權。平台維護核心不禁止作者自己寫 API 包裝；網站照常執行，只有無法確認來源時 Design 才拒絕寫入。作者在自己的電腦執行網站（localhost）仍是產品目標，具體方案與實作延後；設計須保留用同一套 SDK 讀已發布內容，以及經授權、可撤銷地讀草稿（#214）。原有要求：Astro 與 Start 的 fixture 引用同一份讀取核心、讀同一個 API，不能各寫一份再比對結果。涵蓋讀取成功、隱藏內容、API 拒絕、網路錯誤，以及兩個並行請求使用不同預覽上下文時不串資料；失敗不回預設內容。驗證層級分開記錄：測試用核心通過只證明共用設計可行；真實 Astro／Start 執行通過才證明各自的接線可行；兩者都不等於正式 Cloudflare、預覽撤銷或完整 Design 已驗收。這一輪的核心是標明未接入產品的測試原型；正式 SDK 的交付另行授權。
2. **資料來源標記**（受控實驗，未排定）：在預覽回傳的內容中附上欄位來源，讓畫面上的文字能對回欄位。必須比較有無標記時，作者程式的字串比較、長度、條件分支、網址與序列化結果，不能只看畫面是否正常；如果作者必須到處清除標記，就等於換一種方式限制寫法。圖片、數字等非文字內容不能靠文字標記解決。實驗前不定為正式方案，也不取代現有的原始碼辨識。

**順序。** 依 1.5 的交付里程碑（2026-10-17 起取代原本的順序）：

1. M0 收尾可靠性修正；
2. M1 SDK＋Start 完整交付線，含 B1 常見傳值的自動綁定（2026-10-21 調整）；
3. M2 Astro 最小正式案例；
4. M3 隱藏功能（獨立里程碑，不擋 M1、M2）；
5. M4 擴充原生寫法的支援範圍（B1 之後）；
6. M5 外部網站把 Morph 當成 CMS；
7. M6 其他框架。

資料來源標記的受控實驗放在 M4。

### 1.4 統一 Morph SDK 與跨網域讀取（2026-10-16 確認方向，未授權實作）

**目標。** 一套不依賴框架、可安裝的正式 SDK。網站不論由 Morph 託管或部署在其他網域，都用同一個介面讀已發布的 CMS 內容與公開商品資料；作者只設定 CMS 來源與適用的憑證，不自行組 API 網址，也不為 Start、Astro 各維護一份讀取邏輯。介面示意（命名待契約設計確認）：`createMorph({ baseUrl, … })` → `morph.pages.get("/")`、`morph.products.list({ q, page, limit })`、`morph.products.get(handle)`。

**原則。**

- 延伸 1.3 的共用讀取核心（#221），沿用既有內容與商品服務，不建立第二套資料管線，也不預設另建端點。
- 同一份核心，由平台薄入口（Morph 託管的 Theme）與可安裝的外部套件共用；核心不依賴 React、Start 或 Astro，每次請求的上下文由平台或 integration 接線。
- 統一的是 SDK 用法，不混淆資料權威：頁面讀 Document／publication；商品的價格、庫存與銷售通路仍由商務服務決定。
- 單頁讀取與頁面列表分開，不把任意查詢塞進 `pages.get()`。
- 不自動公開整個資料庫或後台管理 API；後台管理與寫入不在首版公開讀取 SDK 內。
- `createMorph` 只保存不變的設定；每次請求的商店、預覽或草稿上下文不得放進可變的全域狀態。

**既有能力（2026-10-16 依程式碼核對）。**

- 已發布頁面：商家網域上的 `GET /_morph/content?path=`。Core 依網域解析出目前的 release 與 content publication，只讀該 publication（`resolveStorefrontContent`），不讀草稿；不需要 key，以 release id 作版本（ETag），回應不帶 CORS 標頭。Starter 與 Build Preview 都讀這個端點；託管的 Theme 由 Core 以 `x-morph-content-origin` 等標頭告知來源，標頭由 Core 設定，外部不能偽造。
- 公開商品：Store API `GET /api/store/products`，已支援 `q`、`page`、`limit`。以 `x-publishable-api-key` 驗證公開 key，並依 key 連結的銷售通路與 `x-storefront-host` 決定商店範圍；允許跨網域（CORS `*`），公開快取 30 秒並依 key 與 host 區分。
- 公開 key 目前只用於商品等 Store API；頁面讀取以網域決定範圍，不用 key。首版是否、以及如何讓兩者使用一致的來源設定，由契約設計決定，不預設要為頁面加上 key。
- 草稿：預覽讀草稿的授權規格在 #214（草稿，尚未實作撤銷）。

**部署現況。** Morph 尚未完成首次正式部署；部分雲端閘門已用測試資源驗證，但「獨立網域的真實網站」驗收需要一個部署好、外部可達的 Morph，屬於另行授權的部署事項。

**分階段。**

1. 盤點與契約設計：核對既有內容服務、商品 API、Starter 讀取模組與 #221 原型的權限鏈，列出可重用能力與缺口；定義型別、錯誤、分頁、排序、來源設定、查無資料的行為、相對網址（如圖片）的處理與快取規則。只包裝現有能力，不把尚未實作的過濾寫成已支援。詳細契約另提設計審閱，不寫在 ROADMAP。排在共用核心正式接線之前。
2. 正式讀取核心與統一入口：`pages.get`（已發布）、`products.list`、`products.get`，保留既有搜尋與分頁；統一來源設定、錯誤與型別，保留既有版本與授權規則；並行請求不串資料。
3. 套件與外部網站接入：同一份核心交付為可安裝套件；先驗收 Morph 內的 Start Theme 與獨立網域的外部 Start 專案，再接 Astro。驗證伺服器首次載入、瀏覽器切頁、跨網域政策與相對網址。不要求外部網站由 Morph 託管。
4. 查詢擴充（延後）：依真實網站需求補 `pages.list`、商品分類／系列等進階過濾、排序與欄位選取；共用查詢慣例，但各資源保留自己的欄位、運算子與查詢上限。
5. 受控草稿讀取（延後，依賴 #214）：公開讀取只取得授權範圍內的已發布內容與公開商品；草稿使用獨立、可撤銷、有範圍與期限的授權，私密憑證不得進入瀏覽器程式包、網址或日誌，也不進公開快取。

GraphQL 保留為未來可選的讀取入口，不是統一 SDK 的前置條件。

**依賴。** #221 的正式接線（不改作者設定檔）；#214（草稿授權與撤銷）；#187（隱藏區塊在 `pages.get` 中的形狀）；首次正式部署（外部網域驗收）。

**驗收。**

- Morph 內部與外部網站使用同一份讀取核心。
- 已發布內容依適用的 release／publication 讀取；商品依既有商務上下文查詢。
- 不同商店、不同預覽授權的並行請求不串資料。
- 草稿不會被匿名讀取，也不混入公開快取。
- 憑證無效、撤銷、網路失敗與 API 拒絕都明確回報，不靜默退回預設內容。
- 至少一個獨立網域的真實網站完成整體驗收；不能只以 mock 或原型測試宣稱交付。

**未授權。** 實作、部署、npm 發布。本節只記目標、階段、依賴與驗收。

**進度（2026-10-21）。**

- 第 1 階段的契約設計是 #245 草稿。
- 第 2 階段的讀取核心 v0 已合併（#246）：`packages/morph-sdk/`。
- 工作區化與獨立建置檢查已合併（#254）：不包含 npm 發布與部署。
- 託管 Start Theme 已接入（#267）：`@morph/sdk/start` 以產生的副本交付到每個 Start 工作區；每次請求從 Core 設定的標頭讀內容來源，不放在模組層級；Start 建置的版本身分帶上 SDK 的雜湊。未涵蓋：#214 的每次請求預覽授權與撤銷尚未實作；容器 transport、瀏覽器內 `/_serverFn` 切頁、真實 Cloudflare 未在該 PR 驗證；平台注入的 `.morph/` wrapper 尚未納入建置身分（已記錄的缺口）。
- 外部網站尚未接入。

### 1.5 交付里程碑（2026-10-17 規劃，原則已接受，未授權實作）

**原則。**

- **原生寫法的支援範圍。** 作者照框架原本的方式寫，程式照常執行。能證明來源（頁面、區塊實例、已宣告的欄位、來源版本）的地方才可以編輯。證明不了時，標示由程式碼控制，不猜測、不寫回。
- **三種能力分開標示。** 內容綁定、欄位編輯（Inspector 改原始值，與直接在畫布改字，兩者分開）、隱藏能力。一種寫法在三者可以有不同結果。
- **正式案例要在固定版本上驗收。** 必須在同一個固定版本上，從作者程式一路驗收到發布結果，並記錄受測版本的身分：
  - head 與 main 的 SHA；
  - Theme 的 source revision、build 與 release；
  - Starter 版本，以及 `content.ts` 是否被作者改過；
  - SDK 與 preview bridge 的版本；
  - 預覽模式與 transport；
  - 執行環境。

  單一 PR 通過不等於案例通過。各層證據分開記錄：單元／元件、shell、本機鎖定 E2E、CI、真實 Cloudflare。真實 Cloudflare 需要另外授權，目前尚未部署。

- **三條線不能互相代替完成證據。** 框架案例、SDK 接入、隱藏功能各自驗收。

**D1 預覽模式（已決定）。**

- 作者選擇預覽模式。
- 純前端模式遇到 server function 或伺服器讀取時，平台必須偵測並明確提示限制與切換方式，不得靜默顯示近似結果。
- 每種模式各自寫明支援範圍。SDK＋Start 的正式案例在完整 Start 預覽下驗收。
- 先不做自動切換。
- 目前預覽模式是部署層級的環境變數。M1 不新增設定，只負責偵測與提示（2026-10-17 決定）；每個 Theme 各自的模式設定另外提方案。
- **調整（2026-10-18）：** 上一條「M1 不新增設定」已由核准的 #271 調整。每個 Theme 可以記錄自己的預覽模式（純前端或完整 Start），作者在編輯器選擇；未記錄時沿用部署預設；不自動切換。上一條保留作為歷史紀錄，有效規則以本條為準。

**里程碑。**

- **M0 收尾可靠性修正。** restore 重新連線、交付保護機制、隱藏值資料最小化階段 1、SDK 工作區化。不擴大範圍。M1 只需要先合併會影響它的修正。
- **M1 SDK＋Start 完整交付線。**
  - 作者依 1.2 的 Start 寫法、經由 SDK 薄入口讀取內容，在 Design 完成四項驗收，接著發布、重新載入、回滾都要一致，公開端不讀草稿。
  - 範圍包含首頁、非首頁、layout 共用區塊與重複實例。
  - 必須涵蓋：
    - 預覽模式界線；
    - 每次請求由平台決定讀草稿還是已發布來源；並行請求不串用；公開請求不得拿到草稿；草稿授權沿用 #214，撤銷尚未做時要明寫；
    - 瀏覽器導航：在預覽與公開網站兩邊，首次載入、`<Link>` 切頁、上一頁／下一頁、重新整理、直接開網址；
    - Starter 升級與相容性：作者改過的 `content.ts`、舊 Theme、舊 bridge。
    - B1「#295 第一輪 Start 案例已合併」（2026-10-21 納入，見下）；M1 其餘固定版本與發布驗收仍按實際證據標示，尚未完成。
- **B1 常見傳值的自動綁定（TanStack Start；#295 第一輪 Start 案例已合併，提前自 M4）。**
  - **是交付關卡，不是另一套架構。** 沿用既有的 Document、權限、OCC、來源版本與預覽流程。第一輪只處理下列 Start 案例，不擴大到任意轉換或所有框架，也不要求作者改成指定寫法。
  - **範圍：** 逐欄傳值（`<Hero title={title} desc={desc} />`）、別名、spread 與字面值的覆蓋順序、兩個實例。C4b 提案、多層傳遞、複雜轉換與其他框架留在 M4、M6。
  - **分兩步，原型通過不等於 M1 已支援：**
    1. 隔離原型：證明定位正確、寫回正確、作者程式行為不變，三者分開證明。不接正式寫入流程。
    2. 正式整合與驗收：整合方案先經審閱，接回既有流程；涉及協定變更時另外請示。最後在 M1 的同一個固定版本上驗收。
  - 原型沒有解決的問題留下為能力缺口，不能改成「安全拒絕」就算 B1 通過。
  - **驗收至少包含：**
    - 逐欄傳值、別名、spread 與字面值的覆蓋順序、兩個實例；
    - 不同欄位故意使用相同文字，仍能正確定位；
    - 修改後直接讀回 Document，確認沒有串寫，也沒有刪除其他內容；
    - 在同一版本完成重新載入、發布與回滾驗收；
    - 需要 server loader 的案例實際跑完整 Start，不能用 client-only harness 代替。
- **M2 Astro 最小正式案例。** 只做 1.2 的 Astro frontmatter 寫法，加一個非首頁路由。在同一個固定版本上完成四項驗收與發布閉環。不做通用的 Astro 編輯器。沿用 M1 的同一份核心。
- **M3 隱藏功能。**
  - 三部分各自驗收：資料最小化、真正不渲染、寫入端的能力檢查與 S2 身分。
  - 是否進首版另外決定。
  - 未完成期間：Design 照實說明「已隱藏，但預覽與正式網站仍以元件預設值顯示」；正式案例不包含隱藏。
- **M4 資料流能力擴充（原生寫法支援範圍擴充）。**
  - 完成條件：依 1.2「綁定驗收規範」，以驗收案例集逐案驗收。第一輪已由 B1（#295 第一輪 Start 案例已合併）交付，M4 寫資料流能力擴充：包括多層傳遞、跨元件傳遞、複雜表達式轉換、C4b 提案（跨區塊欄位覆蓋 spread 的自動綁定）與可選的明確綁定出口（#210）；尚未通過的案例列為能力缺口。Astro／其他框架分別對齊 M2（Astro 最小正式案例）／M6（其他框架）。
  - 轉換過的值：Inspector 改原始值，與直接在畫布改字，分開驗收。
  - 可選的明確綁定出口（#210）。
  - 資料來源標記的受控實驗。
- **M5 外部網站把 Morph 當成 CMS。** 網站可以在不同網域、不同平台、任何框架；Morph 只提供 CMS 資料，不要求託管前端。分兩層：
  - **M5a 外部網站讀取既有的已發布內容。**
    - 由外部網站的伺服器呼叫現有 API，不需要瀏覽器 CORS，也不需要 Design。
    - 限制：內容來源仍依賴 Morph 已發布的商家網域、release 與 build。
    - 公開內容不需要 token；不提供草稿。
    - 使用可安裝的 SDK；npm 發布另外授權。
    - 驗收：至少一個部署在獨立網域的真實網站。
  - **M5b 不依賴 Theme 與 build 的獨立內容發布 API（完整 headless CMS）。**
    - 內容發布後，取得內容 API 網址，不必先發布 Theme。
    - 需要另外設計：發布模型、內容歸屬、內容網域（1.4 依賴）。
    - 私人或草稿內容要有範圍、可撤銷、有期限的授權。私密 token 只能放在伺服器端。
    - 若要讓瀏覽器直接讀取，要另外設計 CORS 與可公開的憑證。
    - 驗收：用一個從未發布過 Theme 的商店，以真實的外部網站驗收。
- **M6 其他框架。** 在 `.morph/` wrapper 接線，每個框架完成一個最小正式案例。在 M1、M2 完成後才開始。

**里程碑進度（2026-10-26，main `bb263ec`）。** 只記已合併或已有證據的事；未跑到的驗收不寫成通過。

- **M0：列出的四項都已合併。** restore 重新連線（#255）、交付保護機制（#256：CI 必須跑完每一個預期的檢查）、隱藏值資料最小化階段 1（#257，只涵蓋編輯器送往畫布的訊息，不是權限保護）、SDK 工作區化（#254）。同期另外合併的安全與可靠性修正：轉送給 Theme 的請求移除平台憑證與 `x-morph-*` 標頭（#261）、移除 Morph 私密 API key（#265）、正式環境不再信任開發與過期的 origin（#263）、建置後的 Worker 不能自行判斷為非正式環境（#264）、Theme 執行環境未設定時回傳通用訊息（#266）、client bundle 檢查拒絕 source map（#277）、Starter 升級與首頁重設加上 CAS／OCC（#260、#272）。
- **M1：部分完成，正式案例尚未驗收。**
  - 已合併：預覽模式提示（#262）、每個 Theme 的預覽模式（#271）、託管 SDK 入口與每次請求的內容來源（#267）、預覽內切頁跟隨（#270），以及 1.2「目前進度」列出的編輯正確性與可靠性修正（#280、#282、#286、#289、#290、#291、#292、#295、#297 等）。
  - 未完成：#214 的草稿授權與撤銷；瀏覽器導航在預覽與公開網站兩邊的完整驗收；Starter 升級與相容性驗收；在同一個固定版本上從作者程式到發布、重新載入、回滾的整體驗收。
  - 距離目標的狀態以 1.2 的五個面向（讀取與保留、自動綁定、正確寫入、發布閉環、跨框架）記錄，不另外估百分比。
- **B1：#295 第一輪 Start 案例已合併。** 已完成第一輪驗收能力：逐欄傳值（`<Hero title={title} desc={desc} />`）、別名、spread 與字面值的先後覆蓋順序、兩個實例，並於完整 Start 預覽下通過 3 個分片驗收。這只涵蓋已驗收的第一輪能力，不宣稱所有合法寫法或其他框架均已支援；C4b 提案（以其他區塊欄位覆蓋 spread）、多層傳遞、複雜表達式與其他框架留待 M4、M6。
- **M2～M6：尚未開始。**

**排程調整（2026-10-21 使用者核准）。**

- **理由。** 已合併的多是「安全拒絕」：不寫錯、不弄丟。作者照習慣寫的元件仍大多無法在 Design 正確編輯。若常見傳值全部等到 M4，M1「完成」後逐欄傳值仍不能編輯，與產品目標不一致。這次調整的是優先順序與驗收門檻，不是降低「自由寫法」的目標。
- **優先順序。**
  1. 正確性修正：資料遺失、spread 覆蓋誤綁。
  2. B1：第一輪元件驗收案例，打通 Start 的自動綁定。
  3. M1 在同一個固定版本上從編輯到發布的整體驗收（含 B1 案例）。
  4. 以相同案例驗證 Astro（M2），再擴展到其他框架。
- M1 因此明確增加完成條件，收尾會更晚。M4 改為「B1 之後的資料流能力擴充（多層傳遞、複雜轉換、C4b 提案等），Astro／其他框架分別對齊 M2／M6」。

**未授權。** 各里程碑的實作、部署、協定變更、npm 發布、遠端遷移。每個里程碑開始前先提出詳細計畫並確認。

---

## 2. Architecture Direction

Morph 不採用「所有 storefront presentation 都由固定 section schema 決定」的架構。

正式方向分成三個 authority layer。

### 2.1 Commerce Data

```text
Products
Prices
Inventory
Variants
Orders
Customers
Promotions
Tax
Sales Channels
```

由 Commerce modules 擁有。

Page / Theme 只能 reference，不建立第二份可編輯 commerce truth。

### 2.2 Presentation Source

```text
React / TSX
Tailwind / CSS
Component Composition
Responsive Layout
Motion
GSAP
Canvas
WebGL
Three / R3F
Map Runtime
```

由 Theme Source 擁有。

它是 storefront presentation 的主要 SSOT。

Theme 的 `public/` 靜態檔（logo、背景圖、字型）也屬於這一層：與程式碼同一份 revision、同一次 build、同一個 release，程式碼以固定路徑（`/images/logo.png`）引用，發布後任何訪客都能取得。

### 2.3 Content / Assembly

```text
Copy
Assets
SEO
Product / Collection References
Section Instances
Ordering
Visibility
Locale Content
```

由 versioned Page / Template Document 擁有。

Document 是 data，不是 React implementation。

這裡的 Assets 是 **CMS 媒體庫**（商品圖、文章圖等內容），與 Theme `public/` 是兩件事：

|          | Theme `public/`      | 媒體庫 Assets                            |
| -------- | -------------------- | ---------------------------------------- |
| 屬於     | presentation source  | content                                  |
| 引用方式 | 程式碼寫死路徑       | content field 選取                       |
| 版本     | 隨 revision／release | 不隨 Theme 版本                          |
| 可見性   | 發布後全部公開       | 預設私有，只提供已發布內容實際引用的媒體 |

兩者可以在同一個 Assets 畫面管理，但不得合併成同一份資料，也不以逐檔「公開／私有」開關取代這條邊界：已發布的 `public/` 檔無法靠事後切換收回。媒體檔要給程式碼用，是明確的「複製到 `public/`」並提示會公開。

---

## 3. Authoring Model

Morph 的 Human / AI authoring 最終都收斂到相同底層。

```text
                    ┌─ Visual AST Editor ─┐
                    │                     │
Theme Source ───────┼─ Monaco Code Editor ├─→ Theme Workspace
                    │                     │
                    └─ AI Code Agent ─────┘
                                              ↓
                                     Immutable Source Revision
                                              ↓
                                         Sandbox Build
                                              ↓
                                      Immutable Artifact
```

Content authoring：

```text
Human Content Editor ─┐
                      ├─→ Page / Template Draft
AI Content Assistant ─┘
                               ↓
                       Immutable Content Revision
```

Production：

```text
Theme Build Artifact
        +
Published Content Revisions
        +
Current Commerce DTO
        ↓
Storefront Release
        ↓
Edge Runtime
```

---

## 4. Current Foundation — 2026-08

目前 repository 已具備相當多基礎。

### Commerce / CMS

已具備：

- TanStack Start + React dashboard
- Better Auth
- Cloudflare D1
- R2 assets
- Drizzle ORM
- config-driven Dashboard routes
- commerce catalogue / pricing / inventory / cart / checkout / order 等 foundations
- Storefront / Theme / Template / Page / Domain data models
- Store API foundations

### Theme Authoring

已具備：

- Theme file virtual workspace
- starter React theme files
- `morph.theme.json`
- Monaco Code Workspace
- source file save
- file version OCC
- theme `sourceGeneration`
- immutable Theme Source Revision
- AST parser / transformer
- `data-morph-node` / `data-morph-element`
- Tailwind token parsing / patching
- Visual Editor shell
- style inspector foundations
- Canvas / code mode foundations
- editor comments / collaboration UI foundations
- 隔離 Monaco file URI workspace，預載同一 Theme 的全部 source models，讓相對 import 可被 TypeScript worker 解析
- 由 bounded route registry 推導的唯讀虛擬 `src/routeTree.gen.ts`，提供 TanStack route path/type 補全；正式 generated output 仍只在 Theme build 暫存 workspace 產生
- Code Mode 的 route literal completion 由同一份 `src/routes/**` registry 推導，支援 `Link`／`navigate`／`createFileRoute` 的路徑輸入，不另維護手寫清單
- `tsconfig.json`／`jsconfig.json` 的 workspace-local 相對 `extends`、`baseUrl` 與 `paths` 會同步到 Monaco、Vite 與 import protection；package／越界 extends 會 fail closed
- Starter Theme bootstrap 的 preview/apply、版本閘門、source generation/OCC 保護與 additive upgrade

### Build Plane

已具備：

- immutable build identity
- source revision materializer
- deterministic input hash
- compiler identity
- queued / building / succeeded / failed lifecycle
- CAS build ownership
- Browser Tailwind preview compiler
- local Vite runner
- Cloudflare Sandbox Vite build runner
- dependency allowlist
- platform-owned dependency catalog、精確版本驗證與 queued → building → succeeded/failed build lifecycle
- Code Mode customer-facing dependency catalog／request UI；只允許選取 `cms.config.ts` 的核准套件，並以最新成功 Build Preview 的 source revision 作為請求閘門
- build resource limits
- R2 artifact store
- canonical build manifest
- immutable build preview service
- preview capability token
- sandboxed iframe preview
- source-authored `src/routes/` registry、fail-closed route diagnostics、真正 TanStack Start Cloudflare Worker build 與隔離的 TanStack Router client preview adapter

依賴安裝不是瀏覽器直接執行 `npm install`：客戶只能從 `cms.config.ts` 的平台核准目錄提出請求，建置成功後才會進入可用狀態。

### Authoring Contract（2026-08 確立）

已具備：

- **內容契約以元件原始碼為優先**：元件可在同一檔案以 `export const contentFields`
  宣告可編輯欄位，不需要先登記在 `morph.theme.json`。掃描涵蓋所有 `src/**/*.tsx`，以來源
  路徑為身分；manifest 的 `contentFields` 只保留給尚未遷移的既有元件作相容 fallback，
  不得成為新的唯一宣告來源。
- 未宣告時，欄位由 JSX 自動推導，依據是元件簽章宣告的 prop 而非執行期收到的值——
  否則從未編輯過的元件永遠無法編輯。
- 欄位型別：text／textarea／url／number／boolean／select／array。`array` 支援
  `minRows`／`maxRows`、逐列欄位與新增／刪除；row 可抽成獨立元件並以 `of: "./Card"` 參照。
  array 不可巢狀 array（與 Sanity 相同的取捨）。
- **section 由路由的 `content("slot")` 推導**：路由決定頁面有哪些 section 與順序，
  Document 只存值。同一元件可在同頁出現多次，各自由 slot id 區分。
- 左側樹的排序與新增 section 直接改寫路由 JSX；路由尚未宣告 slot 時沿用既存 Document，
  所以採用 slot 是每個路由各自的選擇。
- 選取、樣式、結構樹與內容編輯都不再需要 `data-morph-*` 標記。instance 樣式需要跨編輯
  穩定的身分，平台會在首次寫入時自動補上，作者不必手寫。

Code Mode 的 generated route tree 契約：

- `src/routes/**` 是作者可編輯的 route source，也是頁面結構與 route path 的 SSOT。
- `src/routeTree.gen.ts` 在 Code Mode 只以唯讀虛擬檔案呈現，供 Monaco 提供與 TanStack
  Router 相同的 path/type 推導；它不屬於 persisted Theme Workspace，不能由使用者或 AI
  直接儲存、修改或刪除。
- 真正的 `routeTree.gen.ts` 只能由固定版本的 Theme build toolchain 在暫存 build workspace
  產生。虛擬模型與正式 build 必須共用 bounded route registry；不合法路由要顯示診斷，
  不得以 `any` 或空 route tree 掩蓋 build 錯誤。

Code Mode 與 TanStack Start 的編譯邊界：

- `.server.*`／`.client.*`、`server-only`／`client-only` marker 與 Start server/client
  specifier 會在 Monaco Problems、Local Vite 與 Cloudflare Sandbox 三條路徑共用同一份
  reachable-graph 檢查；只有 `createServerFn().handler`、`createMiddleware().server`、
  `createIsomorphicFn().server/.client` 等 compiler boundary 可安全跨環境。
- `tsconfig.json`／`jsconfig.json` 的 `baseUrl`、`paths` 會被同一份受限解析器提供給
  Monaco、import protection 與 Vite；不安全或越界 alias 會 fail closed。這對齊 TanStack
  Start 的路徑別名契約，但不執行客戶自訂的 Vite／Router plugin。

Starter bootstrap 與 workspace upgrade 契約：

- 新建或升級 Theme 前先產生檔案差異；只對未被作者修改的已知 starter bytes 套用安全升級。
- 使用者確認後才透過 Theme Workspace、ownership、source generation 與 OCC 寫入；既有
  authored files、customer dependencies 與不安全刪除一律保留並顯示衝突。
- 套用後必須重新跑 route diagnostics、Live Preview 與 immutable build；bootstrap 成功不
  代表已 Publish。

寫入目標的分界：

| 使用者動作                                      | 寫進哪裡       |
| ----------------------------------------------- | -------------- |
| 樣式、Tailwind classes、同層排序                | 元件 TSX       |
| section 排序、新增 section                      | 路由 TSX       |
| Content & Fields 的值、陣列列增刪、section 啟用 | Document（D1） |

---

### Production Runtime / Deployment（2026-08 新增）

已具備：

- hostname → 已驗證 domain → published storefront → `active_release_id` → available release → succeeded build 的 fail-closed 解析鏈
- preview 與 production 共用的 artifact serving core（manifest 邊界、path sanitize、ETag／304、快取與安全標頭），差異只由 serving policy 表達
- `ThemeRuntime` 傳輸抽象：service binding（生產）、local direct（開發）、dispatch namespace（保留給 Phase 8）、unavailable（fail-closed）
- storefront hostname 與平台 hostname 的精確分流；storefront 網域上不得出現 dashboard／editor／server function 路由
- Theme Worker 部署平面：deployment plan（含 forbidden binding 檢查）、Sandbox 內以固定版本 wrangler 部署、憑證只存在於 exec environment 且失敗輸出會清洗
- Publish 與 rollback 兩條路徑共用同一個部署核心
- artifact smoke-run harness：本地實際啟動 `runtime/server/index.js` 驗證 build 產物真的可執行
- **純內容發布不再重新部署**：Theme Worker 實際執行的 build 記錄在該 release 的 metadata，
  只在部署成功後寫入。發布時若記錄顯示 Worker 已在跑同一個 build 就跳過部署；
  沒有紀錄、紀錄不符、id 空白等任何不確定情況一律照常部署——多部署一次只是慢，
  少部署一次會讓網站靜默地服務舊的產物。
- **Theme artifact + Page Document 的 runtime 組合已閉環**：Morph Core 以 `/_morph/content` 提供 active release 的已發布內容，Theme 在 root route `beforeLoad` 以 server-only 分支取回並經 router context 序列化到 client。編輯器解釋器、Build Preview 與 production 三個平面共用同一份 root route source
- Morph Core 以 `x-morph-content-origin` 明確告知回撥位址，Theme 不需從 hostname 猜測 scheme／port；該 header 為 set 而非 merge，外部無法偽造

### Theme `public/` 靜態檔（2026-09 新增）

已具備（#37～#44，契約見 `.agents/rules/01-core-architecture.md` §4.1.2）：

- 二進位檔以引用存在 workspace 與 revision（digest、大小、MIME），bytes 存在 R2 content-addressed blob；revision、回滾、manifest 遷移都帶著它們。
- 格式、大小、數量、保留名與路由衝突由 `theme-public-files.ts` 單一來源判定；建置時以凍結 revision 自己的路由再判一次。
- 預覽（本機 sidecar 與 Cloudflare Sandbox）與兩條建置路徑都寫入完整位元組；建置預設帶入二進位檔。
- 實測：真實 Sandbox 建置並發布後，正式店面回應與上傳時逐位元組相同，Content-Type 正確；starter Theme 的圖片進入 `runtime/client/`。
- Code 模式：檔案樹列出二進位檔、唯讀資訊面板；上傳、替換、刪除都帶 OCC；「尚未發布」與回滾預覽以 digest 比對。
- 唯一寫入入口 `POST /api/storefront/theme-binary-file`（admin、octet-stream、5 MiB，寫入走 `saveBinaryFile`）。
- Sandbox Live Preview 的 start 與即時同步在容器內同一把鎖下判定版本並寫入，較舊的 start 整批拒絕（#40）。

### 已完成但需持續回歸

以下能力已完成並有驗證，但仍需隨新 Theme 與瀏覽器回歸：

- release history UI：已閉環——編輯器工具列的 History 列出每次發布的 release，
  標出目前 live 的版本並可切換。啟用沿用同一個部署核心（CAS 搶指標後部署該 release
  的不可變 artifact），CAS 的期望指標取自清單自身看到的狀態，過期的分頁會輸掉。
  分頁已完成：25 筆一頁，底部可載入更早的版本。
- 復原／重做已覆蓋全部八條寫入路徑，同一檔案的多次寫入會逐筆堆疊；範圍是單一分頁的
  編輯 session（上限 100 筆、不持久化）。跨發布的回復由 release history 負責。
- content-only publish：已閉環——不重新編譯，且相同 build 不再重新部署 Worker。
  已用真實 workspace 的資料庫副本實測：第一次發布因無部署紀錄而部署，記錄後的第二次
  純內容發布判定為跳過，且仍建立新 release。
- 編輯器解釋器與真實建置的一致性：元件層已證實逐字相同（同一份 starter 主題原始碼，
  一邊走解釋器、一邊以 esbuild 編譯後交給真的 React，比對正規化 DOM；九個案例通過，
  含跨檔案 import 與 `map` 內的元件邊界）。前提是主題依賴為封閉白名單，所以解釋器要
  覆蓋的是一個受控子集，不是整個 React 生態。框架整合層也已涵蓋：以真實 TanStack
  Router 渲染 starter 主題首頁並與解釋器逐字比對，`beforeLoad`、`createIsomorphicFn`、
  React context 與 `Outlet` 全部真的執行。另有對抗性模式測試：列出 15 種 starter
  沒用過、但熟悉 React 的人會使用的模式，據此找出並修好五個缺口——其中三個是靜默
  分歧（`{...rest}` 轉發被丟棄、JSX 文字空白被無條件 trim、`%` 運算子未支援且靜默
  回傳 `undefined`）。**邊界是那份 fixture 是自己寫的**：它只能找到有人想得到要探的
  缺口。因此另有 `pnpm test:parity`，直接對照本機工作區裡真實開發中的主題跑同一套
  比對——那份主題不會顧慮解釋器支援什麼，所以每個新元件都是沒人設計來通過的 fixture。
- 真實瀏覽器層 E2E：已建立（Playwright，`pnpm test:e2e`，與單元測試分離；憑證走未追蹤
  的 `.env.e2e`，未設定時自行 skip）。目前覆蓋三個場景——畫布選取回到樹狀、預覽框高度
  等於內容高度、未編輯時 Undo 停用——皆經變異驗證。仍缺：實際互動延遲、跨瀏覽器行為、
  響應式斷點與跨瀏覽器已覆蓋（無障礙以 axe 掃描含對話框狀態、鍵盤操作與焦點歸還；
  響應式比對 header 各組是否重疊；Chromium、Firefox、WebKit 三個引擎全數通過，
  無任何引擎行為差異）。
  發布迴圈已實際執行並通過：編譯 → 建置產物 → Publish → 建立 release → production
  指標移動，斷言包含最新的 release 帶有 `Live` 標記。仍由 `E2E_ALLOW_PUBLISH=1`
  才啟用，因為它會建立 release 並移動指標。互動延遲也已建立基準（畫布選取約 470ms、
  樹狀選取約 150ms、模式切換約 220ms），量測過程本身找出並修掉一處退化。
  原生拖放在 iframe 加縮放畫布的組合下仍驗證不了，拖曳行為只能手動實測。

### 尚未完整閉環

目前主要缺口：

- custom domain 憑證與 DNS 生命週期
- 獨立平台人工 approval workflow；Code Mode 已有 customer-facing dependency catalog／request UI，
  只顯示 `cms.config.ts` 核准套件並顯示 queued／building／ready／failed。若採逐案人工審核，
  還需要獨立 approval role、audit 與 state machine
- AI Code Agent backend workflow
- AI patch / diff / repair orchestration
- production-grade observability / metering / tenant isolation

### Theme `public/` 與 Assets 後續（2026-09-26 排定，依序）

先修正確性，再補編輯操作，最後才是介面整合與新功能；匯入明確排在最後。

| 順序 | 項目                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 類別                       |
| ---: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
|    0 | ✅ Theme Worker 沒有公開入口：部署設定明寫 `workers_dev: false`、`preview_urls: false`，只經 Morph Core 的 service binding 到達（高優先，6a 期間發現）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 安全                       |
|    1 | ✅ 預覽版本帳本記錄刪除：較舊的 start 不得刪掉較新同步新增的檔案（以 `sourceGeneration` 水位完成）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 正確性                     |
|    2 | ✅ 二進位檔的重新命名、搬移、複製，以及含二進位檔的資料夾操作（`binaryCopies`，改網址前先審查引用）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 編輯操作                   |
|    3 | ✅ Assets 頁面顯示「網站 `public/`」分區（與 Code 模式同一份資料、同一個寫入入口）。3a：搬移／複製時經確認由伺服器以 AST 改寫 Theme 原始碼中的網址引用；3b：Assets 側欄子項目「Site public/」、admin 草稿預覽讀取入口（核對 digest）、與 Code 共用的寫入檢查與搬移對話框                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 介面整合                   |
|    4 | ✅ 從媒體庫複製到 `public/`（明確提示發布後公開；伺服器讀媒體庫 bytes 後走同一個 `saveBinaryFile`，入口在 Code 模式 Assets 面板與 Assets 的 Site public/）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 功能                       |
|    5 | ✅ 部署前檢查尚未套用的 D1 migration（`pnpm run deploy` 先唯讀比對遠端 `d1_migrations` 與 `drizzle/`：未套用、checkout 較舊、同號都停止；CI 檢查同號）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 部署安全（首次部署前完成） |
|    6 | SVG 支援：驗證不合格即拒絕（不清理改寫）＋每個 SVG 回應由平台加隔離標頭。6a ✅ 四條送出路徑的隔離標頭（真實瀏覽器驗證）；6b 共用 SVG 驗證器：6b-1 ✅ `validateSvg`（解析＋允許清單，拒絕不改寫，帶版本；v2 起一律拒絕 DOCTYPE）；6b-2 ✅ 媒體庫改用它、以驗證器版本取代 `svgValidated`（舊標記不再 inline），所有媒體庫 SVG 回應加隔離標頭；舊 SVG 重新驗證工具 ✅（先只讀掃描，確認後逐檔重驗並以 ETag 條件寫入）；6c ✅ 閘門關閉下接線（上傳、媒體庫複製與日後匯入都經 `checkThemePublicBytes`／`validateSvg`；發布前以凍結 revision 重查；`public/` 不收文字檔）；6d ✅ 開啟閘門（本機兩道條件通過：一般上傳並由元件以根路徑引用的 SVG 在真實 Sandbox 預覽正確顯示、位元組不變；放進容器的惡意 SVG 在三種瀏覽器經代理直開都不執行，對照組會執行）；部署閘門待首次部署：正式回應的隔離標頭與直開，缺標頭即關閘門並處理已發布的 release | 安全設計                   |
|   6′ | ✅ Live Preview 以根路徑送出 `public/`（作者寫的 `/images/hero.png` 原本在畫布上 404；只在檔案存在時對應到預覽 base，保留前綴與 Vite 內部路徑不動；`/api/store/`、`/_storefront-media/` 加入保留前綴）。先於開放 SVG，否則上傳成功卻看不到圖                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 正確性                     |
|    7 | R2 未引用 blob 清理（保護 manifest、revision、release 與保留期）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 儲存成本（上線後依用量）   |
|    8 | 批次把 `public/` 圖片關聯為產品媒體（使用者確認對應，不依資料夾名稱猜測）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 功能（依賴匯入）           |
|    9 | 本地 TanStack Start 專案匯入（`public/` 原樣匯入）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 功能（最後做）             |

### TanStack Start 原生相容（2026-09-29 排定，依序）

目前各層證據與剩餘能力盤點見 [`docs/tanstack-start-compatibility.md`](docs/tanstack-start-compatibility.md)。文字靜態檔延伸既有 bytes 流程；Code 建立／編輯已有本機驗收，不能因此宣稱全部 Start 功能或 Cloudflare 驗收完成。

目標：同一份 Theme 原始碼在本地、Live Preview、發布後具有一致的 TanStack Start 行為，差別只在資料與權限。Design 是額外工具，不限制 Code；Design 無法安全編輯的部分標示 Code only。承諾範圍是 Cloudflare Workers 可執行的 TanStack Start 能力，不是所有 Node.js 套件或本機系統功能。一項能力只有在預覽與正式建置都通過測試後才列為支援，不以 import 檢查放行。

相容性測試同一組 Theme 檔案（`src/lib/storefront/compat/native-compat-theme.ts`）跑三處：`native-compat.test.ts`（建置出的 Worker，CI）、`e2e/native-compat-preview.spec.ts`（Live Preview，CI）、`e2e/native-compat-published.spec.ts`（發布後經 Morph Core 的店面網域，Sandbox）。尚未解決的差異寫成 `KNOWN GAP` 斷言，缺口一修好就會失敗，必須改成一般斷言。

| 順序 | 項目                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 類別   |
| ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
|    1 | ✅ 相容性測試進 repo，已知缺口以 `KNOWN GAP` 斷言                                                                                                                                                                                                                                                                                                                                                                                                                   | 驗證   |
|    2 | ✅ 商家網域不得拿到平台靜態檔：Worker 先於靜態資產（`run_worker_first`，僅 Vite dev 模組路徑例外），只在平台網域取平台檔（依網域而非檔名）；`/assets/` 依網域區分擁有者；Theme 有檔與沒檔（404）都測。部署後需驗 Cloudflare 真實行為                                                                                                                                                                                                                                | 正確性 |
|    3 | ✅ 預覽專用替身不再拖垮正式建置：`@tanstack/react-start/server` 的替身改由真實模組讀出全部匯出名稱，每個都在呼叫時明確回報預覽不支援，不在匯入時讓建置失敗（`getCookie` 等）；Theme 匯入檢查接受 file route `server` 屬性內的 server-only 匯入（Start 於 client 移除該屬性）。預覽產物本身待第 4 步完成後退役                                                                                                                                                       | 正確性 |
|    4 | 🧪 完整 TanStack Start 預覽已接入既有編輯器與兩種傳輸，仍為 opt-in：只有平台明確設定 `MORPH_THEME_PREVIEW_RUNTIME=start` 才啟用，不設仍為原有純前端預覽。本機真實 Sandbox 已驗證 SSR、server functions、cookies、middleware、server routes、HMR、Design、SVG 隔離、文字升級與發布後店面；證據見 `docs/evidence/full-start-preview-2026-10-03.md`。這不代表雲端驗收完成或可以一般開放，下列開放前條件仍全部保留；預覽的 server 程式不得取得正式商店寫入權限或 secret | 架構   |
|    5 | `public/` 開放經格式檢查的文字檔（`.txt`、`.xml`、`.json`、`.webmanifest`；SVG 仍驗證）；新店不需先改 Design 即可發布初始 Document（仍走 revision、OCC、publication）                                                                                                                                                                                                                                                                                               | 功能   |
|    6 | Design 依能力顯示：只有 server handler 的 route 標為端點；同時有頁面與 handler 的 route 仍可編輯                                                                                                                                                                                                                                                                                                                                                                    | 介面   |

`codex/start-public-text` 這項變更已接上第 5 步經格式檢查的文字檔上傳與 Code 建立／編輯／儲存。`public/` 仍走既有 bytes、revision、build、publish 路徑，不建立文字存檔旁路；Monaco 按需讀取，沿用登入暫停、草稿保留、結果不明先讀回與 OCC。同項變更也實作第 6 步：既有 route registry 明確識別的純 server handler 路由在 Design 顯示為 Code-only 端點，混合頁面與 lazy/component 拆分路由仍可編輯。不執行 Theme 程式來解析未知選項；未知時保留既有頁面行為。實際驗收與仍缺少的能力以 `docs/tanstack-start-compatibility.md` 為準。

初始發布的本機分層驗收已補：既有模板只用 Code 存檔後，發布動作經原本 Document writer 與 source/draft CAS 建立初始 revision，不靠假 Design 修改。DAL 已驗到既有 release/publication 路徑；瀏覽器已驗首頁與 layout 準備及建置交接（刻意攔住 build，並未部署或完成端到端發布）。原有 revision/OCC 要求不變。尚無 template row 的新 source-only 路由，以及 Cloudflare 真實部署，未包含在這份驗收中。

同項變更另補 native transport 驗收：原生 server function 的 Response、FormData 與串流共用既有相容性 Theme，本機 Start 預覽、建置 Worker 的 HTTP，以及瀏覽器皆有分層證據；typed stream 目前只驗到預覽瀏覽器。建置串流測試使用 identity encoding，不代表壓縮傳輸或 Cloudflare 驗收已通過。後續 `.server` 修正已讓 native Start handler 內的靜態匯入在預覽、正式建置與 Code 診斷通過：兩份瀏覽器產物都走原生 client compiler，預覽直接讀取 server-only 原始碼與 source map 會被拒絕，五種邊界案例已有正式測試。動態 `.server` 匯入仍拒絕；未編譯的純前端 Live Preview 仍不支援 server functions，完整 Start 仍為 opt-in。這次只有本機驗收，不代表真實 Sandbox 或 Cloudflare 驗收完成。完整狀態見相容性清單。

完整 Start 預覽開放給一般使用者前必須完成（任一未完成都不開放；文件記載不等於解決）：

- ✅ 預覽網域須為不同的可註冊網域（PSL，含私有區段；僅 loopback 名稱為開發例外）；代理在呼叫 Sandbox SDK 前移除平台憑證 Cookie（名稱由 Better Auth 設定推導）與 `x-morph-*` 標頭，並擋下容器設定平台保留名稱的 `Set-Cookie`；預覽啟動日誌在接收時即限制行數、單行與總量
- 預覽預設拒絕外連（第一步已做，不是完整網路隔離）：預覽容器改用獨立的 `PreviewSandbox`（`enableInternet = false`、`interceptHttps`，Worker 端拒絕 handler），HTTP／HTTPS 一律得到平台的 `PREVIEW_EGRESS_DENIED` 回應，拒絕日誌只記方法與目的主機並限頻限量；建置與部署的 `Sandbox` 不變。仍待：
  - **部署環境驗收**：本地只證明接線與 HTTP／HTTPS 行為。本地實測非 80／443 埠（1.1.1.1:8443）TCP 仍能建立連線，官方文件說正式環境會拒絕，必須在 Cloudflare 上實測；休眠喚醒、重啟後政策也須在部署環境再驗
  - DNS 仍經 Cloudflare 解析器送出，查詢名稱可夾帶少量資料外傳，不宣稱已封住
  - 允許清單（限制目的地、協定、埠、方法、重新導向、回應大小與頻率），與商店資料改走有範圍的平台 API
  - 建置容器同樣執行不可信 Theme 程式，外連政策尚未處理
  - 外連限制不等於容器內隔離：Theme 仍可能碰到 localhost、控制服務與同容器其他程序
- 預覽外連允許清單的介面訊息須說明是預覽政策拒絕，不是 TanStack Start 不支援
- Wrangler 版本升級時必須一併重跑部署目的地與 `.env` 對照測試（`sandbox-wrangler-deploy-destination.test.ts` 已比對容器固定版本與 repo 版本）
- 資源預算：單一容器上限，以及每人啟動頻率、並行數與存活時間
- 跨預覽 Cookie 注入：所有預覽共用預覽網域的父網域，Theme 可用 `document.cookie` 設定父網域 Cookie 送到其他人的預覽，代理無法攔截。長期方向是把預覽網域列入 PSL 私有區段；在那之前預覽之間不算隔離
- 控制服務授權未確認，不依賴容器內隔離作為防線；容器內快取、設定目錄與正式環境的秘密盤點仍未完成
- ✅ 部署加固：wrangler 在平台建立、產物無法寫入的專用工作目錄執行，設定檔用絕對路徑，`--env-file` 指向空檔不載入任何 `.env`，API 位址／環境／合規區域以非空官方值寫死（代理與全域 API key 無法以空值寫死，故 `.env` 不載入才是主防線）。測試以固定版本的真實 wrangler、假 API 與假 token 驗證各目錄的 `.env`／`.env.local` 不能改變目的地，並以對照組證明未加固時會。部署 token 的實際權限範圍仍待建立正式 token 時限縮

產品方向（2026-10-06）：Morph 匯入的是原生 TanStack Start 專案，不轉換成 Morph 專案，也不新增 Morph 專用設定語言。規劃見 [`docs/start-native-import-plan.md`](docs/start-native-import-plan.md)：官方 fixture 原樣匯入為最高層級驗收；建置執行客戶自己的 `vite.config.ts`（AST 只服務 Design 與 Monaco）；每個 Theme 有依 lockfile 鎖定的依賴快照，沿用既有套件申請流程自動提出、但不自動信任；基礎設施（D1、KV、R2、Secrets）以對應方式處理；四種渲染模式由 Code 與 Design 修改同一份官方寫法；發布時由產物凍結 Render Plan。

產品方向更新（2026-10-06）：Theme 可用多種框架撰寫，建立網站時選擇（第一版 TanStack Start 與 Astro），CMS 本體維持 TanStack Start。框架無關的契約、元件旁的 `.fields.ts` 欄位規則、依檔案語言的 Design 接入與交付順序見 [`docs/multi-runtime-theme-plan.md`](docs/multi-runtime-theme-plan.md)；TanStack Start 的原生匯入成為其中一種框架接入。

產品方向更新（2026-10-08）：目標是盡量支援 Vite 能建置的框架，以支援層級區分能力：L1 託管（建置、預覽、發布、回滾、CMS 內容，通用路線）、L1.5 點選定位（點選元素跳到原始碼，參考 `code-inspector-plugin` 的注入做法）、L2 視覺改寫（依檔案語言逐一接入）、L3 認證（框架 × 版本）。接入順序：TanStack Start 原生 → Astro → React Router（原 Remix）→ 通用 Vite 託管（SvelteKit、SolidStart、Vue 等）→ Next.js（vinext）。Astro 的 Design 先做 L1.5；`.astro` 的解析器放不進 Morph 主 Worker（M1，#141），L2 改寫走專用解析 Worker（需另外核准新的部署單位），備選是 Sandbox 中的官方 Node 解析器，不自行維護 compiler fork。本機實驗 M1c 已完成（#145）：先取得名額再讀 body、串流位元組上限、trap 後停用實例等機制都運作，GC 後的記憶體在限內，但 GC 前的取樣在多個條件下超過 128 MB；部署後的雲端驗證（M1c-C）是正式閘門，2026-10-08 以測試資源完成並**通過**：每一種合法負載至少 3 輪逐請求對帳完整（Workers Logs）、`exceededMemory` 為 0；128 MB 的計算方式與毒化 isolate 的回收仍未回答，正式部署解析器 Worker 仍待使用者核准。L2 改寫引擎寫成獨立 package，目前不開源。細節見多框架計畫與 [`docs/astro-theme-plan.md`](docs/astro-theme-plan.md)。

進度（2026-10-07～08，原生 Start 的內容配對與發布，皆為本機驗收，Cloudflare 部署環境未驗）：

- 預先渲染只讀封存的內容（#130），預先渲染伺服器綁 127.0.0.1（#134），發布後送出正確的草稿 generation（#135）。
- build 記錄內容依賴（`content_dependency`，平台實測、不採信 Theme 宣告），無指名 build 的發布只重用生效 release 自己的 build，回滾後重新發布正確判斷是否已上線（#137）；G0 內容配對在本機真實容器驗收（#137，記錄於 #138）。
- 發布成功後才顯示該 release 的預覽，內容取自 release 本身（#142，migration 0074）。
- Live Preview 在 Sandbox 中斷後自動重連（#139、#143）；原生預先渲染不再開 inspector port，修正偶發的 EADDRINUSE 500（#146）。
- 原生建置開關仍關閉；開啟是另一個 PR，限已認證的工具鏈組合，且須先完成 Cloudflare 部署環境的驗收。

進度（2026-10-08～10，皆為本機驗收，Cloudflare 部署環境未驗）：

- **Astro A1～A6c 已合併**，仍在 `MORPH_ASTRO_THEMES=1` 開關後面，正式環境一律關閉；細節與各步閘門見 [`docs/astro-theme-plan.md`](docs/astro-theme-plan.md)。
  - A1 框架身分由 build 記錄（#151）。
  - A2a／A2b 工具鏈依框架分開，以身分記錄；預先渲染在 Sandbox 路徑驗證（#162、#163）。
  - A3 預先渲染只讀封存內容，以真實建置證明（#164）。
  - A4 原生建置先在本機 runner、再到 Sandbox runner；官方 Astro Cloudflare fixture 原樣匯入（#165、#168、#169）。Wrangler 設定可省略，工具目錄不從原始碼來（#171）。
  - A5 網站記錄框架；Astro 走過 Build Preview、發布與回滾（#178）。
  - A6 Live Preview：A6a 本機 sidecar（#179）；A6b-1 草稿內容同步，帶票據、雜湊綁定並逐伺服器確認（#181、#185）；A6c 進容器（#188）；純 Astro 網站不需 Start 入口檔即可啟動預覽（#196）；Code 修改 React island 時就地更新並保留狀態（#197，只在本機容器驗收，CI 不跑容器）。
  - 下一步是 L1.5（點選定位，設計草稿 #191 未合併）；L2 仍等解析 Worker 的正式部署核准。
- **`src/` 下的二進位檔**：沿用 `public/` 的儲存與建置機制，兩種 Live Preview 傳輸、Build Preview、發布與回滾都已驗收；Code 模式可上傳（#172～#175）。平台建置檔在伺服器端拒絕，過期的可刪除（#176）。
- **內容**：`src/morph/content.ts` 改為作者擁有，有明確的還原方式；Design 寫入前先確認需要的匯出形狀（#180）。Inspector 只編輯儲存的值，不再把 Theme 轉換後的文字當草稿；畫布行內編輯只在顯示文字等於儲存值時開始（#186）。Starter 可在本機以 `morph.pages.get` 讀已發布內容（#161）。
- **編輯器**：離開或切頁前先送出等待中的修改，存檔狀態與發布狀態分開顯示（#192）；Theme 重新取得時，畫布上正在輸入的文字不再被關閉（#201）；Theme 無法編譯導致畫布空白時說明原因（#194）。
- **建置與預覽的容器**：三種 Sandbox 容器依實測定規格（#157）；建置容器啟動失敗時只重試啟動階段，探測改在 Durable Object 內執行，才讀得到結構化錯誤（#149、#155）；Build Preview 容器啟動失敗時回應「starting」，不再停在 500（#170）。
- **直譯器**：直譯器的保證已在真實 React Live Preview 中以測試固定（#193）。刪除直譯器是下一個 PR，前置條件是以下四項全部合併：#198（自身元件渲染的列有穩定身分）、#199（共用 layout 修改算作未發布）、Header／Footer 隱藏修正、欄位標記修正（後兩項 2026-10-11 尚無 PR；2026-10-13 更新：四項都已合併，見下一段）。
- **本機程式碼同步（原型）**：本機資料夾與 Theme Code 工作區雙向同步，含累計大量刪除保護（#177）；過時副本的提示列出本機同步也是可能來源（#182）。用法與限制見 [`docs/local-code-sync.md`](docs/local-code-sync.md)，後續順序見下表。
- **E2E 基礎設施**：一台機器同時只跑一個編輯器 E2E，runner 自己持鎖；容器傳輸的 run 以自己的名稱認領容器、建自己的 Sandbox 映像，互不清除（#195）。一般 `pnpm dev` 之間仍會互相清除 Sandbox 容器，見 [`TODO.md`](TODO.md)。

進度（2026-10-11～13，皆為本機驗收與 GitHub CI，Cloudflare 部署環境未驗）：

- **內容綁定（1.2 的 Start 案例）**：案例 B 測試基線（#211）；server function → loader → `useLoaderData()` 的綁定（#212）；伺服器讀內容的 Live Preview 在存檔後同步、確認後才刷新畫布（A6b-2，#216）；選取後原始碼被改時拒絕舊選取的寫入、保留草稿，並以欄位為單位恢復（#217）。尚未完成的反向檢查見 1.2。
- **直譯器刪除的前置條件全部合併**：#198（自身元件渲染的列有穩定身分）、#199（共用 layout 修改算作未發布）、#208（隱藏的 Header／Footer 在真實 React 中保持隱藏）、#209（不編輯被拒絕的手寫標記所指的欄位）。行為差異審查已合併（#213）；刪除本身（PR 2）待使用者決定審查中列出的問題。
- **編輯器**：重新取得失敗時保留編輯器，換成另一個帳號時鎖住（#206）；離開檢查涵蓋樣式修改與 Design 切換到 Code（#204）。
- **其他修正**：Starter 升級不會把首頁升級成工作區缺少的匯入（#202）；每次 Astro 建置使用自己的 Vite 依賴快取（#207）；首頁原始碼位置範例改正（#215）。
- **2026-10-13 晚間已合併**：完整 Start 預覽的 E2E 加進 CI（#219，`26b48a3`）；空的路由 Document 與沒有 Document 等效的測試，對應 #218，#218 已關閉（#220，`c266b9c`）；刪除過時的 `preview-health.spec.ts`（#222，`fa70bbd`；現有單元與伺服器測試不等於原本瀏覽器經容器連到正確預覽實例的那段覆蓋）；來源拒絕恢復測試改由測試控制存檔順序、每個測試結束時證明不再送出存檔（#225，`53b6b36`）；分片計畫裡的檔案必須存在（#223，`82b0bc6`）。這段期間改用單一合併窗口：只由一個協調 session 合併，一次一個，每次在最新 main 上驗證。
- **進行中（草稿，未合併）**：共用讀取核心原型（#221）；預覽存取規格（#214，CI 有一個 restore 測試的間歇性失敗未解決）。隱藏區塊不可選取（#224）其後已合併，見 1.2 目前進度。

### 本機程式碼同步後續（2026-10-09 排定，依序）

第 1 階段原型已合併（#177、#182）。以下依使用者排定的順序進行；安全還原排在即時更新之前，避免使用者在還原能力缺席時依賴即時同步。

| 順序 | 項目                                                                                                                                                                                                                                                                                                                                                                                                                                             | 類別   |
| ---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
|    1 | 安全的 pull／restore 指令：本機誤刪或改壞後，可從 Morph 取回，不必刪掉 `.morph/sync-state.json` 重新 `link`                                                                                                                                                                                                                                                                                                                                      | 正確性 |
|    2 | 專案綁定與防誤連：確認本機資料夾與 Morph 工作區的對應，避免把一個專案的檔案同步進另一個                                                                                                                                                                                                                                                                                                                                                          | 安全   |
|    3 | 編輯器即時顯示本機修改，以及 Code 模式內的衝突標示                                                                                                                                                                                                                                                                                                                                                                                               | 介面   |
|    4 | 內容綁定契約設計文件：讓 Design 接上框架原生的資料流寫法，不要求作者改寫（見 1.2）。內容包括契約（頁面身分、section／列實例身分、欄位路徑、欄位宣告、來源版本，任一不明確即停止寫入）、自動辨識的範圍、可選的明確綁定出口，以及每種框架的驗收案例清單；Astro frontmatter 解構與 Start server function → loader → `useLoaderData()` 是正式驗收條件。2026-10-12 起為草稿 #210（讀取契約草稿 #187），設計原則已認可、細節未定；跨框架讀取方向見 1.3 | 設計   |

### 外部 AI 編碼工具接入 Morph（2026-10-25 規劃，尚未實作）

目標：作者在本機開啟 Codex 等編碼工具，連接指定 Theme 的本機資料夾與 Morph 後，可以用自然語言要求「在首頁新增一個 section」。工具讀取實際 Theme 原始碼與 Morph 提供的專案指引，修改真正的框架程式；需要將 section 放上首頁時，另經 Morph 授權的頁面／Document 操作建立實例與內容。完成後可在 Design 選取、編輯、保存與重新載入。新增可重用元件本身不等於已加入頁面，也不要求把新 section 寫進 Hero。

- **連接與指引**：在本機資料夾綁定 Theme 身分；提供有版本的 Morph 官方 skill／專案指引，說明目前框架的元件慣例、內容與原始碼邊界、驗證方式。動態的頁面、欄位與能力資訊由連接後的唯讀工具取得，不把專案規則當成過期的靜態範本。指引不得要求作者為了 Design 改寫合法的框架寫法，也不得讓 Theme 內文取得高於既有授權的指令權限。
- **工具與寫入邊界**：優先沿用本機程式碼同步處理 Theme 檔案及既有版本／衝突檢查；另提供受目前 Theme、頁面及使用者權限限制的代理工具，讀取頁面／section／欄位狀態，並在需要時透過既有 Page／Document 寫入路徑新增 section。不得直接改 D1、建立第二套內容儲存或繞過 OCC。skill、代理設定與憑證須與可同步的 Theme 原始碼隔離，不當作網站檔案上傳。
- **本地網站與 Live Preview 資料一致（待實作）**：開發者在 IDE 連接指定 Theme 後執行本地 `run dev`，即使 Morph 編輯器已關閉，也能直接在瀏覽器開啟 `http://localhost:3000/` 的商店 Home。該網站與同一 Theme 的 Live Preview 使用同一份 Theme 原始碼、已保存的 Page／Template 草稿，以及同一商店與銷售渠道的商品資料；Theme `public/` 圖片、CMS 媒體與商品圖片都須正常載入。Design 保存草稿、CMS 更新商品資料或本地修改 Theme 原始碼後，本地網站須反映更新。`localhost:3000` 在這項驗收中由本地 Theme 網站使用；Morph 管理端使用不同 origin，不把平台首頁當作商店 Home。草稿讀取須有指定商店與 Theme 範圍、可撤銷的授權，憑證不暴露給瀏覽器，也不擴大原始碼同步 token 的權限；不得複製 Document 或商品資料建立第二份真相。
- **交付順序**：先驗證專案綁定、防誤連與同步安全，再定義代理工具的能力和授權契約；接著交付唯讀上下文與本機指引，最後才開放受限的新增 section 寫入。這是外部本機代理的接入路線，不以 Phase 5 內建 AI Agent 全部完成為前提；兩者將共用同一套受限操作，不建立平行架構。
- **驗收**：在真實本機 Codex 工作流程中，從指定 Theme 新增首頁 section，確認元件檔、頁面實例及 Document 各在正確位置；在 client-only 與完整 Start 的適用環境驗證「點畫布 → 找到正確 CMS 欄位 → 修改並保存 → 讀回原始 Document → 重新載入」。同時驗證錯誤 Theme、撤銷權限、版本衝突及來源無法證明時安全拒絕且不遺失內容。Astro、Vue 等框架依各自的真實案例逐步驗收；不因工具能改檔就宣稱所有合法寫法都已能在 Design 自動綁定。發布與部署仍須獨立操作。
- **本地網站驗收**：關閉 Morph 編輯器，直接打開並重新載入 `http://localhost:3000/`；在相同路由與視窗大小下，逐項對照重新開啟的 Live Preview：section 與順序、文字、商品與價格、Theme `public/` 圖片、CMS 媒體和商品圖片均一致，圖片請求實際成功。分別保存 Design 草稿、更新商品及從 IDE 修改原始碼後確認本地畫面更新；錯誤商店／Theme、預覽授權撤銷及資料來源不可用時須明確拒絕，不顯示另一商店或過期草稿。輸入中尚未保存的文字不列入同步承諾；各框架只有完成自身真實瀏覽器驗收才列為支援。

---

# Phase 0 — Architecture Alignment

## Status

✅ 已完成。規則 authority 已收斂到 `AGENTS.md` 與 `.agents/rules/*.md`；本文件只保留產品階段、交付順序與未來缺口。

## Goal

讓 repository 文件、AI coding rules 與實際 Code-backed implementation 完全一致。

## Deliverables

- 對齊 `AGENTS.md` 與 `.agents/rules/*.md` 的規則 authority
- 重寫 `ROADMAP.md`
- 把 Presentation SSOT 明確改為 Theme React Source
- 把 Page Document 明確降回 Content / Assembly responsibility
- 移除「AI 只能 Schema Authoring」的限制
- 移除「Code Mode 最後才做」的舊演進規則
- 定義 Visual Editor = AST/source editor
- 定義 AI Code Agent 與 Sandbox / Release safety boundary
- 定義 target Storefront Release model

## Completion criteria

- 開發者與 AI agent 不會再依文件建立第二套 schema-first storefront framework。
- 新功能有明確 authority：Commerce、Source 或 Content。
- Build / Preview / Publish 名詞在文件與程式中意思一致。

---

# Phase 1 — Authoring Convergence

## User value

使用者可以在 Canvas 或 Code Editor 編輯同一個真正的 React Theme，不會出現「Canvas 一份、程式碼另一份」。

## Core flow

```text
Theme Source
   ↕
Visual AST Editor
   ↕
Monaco
```

## Deliverables

### Theme Workspace

目前狀態：核心 file lifecycle、tree UX、multi-file OCC、source-generation conflict 與 revision history／restore 已完成；dirty／saving／conflict 的回歸持續進行。

- 完成 file create / rename / delete lifecycle
- 完成 file tree UX
- 強化 workspace dirty / saving / conflict state
- 完成 multi-file OCC
- 完成 source generation conflict UX
- revision history / restore UI

### Visual AST Editor

- 選取 preview DOM → resolve `data-morph-node`
- node → source file / AST position
- Inspector read static Tailwind values
- Inspector safe source patch
- source save → preview refresh
- Monaco edit → Inspector reparse
- unsupported dynamic expression 顯示 Code-only state

### Code Mode route authoring

- `src/routes/**` 由作者直接編輯，新增 `about.tsx` 等 route source 後由同一份 bounded route registry
  解析 path、parent 與 diagnostics。
- Explorer 顯示唯讀虛擬 `src/routeTree.gen.ts`，用來提供 TanStack Router 的 path/type 補全；
  它不是 workspace source，也不會被保存或由 AI 直接修改。
- 真正的 route tree 只在固定版本 Theme build toolchain 的暫存 workspace 產生；新增 route
  只有在 route generation、Preview 與 build 成功後才算可執行。

### Starter bootstrap / upgrade

- 新建或升級 Starter Theme 前先產生可審閱的 create／update／delete plan。
- 套用時沿用 ownership、source generation 與 OCC；作者修改過的檔案、客戶依賴與非安全刪除不會
  被靜默覆蓋。
- 套用後重新執行 route diagnostics、Live Preview 與 immutable build；bootstrap 不等同 Publish。

### Morph component metadata

維持 `morph.theme.json` 作為 routing、component mapping 與舊元件相容 metadata；新的 code-authored
內容 capability 以元件同檔案的 `export const contentFields` 為優先來源，manifest `contentFields`
只作為尚未遷移元件的 fallback。

- component id
- source path
- entry
- display name
- visual-editor capability
- optional inspector metadata
- bounded `contentFields` capability parser 與 server-side allowlist，讓 customer code-authored props 可安全接入 versioned Page／Template content draft

Manifest 是 mapping / metadata，不是 styling SSOT。

### Editing capability

先把最重要的 CSS / Tailwind 能力打通：

- typography
- spacing
- sizing
- color
- background
- border / radius
- flex
- grid
- alignment
- responsive tokens

## Completion criteria

至少一個完整 vertical slice：

```text
Canvas 改 Hero heading font size
→ Hero.tsx class 改變
→ Monaco 立即看到
→ Save
→ reload 後保持
→ create source revision
→ build
→ immutable preview 正確
```

反向：

```text
Monaco 改 Hero.tsx
→ Save
→ Visual Editor reparse
→ Inspector 顯示新值
```

---

# Phase 2 — Build & Preview Productionization

## User value

任何 source revision 都能以可重現方式 build，且 preview 真正對應 immutable artifact。

目前 repository 已有大部分技術 foundation，本階段重點是 production hardening。

## Deliverables

### Build Runner

- Cloudflare Sandbox production configuration
- deterministic toolchain
- approved dependency registry
- dependency version policy
- build timeout
- file / source / output budgets
- structured build logs
- diagnostics mapping 到 Monaco / Inspector
- customer dependency request 的 platform allowlist、精確版本與 queued → building → ready／failed 狀態

### Theme dependency workflow

- `cms.config.ts` 是平台擁有的核准套件目錄與精確版本來源；客戶端不可提交任意 npm 名稱或版本。
- 已登入且具備 CMS 管理權限的請求只能啟用核准目錄中的套件，建立 dependency request 並綁定
  immutable source revision。
- Cloudflare Queue／local runner 執行 `queued → building → succeeded／failed`；只有 build 成功
  後套件才進入 `ready`，失敗不得影響上一個可用 build。
- 目前「平台核准」等同 `cms.config.ts` allowlist 加上 CMS admin server capability；若未來要
  由平台人員逐案審核，必須另建 review role、approval state、audit 與 UI，不得把 `building`
  當成審核完成。

### Artifact

- immutable R2 artifact prefix
- canonical manifest
- hash / metadata
- retention policy
- orphan artifact cleanup policy

### Preview

- stable immutable preview URL
- preview token lifecycle
- iframe isolation
- build diagnostics UI
- failed build UX
- retry behavior
- build history UI

### Build verification

Publish 前能確認：

- source revision
- compiler identity
- build success
- artifact availability
- manifest integrity

## Completion criteria

- Build 永遠只讀 immutable revision。
- 同一 revision + compiler identity 可以 deterministic rebuild / verify。
- Failed build 不影響前一個 preview / production artifact。
- Build Plane 無 production database / auth secrets。
- Preview asset 只能從 manifest allowlist 讀取。

---

# Phase 3 — Storefront Release Model

## User value

Morph 可以安全地把一個已驗證版本切到 production，且瞬間 rollback。

這是下一個最高優先級 backend milestone。

## Target model

```text
StorefrontRelease
├─ id
├─ storefrontId
├─ themeId
├─ themeBuildId
├─ sourceRevisionId
├─ contentPublicationId
├─ createdBy
├─ createdAt
└─ metadata
```

```text
Storefront
└─ activeReleaseId
```

## Rules

### Presentation release

Theme Source 改變：

```text
Source Revision
→ Successful Build
→ New Release
→ Atomic activate
```

### Content-only release

只有 copy / assets / SEO / section ordering 改變：

```text
Existing Successful Theme Build
+
New Published Content Revisions
→ New Release
→ Atomic activate
```

不需要重新 build theme。

## Deliverables

已完成：

- `storefront_releases` / `activeReleaseId` SSOT
- `ContentPublication` immutable template/page revision snapshot foundation
- content-only build reuse
- publication + release atomic activation
- legacy `sourceGeneration` fail-closed
- source/build identity validation
- rollback activation service with history query and OCC
- release activation fail-closed ContentPublication/revision/document validation
- revision retention guard for ContentPublication references
- 0045 → 0049 migration regression coverage, including trustworthy active legacy backfill

已具備（續）：

- release history UI 與回滾切換（編輯器工具列 History）

待完成：

- ~~release history 分頁~~：已完成（`useInfiniteQuery`，25 筆一頁，收到不足一頁即停止）
- audit/history presentation：誰在何時發布、變更了什麼；目前只有 `created_by` 與時間
- compatibility cleanup from current `publishedSourceRevisionId` / `publishedRevisionId`

## Completion criteria

- Production 永遠指向完整 immutable release。
- 不可能出現 source 已 published 但 artifact 不存在。
- Content-only publish 不觸發 Vite build。
- Rollback 只需切回 previous release。
- Concurrent publish 不 silent overwrite。

---

# Phase 4 — Production Edge Storefront Runtime

## User value

真正的顧客可以透過 storefront domain 使用 Morph 發布的網站。

## 部署拓撲（2026-08 確立）

Morph 目前是**單租戶交付**：每個客戶取得一份自己的 Morph 部署，跑在客戶自己的
Cloudflare 帳號。這決定了 production runtime 的形狀：

```text
merchant hostname
      ↓
Morph Core Worker（分流：平台 hostname vs storefront hostname）
      ↓ hostname → active release → immutable build
      ↓
service binding → Theme Worker（同帳號內的一般 Worker）
```

- Theme Worker 是**同一個 Cloudflare 帳號裡的普通 Worker**，用 service binding 呼叫。
- **Workers for Platforms／dispatch namespace 屬於 Phase 8**，不是現在的方案。它是為
  「一個帳號承載大量互不信任的客戶 Worker」而存在的，單租戶交付不需要，也不該為此付費。
- `ThemeRuntime` 介面已保留 dispatch 實作，Phase 8 只需換傳輸層，解析與授權邏輯不變。

### service binding 的取捨

service binding 指向**固定的 script 名稱**，所以「哪個 build 在線上」由部署決定，
指標翻轉做不到。因此：

- `storefronts.active_release_id` 仍是「哪個 release 應該在線上」的唯一 SSOT。
- 啟用必須**先以 CAS 佔位、再部署**；佔位失敗者永遠不得碰部署腳本，兩個並行啟用
  就不可能同時替換同一個 script。
- 部署失敗必須把 `active_release_id` 還原；還原也失敗時必須明確回報 drift，不得靜默。

## Request path

```text
Hostname
   ↓
Storefront Resolver
   ↓
Active Release
   ↓
Theme Build Artifact
   ↓
Published Page / Template Context
   ↓
Commerce DTO
   ↓
Storefront
```

## Deliverables

### Domain / routing

- hostname resolver
- primary domain
- preview domain
- home route
- pages
- products
- collections
- cart / checkout handoff
- 404
- canonical URL
- sitemap
- robots

### Runtime bridge

建立正式 `StorefrontRuntimeContext` contract。

Theme build 不應 bake mutable content 與 commerce values。

Theme runtime 可以透過：

- initial serialized boot context
- same-origin Store API
- Morph runtime adapter

取得：

- page/template content
- public product data
- collection data
- cart context
- navigation
- locale
- currency / sales channel

### Artifact serving

- immutable cache
- proper MIME
- ETag / cache headers
- route fallback
- asset manifest
- versioned URLs

### Isolation

- Control Plane downtime 不影響已發布 storefront。
- Build Plane downtime 不影響 active release。
- draft content 不可透過 public runtime 取得。

## Completion criteria

- custom domain 可以載入 active release。
- `/`, `/products/:handle`, `/collections/:handle`, `/pages/:handle` 正常運作。
- 同一 theme build 可以搭配更新後的 content release。
- product price / inventory 更新不需要 theme rebuild。
- previous release 可以立即 rollback。

---

# Phase 5 — AI Code Agent

本階段的內建代理與上方「外部 AI 編碼工具接入 Morph」共用 Theme、Page／Document 與授權邊界；本機 Codex 接入可先獨立交付。

## User value

使用者可以描述想要的頁面、元件或互動效果，AI 直接修改真正的 React Theme，而不是只能排列固定 sections。

## AI scope

AI 可以：

- inspect source tree
- read selected component
- create component
- modify React / TSX
- modify Tailwind / CSS
- create responsive layout
- create GSAP animation
- create Canvas / WebGL / Three / R3F experience
- update `morph.theme.json`
- add Morph visual-edit metadata
- modify Page / Template content when appropriate

## Architecture

```text
Prompt
   ↓
Context Builder
   ↓
Agent Workspace
   ↓
File Operations / Patch
   ↓
Validation
   ↓
Theme Workspace OCC
   ↓
AI Source Revision
   ↓
Sandbox Build
   ↓
Diagnostics
   ↓
Bounded Repair Loop
   ↓
Preview
   ↓
Human Approval
```

## Context Builder

只提供必要資訊：

- relevant source files
- component manifest
- current selected node
- theme design language
- dependency allowlist
- public commerce DTO schema
- Page / Template context
- asset references
- project rules

不可提供：

- production secrets
- raw session secret
- unrestricted D1
- unrelated PII

## Agent operations

Agent 不應取得 unrestricted filesystem。

提供 scoped tools：

- list theme files
- read file
- create/update/delete allowed file
- apply patch
- query diagnostics
- request source revision
- request build
- inspect build result

## Repair loop

- bounded attempts
- every attempt recorded
- build error fed back with scoped diagnostics
- no infinite loop
- failed repair leaves previous workspace / release recoverable

## Human approval

AI 不可：

- publish
- deploy
- activate release
- migrate production
- expand dependency policy
- expand its own permissions

## Completion criteria

使用者可以輸入：

> 做一個跟著滾輪移動的 IoT Canvas hero，手機版改成靜態圖片。

AI 能：

1. 建立真正 React / Canvas code。
2. 通過 dependency / path / security policy。
3. Build。
4. 顯示 preview。
5. 失敗時有限次 repair。
6. 使用者批准後才建立 / activate release。

---

# Phase 6 — AI Content & Commerce Authoring

## User value

對不需要寫 code 的工作，AI 可以用更快、更安全的資料層直接完成。

## Use cases

- landing page copy
- SEO
- image selection
- product / collection binding
- translation
- navigation
- reorder sections
- campaign page content
- product merchandising

## Decision rule

```text
Content / assembly
→ Page Document

Presentation / behavior
→ Theme Source
```

## Deliverables

- content assistant
- asset suggestion
- localization
- SEO generation
- commerce reference search
- structured content diff
- draft revision
- publish review

## Completion criteria

Content-only AI change 不需要 build Theme，也不會取得 code execution capability。

---

# Phase 7 — Advanced Interactive Runtime

## User value

Morph 可以穩定承載高品質品牌官網與互動式商品體驗。

## Capabilities

- Canvas
- WebGL
- Three.js / R3F
- GSAP
- image sequence
- scroll story
- Mapbox / maps
- 3D product viewer
- immersive landing page
- IoT / data visualization

## Platform work

- dependency capability packs
- asset preload budgets
- GLB / texture / sequence pipeline
- lazy activation
- visibility lifecycle
- render-loop controls
- memory / FPS instrumentation
- mobile strategy
- no-WebGL fallback
- reduced-motion fallback
- error boundaries

Reusable presets 可以存在，但它們是 authoring acceleration，而不是唯一可用 presentation vocabulary。

## Completion criteria

AI 能建立超出預設 component library 的新互動實作，同時 production 仍受到 build sandbox、resource budget 與 release policy 保護。

---

# Phase 8 — Multi-tenant SaaS Platform

## User value

Morph 可以安全地服務多個商家、網站與不同方案。

## Target topology

```text
Morph Control Plane
├─ users / orgs
├─ projects / storefronts
├─ billing / entitlement
├─ AI jobs
├─ builds
├─ releases
├─ domains
└─ observability

Morph Authoring Plane
├─ theme workspace
├─ visual editor
├─ Monaco
└─ AI agent

Morph Build Plane
├─ queue / workflow
├─ sandbox / container
├─ artifact store
└─ immutable previews

Morph Runtime Plane
├─ hostname router
├─ active releases
├─ Store API
├─ commerce runtime
└─ CDN / cache
```

## Deliverables

- explicit tenant identity
- **Workers for Platforms dispatch namespace**：多租戶才需要的傳輸層。`ThemeRuntime`
  已有 `DispatchNamespaceThemeRuntime` 實作與 script 命名（以 buildId 為鍵，讓啟用
  變成指標切換），Phase 8 需補的是部署平面、script GC 與 outbound worker 隔離
- tenant-aware D1 / storage strategy
- per-tenant quotas
- AI cost attribution
- build metering
- release audit
- backups
- retention
- domain lifecycle
- incident tooling
- logs / traces
- enterprise isolation option
- migration between shared / dedicated runtime

## Completion criteria

沒有任何 request 能取得其他 tenant 的：

- commerce data
- theme source
- artifact
- preview
- release
- secret
- domain
- AI job

---

# Phase 9 — Commerce Application Generator

## User value

Morph 不只產生 storefront，也能建立 commerce-adjacent application。

例如：

- B2B quotation portal
- dealer portal
- service booking
- product configurator
- marketplace operations
- subscription management
- wholesale customer portal

## Architecture principle

優先重用既有 commerce source of truth。

對通用業務 entity 可建立 controlled application schema，但它不是 storefront presentation schema。

```text
Commerce Core
     +
Application-owned Extension Data
     +
Generated UI / Workflow
```

Code Agent 可處理超出 controlled runtime schema 的需求，但仍走 Sandbox → Preview → Approval → Release。

## Completion criteria

- commerce records 不被複製成第二套 truth。
- generated server behavior 有 permission boundary。
- migration 可 preview / rollback。
- tenant isolation 完整。
- production schema mutation 必須人工批准。

---

# Deferred by decision

以下不是缺口，是明確決定「先不做」的項目。記在這裡是為了不用再討論第二次。

## 把一致性檢查搬進建置容器

**決定：現階段不做。** 目前的組合已經把風險蓋住：本機的 `pnpm test:parity` 修的是
會跟著出貨的解釋器本身，而部署後的安全網是 Build Preview——發布流程強制要有一次成功
的建置，所以「沒看過真實產物就上線」在設計上發生不了。

問題在於 Build Preview 只給你「實際長什麼樣」，要自己用眼睛比對兩個預覽；而
`pnpm test:parity` 能指出**哪一行不一致**，但只跑在有 repo 與 Node 的機器上，部署到
Cloudflare 之後在瀏覽器裡編輯的人碰不到它。

想做的話路徑是清楚的：同一套比對搬進建置容器（Vite 已經在那裡跑），把差異當成 build
diagnostic 回報——按下 Build Preview 就直接說「第 12 行的寫法在編輯器裡會顯示不同」。

代價是解釋器也要送進容器，也就是容器裡多一份必須與編輯器同版本的程式碼；版本一旦
分岔，這個檢查本身就會開始說謊。真要做，解釋器得先有明確的版本邊界。

值得重新考慮的時機：**客戶或 AI agent 開始在部署後的編輯器裡寫主題程式碼**。在那之前
能引入新分歧的只有寫主題的人，而那個人在本機。

## 主題可用的第三方 runtime 套件（例如 Rive）

**決定：系統收完之前不加。** 每加一個有副作用的套件，就是在半成品上再開一個戰場。

技術路徑已經確認，之後照這個做即可：

- 建置端：加進 `DEFAULT_APPROVED_DEPENDENCIES` 即可，容器內的 Vite 會打包它；
  建置本來就保留二進位產物完整，`.riv` 這類資產不會被破壞。
- Live Preview：走既有的 `builtinComponents` 機制——主題 import 該套件時，解釋器
  直接換成平台提供的真實 React 元件（`@tanstack/react-router` 的 `Outlet` 就是這樣
  處理的）。解釋器不需要理解那個套件在做什麼。
- 前提：主題必須用**元件寫法**（`<Rive src="..." />`），不能用 hook 寫法
  （`useRive()` 需要解釋器能執行 hook 並解構結果，那是另一個層級的工作）。
- 兩個待決定：WASM 自行託管或走外部 CDN；以及編輯器 iframe 裡要不要真的執行
  第三方 WASM（跑＝所見即所得，不跑＝Live Preview 顯示佔位框、真實效果看
  Build Preview）。後者是安全決定，不是技術決定。

# Product Ceiling

完成主要階段後，Morph 可以成為：

> **一個 Cloudflare-native AI commerce platform：以 modular commerce backend 為資料核心，以 React code-backed theme 為 presentation 核心，提供 Visual AST Editor、AI Code Agent、immutable build/release、Edge Runtime 與 commerce-focused application generation。**

Morph 的競爭點不是「限制越少越好」，而是：

- AI 可以真的寫 code
- storefront 自由度高
- commerce data correctness 不犧牲
- production 不直接執行 AI 草稿
- 每個版本可以 build、preview、audit、publish、rollback
- content update 不必因為 code-backed theme 而每次 rebuild

---

# Cross-phase Invariants

所有 Phase 都必須維持：

- Commerce modules 是 commerce SSOT。
- React / TSX / Tailwind Theme Source 是 presentation SSOT。
- Page / Template Document 是 content / assembly SSOT。
- Visual Editor 不建立平行 presentation model。
- AI code 只能先進 authoring workspace。
- Build 只讀 immutable source revision。
- Untrusted code 只在 isolated build environment 執行。
- Failed build 不影響 active production release。
- AI 不可自行 publish / deploy / migrate / elevate permission。
- Content-only publish 不要求重新 build Theme。
- Production 永遠可 rollback 到已知 good release。
- Draft、Revision、Build、Preview、Release、Production 是不同 state。
- 新功能不得繞過 authorization、OCC、validation、audit、bounded work 與 rollback。
