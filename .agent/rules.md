# 專案最高開發與效能規範 (Project Architecture & Performance Rules)

## 📌 最高核心原則 (Core Directive)
> **「除非不得已，否則嚴禁使用會造成 React 組件重新渲染 (Re-render) 的方式來實作功能與視覺互動。」**

---

## 1. 拖拉、動畫與 UI 視覺互動 (UI & Interaction Performance)
- **零重新渲染 (Zero Re-render Dragging/Resizing)**：
  - 拖拉分界線、視窗縮放、動態位置計算等視覺變動，**嚴禁使用 `useState` 或頻繁 `setState` 觸發重繪**。
  - 必須統一使用 `useRef` 紀錄 DOM 節點與座標，並透過 `setPointerCapture` + `requestAnimationFrame` 直接修改 DOM `style.height` / `style.transform` / CSS Variables。
  - 拖拉過程中使用 `pointer-events-none` 暫時封鎖 Hover repaint，保護 GPU/CPU 渲染效能。
- **CSS 驅動微互動與動態效果**：
  - 展開/收合動畫、Hover 反饋、提示方塊等，優先以 Vanilla CSS Class、`classList.add()` / `classList.toggle()`、`data-*` 屬性或 CSS Transition/Animation 實現，禁止為了狀態切換重新觸發元件渲染。

---

## 2. 狀態管理與數據流規範 (State Management & Data Flow)
- **URL 驅動單一真實來源 (URL Search Params as Single Source of Truth)**：
  - 頁面分頁、排序 (`sortBy`, `sortOrder`)、關鍵字搜尋 (`q`)、資料夾切換 (`folderId`) 等全域與瀏覽狀態，**必須 100% 透過 URL 驅動**。
  - 使用 TanStack Router 的 `useSearch` 與 `navigate({ search })` 進行狀態轉換，嚴禁複製一份至組件內部 `useState` 造成雙重狀態同步問題。
- **Zustand 原子化訂閱 (Selector & Shallow Subscription)**：
  - 使用 Zustand 全域 Store 時，**嚴禁全量訂閱 Store 對象**（例：`const store = useAssetsStore()`）。
  - 必須使用微粒化原子選擇器 (Atomic Selectors) 搭配 `useShallow` 進行精準訂閱（例：`useAssetsStore(useShallow(state => state.selectedItems))`），確保只有真正受影響的微小組件重繪。

---

## 3. 資料請求與表格優化 (Data Fetching & Table Rendering)
- **原地保留數據 (Keep Previous Data)**：
  - 在列表、表格進行分頁、排序或搜尋切換時，必須配置 `placeholderData: keepPreviousData`。
  - 絕不允許切換參數時觸發 `fallback={null}` 或組件解構卸載 (Unmount) 造成畫面瞬間閃爍或空白。
- **Uncontrolled 表單與輸入模式**：
  - 彈窗、搜尋框與表單輸入優先使用 Uncontrolled Component (`useRef` 或原生 `FormData`) 擷取數值，避免使用者每打一個字即觸發整個 Form/Card 組件重新渲染。

---

## 4. 程式碼審查與開發自我檢核 (Developer Audit Checklist)
在撰寫任何新功能或修改現有程式碼前，必須進行以下三問：
1. **「這個視覺/位置/樣式變更，能直接操作 DOM `style` 或 CSS class 完成嗎？」** ➔ 若能，直接使用 `ref`，不加 `state`。
2. **「這個狀態能直接寫入 URL 或全域 Store 的微粒選擇器嗎？」** ➔ 若能，不建立組件內部 `useState`。
3. **「這個改動會導致幾百個子組件 (例如 90+ 個資料夾卡片) 一起被重新繪製嗎？」** ➔ 若會，必須重構為局部變更或 `memo` + 零重繪 DOM 模式。
