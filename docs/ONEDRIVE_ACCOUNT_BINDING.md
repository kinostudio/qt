# Google 帳號綁定 OneDrive

狀態：隔離 release 已完成移植及本機驗證，基底 kinostudio/main dd9a9c1，分支 codex/onedrive-google-binding-release。尚未正式上線，正式環境預設不啟用。既有 Google／D1／R2 同步及獨立 Microsoft SPA 登入保持不變。

## 目標與範圍

首次登入 Google 後，由使用者明確綁定 Microsoft 帳號並選擇目錄。之後在不同裝置登入同一 Google 帳號，可恢復 OneDrive 帳號與目錄；Microsoft 授權仍有效時，不需再次手動登入 Microsoft。

Google 仍只驗證 QT 使用者，不直接授予 Microsoft 權限。新增功能只用目前使用者的 Microsoft 委派授權存取其 OneDrive；不新增共用工作區、應用程式全租戶檔案權限或 Google Drive 功能。

## 期限：不能承諾永久免登入

- 綁定關係及預設目錄：保存到使用者解除綁定，沒有設定 24 小時到期。
- 現有 SPA 更新權杖：Microsoft 預設 24 小時；後續從該權杖取得的更新權杖不延長原始期限。
- 新的 Web／後端授權流程：一般更新權杖預設 90 天，使用時可取得新的更新權杖。90 天不是整個綁定關係的固定最長壽命，也不是保證至少可用 90 天；服務可能提前撤銷，條件式存取等政策也可能要求重登。
- 官方沒有為持續正常續期的綁定提供「一定能用到某日」的最長保證；不以假定的到期日顯示仍有效。
- 後端 Microsoft 用戶端密碼是另一個期限：官方限制最長 24 個月或更短，建議小於 12 個月，必須另外安排輪替。不能把這個期限當成使用者權杖期限。

官方來源（2026-11-18 核對）：

- https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens
- https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials

## 實作與驗收順序

1. 新增獨立綁定／一次性授權嘗試資料表，不更改專案、條款、印章、版本紀錄表。正式 migration 暫不執行。
2. 以已驗證的 Google 使用者工作區為唯一歸屬；PKCE + 一次性 state + 有效期限，瀏覽器只持有一次性授權碼及 verifier，不接收 Microsoft 存取／更新權杖。
3. Worker 用 AES-GCM 加密保存更新權杖，金鑰用 Worker Secret；加入工作區關聯驗證，避免把甲帳號密文移給乙帳號使用。
4. 受限的資料夾瀏覽、選擇、報價存檔 API；不提供任意 Graph URL 代理。伺服器保存 drive ID／folder ID，前端不得指定其他工作區或直接覆寫存檔目的地。
5. 跨請求租約保護更新權杖輪替；綁定／目錄版本核對保護排隊工作，登出及換帳號時停止舊工作。既有條款差異同步不因此觸發。
6. 登入／恢復綁定只讀取狀態，不上傳草稿。自動存檔需使用者在目前連線明確啟用；解除綁定只刪除應用內連線資訊，不刪 OneDrive 檔案。
7. 隔離測試：未登入、跨帳號、state 過期／重放／PKCE 錯誤、密文竄改、續期輪替／失效、租約、目錄／名稱限制、登入零上傳、手機／桌面及原有同步回歸。
8. 完成獨立程式審查後，才處理正式授權設定與隔離實際驗收；未通過不能宣稱已上線或真實 Microsoft 授權可用。

## 部署前需完成

- 既有 Microsoft 應用程式新增 **Web** 回呼 `https://qt.kinostudio.tw/onedrive-link.html`，保留原有 SPA 回呼；新回呼不可誤登錄成 SPA。
- 正式後端需要 `MICROSOFT_CLIENT_SECRET`、`ONEDRIVE_TOKEN_KEY`（隨機 32 bytes 的 base64url）兩項 Secret。不得放入 Git、備份檔、前端或一般 vars；建立憑證與授予持續存取需使用者於當下確認。
- 非機密 vars：`ONEDRIVE_REDIRECT_URI` 與 `ONEDRIVE_BINDING_ENABLED`。只有資料表、Web 回呼及 Secret 準備好，並完成驗收安排後才啟用。
- 先部署相容的 Worker／新增表，再發布前端；不要為這項功能順便套用尚未驗收的簽署 migration 或其他功能旗標。
- 來源開發分支包含未發布的簽署／Browser Run 額度功能；本隔離 release 明確排除其 imports、API、資產、旗標與 migrations 0008／0009，只移植 Google 綁定 OneDrive 及兩項資料夾 UX 修正。0010 僅提供檔案，未套用正式資料庫；禁止直接套用全部 migrations。
- 沿用現有 Free 方案與資源；不申請 Azure 付費方案，不擴大 Graph 檔案權限。費用仍受原有供應商額度約束，不承諾整個帳戶永遠零費用。

## 維護與恢復邊界

- Microsoft 用戶端密碼到期前需輪替；同一應用程式更換密碼不等於重新綁定每個使用者。應先更新 Worker Secret 並驗證，再移除過期憑證，不把密碼貼進聊天或文件。Microsoft 對正式環境更推薦憑證／同盟認證；本批先實作受保護的用戶端密碼路徑，正式啟用前需評估並接受此憑證管理風險。
- `ONEDRIVE_TOKEN_KEY` 不可當一般設定直接換值；既有更新權杖會因此無法解密。密碼輪替與加密金鑰輪替是不同工作，後者需獨立設計舊金鑰解密／重新加密或讓使用者重新授權，不可清空原始專案資料來處理。
- 綁定表刻意不納入條款／專案版本還原，也不納入瀏覽器完整本機備份；那些功能不能還原 Microsoft 憑證。使用者仍能以既有備份恢復報價內容，再重新綁定 OneDrive。
- 解除綁定只撤除 QT 保存的存取方式，不代表代替使用者在 Microsoft 全域撤銷所有應用程式授權。需要全域撤銷時應另外前往 Microsoft 帳號的應用程式權限管理。

## 審查與測試證據

2026-11-18 隔離 release 實測（不是來源開發分支結果）：

- `node --test tests/*.test.mjs`：39/39 通過，包含新後端綁定 18 項、Worker 路由隔離 3 項及 main 既有 18 項；不包含未發布簽署／Browser Run 額度測試。使用記憶體 SQLite 執行真實 SQL、Web Crypto 密文與狀態轉移；Microsoft 回應為隔離替身。
- `node tests/onedrive-binding-ui.cjs`：實際瀏覽器前端；驗證手機／桌面、PKCE 回呼、狀態不符拒絕、只用已驗證 Google 身分、登入零上傳、顯式自動儲存、目錄 revision、換帳號／過期回應隔離、Microsoft 失效不登出 Google、503 恢復及重試、同 revision 恢復不重新啟用已取消的排隊存檔。
- `node tests/onedrive-binding-e2e.cjs`：390×844 手機頁面串接真實 binding handler、SQLite 及模擬 Graph；選定上級目錄、自動建立子目錄、儲存真實報價 JSON 成功，原專案 sentinel 不變。不是正式 Microsoft OAuth 或真實 Graph 寫入驗收。
- `node tests/onedrive-runtime.cjs`：真正 workerd／臨時 D1；設定旗標、Google 工作區隔離、state、PKCE、解除綁定、舊專案 sentinel 通過，沒有呼叫 Microsoft。需先用最新 Worker dry-run 輸出到 `tmp/onedrive-worker-bundle`。
- `node tests/mobile-sync-mock.cjs`：原有手機差異面板、Snackbar、印章、序列化 OneDrive 模擬存檔及完整本機備份／還原回歸通過。編輯台建置包含獨立回呼頁，僅輸出公開 allowlist，沒有後端或備份。

審查找到並已修正：start／folders／save 回傳契約不一致；解除綁定與首次完成授權並行時的假成功；跨裝置改綁後的舊目錄選擇缺少 revision；選目錄暫時失敗導致 revision 遺失、後續儲存無反應；恢復同 revision 可能讓舊排隊工作復活。獨立重審後沒有剩餘 must-fix；結論只允許以預設關閉狀態交付程式，正式啟用需另外驗收。

未驗證／限制：真實 Microsoft Web OAuth、權杖長期續期、正式 Graph 條件 PUT 的執行效果與行動裝置實機。即使條件 PUT 生效，也不能偵測兩台裝置先後提交的語意上過期草稿；目前不是多人協作版本鎖，避免同時對同一報價啟用多裝置自動儲存。

本 release 批次未執行正式 Microsoft 登入、建立或複製 Secret、套用正式 migration、部署或寫入現有 D1／R2／OneDrive。使用者後續授權及父工作已完成的正式設定，以以下續作紀錄為準。

## 正式設定續作紀錄（2026-11-18）

- 使用者已明確同意新增 Web 回呼、建立後端憑證、保存到 Worker Secret 及首次綁定時取得 `offline_access`；保留原 Files.ReadWrite／SPA／D1／R2，不開通付費服務。
- 已從 GitHub 讀取最新 main：`dd9a9c1`。建立獨立本機工作樹 `C:\Users\Aaron\Documents\Codex\KINO Quota Release`，分支 `codex/onedrive-google-binding-release`，只準備這項功能的發布內容；原開發工作樹及其修改保留。
- 已唯讀確認 QT Worker 原本沒有 Secret，之後建立 **ONEDRIVE_TOKEN_KEY**。32 bytes 金鑰只在記憶體產生並透過標準輸入交給官方 CLI，未列印、未寫檔／Git。建立後只核對名稱存在，不讀取值；正式 `/health` 仍為 `ok:true`，原 OneDrive SPA 登入仍啟用。尚未部署新綁定程式，正式設定 API 尚未提供 `oneDriveBindingEnabled` 欄位。
- 尚未建立或核對 **MICROSOFT_CLIENT_SECRET**，也未確認 Web 回呼已新增。原生 Windows `computer-use` 技能禁止代為變更安全／權限設定，且本輪 Edge 畫面擷取連續逾時，已停止 UI 重試；未繞過限制或從瀏覽器提取登入憑證。
- 已請求使用者一次：在 Entra 的 KINO Quotation OneDrive（Client ID `1716f4a3-f086-4c1b-b6e0-43ae9561b340`）新增 Web 回呼 `https://qt.kinostudio.tw/onedrive-link.html`，保留原 SPA；建立描述 `KINO QT OneDrive Backend` 的用戶端密碼（建議6個月並記錄到期日），把其 **值** 直接存到 QT Worker 的 **Secret** `MICROSOFT_CLIENT_SECRET`，不要貼到對話、不要誤填秘密識別碼、不要放進一般文字變數。
- 等待使用者回覆「已設定」；期間不重複建立金鑰、不反覆嘗試安全設定。尚未啟用 `ONEDRIVE_BINDING_ENABLED`、套用正式 migration、變更 D1／R2／OneDrive 資料或執行真實授權／存檔驗收。

## 隔離 release 發布紀錄（2026-11-18）

- 路徑：`C:/Users/Aaron/Documents/Codex/KINO Quota Release`；移植基準 `dd9a9c1`，受測程式提交 `c9c99d6` 已推送 main 與 `codex/onedrive-google-binding-release`。移植時未修改原工作區程式，保留原開發分支的未提交修改。
- `cloud-sync/wrangler.jsonc` 僅增加公開 `ONEDRIVE_REDIRECT_URI` 與字串 `ONEDRIVE_BINDING_ENABLED: "false"`；原有 qt／GitHub Pages／localhost origins、D1／R2、PDF 設定保留。沒有 Secret 值或新依賴。
- 兩項既有 SPA UX 修正：尚未選位置時「立即儲存」開啟資料夾選擇；勾選自建子資料夾時以既選資料夾作上級目錄，之後切換不把已建子資料夾誤當上級。
- 上述 39 項 unit、OneDrive UI、手機真實 handler E2E、既有手機 mock、真正 workerd／暫存 D1 全部通過。`wrangler deploy --dry-run` 亦通過（924.51 KiB／gzip 173.00 KiB）；只產生本機 bundle，不部署。
- 建置公開根目錄僅 `assets`、`index.html`、`onedrive-link.html`；既有 local-backup／builder 測試沒有未發布 signing 資產。所有 style 區塊、PDF renderer、印章測試、local-backup 資產與測試、package／lock 與 dd9a9c1 相同，沒有 0008／0009。
- 依賴重用：忽略的 `cloud-sync/node_modules` junction 指向原工作區已安裝依賴；瀏覽器測試設 `NODE_PATH=C:/Users/Aaron/Documents/Codex/KINO Quota/node_modules;C:/Users/Aaron/Documents/Codex/KINO Quota/cloud-sync/node_modules`。未執行安裝。workerd 測試讀 release 的 `tmp/onedrive-worker-bundle/index.js`；Wrangler 的 `--outdir` 要給此絕對路徑，避免解析到 cloud-sync/tmp。
- 過程失敗已排除：手工 esbuild 先被沙箱上層目錄讀取限制阻擋，之後缺少 Workers 對 tty／util 的相容解析；改用已安裝 Wrangler 官方 dry-run。第一次 dry-run 相對輸出落在 cloud-sync/tmp，造成 runtime ENOENT；改絕對路徑後 runtime 通過。一般 diff --check 把 CRLF 視作尾端空白；`git -c core.whitespace=cr-at-eol diff --check` 通過，無實質尾端空白問題。
- 已先部署相容 Worker `ebf464c1-d3f3-4d68-9a45-ee6afa8a6a83`，再推送前端；Pages production `18aca283-4217-4ace-8060-02f4ddbcb160` 的 source 為 c9c99d6。正式 health=true、oneDriveBindingEnabled=false、oneDriveLoginEnabled=true；原登入流程保持可用，新綁定未啟用，正式 migration 未套用，也未寫既有 D1／R2／OneDrive 資料。
- 正式主頁與專用回呼頁皆200且含新程式。獨立無登入瀏覽器 smoke 通過：編輯台可渲染、舊 OneDrive 登入設定可開啟，應用 API 零非 GET／HEAD／OPTIONS 請求。Cloudflare 自動附加 Web Analytics 標記，不宣稱公開 HTML 與原檔逐位元組相同。
- 使用者後續要求代理設定 Microsoft；已核對沒有可用的 Entra 管理連線／Azure CLI／Graph 管理 SDK，Windows computer-use 技能禁止代改安全設定，Edge 擷取也持續失敗，已停止重試。不擅自索取全應用程式管理權限或新增外部雲端瀏覽器服務。
- 已由代理建立 ONEDRIVE_TOKEN_KEY，尚無 Microsoft 用戶端密碼。正式 Web callback／MICROSOFT_CLIENT_SECRET 仍需使用者完成，或提供適合且已授權的 Entra 管理介面，之後才安排 OAuth／Graph／長期續期與實機驗收。使用者同意不是設定成功的證據；不宣稱綁定已可用，也不重複請求相同許可。
