# Morph Code-Backed Theme 架構審閱與下一步建議

## 目前確認到的實際狀態

這次重新檢查 GitHub `main` 後，可以確認「第一、第二階段」已經真的進入程式碼，而不只是規劃文件。

目前已完成的項目：

| 項目 | 現況 | 評價 |
| --- | --- | --- |
| `storefront_theme_files` | ✅ 已建立 | 正確 |
| Theme 與 Morph Core 分離 | ✅ 已開始 | 正確 |
| Starter Theme files | ✅ 已建立 | 正確 |
| `Hero.tsx / Header.tsx / Footer.tsx / index.tsx` | ✅ | 正確 |
| `morph.theme.json` | ✅ | 很好 |
| Monaco | ✅ 已加入 | 正確 |
| File Explorer | ✅ | 正確 |
| Multi-tab / dirty state | ✅ | 正確 |
| Ctrl/Cmd+S | ✅ | 正確 |
| Design / Code 切換 | ✅ | 正確 |
| Theme file CRUD API | ✅ | 正確 |
| Code → 真實 Preview | ❌ | 尚未完成 |
| Design → 修改 source AST | ❌ | 第三階段 |
| Source revision / rollback | ❌ | 現在就該補 |
| Compile / Build | ❌ | 第四階段 |
| R2 build artifact | ❌ | 第四階段 |
| Atomic publish | ❌ | 第四階段 |

目前架構方向沒有走歪，Morph 已經開始從：

```text
JSON Page Builder
```

往：

```text
Code-backed Theme Platform
```

演進。

---

## 最重要的現況：Code Editor 與 Design Preview 還沒有真正合流

目前 Code Editor 的資料流是：

```text
Code Editor
    ↓
storefront_theme_files
    ↓
Hero.tsx
```

但目前 Visual Preview 仍然是：

```text
Visual Preview
    ↓
StorefrontPageDocument
    ↓
StorefrontDocumentRenderer
    ↓
舊的 StorefrontHero
```

也就是說，兩邊目前仍然是兩條分離的 rendering path。

例如在 Code Editor 裡把：

```tsx
className="text-[64px]"
```

改成：

```tsx
className="text-[120px] text-red-500"
```

按下 Save 後，雖然 preview iframe 可能 reload，但目前 Canvas 並不是由這份 `Hero.tsx` 真正渲染，因此畫面不會真正因為這份 source code 而變成 120px / 紅色。

這就是第三階段 **Code as SSOT（Single Source of Truth）** 真正需要解決的事情。

---

## 目前整體完成度

```text
① Theme Virtual Workspace
█████████░  90%

② Design | Code Editor
█████████░  90%

③ Code as SSOT
░░░░░░░░░░   0%

④ Build / Publish Runtime
░░░░░░░░░░   0%
```

第一、二階段已經不是假的 UI，而是真正的 Theme IDE foundation。

---

# 現在最好先修的問題

## 1. Theme Source 還沒有 Revision

目前 `saveFile()` 的行為基本上是：

```text
Hero.tsx
↓
UPDATE storefront_theme_files
↓
原內容直接被覆蓋
```

也就是目前 source file 是 mutable 的。

這跟原本 `StorefrontPageDocument` 已經具有：

```text
draftRevisionId
publishedRevisionId
immutable revisions
```

的設計不一致。

如果 Theme source 沒有 revision，之後以下功能會很難做：

```text
AI 改壞
Undo
Version History
Rollback
Publish #58
還原 Publish #57
Compare
```

### 建議現在就補 Source Revision

概念可以是：

```text
storefront_theme_source_revisions
────────────────────────────
id
themeId
version
createdBy
createdAt
```

以及：

```text
storefront_theme_file_revisions
────────────────────────────
revisionId
path
content
mimeType
```

也可以進一步使用 manifest + content hash。

重點是：

> 不要等第四階段 Publish 才開始做 revision。

因為第三階段 Code as SSOT 本身就應該建立在 revision model 上。

---

## 2. `listFiles()` 自動 seed 有隱藏問題

目前邏輯類似：

```ts
if (existing.length === 0) {
  // STARTER_THEME_FILES
}
```

這會產生一個問題。

假設客戶真的把 Theme workspace 裡的檔案全部刪除：

```text
0 files
```

下次重新開 Editor 時，Morph 會再次判斷：

```text
existing.length === 0
```

並重新塞回：

```text
Hero.tsx
Header.tsx
Footer.tsx
index.tsx
...
```

這表示：

> Empty workspace 現在無法存在。

### 建議

不要讓 `listFiles()` 同時負責初始化。

應該改成：

```text
createTheme()
↓
initializeThemeWorkspace()
```

或者在 Theme 上保留：

```text
workspaceInitializedAt
```

初始化只做一次。

`listFiles()` 應該維持純讀取行為。

---

## 3. Design 模式目前也可能觸發 Theme Files 初始化

現在 `VisualEditorShell` 裡直接執行 Theme Files query。

也就是客戶只是打開：

```text
Design
```

即使沒有切換到 Code，也可能發生：

```text
useQuery
↓
listFiles
↓
沒有 files
↓
自動 seed
```

### 建議

可以先改成：

```ts
enabled: editorMode === "code"
```

或者明確把 workspace initialization 移到 Theme 建立流程。

這會讓 Non-breaking migration 更乾淨。

---

## 4. Theme File Path Validation 太寬鬆

目前 path validation 基本上只有：

```ts
path: z.string().min(1)
```

但未來這些 path 很可能會被 materialize 到：

```text
Sandbox filesystem
```

或：

```text
Compiler Virtual FS
```

因此現在就應該防止：

```text
../../../something
/absolute/path
src/../../...
```

### 建議至少做

```text
normalize path
禁止 ..
禁止 absolute path
禁止 NUL (\0)
限制 path 長度
限制可接受副檔名或 root directory
```

不要等 Sandbox 接上後才補安全模型。

---

## 5. `storefrontId + themeId` Ownership 要再鎖緊

目前 Theme file 同時存：

```text
storefrontId
themeId
path
```

但其實：

```text
themeId
↓
storefrontThemes
↓
storefrontId
```

已經能知道這個 Theme 屬於哪個 Storefront。

因此 server 收到：

```json
{
  "storefrontId": "A",
  "themeId": "B"
}
```

時，應該確保：

> Theme B 確實屬於 Storefront A。

否則資料模型可能出現不一致關係。

### 更乾淨的做法

Theme file 甚至可以只保存：

```text
themeId
path
```

Storefront ownership 一律透過 Theme relation 驗證。

---

## 6. Source 暫時放 D1 是可以接受的

目前 source file 內容直接放：

```ts
content: text("content").notNull()
```

也就是純文字 source 目前全部在 D1。

第一版其實沒有必要急著搬到 R2。

例如：

```text
Hero.tsx      5 KB
Header.tsx    3 KB
global.css   10 KB
```

這類資料放 D1 反而方便 CRUD、transaction、revision 與查詢。

### 建議分工

```text
D1
→ source code
→ metadata
→ revision
→ manifest

R2
→ images
→ fonts
→ large assets
→ build output
→ source snapshot archive（未來需要時）
```

第四階段再讓 R2 真正成為 build artifact storage。

---

## 7. Starter Theme 還不是完整可 Build 專案，但這不一定是問題

目前已經有：

```text
package.json
morph.theme.json
src/
  components/
  pages/
  styles/
```

而：

```json
{
  "entry": "src/pages/index.tsx",
  "components": [...]
}
```

這種 `morph.theme.json` manifest 設計是好的。

之後 Morph Compiler 可以直接讀它。

但目前 Theme workspace 還缺少典型完整 Vite App 的：

```text
vite.config
build script
main.tsx
index.html
```

而且 Theme `global.css` 使用：

```css
@import "tailwindcss";
```

Theme 自己的 virtual `package.json` 卻未必有完整 Tailwind build dependency。

### 這不一定要修成「每個 Theme 都是一個完整 Vite repo」

更推薦：

```text
Theme Source
      ↓
Morph Theme Compiler
      ↓
Platform 提供：
React runtime
Tailwind compiler
Vite/build infrastructure
```

Theme 自己的 `package.json` 未來可以只記錄額外依賴，例如：

```json
{
  "dependencies": {
    "gsap": "...",
    "three": "..."
  }
}
```

Morph 平台則提供固定 React/Tailwind/runtime。

這會比讓每個 Theme 各自維護完整 build stack 更容易控制版本。

---

# Code Mode 的 UX 風險

目前大致是：

```tsx
editorMode === "code"
  ? <EditorCodeWorkspace />
  : <DesignEditor />
```

這表示切換模式時，Code Workspace 會 mount / unmount。

而目前這些：

```text
fileContents
dirtyFiles
openTabs
```

都在 `EditorCodeWorkspace` local state。

因此：

```text
Hero.tsx
● unsaved
↓
切 Design
↓
Code Workspace unmount
```

再切回來時，未儲存內容可能消失。

### 建議至少加入

```text
有 Dirty File
↓
切 Design
↓
Save / Discard / Cancel
```

或者把 editor buffer 移到：

```text
Zustand
或
VisualEditorShell parent state
```

確保 Code / Design 切換不會丟失未儲存內容。

---

# 建議新增 Phase 2.5 — Source Integrity

不要現在直接衝完整第三階段。

先補：

```text
Theme source revisions
Theme ownership validation
Path sanitization
Workspace initialization
Dirty-buffer protection
Database migration
```

其中 Database migration 特別重要。

現在已經改了 Drizzle schema：

```text
storefront_theme_files
```

但如果還沒有對應 migration，就應該先：

```bash
pnpm db:generate
```

產生真正的：

```sql
CREATE TABLE storefront_theme_files ...
```

確保未來部署到客戶 Cloudflare D1 時能正常 migration。

---

# Phase 3 最適合先做一個 Vertical Slice

不要一次把所有 CSS、所有 component、所有 AST 編輯全部做完。

先只選：

```text
Hero heading
```

把整條鏈打通：

```text
① Canvas 點 Hero heading
        ↓
② Node Identity
        ↓
③ Jump to Code
        ↓
④ 正確開 Hero.tsx 並定位 JSX
        ↓
⑤ Visual Editor 修改 font-size
        ↓
⑥ AST 精準修改 Hero.tsx
        ↓
⑦ Compiler / Preview 更新
        ↓
⑧ Canvas 立即看到結果
        ↓
⑨ Code 手動修改 font-size
        ↓
⑩ Design Inspector 能重新讀回最新值
```

這條閉環成立後，Morph 才算真正跨進：

```text
Code as SSOT
```

而不是只有：

```text
CMS + Monaco Editor
```

---

# 第三階段的最終架構目標

最終應該變成：

```text
                Theme Source
              React + Tailwind
                    │
              Source of Truth
                    │
        ┌───────────┴───────────┐
        │                       │
   Design Editor           Code Editor
        │                       │
        └───────────┬───────────┘
                    │
                  Preview
```

Presentation 不應再同時存在兩套真相來源：

```text
JSON styles
+
React/Tailwind
```

應該明確分工：

```text
CMS JSON
= Content / Data / Configuration

React + Tailwind / CSS
= Presentation / Layout / Interaction
```

---

# 結論

目前方向可以維持，不需要推翻。

現在 Morph 已經正確建立：

```text
Morph Core
≠
Theme Source
```

以及：

```text
Theme
↓
Virtual Files
```

並在同一個 Editor 裡建立：

```text
Design | Code
```

也已經有：

```text
morph.theme.json
```

作為 Theme manifest 的雛形。

目前架構方向約可評為：

```text
9 / 10
```

主要缺少的不是方向，而是：

```text
Source revision
真正的 source-driven preview
Code as SSOT
Compiler
Build pipeline
Atomic publish
```

下一步建議：

```text
Phase 2.5
Source Integrity

↓

Phase 3
Hero Heading Vertical Slice

↓

Code as SSOT 全面擴充

↓

Phase 4
Build → R2 → Edge Router → Atomic Publish
```

只要 Hero Heading 那條完整雙向閉環真正跑通，Morph 就會正式從「有 Code Editor 的 CMS」跨進真正的 **Code-backed Website Builder**。
