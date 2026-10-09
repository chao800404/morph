# 列元件的內容綁定：支援清單與自動辨識方式

本文件記錄 Live Preview 對「由元件渲染的列表列」（例如
`items.map((item) => <Card {...item} />)`）能辨識哪些 React 寫法、目前尚未支援哪些，
以及每一項打算如何自動辨識。

## 原則

1. **合法程式一律可以儲存、預覽、建置。** 綁定辨識失敗只影響 Design 模式能不能直接寫入
   那個欄位，不影響 Code 模式，也不擋存檔或建置。
2. **內容來源無法確認時，只暫停該欄位的視覺寫入，並說明原因。** 不猜測，也不退回同名的
   頂層欄位。原因碼見 `ContentUnavailableReason`（`src/lib/storefront/editor/selection-taxonomy.ts`），
   Inspector 依原因顯示說明。
3. **「尚未支援」是解析器目前的範圍，不是作者必須遵守的規則。** 不要求作者為了配合 Morph
   改寫程式；下表每一項都應逐步支援。
4. **不為了「零限制」放寬安全檢查。** 每一種新寫法都必須先能證明「頁面上顯示的值就是
   寫入的那個欄位」，或至少能可靠定位原始欄位；證明不了就維持暫停寫入。
5. **複雜轉換不一定要能 inline 編輯。** 顯示值與儲存值不同時（格式化、計算），目標是：
   點擊能可靠定位到原始欄位，並在右側 Inspector 編輯儲存值；畫布上的 inline 文字編輯可以
   關閉。

## 機制摘要（目前）

- 編譯期（`injectPreviewBindings`）在列表呼叫端確認 Card 的哪些 prop 就是該列的欄位，
  經 `__morphRow` prop 交給 Card 自己的解構參數；Card 的元素因而直接帶
  `data-storefront-field-path="items.N.title"`。
- `__morphRow` 只是預覽用的定位提示，不是授權：伺服器以自己從已存檔案解析的 capability、
  OCC 與 ownership 決定能寫什麼；正式 build 不執行這個注入。
- 列的身分是 `id`，不是索引：選取帶 `itemId`，寫入前與選取還原都依 id 重新確認目前索引
  （`rebaseSelectedRowPath`、`followRestoredRow`）；列已不存在就拒絕寫入。

## 支援清單

| # | 寫法 | 狀態 | 暫停時的原因碼 |
|---|------|------|----------------|
| 1 | `<Card {...item} />` | 已支援 | — |
| 2 | 改名傳遞 `<Card heading={item.title} />` | 已支援 | — |
| 3 | 列表內直接寫 host 元素 `<li>{item.title}</li>` | 已支援（既有） | — |
| 4 | 列表內傳 children `<Card>{item.title}</Card>` | 已支援（children 屬於列表檔案的列範圍） | — |
| 5 | prop 被覆寫：`{...item} title="x"`、`title="x" {...item}`、`{...item} {...other}` | 依最後生效值判斷；無法確定時暫停 | `value-not-from-row` |
| 6 | 整包取 props：`function Card(props) { props.title }` | 尚未支援 | `row-not-passed`（若有標記） |
| 7 | `memo()`、`forwardRef()` 包裝 | 尚未支援 | `row-not-passed` |
| 8 | 元件內再解構：`const { title } = props` | 尚未支援 | `row-not-passed` |
| 9 | 傳整個物件：`<Card item={item} />`，Card 內讀 `item.title` | 尚未支援 | 無標記（點擊落在列上） |
| 10 | 值轉換：`title={item.title.toUpperCase()}`、`format(item.price)`、模板字串 | 尚未支援 | `value-not-from-row` |
| 11 | 有預設值的讀法：`title={item.title ?? "Untitled"}` | 尚未支援（列表端） | `value-not-from-row` |
| 12 | 條件選擇：`title={cond ? item.a : item.b}` | 尚未支援 | `value-not-from-row` |
| 13 | 多層傳遞：Card 再把 `title` 傳給 `<Heading text={title} />` | 尚未支援（內層元件的標記被拒絕） | `row-not-passed` |
| 14 | 陣列先轉換再 map：`items.filter(...).map`、`slice`、`[...items].sort()` | 尚未支援（索引會錯，目前不標記列） | 無標記 |
| 15 | 列內的巢狀列表 | 尚未支援（內容模型目前不允許列內陣列） | `nested-list` |
| 16 | 由 state／hook 推導的值（`useMemo(() => item.title.trim())`） | 尚未支援 | 無標記 |

## 逐項的自動辨識方式

### 6. 整包取 `props`

- 判斷：第一個參數是識別字 `props`。元素讀 `props.title` 時，視同解構出的 `title`
  （延伸 `inferBoundPropName`／`fieldForElement`，把該參數名當作「props 物件」）。
- 傳遞：標記直接讀 `props.__morphRow`，不必改參數。
- 安全前提：`props` 不能整包流到 DOM。若函式內有 `{...props}` 擺在 host 元素上，或把
  `props` 整包傳給其他元件，就在該 spread 改寫為排除 `__morphRow` 的版本
  （例如 `{...__morphOmitRow(props)}`，helper 由預覽注入），或對這個元件暫停並回報。
  兩者都只發生在預覽副本，不改作者的原始碼。

### 7. `memo()`、`forwardRef()`

- 判斷：匯出值是 `CallExpression`，callee 是從 `"react"` 匯入的 `memo`／`forwardRef`
  （或 `React.memo`），第一個參數是函式或指向本檔函式的識別字。
- 處理：展開到內層函式後沿用目前流程。`forwardRef` 的第二個參數 `ref` 不受影響。
  props 經過 `memo`／`forwardRef` 原樣傳入，不改變語意。

### 8. 元件內解構

- 判斷：函式本體頂層有 `const { title, body } = props`（或解構自第一個參數）。
- 處理：把該解構視為參數解構，`__morphRow` 加在這個解構裡（同樣能排除在 `...rest` 外）。

### 9. 傳整個物件 `<Card item={item} />`

- 判斷：列表端把列變數原樣傳給某個 prop（`item={item}`）。這可以證明 Card 的 `item` 就是整列。
- 處理：`__morphRow` 帶上「`item` 是整列」的對應；Card 端把 `item.title` 這類成員讀取
  標成 `${path}.title`，前提是 `title` 屬於該列宣告的欄位。

### 10–12. 值轉換、預設值、條件

- 判斷：表達式裡讀到的列欄位可以靜態找出（例如只讀了 `item.title` 一個欄位）。
- 處理：分成兩種標記：
  - **直接值**（顯示值就是儲存值）：可 inline 編輯，即目前的 `data-storefront-field-path`。
  - **衍生值**（顯示值由儲存值計算而來）：另外標出原始欄位（例如
    `data-morph-content-source="items.1.title"`），點擊時 Inspector 定位並編輯儲存值，
    畫布不開放 inline 改字，以免把格式化後的文字存回去。
- `item.title ?? "Untitled"`：有儲存值時顯示的就是儲存值，可視為直接值，缺值時顯示預設
  文字；可在確認語意後歸為直接值。
- 條件式：兩個分支各自讀不同欄位時，標出兩個候選欄位，由 Inspector 一起列出，不猜哪一個。

### 13. 多層傳遞

- 判斷：Card 把收到的 prop 原樣傳給下一層元件（`<Heading text={title} />`）。
- 處理：與列表端同樣的證明方式，逐層把對應關係往下傳（Card 把收到的 `__morphRow`
  轉換成 Heading 的對應後再傳下去）。每一層都要求原樣傳遞；中間有轉換就歸到 10–12 處理。

### 14. 先轉換再 map

- 問題：`items.filter(...).map((item, i) => ...)` 的 `i` 不是儲存陣列的索引，用它組路徑
  會寫錯列。
- 處理：不用 map 的索引，只標列的 `id`；編輯器用 `rebaseSelectedRowPath` 同一套方式由 id
  找出儲存陣列中的真正索引。沒有 id 的列維持暫停。

### 15. 列內的巢狀列表

- 目前的內容模型不允許列內再有陣列（與 Sanity 相同的理由：編輯者分不清自己在哪一層）。
- 支援方式要先擴充 schema（例如在列內允許一層物件包陣列），再沿用相同的 id 與路徑規則。
  在那之前，點擊能定位到元素並說明原因，內容在 Code 模式編輯。

### 16. state／hook 推導的值

- 值只在執行期存在，靜態分析無法證明來源。可以做的是可靠定位（透過列的 id 與元素位置），
  讓 Inspector 顯示該列宣告的所有欄位供編輯；畫布不 inline 編輯這個元素。

## 驗收方式

每支援一項，都要同時有：

- 真實 React 的 live 測試（`src/lib/storefront/editor/preview-row-component.live.test.tsx`）：
  路徑、點擊、還原；
- 對應的「無法確認」測試：同一寫法的變形必須暫停並回報原因，不落到頂層欄位；
- 反向（mutation）檢查：拔掉新邏輯後，上述測試必須變紅。
