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
7. [ ] 新站使用既有 Google Client ID，新增來源與需要的 redirect URI；OneDrive 新增 SPA redirect URI `https://qt.kinostudio.tw/`。保留舊網址設定直到驗收完成，不重建帳號／工作區。
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

1. [ ] 設計新增的獨立資料表與R2專用key前綴；沿用資源但不修改既有資料列。先建立本機 migration 與測試，正式套用需明確列出影響。
2. [ ] 後端建立／讀取／撤銷分享與權限邊界測試。
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
- 仍需新增Google來源與Microsoft SPA redirect設定並完成實際登入驗收；使用者完整本機備份與新站還原驗收尚未完成。不得私人化或關閉原站。
- 每個工作批次更新此檔案，紀錄實際證據，區分 `passed`／`failed`／`not_checked`。不能因為程式寫完就勾選正式驗收完成。

## 自動續作

已建立本對話 active goal；沿用並更新此對話既有 heartbeat `automation-6`，每小時續作一個安全工作批次。需本機 Codex 能執行；不代表離線雲端常駐服務。需使用者授權的步驟記錄並請求，不擅自繞過。
