# Morph Git 交付與推送規則

## 本檔鐵則

1. **目前 `main` 受 PR 與 branch protection 保護。** 未經明確授權，不得直接執行 `git push origin main`，也不得為了繞過拒絕而修改或停用 branch protection。
2. **正常交付使用 feature branch + `pnpm ship`。** `pnpm ship` 負責 push branch、建立 PR、等待 CI、merge、刪除已合併分支並更新 `main`；不要手動拆成一半，造成遠端狀態不一致。
3. **提交前必須有實際驗證結果。** 正常程式修改至少執行 `pnpm typecheck`、`pnpm test`、`pnpm build`；未執行或環境阻擋時必須明確標為未驗證，不得推測通過。
4. **只提交本次範圍。** 使用 `git add -- <明確檔案>`，不得用 `git add .` 或 `git add -A` 把 WIP、generated files、暫存檔或其他 worktree 內容帶入 commit。
5. **任何非成功 CI 狀態都不得合併。** `FAILURE`、`CANCELLED`、`TIMED_OUT`、`STARTUP_FAILURE`、`ACTION_REQUIRED`、空的 check rollup 或尚未完成的 required check 都不能被當成通過。
6. **不得使用破壞性 Git 指令整理流程。** 不得用 `git reset --hard`、`git checkout --`、force push 或刪除不明確目標來「清理」阻塞；先保留現況並說明衝突。
7. **合併完成就收尾清理，但不能只憑 `prunable` 刪除。** 依下方「合併後收尾清理」逐項確認後再刪遠端分支、本機分支與 worktree。以 Windows 路徑登記的 worktree（`//wsl$/…`、`//wsl.localhost/…`、`C:/…`）在 WSL 的 Git 看來是 `prunable`，但目錄可能仍在、甚至有 session 正在使用；不得因此執行 `git worktree prune`。

## 標準流程

1. 先確認 `git status -sb`、目前 branch、remote 與待提交範圍；不要在 `main` 上開始新的修改。
2. 從最新 `main` 建立分支：

   ```bash
   git switch main
   git pull --ff-only
   git switch -c fix/<short-description>
   ```

3. 只 stage 相關檔案並 commit：

   ```bash
   git add -- <file-1> <file-2>
   git commit -m "<clear change description>"
   ```

4. 執行完成條件：

   ```bash
   pnpm typecheck
   pnpm test
   pnpm build
   ```

5. 驗證成功後執行：

   ```bash
   pnpm ship
   ```

`pnpm ship` 預設等待所有 CI check。只有使用者明確要求縮短等待、且已理解其他 check 仍可能 pending 時，才可使用 `MORPH_SHIP_REQUIRED_ONLY=1 pnpm ship`；即使如此，已回報的任何失敗仍必須拒絕合併。

## 合併後收尾清理

每次合併都要收尾，不讓分支與 worktree 累積。固定順序：

1. 合併。
2. 確認 `main` 包含提交：`git fetch origin` 後 `git merge-base --is-ancestor <branch-tip> origin/main` 成立。
3. 保存需要的證據（驗證 log、報告、診斷結果）到 worktree 以外的位置。
4. 確認沒有依賴與未存工作（各類條件如下）。
5. 清理。

三類目標分開判斷：

- **遠端分支**：PR 已合併，且沒有其他開著的 PR 以它為 head 或 base、沒有其他工作依賴它，就可以 `git push origin --delete <branch>`。已合併的提交仍保留在 `main` 與 PR 紀錄。
- **本機分支**：tip 已包含在 `origin/main`，且沒有 worktree checkout 它、沒有執行中的 session 以它為工作分支，才以 `git branch -d` 刪除；不用 `-D`。
- **worktree**：以下全部確認後才 `git worktree remove`：
  - `git status --porcelain` 為空（沒有追蹤中的修改，也沒有 untracked 檔）。
  - `git status --porcelain --ignored` 列出的 ignored 資料不需保留。特別確認：`.env*`、`.dev.vars*`（本機憑證）、`.wrangler`（本機 D1／R2 狀態）、`e2e` 底下的登入狀態、`.morph-*`、`sandbox`。
  - 不是診斷用 worktree，也不含尚未保存的診斷證據。
  - 沒有程序的工作目錄在其中，也沒有 session 以它為工作目錄。

判斷 worktree 是否存在時，先把登記路徑換成實際路徑（`//wsl$/<distro>/…`、`//wsl.localhost/<distro>/…` → `/…`；`C:/…` → `/mnt/c/…`）再檢查，不能只看 `git worktree list` 的 `prunable`。

`main` checkout、診斷 worktree、其他 session 的工作與有未存工作的項目一律保留並回報，不在收尾時處理。尚未合併的歷史累積項目須逐項取得使用者同意後才清理。

## 特殊情況

- 如果誤在 `main` commit，不要 reset 或丟棄 commit；先以目前 HEAD 建立 feature branch，再依標準流程交付，並確認 `main` 與 `origin/main` 的差異後再整理。
- 如果 `pnpm ship` 因 CI failure、timeout、未登入 GitHub CLI、merge conflict 或權限問題停止，保留 branch 與 PR，回報實際錯誤；不得重試到繞過 guard 或直接推 `main`。
- 如果使用者真的要改成直推流程，必須先明確授權修改 GitHub branch protection。即使改成允許直推，也要保留禁止 force push、禁止刪除 `main`，並在 push 前執行本檔要求的本地驗證。
- PR merge 完成後確認 `git status -sb`、`git log -1 --oneline` 與遠端同步狀態；不要把未追蹤暫存檔當成提交內容。
