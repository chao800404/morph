# 本機資料夾與 Theme 程式碼雙向同步（原型）

狀態：第 1 階段原型，選用。正式建置、發布、rollback 都不經過它，也不受它影響。

Morph 以程式碼為主體：Code 模式、Design 模式、本機 IDE 是同一份 Theme 原始碼的三個編輯入口。這個工具讓本機資料夾和 Theme 的 Code 工作區保持一致，兩個方向都同步：

- 本機改檔案 → 幾秒內進到 Morph 的工作區（Code 模式、Live Preview 讀的就是它）。
- Morph 裡改檔案（Code 模式，或 Design 改寫原始碼）→ 寫回本機檔案，本機 dev server 熱更新。
- 兩邊同時改同一個檔案 → 標成衝突，兩份都保留，由你決定。

Morph 的工作區仍是唯一的存放處；本機是它的工作副本。

## 使用

1. 在編輯器的 Code 模式開 Command Palette（Ctrl+Shift+P），選 **Theme: Link Local Folder**，按 **Create token**。
2. 在 Morph repo 執行對話框給的指令，貼上 token：

   ```bash
   pnpm morph:sync link --dir ../my-theme --origin http://localhost:3000
   ```

3. 開始同步：

   ```bash
   pnpm morph:sync start --dir ../my-theme
   ```

第一次執行（或工具關閉期間任一邊有變更）會先列出要上傳、下載、刪除與衝突的檔案，確認後才動作。非互動環境加 `--yes`，否則不套用。

`--yes` 不包含大量刪除：一次刪很多檔案、或整個資料夾被清空時，工具一律停下來。要在終端機互動確認，或明確加 `--allow-mass-delete`。

其他指令：

| 指令 | 作用 |
| --- | --- |
| `status` | 只列出現在會做什麼，不套用 |
| `resolve <path> --keep local\|remote` | 決定衝突檔要保留哪一邊；下次同步時套用 |
| `logout` | 在伺服器撤銷 token，並從本機移除 |

## 規則

**三方比對。** 每個檔案拿三份比：本機現在、Morph 現在、上次兩邊一致時的基準（存在 `.morph/sync-state.json`）。只有一邊變了就複製到另一邊；兩邊都變了且內容不同就是衝突。

**衝突不覆蓋。** 本機檔案不動，Morph 的版本寫在旁邊的 `<檔名>.morph-remote`；Morph 那邊也不動。用 `resolve` 選一邊後，下次同步才把選定的一邊蓋過去，而且仍帶版本前提。

**寫入一律帶 OCC。** 上傳帶工作區的 `sourceGeneration` 與每個檔案的 id/版本；期間 Morph 有人改過，整批拒絕、什麼都不寫，工具重新讀取再規劃。

**換行與 BOM 不算變更。** 比對前統一成 LF、去掉 BOM。上傳的是 LF；寫回本機時保留該檔原本的換行。

**刪除。** 一邊刪、另一邊沒改，就同步刪除。本機被刪的檔案移到 `.morph/trash/`，Morph 的刪除會留 revision。整個資料夾被清空、或一次刪很多檔案時，工具停下來要你確認。

**不同步的路徑。**

- 只存在本機的：`node_modules/`、`.git/`、`dist/`、`.wrangler/`、`.morph/` 等、`.env*`、`.dev.vars*`。
- 平台持有的檔案（`__entry.tsx` 等），以及每次 dev 啟動都會重新產生的 `src/routeTree.gen.ts`。
- manifest 時代的 `morph.theme.json`（只能透過伺服器端遷移修改）。
- `public/` 與其他二進位檔：原型還不同步，工具會列出略過了哪些。
- `.morphignore` 列出的路徑（每行一個：完整路徑、`資料夾/`、`*.副檔名`）。

伺服器端用同一套規則拒絕寫入，不信任工具送來的內容。

## 授權

- token 只能讀寫**這一個 Theme 的原始碼檔案**：不能發布、不能 rollback、碰不到其他商店資料。
- 綁定發出它的管理員；每次請求都重新驗證 token、Theme 與該管理員的角色。撤銷、刪除 Theme、移除管理員權限，下一個請求就生效。
- Morph 只存 token 的 SHA-256。
- 本機存在 `~/.config/morph/sync-credentials.json`（權限 600），不放進專案資料夾。
- 同一位管理員對同一個 Theme 只有一個有效 token；重新產生會撤銷舊的。

## 原型的限制

- **token 一次 30 天，沒有 refresh。** 設計是短效 access token 加 refresh token、瀏覽器登入或 device code；目前是在編輯器產生後貼上。
- **不同步二進位檔**（`public/`、`src/` 下的圖片）。
- **在本機改 route 檔名，等於刪除再新增**，不會像編輯器的改名那樣把該 route 的內容一起搬過去。
- **編輯器不會即時顯示本機的修改。** 存進工作區了，但已開著的 Code 分頁要重新開啟才看得到。Code 模式內的衝突標示是第 2 階段。
- **沒有請求速率限制。** 有單次批次與檔案大小上限（200 個檔案、單檔 1 MiB）。
- 要從 Morph repo 執行，還不是獨立套件。
- 本機誤刪後，沒有「從 Morph 還原」的指令；目前要刪掉 `.morph/sync-state.json` 再重新 `link`，缺少的檔案才會當成新檔下載。
- 從 Morph 編輯器看到的過時檔案再存檔，會被 OCC 擋下並提示；提示文字說的是「另一個分頁」，還沒有說明是本機同步改的。

## 輪詢與費用

本機變更由檔案監聽觸發，即時上傳。Morph 的變更靠輪詢：只問工作區的 `sourceGeneration`，有變才讀清單與變動的檔案。間隔 3 秒，閒置時逐步拉長到 10 秒，有變更就回到 3 秒，工具關閉就停。上限原本是 30 秒，手動測試時 Design 的修改等了約 40 秒才下來，所以改成 10 秒。費用估算見設計文件；實際用量尚未量測。

## 手動驗收（2026-10-09，本機 dev server 與測試資料庫）

| 項目 | 結果 |
| --- | --- |
| 編輯器產生 token、CLI 連結、第一次下載 30 個檔案 | 通過 |
| Design 改 hero 的 Padding 為 20px → 原始碼寫成 `lg:p-[20px]` → 本機檔案更新 | 通過（當時閒置上限 30 秒，約 40 秒才下來） |
| 本機改檔 → 4 秒內進到 Morph 工作區 | 通過 |
| 開著的編輯器在本機改檔後再存同一檔 → OCC 擋下、提示、雙方內容都在 | 通過 |
| 從 Windows 端經 `\\wsl$` 改檔 → 偵測到並上傳 | 通過 |
| Prettier 連續格式化兩次 → 只上傳一次，45 秒內無來回 | 通過 |
| 本機一次刪 25 個檔案（帶 `--yes`）→ 停下、Morph 檔案數不變 | 通過（修正前 `--yes` 會放行，已修） |
| 開著的編輯器即時顯示本機修改 | 不會，需重新開啟（已知限制） |

## 驗證

- `e2e/local-code-sync.spec.ts`：真實 dev server 與 D1，編輯器產生 token，真正的 CLI 連結暫存資料夾，驗證兩個方向、CRLF 不回傳、平台檔不上傳、衝突保留兩份與 `resolve`、logout 後 token 失效。
- 單元與整合測試在 `src/lib/storefront/local-dev/theme-sync/`、`src/server/storefront/theme-sync-api.test.ts`、`src/lib/storefront/service/theme-sync/`。
