# 客戶簽署發布紀錄（2026-11-18）

## 產檔等待與雲端箭頭修正（2026-11-22）

- 保留既有免費方案產檔預算、啟動間隔與並行租約，不以移除保護解決忙碌提示。分別回報啟動間隔／未釋放工作及剩餘秒數，HTTP 429 同時包含 Retry-After 與 JSON retryAfter。
- 簽署管理器遇到上述限制時顯示倒數，保留固定版本及確認狀態；倒數期間勾選確認不能繞過等待，時間到可手動重試，不自動重送建立請求。
- 雲端與帳號折疊箭頭改為固定尺寸 SVG 並跟隨開關旋轉；OneDrive 設定箭頭同樣改為 SVG，避免字型造成位置與圖形不一致。
- 91/91 單元測試通過，含實際 Worker handler 回傳重試秒數測試；390／1366px 隔離雲端面板與簽署管理器測試通過，未發送正式同步／OneDrive 存檔。
- Worker dry-run 通過，部署 ca509cbc-61a4-405a-806d-d5a154719e01（keep-vars）。沒有 migration、Secret 變更、清理或覆寫業務 D1／R2／OneDrive。前端由本次提交透過既有 Pages 建置發布，正式檔案須再核對。
- 此次未重跑真實付費計量的 Browser Run，也未宣稱客戶簽署全流程正式驗收完成。真正產檔仍可能因共享額度／啟動間隔而暫時等待；一般 PDF 下載會顯示等待秒數，簽署管理器另提供按鈕倒數。

## 使用者指示與來源

使用者明確更正：現在接通並上線 quote.kinostudio.tw，不是延後簽署開發。既有編輯台保持 qt.kinostudio.tw；不清空 D1／R2、不混用官網、不升級免費方案。

從正式66bd363建立codex/quote-signing-release，合併4ccfcb1的既有簽署／額度功能；原開發工作樹及未提交修改未動。兩個衝突檔保留OneDrive綁定、錯誤代碼、雲端整合面板與新版導航，同時加入簽署旗標與管理入口。

## 已完成

- 89/89單元測試；客戶五檔建置白名單；Windows換行測試改為比對trim後內容，不改路由。
- 真實編輯台＋手機客戶頁＋handler＋SQLite＋模擬R2＋本機Chromium：快速手寫／詳細印章、不可變快照、產檔失敗重試、甲乙下載SHA一致、撤銷後保留管理者歸檔皆通過。
- 真正workerd臨時D1/R2：建立／讀取／撤銷、原子claim、不可變觸發器、R2條件寫入、來源隔離、送出重試通過。首次esbuild受沙箱上層目錄權限阻擋，經核准的同一隔離測試重跑通過；沒有修改測試來繞過驗證。
- 管理者手機／桌面UI、新雲端面板、既有手機同步差異／Snackbar／印章／序列化OneDrive／備份還原與真實handler的OneDrive模擬存檔回歸通過。
- 獨立Pages kino-quotation-signing建立並部署72f91625，來源只含index.html、app.js、app.css、_headers、_redirects。正式pages.dev根路由、/s/<測試字串>、app.js皆200且含no-store／no-referrer／noindex／CSP。
- 自訂網域quote.kinostudio.tw已在該Pages專案登錄，仍待CNAME接線。沒有修改官網或qt記錄。
- 先備份D1至儲存庫外私人目錄d1-before-signing-enable-20261118.sql：987480 bytes，SHA256 20c3d96022d90734d2904e8a5594597131056732ad43a429c6ae8dc0181bf812；實際記憶體SQLite載入成功。資料原有3專案、29條款、1個OneDrive綁定。
- 只套用已列出的0008_quote_signing.sql與0009_browser_budget.sql。後備份d1-after-signing-migration-20261118.sql與遷移前15張舊表逐列排序雜湊比對完全一致；新簽署／額度表均0筆。備份不可加入Git。
- 新SIGNING_LINK_SECRET以32-byte隨機值直接經stdin存入既有Worker；未輸出／寫入檔案或Git，也未輪替Google／OneDrive金鑰。
- 既有QT Worker部署c083417f-2968-4cc2-a877-d809648a2be4；SIGNING_ENABLED=false、SIGNING_SUBMIT_ENABLED=false，管理者白名單kinostudio.tw@gmail.com。health200、Google／OneDrive原有設定保留、OneDrive綁定旗標true；客戶來源對/api/sync的OPTIONS為403。

## 非預期部署與恢復

Wrangler pages project create在此版本非預期委派為Worker部署，曾新建同名kino-quotation-signing Worker（3483cf36-587b-4e0e-a856-cb744653b2ac），而非靜態Pages。立即停止後續步驟並以精確名稱移除此批新Worker，未刪D1／R2或原kino-quotation-data-api；其程式可由Git恢復，不保留重複公開API。之後使用既有Wrangler OAuth的官方Pages REST API明確建立Pages，正常pages deploy成功。不能把誤建Worker當成客戶站已完成。

## 阻礙與待辦

- OAuth具有Pages寫入但沒有DNS編輯權限；quote目前無DNS紀錄。已一次請使用者新增CNAME quote → kino-quotation-signing.pages.dev，保留@／www／qt／api／review。
- Windows Edge當前為其他專案頁面；安全審查拒絕讀取其完整可及性樹，避免暴露非本任務私人內容。未重試或繞過拒絕，也未讀取瀏覽器Token／建立假的正式Google使用者。
- DNS驗證與HTTPS就緒後，才啟用兩個簽署旗標並完成正式隔離待簽版本→客戶填寫／手寫或上傳→預覽→確認→固定PDF→雙方下載驗收。尚未做真實Google帳號與正式Browser Run完整驗收，不能宣稱整體已可用。
- 現有R2暫存物件採保守保留，不做自動刪除；後續依D1引用、前綴與保留期獨立審核清理，不能依錯誤訊息推定物件可刪。此次沒有清理任何既有物件。
- 一般PDF與簽署共用8分鐘保守應用預算；不是帳戶實際帳單用量，也不能保證其他產品永不收費。沿用已確認的Workers Free，不升級。

程式部署與資料表就緒不等於客戶簽署正式驗收。舊aaronkino/qt已依使用者指示私人化，新kinostudio/qt仍公開；本次不再變更可見性。

## DNS完成後啟用（2026-11-19）

- quote CNAME已出現在專用DNS頁（25筆記錄），指向kino-quotation-signing.pages.dev。HTTPS200且保留no-store／no-referrer／noindex／CSP；官方Pages API回讀網域active。先前DNS阻礙已解除，不再要求新增同一記錄。
- Wrangler既有OAuth存取權杖過期造成直接API401，使用官方CLI正常續期後domain查詢200。subscriptions API仍403，未擴大權限；改以已登入Cloudflare的Workers方案頁唯讀核對「免費 US$0 目前方案」，Paid仍顯示升級，未點擊任何計費變更。
- 原Worker部署ff6d9b7a-6064-4855-b28d-2ccfda2782bd，兩簽署旗標true，管理者白名單與既有Secret／OneDrive／Google／D1／R2保留。沒有再次套用migration或建立金鑰。
- 89項單元再次通過。正式GET／OPTIONS隔離檢查：quote來源對/api/sync、/api/stamps、/api/onedrive、管理者/api/signing皆403；專用guest預檢204，不存在的測試連結404，未登入管理者401。
- 唯讀D1：projects=3、clauses=29、bindings=1、signing_requests=0、budget_rows=0，rows_written=0。這證明啟用及上述負向測試沒有建立簽署或Browser Run工作，不代表既有資料逐位元組再次比對。
- 待真實Google白名單帳號的非業務報價簽署／正式Browser Run完整驗收；不得偽造工作階段或使用既有真實客戶合約做測試。真實簽署驗收完成前不可把「已啟用」稱為「全流程已驗收」。
- 程式提交163e1b4已先核對遠端main為祖先，再atomic push主線與簽署分支；qt正式HTML含openSigningManager及新版CloudAccountControls。390／1366px全新未登入Edge實測：展開工具列、客戶簽署入口、轉Google登入提示、quote根頁不完整連結及不存在權杖拒絕均通過，零應用寫入、零頁面錯誤。初次測試exact按鈕名稱受Font Awesome字型影響未定位到，核對真實按鈕後改用文字正則，未修改正式功能來配合測試。
- 已一次請使用者在編輯台以kinostudio.tw@gmail.com登入（已登入免重登）、關閉而非合併同步差異，再開客戶簽署；不要從真實報價建立連結。等待正式登入操作時，不提取Token、不建立假Google工作階段、不擅自替換本機草稿。
