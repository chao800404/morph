# Morph Git 交付與推送規則

## 本檔鐵則

1. **目前 `main` 受 PR 與 branch protection 保護。** 未經明確授權，不得直接執行 `git push origin main`，也不得為了繞過拒絕而修改或停用 branch protection。
2. **正常交付使用 feature branch + `pnpm ship`。** `pnpm ship` 負責 push branch、建立 PR、等待 CI、merge、刪除已合併分支並更新 `main`；不要手動拆成一半，造成遠端狀態不一致。多個 session 並行時，改用下方「本機驗證後 `main` 已前進」的草稿推送流程，合併由協調 session 依使用者授權執行；`pnpm ship` 的自動合併只在使用者明確要求時使用。
3. **提交前必須有實際驗證結果。** 正常程式修改至少執行 `pnpm typecheck`、`pnpm test`、`pnpm build`；未執行或環境阻擋時必須明確標為未驗證，不得推測通過。
4. **只提交本次範圍。** 使用 `git add -- <明確檔案>`，不得用 `git add .` 或 `git add -A` 把 WIP、generated files、暫存檔或其他 worktree 內容帶入 commit。
5. **任何非成功 CI 狀態都不得合併。** `FAILURE`、`CANCELLED`、`TIMED_OUT`、`STARTUP_FAILURE`、`ACTION_REQUIRED`、空的 check rollup 或尚未完成的 required check 都不能被當成通過。
6. **不得使用破壞性 Git 指令整理流程。** 不得用 `git reset --hard`、`git checkout --`、force push 或刪除不明確目標來「清理」阻塞；先保留現況並說明衝突。
7. **合併完成就收尾清理，但不能只憑 `prunable` 刪除。** 依下方「合併後收尾清理」逐項確認後再刪遠端分支、本機分支與 worktree。以 Windows 路徑登記的 worktree（`//wsl$/…`、`//wsl.localhost/…`、`C:/…`）在 WSL 的 Git 看來是 `prunable`，但目錄可能仍在、甚至有 session 正在使用；不得因此執行 `git worktree prune`。
8. **本機驗證後 `main` 前進，不擋草稿推送，但合併前要重新核對。** 草稿 PR 可以推送已驗證的版本；PR 要分開寫本機驗證的 base 與 CI 實際測的 head、base、merge checkout，不得預先宣稱 CI 測到最新 `main`。詳見下方「本機驗證後 `main` 已前進」。

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

`pnpm ship` 一律等待所有預期的 CI check（清單在 `scripts/ci-required-checks.mjs`），每一個都必須出現且結論為 `SUCCESS`；任何失敗、略過或始終未出現的 check 都拒絕合併。沒有縮短等待的開關：`MORPH_SHIP_REQUIRED_ONLY` 已移除，只要設定了它（任何值），`pnpm ship` 會在推送前直接失敗並要求取消設定。

## 本機驗證後 `main` 已前進

本機完整驗證要十幾分鐘，這段時間其他 PR 合進 `main` 很常見。若每次都要重新整合、重跑完整驗證才能推送，草稿會一直推不出去；而 PR 的 CI 本來就會測 PR 與 base 的合併結果。

**推送草稿 PR。** `main` 前進時，不必先重新整合、重跑本機完整驗證，但推送前要確認：

- worktree 乾淨，沒有未提交或 staged 的內容；
- 提交範圍就是本次範圍：`git log origin/main..HEAD` 只有預期的提交，`git diff --name-only <本機驗證的 base> HEAD` 只有預期的檔案；若推送前已把 `main` 合併進分支，改用 `git diff --name-only origin/main...HEAD` 確認範圍；
- 要推的就是驗證過的那個提交：commit SHA 與 tree 相同（以匯出目錄驗證時，連 `git archive` 的雜湊一起比）；
- 一般推送：遠端分支不存在或可以 fast-forward，不得 force push。

`main` 新進來的變更若和本次修改有衝突，先停下回報，不推送。

**PR 裡分開寫兩組證據。**

- 本機驗證：凍結的 SHA、驗證時的 base、實際跑了哪些檢查、當時的環境狀況（例如機器是否忙碌）。
- CI：從實際的 run 讀出 head、base、各 job checkout 的 merge ref（`refs/pull/<n>/merge` 及其兩個 parent）與每個 job 的結果。CI 跑完前不得寫成「CI 已測過最新 `main`」；CI 跑完後 `main` 再前進，那次 run 就不涵蓋新的 `main`。

**合併前重新核對。** 合併時再看一次當下的 `main`，以及 CI 是否在包含它的合併結果上全部通過。不是的話先回報，由使用者決定要重新整合、重跑 CI，或照現況處理；舊的 run 不能代替。合併的時機與先後依使用者安排：使用者宣告暫停合併時不合併，也不為了準備合併而轉 ready，準備好就回報。合併只在負責協調的 session 進行，且每個 PR 都要使用者逐一授權；其他 session 或 subagent 只推送草稿並回報，不合併、不轉 ready。

## 合併後收尾清理

每次合併都要收尾，不讓分支與 worktree 累積。固定順序：

1. 合併。
2. 確認 `main` 包含提交：`git fetch origin` 後 `git merge-base --is-ancestor <branch-tip> origin/main` 成立。
3. 保存需要的證據（驗證 log、報告、診斷結果）到 worktree 以外的位置。
4. 確認沒有依賴與未存工作（各類條件如下）。
5. 清理。

三類目標分開判斷；任何一項無法確認已無人使用，就不清理：

- **遠端分支**：PR 已合併，且沒有其他開著的 PR 以它為 head 或 base、沒有其他工作依賴它，就可以 `git push origin --delete <branch>`。已合併的提交仍保留在 `main` 與 PR 紀錄。
- **本機分支**：tip 已包含在 `origin/main`，且沒有 worktree checkout 它、確認已無人以它為工作分支，才以 `git branch -d` 刪除；不用 `-D`。
- **worktree**：以下全部確認後才 `git worktree remove`：
  - `git status --porcelain` 為空（沒有追蹤中的修改，也沒有 untracked 檔）。
  - `git status --porcelain --ignored` 列出的 ignored 資料不需保留。特別確認：`.env*`、`.dev.vars*`（本機憑證）、`.wrangler`（本機 D1／R2 狀態）、`e2e` 底下的登入狀態、`.morph-*`、`sandbox`。
  - 不是診斷用 worktree，也不含尚未保存的診斷證據。
  - 沒有程序的工作目錄在其中，且確認已無人以它為工作目錄。

刪除順序與停止條件：

1. 刪除任何一項之前，先 `git fetch origin`，確認 tip 已包含在 `origin/main`（`git merge-base --is-ancestor <tip> origin/main`）；不成立就停止。
2. 先移除 worktree，再刪本機分支，最後才刪遠端分支。`git branch -d` 可能因 upstream 仍在而通過、遠端分支刪除並 prune 後卻拒絕（本機 checkout 的 `HEAD` 不一定是最新 `main`），所以本機分支要在遠端分支之前刪。
3. `git branch -d` 拒絕時就停止並回報，不改用 `-D`。

判斷 worktree 是否存在時，先把登記路徑換成實際路徑（`//wsl$/<distro>/…`、`//wsl.localhost/<distro>/…` → `/…`；`C:/…` → `/mnt/c/…`）再檢查，不能只看 `git worktree list` 的 `prunable`。

`main` checkout、診斷 worktree、其他 session 的工作與有未存工作的項目一律保留並回報，不在收尾時處理。尚未合併的歷史累積項目須逐項取得使用者同意後才清理。

## 特殊情況

- 如果誤在 `main` commit，不要 reset 或丟棄 commit；先以目前 HEAD 建立 feature branch，再依標準流程交付，並確認 `main` 與 `origin/main` 的差異後再整理。
- 如果 `pnpm ship` 因 CI failure、timeout、未登入 GitHub CLI、merge conflict 或權限問題停止，保留 branch 與 PR，回報實際錯誤；不得重試到繞過 guard 或直接推 `main`。
- 如果使用者真的要改成直推流程，必須先明確授權修改 GitHub branch protection。即使改成允許直推，也要保留禁止 force push、禁止刪除 `main`，並在 push 前執行本檔要求的本地驗證。
- PR merge 完成後確認 `git status -sb`、`git log -1 --oneline` 與遠端同步狀態；不要把未追蹤暫存檔當成提交內容。
