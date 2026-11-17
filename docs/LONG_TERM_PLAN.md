# QT 遷站與客戶簽署長期目標

更新：2026-11-17。狀態：進行中。工作目錄：`C:\Users\Aaron\Documents\Codex\KINO Quota`。

## 不可違反的範圍

- 編輯台：`qt.kinostudio.tw`；客戶分享與簽署：`quote.kinostudio.tw`。兩個獨立前端，不混用奇諾官網。
- GitHub 指定帳號：`kinostudio`。使用者已確認建立獨立 `kinostudio/qt` 並保留完整歷史；原始遠端 `aaronkino/qt` 留作回退。依指定順序，新庫先建公開且最後才私人化，原庫也不提前關閉。
- 沿用現有 `kino-quotation-data-api` Worker、D1 `kino-quotation-data`、R2 `kino-quotation-stamps`。不清空、不重建、不覆寫既有專案、條款與印章。
- 免費方案優先；遇到升級、付款、額外外部服務，先取得確認。
- 不用正式資料做寫入測試，不將憑證、Token、客戶資料寫入 Git、日誌或文件。
- 未完成新站登入／列印／PDF／資料驗收及本機備份回復測試，不關閉舊站、不將原 GitHub 庫改私人。
- 原本已公開的程式碼／歷史可能已被複製，改私人不能撤回外部副本。前端傳至瀏覽器的程式仍可被使用者查看。

## 完整功能基準（不可遺漏）

已上線基準 `df0f91f`，之前的更新一併納入新站：

- 快速／詳細報價；A4 動態分頁與頁尾；70–100% 列印比例與直接列印按鈕。
- 表格、VAT 小計／總額、預設字樣、簽署日期、甲乙方欄寬與簽章列高等既有調整。
- Google 登入與工作區隔離；D1 同步前差異確認、版本保留、刪除版本核對、實際寫入／略過結果。
- 易讀新增／修改內容、差異摘要、文字突出標示、印章縮圖比較、Snackbar。
- OneDrive 記住目錄、自動建立專案資料夾、JSON 手動／自動存檔與單頁上傳序列化（不是跨裝置鎖）。
- 手寫簽名、上傳／選擇印章、常用尺寸、透明裁切、預覽、印章跨格蓋住公司資訊。
- Chromium 同版型下載 PDF；甲方抬頭／代表人／統編／電話可填寫與中文編輯字型；簽章使用閱讀器工具，不是憑證式數位簽章。列印仍為一般 PDF。
- 手機／電腦導覽、條款分類與條款 CRUD、拖曳排序、JSON 開啟儲存、返回／重做／重置。
- 尚未提交的 README 架構圖連結與 `docs/architecture.html` 是前期文件，需納入來源庫，標明歷史基準，不將舊版圖假稱為新架構。

## A. 先遷站，後私人化

1. [x] 核對本機基準及髒工作區；保留不相關修改。
2. [x] GitHub CLI 活動帳號確為 `kinostudio`，`kinostudio/qt` 尚不存在。
3. [x] Cloudflare OAuth 可用，帳號為既有 QT Worker 所在帳號；Pages 目前只有官網、review 等其他專案，不能覆寫。
4. [x] 使用者確認建立獨立 `kinostudio/qt`。新庫已建立、主線及12個回退標籤已推送；原 `aaronkino/qt` 保留。公開DNS查詢兩個新名稱最初皆為NXDOMAIN。已依使用者要求透過Cloudflare網頁只新增 `qt` CNAME → `kino-quotation-editor.pages.dev`（Proxy，自動TTL），DNS記錄由23筆增至24筆；`quote` 尚未新增。
5. [x] 已建立 `scripts/build-editor.mjs`，輸出 `tmp/qt-editor-site`；僅 `index.html` 與 `assets/`，拒絕資產符號連結。`tests/build-editor.test.mjs` 核對白名單、PDF模組與前期功能標記；12項本機測試通過。尚未接入新站部署；簽署站另建獨立白名單。
6. [x] 獨立 Git 整合專案 `kino-quotation-editor` 已建立，來源 `kinostudio/qt` main；建置命令 `node scripts/build-editor.mjs`，輸出 `tmp/qt-editor-site`。首次部署 `9a2b4409-01e7-41d3-9aa2-f552777cb436` 顯示deploy/success，預覽為 `https://kino-quotation-editor.pages.dev`。舊GitHub Pages workflow僅允許原 `aaronkino/qt` 執行，避免新庫誤啟動GitHub Pages。尚需驗證後續push自動建置及自訂網域HTTPS。
7. [x] 既有 Google Client ID 已新增新站來源（使用者保存），新站實際登入 `kinostudio.tw@gmail.com` 並顯示同步完成。OneDrive 已由代理依使用者當下確認新增 SPA redirect URI `https://qt.kinostudio.tw/`，清單顯示新增成功且保留舊站／localhost。不重建帳號／工作區；OneDrive 新站實際登入仍待驗收。
8. [x] 新站 HTTPS／字型驗證後，CORS 新增編輯台來源並保留舊站；PDF 字型與 CSP 改新站。Worker 版本 `19165970-f5d4-4dfe-a14c-43d19ffb3d03` 已部署，未改 D1／R2 綁定或資料。公開 OPTIONS 驗證新舊編輯台均204，客戶簽署網域403。
9. [ ] 以假資料回歸：桌面與手機、登入恢復、差異／刪除衝突、OneDrive、列印70/85/100、快速／詳細 PDF、中文填寫存檔、印章跨格與頁碼。
10. [ ] 舊站實際瀏覽器本機資料做可還原備份：草稿、完整專案、條款範本、分類、條款、印章圖片與版面設定；排除登入Token。不能用空白隔離瀏覽器的備份冒充使用者備份。
11. [ ] 新網域匯入備份、逐項核對；換網域的 localStorage／sessionStorage 不會自動轉移。Google／Microsoft 需重新登入。
12. [ ] 驗收證據完整後才轉私人，並更新推送權限、自動部署、舊站退場／轉址與回復方式。若原庫需 owner 權限，切換到正確授權，不用別站金鑰。

## B. 客戶簽署最小可用版

### 固定流程與資料

- 管理者明確確認後才產生待簽快照。儲存報價JSON、條款全文、印章／簽名版本、列印設定、來源專案與快照雜湊；之後草稿更改不回寫快照。
- 客戶URL為 `https://quote.kinostudio.tw/s/<高熵隨機權杖>`。不使用可猜測專案編號；資料庫只存Token雜湊，可設定期限與撤銷。預設期限先採14天，編輯台可調整。
- 客戶無須註冊，只能讀取該份待簽快照；不能取得Google／OneDrive Token、專案庫、條款庫或管理API。
- 客戶填寫甲方資料，選擇手寫或圖片印章；驗證圖片實際格式、大小與尺寸，限制載入來源；預覽完整報價，再明確確認送出。
- 最終送出採原子條件更新 `pending -> signed`；使用冪等鍵防雙擊，競爭送出不能覆寫。過期、撤銷、已簽狀態要有明確UI。
- 生成並保存固定的已簽PDF及雜湊、簽署時間、提交版本，與待簽快照分開。狀態可用 `pending/submitting/signed/revoked/expired` 等最小必要狀態，PDF生成失敗可安全重試，不產生假完成。
- 雙方可透過各自權限下載／列印固定PDF；客戶端不顯示編輯台連結。已簽URL為持有連結即可讀取的能力權限，預設不公開索引、不快取、避免referer洩漏；管理者可撤銷分享存取。
- 僅為電子簽署工作流程，不自稱憑證式數位簽章或已驗證本人身分。顯示簽署意願確認，不擅自新增法律保證或條款。

### 分批開發

1. [x] 新增獨立 `quote_signing_requests` 表與 `quote-signing/v1/` R2前綴設計，migration `0008_quote_signing.sql` 在記憶體SQLite通過；既有表結構／資料保持不變。尚未正式套用，影響與公開前缺口見 `docs/signing-storage.md`。
2. [x] 已在開發分支接入建立／讀取／撤銷API，透過Worker fetch入口、記憶體SQLite及模擬bindings驗證Google身分、簽署帳號白名單、工作區、客戶來源及權杖隔離。預設停用，尚未正式部署；Workers runtime驗收另列後續缺口。
3. [ ] 客戶手機頁：閱讀、填寫、手寫／上傳、預覽、確認、完成頁與下載／列印。
4. [ ] 簽署原子性、重試與PDF固定版本；錯誤復原、已簽內容防覆寫。
5. [ ] 編輯台建立連結、簽署狀態、開啟／下載已簽版本。
6. [ ] 隔離整合測試：過期／撤銷／重複提交／兩客戶競爭／跨工作區／無權讀寫／惡意圖片／PDF失敗回復。
7. [ ] 正式發布與兩網域端對端驗收，不使用既有真實專案做測試。

## 目前下一步

- 新庫與Git整合建置已建立。Cloudflare OAuth有Pages權限但無DNS記錄API權限；DNS由使用者授權的網頁操作完成，不擴大API金鑰權限。
- `qt.kinostudio.tw` 自訂網域、驗證與憑證狀態皆已 active，HTTPS200；字型與本機 SHA-256 相同。push 自動建置已由 `bb45cc6` 的部署 `d13a8679-ff30-4787-bc94-baa349caa067` 驗證成功。
- 完整本機備份／還原工具已實作；17項單元測試與隔離手機跨網址匯出／還原／重新載入測試通過，沒有增加同步或 OneDrive 寫入。修復初次載入 effect 覆寫還原草稿的問題。這不是使用者正式資料已備份的證明。
- 舊站僅新增只讀備份輔助頁 `https://aaronkino.github.io/qt/assets/migration-backup.html`（原庫 `d1c72cd`），HTTPS200；未替換舊站編輯台或後端。實際備份須在原本使用的瀏覽器／設定檔操作。
- Google來源與Microsoft SPA redirect設定已完成，Google新站登入已實際觀察；OneDrive實際登入及新站還原驗收尚未完成。不得私人化或關閉原站。
- 每個工作批次更新此檔案，紀錄實際證據，區分 `passed`／`failed`／`not_checked`。不能因為程式寫完就勾選正式驗收完成。

### 印章介面增量（2026-11-17）

- 簽署區整併為單一「設定印章」入口；視窗內保留選擇與上傳。
- X／Y 位移新增滑桿，與毫米輸入雙向連動，維持原有格內限制及跨格選項。
- 透明度與資料正規化範圍均改為0–100，既有預設96不變。
- passed：18項單元測試、隔離手機操作、桌面寬度重開視窗、0／45／100透明度、JSON值保留及模擬OneDrive存檔；未對正式雲端資料寫入。not_checked：實體手機觸控與此增量的正式PDF下載。

### 實際登入設定與備份驗收（2026-11-17）

- Google Cloud 專案 `kino-quotation` 的既有 OAuth 用戶端已在頁面顯示 `https://qt.kinostudio.tw` 與 Pages 預覽來源，並有「OAuth 用戶端已儲存」通知；原3個來源保留。使用者自行完成設定，代理未重複提交。後續已觀察新站正確Google帳號登入與同步完成。
- Microsoft Entra 已由使用者登入，已核對既有用戶端ID；依使用者當下同意只新增新站SPA回呼，清單已確認同時存在 localhost、舊GitHub站、新站三筆；未新增權限、密鑰或付費方案。
- 目前 Edge 設定檔的舊站備份已實際下載、通過 `KinoLocalBackup.inspect` 完整性檢查：草稿、2專案、1範本、7分類、28條款、1印章，檔案1,555,844 bytes。另存專案外的私人備份目錄，不提交Git。
- 新站初始安全副本已下載及驗證：草稿、0專案、0範本、7分類、16條款、0印章。使用者隨後自行Google登入並載入雲端，畫面顯示正確帳號及同步完成；代理未點擊同步合併或寫入。
- 還原前已暫時登出網站Google，另下載及驗證登入後最新副本：草稿、3專案、1範本、7分類、29條款、1印章（1,562,634 bytes）。三份副本存放 `C:\Users\Aaron\Documents\Codex\QT Private Backups`，不含登入Token，不提交Git；不能代表其他裝置已備份。
- 使用者已明確允許本機還原；準備選檔時瀏覽器回報 `Debugger unattached`。重新檢查同一頁籤及重新取得綁定各一次仍失敗，已停止UI操作。尚未點擊「還原到此瀏覽器並重新載入」或接受確認，不得宣稱已還原；下次先核對頁面及任何檔案選取對話框，不重複執行。
- 本批次未寫入 D1／R2／OneDrive、未私人化GitHub、未停用舊站。Cloudflare CLI OAuth最近查詢回報登入失效，後續部署需重新授權；公開新站仍正常。

### 下一批實際證據：還原操作與簽署儲存層

- Edge重新連接成功，實際載入舊站備份並顯示來源及2專案／28條款等摘要，檢查碼正確。勾選安全副本確認後，點擊還原觸發confirm（點擊工具逾時，但接著查到confirm存在）；依既有明確授權接受confirm。之後觀察與重新取得同一頁籤均因焦點/CDP逾時失敗，停止操作。**現在還原結果未知**，不能沿用先前「尚未接受確認」的紀錄，也不能直接重做還原。需先確認實際頁面及資料數量。
- 新增簽署儲存模組 `signing-store.js`：快照私有條件寫入、SHA-256檢查、32-byte隨機權杖僅存雜湊、工作區限定撤銷、過期拒絕。SQL使用單次條件更新取得提交權，觸發器阻擋快照／提交／已簽PDF改寫與狀態回退。
- passed：全部25項單元測試，其中7項新簽署測試使用真正記憶體SQLite與模擬R2。not_checked：Workers本機整合、正式R2條件寫入、完整客戶HTTP／手機簽署。模組尚未接入Worker路由，不公開啟用，不算完成客戶簽署功能。
- 本批只開發本機程式與測試；未套用正式migration、未部署Worker、未寫入既有雲端資料。下一步接入嚴格快照／圖片驗證與登入管理者API，再做客戶頁及固定PDF；不要因儲存層測試通過就直接上線。

### 簽署API與圖片驗證增量

- 開發分支新增 `signing-api.js`、`signing-validation.js`；Worker route以 `SIGNING_ENABLED` 預設關閉，管理者另需 `SIGNING_ALLOWED_EMAILS`。兩個正式設定均尚未啟用。
- 管理者POST建立、GET查閱、DELETE撤銷均限定已登入的工作區；客戶GET使用Quote權杖header，只讀單份快照。客戶網域無法藉此存取同步／印章管理API。
- 快照拒絕未知欄位、工作區覆寫、外部圖片及缺失印章；串流請求受20MB限制。圖片需先轉PNG再由隔離瀏覽器實際解碼重畫；原編輯台上傳格式不變，建立簽署介面的PNG轉換尚待接線。
- passed：全套33項單元測試，另有本機Chromium圖片解碼測試，覆蓋損壞檔、像素上限及無外部連線。not_checked：正式Browser Run、Workers本機runtime、客戶手機提交／固定PDF。未部署或寫入正式D1／R2，未呼叫正式Browser Run。
- 本輪未操作Edge還原；上輪接受確認後的結果仍未知，需恢復連線後先核對，不可重做還原。下一步：客戶資料／手寫／印章提交及冪等重試、客戶獨立前端、固定PDF，並補齊遷站驗收。
- 補強驗證：Wrangler dry-run打包成功（912.10KiB，gzip171.73KiB，未部署）；另用已安裝Miniflare/workerd啟動不持久化的隔離本機D1/R2，實際通過建立／客戶讀取／撤銷、單次claim、快照／PDF欄位不可改寫、R2條件寫入及來源隔離。這補齊了此批文字快照API的Workers本機binding驗證，仍不代表正式Browser Run圖片服務、完整簽署UI或正式部署通過。

### 客戶提交、產檔租約與固定檔案讀取增量

- `signing-submit.js` 已完成儲存核心：明確同意與快照雜湊、只收甲方欄位及PNG簽名／印章、相同請求重試、拒絕不同提交覆寫、2分鐘租約、舊工作不得發布、PDF先存R2再以條件更新signed，以及D1不確定回應的恢復。
- `0008_quote_signing.sql` 增加產檔租約欄位與檢查；此migration仍未套用正式D1，因此只修改尚未上線的新表定義，不對既有表做ALTER。API增加客戶／管理者已簽PDF讀取，使用報價單號檔名與固定檔案SHA-256；撤銷／過期保護客戶連結，管理者版本保留。
- passed：核心單元測試涵蓋並發、回應遺失、R2故障、過期與撤銷；另有隔離workerd的實際D1/R2提交及重試驗證。產檔使用測試回應，不能據此宣稱真實已簽PDF版型正確。
- **未開放HTTP送出**：正式報價版型產檔器、客戶手機頁、PNG實際驗證與送出路由仍需接線，暫存物件安全清理仍待做。不得將B3/B4/B7勾成完成或啟用正式簽署。
- 全程未套用正式migration、未部署Worker／前端、未寫入現有雲端資料。遷站驗收與Edge還原結果仍待核對，GitHub不提前私人化。
- 最終驗證：全套46項單元測試、本機Chromium圖片驗證、兩組隔離workerd實際D1/R2測試均通過；Worker dry-run 915.61KiB（gzip172.34KiB），沒有部署。原有PDF下載／同步測試也保留通過。

## 自動續作

已建立本對話 active goal；沿用並更新此對話既有 heartbeat `automation-6`，每小時續作一個安全工作批次。需本機 Codex 能執行；不代表離線雲端常駐服務。需使用者授權的步驟記錄並請求，不擅自繞過。
