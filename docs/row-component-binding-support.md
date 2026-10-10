# 列元件的內容綁定：支援現況與待驗證計畫

本文件記錄 Live Preview 對「由元件渲染的列表列」（例如
`items.map((item) => <Card {...item} />)`）目前能辨識哪些 React 寫法、哪些尚未支援，
以及每一項尚未實作的**候選做法**。

**後半的「候選做法」都是待驗證的計畫，不是已支援的功能，也不代表評估過難易度。**
每一項都要先用真實 React 的 live 測試與反向檢查證明可行，才能把狀態改成「已支援」。

## 原則

1. **合法程式一律可以儲存、預覽、建置。** 綁定辨識失敗只影響 Design 模式能不能直接寫入
   那個欄位，不影響 Code 模式，也不擋存檔或建置。
2. **內容來源無法確認時，只暫停該欄位的視覺寫入，並說明原因。** 不猜測，也不退回同名的
   頂層欄位。原因碼見 `ContentUnavailableReason`（`src/lib/storefront/editor/selection-taxonomy.ts`）
   與 `SelectedRowRefusal`（`selected-row-identity.ts`），Inspector 依原因顯示說明。
3. **「尚未支援」是解析器目前的範圍，不是作者必須遵守的規則。** 不要求作者為了配合 Morph
   改寫程式；下表每一項都應逐步支援。
4. **不為了「零限制」放寬安全檢查。** 每一種新寫法都必須先能證明「頁面上顯示的值就是
   寫入的那個欄位」，或至少能可靠定位原始欄位；證明不了就維持暫停寫入。
5. **複雜轉換不一定要能 inline 編輯。** 顯示值與儲存值不同時（格式化、計算），目標是：
   點擊能可靠定位到原始欄位，並在右側 Inspector 編輯儲存值；畫布上的 inline 文字編輯可以
   關閉。

## 機制摘要（目前已實作）

- 編譯期（`injectPreviewBindings`）在列表呼叫端確認 Card 的哪些 prop 最後生效的值就是該列
  的欄位，經 `__morphRow` prop 交給 Card 自己的解構參數；Card 的元素因而直接帶
  `data-storefront-field-path="items.N.title"`。
- `__morphRow` 只是預覽用的定位提示，不是授權：伺服器以自己從已存檔案解析的 capability、
  OCC 與 ownership 決定能寫什麼；正式 build 不執行這個注入。
- **列的身分是 `id`，不是索引，而且必須穩定且唯一。** 選取帶 `itemId`，寫入前與選取還原
  都依 id 重新確認目前索引（`rebaseSelectedRowPath`、`followRestoredRow`）。以下情況一律
  拒絕寫入並說明原因：選取的列沒有 id、id 在列表中重複、或原本的 id 已找不到。
- 這是編輯器端的防線，不取代伺服器：整份寫入仍由伺服器依 Document 的 generation（OCC）
  接受或拒絕。OCC 擋過時版本，但不能單獨證明選中的是哪一列，兩者缺一不可。
- id 只在「同一個 section、同一個欄位、同一個列表」內使用：Inspector 只在該 section 的
  該欄位陣列裡找，選取還原只在該 section、同一欄位的列裡找，預覽端判斷重複也只算同一個
  列表。別的列表有同名 id 不算數。

## 列 id 的生命週期（已核對）

- `normalizeDocumentRowIds` **只補缺少的 id、修正重複的 id**：任何非空字串的既有 id
  都原樣保留；重複時第一列保留，後面的列換新 id；以陣列為範圍。
- 補上的 id 由「template＋section＋路徑＋索引＋內容」推導，**只套用在讀出來的文件上**
  （`findEditorContext`），不在編輯後重算。`updateSectionProps` 以這份已補 id 的文件為底
  寫入，所以第一次儲存後 id 就存進資料庫，之後改文字、重排都不再變動。
- 預覽畫布的 template 內容同樣來自 `findEditorContext`，所以畫布上的 id 與 Inspector 一致。
  頁面（`storefrontPageDal`）不經過這個修補，但頁面只在後台 Pages 編輯，不經 Visual Editor
  的列寫入。
- 重排（`swapArrayItemsAtFieldPaths`）搬動整列，id 跟著走；新增列（`addArrayRowAtFieldPath`）
  取新的 id；undo／redo 還原的是含 id 的 props 快照。這些由
  `row-id-lifecycle.test.ts` 依序驗證。

## 尚未儲存、且程式碼預設列沒有 id 的列表

- 畫布上這種列沒有 id，從畫布選取單一列時**不寫入**（不退回用索引猜）。
- 但不會鎖死：Inspector 顯示整個列表供編輯，並提示「先儲存列表，才能從畫布逐列編輯」。
  列表編輯器的寫入對應的是面板當下畫出的列，不是點擊時記下的索引。儲存後，編輯器讀回的
  文件會補上 id，之後就能從畫布逐列編輯。
- Starter 的預設列在「已儲存」與「未儲存（只顯示程式碼預設值）」兩種狀態下都有可確認的
  id（`starter-row-identity.live.test.tsx`），因此這條規則沒有讓 Starter 原本能逐列編輯的
  列變成不能編輯。
- **待定的小範圍方案（尚未實作）**：首次編輯未儲存的預設列表時，由平台在既有的儲存與
  OCC 流程中把預設列建立成 Document 裡有 id 的列（用 `createMorphItemId`，不用內容或
  索引雜湊），成功後才開放從畫布逐列寫入。不改作者原始碼、不另建身分機制。需要另外設計
  與驗證。

## 支援現況

「已支援」一欄只列出有測試的寫法；其餘都是「尚未支援」。

| # | 寫法 | 狀態 | 暫停時的原因碼 |
|---|------|------|----------------|
| 1 | `<Card {...item} />` | 已支援（live、Inspector、E2E 測試） | — |
| 2 | 改名傳遞 `<Card heading={item.title} />` | 已支援（live 測試） | — |
| 3 | 列表內直接寫 host 元素 `<li>{item.title}</li>` | 已支援（既有） | — |
| 4 | 列表內傳 children `<Card>{item.title}</Card>` | 既有行為，children 屬於列表檔案的列範圍；本次未另寫測試 | — |
| 5 | prop 被覆寫：`{...item} title="x"`、`title="x" {...item}`、`{...item} {...other}` | 依最後生效值判斷；無法確定時暫停（live 測試） | `value-not-from-row` |
| 6 | 整包取 props：`function Card(props) { props.title }` | 尚未支援 | `row-not-passed`（若有標記） |
| 7 | `memo()`、`forwardRef()` 包裝 | 尚未支援（`memo()` 的暫停行為有 live 測試） | `row-not-passed` |
| 8 | 元件內再解構：`const { title } = props` | 尚未支援 | `row-not-passed` |
| 9 | 傳整個物件：`<Card item={item} />`，Card 內讀 `item.title` | 尚未支援 | 無標記（點擊落在列上） |
| 10 | 值轉換：`title={item.title.toUpperCase()}`、`format(item.price)`、模板字串 | 尚未支援 | `value-not-from-row` |
| 11 | 有預設值的讀法：`title={item.title ?? "Untitled"}` | 尚未支援（列表端） | `value-not-from-row` |
| 12 | 條件選擇：`title={cond ? item.a : item.b}` | 尚未支援 | `value-not-from-row` |
| 13 | 多層傳遞：Card 再把 `title` 傳給 `<Heading text={title} />` | 尚未支援（內層元件的標記被拒絕） | `row-not-passed` |
| 14 | 陣列先轉換再 map：`items.filter(...).map`、`slice`、`[...items].sort()` | 尚未支援（目前不標記列） | 無標記 |
| 15 | 列內的巢狀列表 | 尚未支援（內容模型目前不允許列內陣列） | `nested-list` |
| 16 | 由 state／hook 推導的值（`useMemo(() => item.title.trim())`） | 尚未支援 | 無標記 |

表中 6、8、9、11、12、13、14、16 的「原因碼」欄是依目前程式路徑推得的預期，尚未逐項寫
測試確認；開始支援某一項時，先補上它在現況下的測試。

## 候選做法（待驗證，尚未實作）

以下每一項都只是方向。每項同時列出必須先驗證的問題；任何一個問題答不出來，就維持暫停。

### 6. 整包取 `props`

- 候選做法：第一個參數是識別字（例如 `props`）時，把 `props.title` 視同解構出的 `title`，
  標記讀 `props.__morphRow`，不改參數。
- 待驗證：`props` 是否整包流到 DOM 或其他元件（`{...props}`、`<Inner {...props} />`、
  傳進 hook）；若要在預覽副本改寫這些 spread 以排除 `__morphRow`，需確認不改變其他 prop
  的行為；`props` 被重新指派或解構成別名時的追蹤範圍。

### 7. `memo()`、`forwardRef()`

- 候選做法：匯出值是呼叫從 `"react"` 匯入的 `memo`／`forwardRef`（或 `React.memo`）時，
  展開到第一個參數的函式，再沿用目前流程。
- 待驗證：`memo(Component, areEqual)` 的自訂比較函式會看到 `__morphRow`，預覽的重繪行為
  是否因此不同；`memo(forwardRef(...))` 等巢狀包裝；第一個參數是匯入的元件而非本檔函式；
  `React` 以其他名稱匯入；Fast Refresh 對包裝元件的處理。每一點都要有 live 測試。

### 8. 元件內解構

- 候選做法：函式本體頂層有 `const { title, body } = props` 時，把 `__morphRow` 加在這個
  解構裡。
- 待驗證：解構前後 `props` 是否另有用途；解構不在頂層（條件內、迴圈內）時的處理。

### 9. 傳整個物件 `<Card item={item} />`

- 候選做法：列表端把列變數原樣傳給某個 prop 時，記錄「這個 prop 是整列」；Card 端把
  `item.title` 這類成員讀取標成 `${path}.title`，前提是 `title` 屬於該列宣告的欄位。
- 待驗證：Card 是否修改或複製 `item`；成員讀取經過別名、解構或函式時能否追到。

### 10–12. 值轉換、預設值、條件

- 候選做法：分成「直接值」（顯示值就是儲存值，可 inline）與「衍生值」（顯示值由儲存值
  計算而來）。衍生值另外標出原始欄位，點擊時 Inspector 定位並編輯儲存值，畫布不開放
  inline 改字，以免把格式化後的文字存回去。
- 待驗證：表達式是否只依賴單一列欄位（函式可能透過閉包讀到其他值，靜態分析未必看得到）；
  Inspector 目前沒有「衍生值」的顯示方式，需要新的介面與協定欄位；`??` 預設值在缺值時
  inline 編輯的語意；條件式兩個分支各讀不同欄位時如何在 Inspector 呈現。

### 13. 多層傳遞

- 候選做法：每一層都用與列表端相同的證明方式，把對應關係往下傳。
- 待驗證：每層都要求原樣傳遞；元件被多處、以不同方式使用時，對應關係是否會混在一起。

### 14. 先轉換再 map

- 問題：`items.filter(...).map((item, i) => ...)` 的 `i` 不是儲存陣列的索引，用它組路徑
  會寫錯列。
- 候選做法：不用 map 的索引，只標列的 `id`，由編輯器依 id 找出儲存陣列中的索引。
- 待驗證：轉換後的物件是否仍是原本的列（`map` 產生新物件時 id 可能被保留，也可能沒有）。

### 15. 列內的巢狀列表

- 目前的內容模型不允許列內再有陣列。要支援必須先擴充 schema，屬於內容模型的設計決策，
  不只是解析器的工作。

### 16. state／hook 推導的值

- 值只在執行期存在，靜態分析無法證明來源。候選做法是只做定位（依列的 id），讓 Inspector
  顯示該列宣告的欄位，畫布不 inline 編輯這個元素；是否可行仍需驗證。

## 驗收方式

每支援一項，都要同時有：

- 真實 React 的 live 測試（`src/lib/storefront/editor/preview-row-component.live.test.tsx`）：
  路徑、點擊、還原；
- 對應的「無法確認」測試：同一寫法的變形必須暫停並回報原因，不落到頂層欄位；
- 反向（mutation）檢查：拔掉新邏輯後，上述測試必須變紅。
