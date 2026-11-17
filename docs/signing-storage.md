# 客戶簽署儲存層（尚未公開啟用）

本機模組：`cloud-sync/src/signing-store.js`。新增 migration：`0008_quote_signing.sql`。

目前完成儲存層、SQL 狀態轉移、管理者API、客戶預覽／提交API及獨立客戶頁。均在開發分支，正式預設關閉；編輯台管理介面、完整端對端驗收與正式部署尚未完成，不能宣稱已可公開簽署。尚未向正式D1套用migration。

## API 與啟用邊界

- `POST /api/signing`：Google登入、簽署帳號白名單、明確確認報價內容、嚴格快照驗證及用量限制後，建立固定版本並返回專用連結。
- `GET /api/signing/<id>`：只允許該版本所屬工作區管理者，保留查看已過期／撤銷版本的能力；不返回R2位置或原始分享權杖。
- `DELETE /api/signing/<id>`：撤銷連結，不刪除快照或已簽PDF。
- `GET /api/signing/guest`：使用 `Authorization: Quote <分享權杖>` 讀取單份快照。權杖不放在API查詢網址或API路徑，避免一般API網址日誌收集權杖。
- `GET /api/signing/guest/pdf` 及 `GET /api/signing/<id>/pdf`：分別核對客戶連結或管理者工作區後，讀取同一份固定已簽檔，核對SHA-256；檔名使用報價單號。過期／撤銷只阻擋客戶存取，管理者仍可保留版本。
- `POST /api/signing/guest/preview`：只接受甲方四欄、PNG簽名及快照雜湊，不接受同意欄位、冪等鍵或報價修改。產生填寫後預覽但不寫入D1／R2、不claim，允許重新填寫。產檔後再核對連結有效與pending狀態，過期或撤銷不回傳檔案。
- `quote.kinostudio.tw` 的CORS只新增到上述客戶讀取端點，不開放 `/api/sync`、`/api/stamps` 或管理者端點；分享權杖不能當Google登入Token。
- 未設定 `SIGNING_ENABLED=true` 時不啟用。管理者另外必須在 `SIGNING_ALLOWED_EMAILS` 白名單中；正式設定尚未加入這兩個值。不可在完整提交／PDF／客戶頁與遷站驗收完成前啟用。
- 建立沿用既有 `PDF_RATE_LIMITER` 的同一使用者限流額度；有圖片時使用既有Browser Run binding解碼。這會使用瀏覽器額度，但本批測試全部在本機，沒有正式Browser Run呼叫。

## 快照及圖片驗證

API只接受報價已知欄位與管理者確認的固定列印文件，不接受工作區、登入憑證或外部圖片URL。檢查分類、項目、數量與單價、條款、付款、簽署及列印設定型別與容量；串流請求即使沒有Content-Length也受20MB上限約束。

`printDocument` 由已登入管理者的現有分頁器產生，保存當時HTML／CSS及內嵌PNG，避免客戶簽署時因編輯台版本更新而改版。這是管理者控制的列印快照，不是客戶可提交的HTML；客戶API也不返回此原始文件。建立時拒絕腳本、事件屬性、嵌入框架與外部圖片，產檔另使用停用JavaScript、CSP、禁止任意網路請求的隔離瀏覽器。甲方只可提交文字與PNG簽名，伺服器使用textContent與圖片元素更新指定四格及簽章格。

簽署前端需先將Logo（包含內建SVG）、印章與簽名轉成PNG；API檢查PNG實際檔頭、Base64、像素上限，再由隔離瀏覽器完整解碼並重畫成PNG，避免只檢查檔名或接受損壞圖片。輸出快照固定保存這些圖片，不繼續讀取可變動的雲端印章版本。此規範不影響原本編輯台的上傳格式；簽署建立介面尚待接線。

## 與原有資料的隔離

- 沿用既有 D1 與 R2，不新增帳號、儲存桶或付費產品。
- migration 僅建立 `quote_signing_requests`、索引與觸發器；不變更既有表或資料列。
- 新物件限定使用 `quote-signing/v1/<隨機ID>/` 前綴，與原本印章資產分開，使用條件寫入防覆蓋。
- 目前原有工作區版本回復機制不包含簽署表：回復草稿／條款庫不得重寫已簽文件。

## 固定版本與狀態

建立待簽版本時，將確認過的快照序列化成獨立 R2 物件，D1 保存物件位置、SHA-256、建立與到期時間。草稿更改不回寫快照；讀取時重新核對 SHA-256。

分享權杖為32個隨機位元組，僅建立當下返回原始權杖；D1只存SHA-256。客戶讀取只返回該份快照、狀態及到期時間，不返回工作區、資料庫編號對應的其他資料或 R2 key。

狀態只允許 `pending → submitting → signed`。撤銷使用獨立欄位，不刪除已簽版本；撤銷後不能重新啟用同一連結。預設14天、可在建立前選1–30天；目前到期限制客戶讀取及首次送出，已接受的提交仍可重試產生PDF。

`SIGNING_SQL.claim` 是單次條件 UPDATE，檢查未過期、未撤銷、仍在待簽；回傳空值代表本次沒有取得簽署權。`finish` 必須匹配已接受提交的雜湊及有效產檔租約，簽後PDF位置、雜湊、時間不可更新。`signing-submit.js` 已處理相同冪等鍵與相同提交的重試；HTTP送出在開發分支接線但正式停用，不能把第二次claim當新簽署。

## 客戶送出與產檔重試（核心已完成，尚未開放HTTP送出）

`signing-submit.js` 接受經確認的甲方四欄、PNG簽名／印章、簽署方式、快照SHA-256與冪等識別碼，不接受金額、條款或乙方資料。核心必須由可信呼叫端提供實際圖片驗證、正式版型產檔器及用量保護；缺少任一項即拒絕，不會先接受簽署。

- 先保存固定客戶提交，再以單次claim取得簽署權。不同提交或不同冪等鍵不能覆寫已接受內容；相同內容重試不重新簽署，已完成時返回同一檔案雜湊。
- 產檔用2分鐘D1租約，同時重試只觀察進度，不再啟動產檔。租約失效可換一個新租約重試；舊工作完成後不能取代新租約的結果，也不能解除別人的租約。
- PDF先以獨立且防覆蓋的R2 key存檔，D1才以租約與提交雜湊為條件改為signed。產檔或R2失敗保留submitting，不回退成可改寫的pending。
- D1已提交但回應遺失時，相同請求能查到既有版本並恢復；不因錯誤而刪除可能已被引用的物件。
- 原始分享期限到期後，不再接受新簽署；已接受的相同提交可完成PDF重試，但不因此重新開放客戶下載。
- 競爭失敗、過期租約或不確定提交可能留下私有暫存物件。正式啟用前須加入依D1引用與保留期核對的安全清理；目前不自動刪除，以免破壞已接受版本。

正式版型產檔器已在開發分支接線，`POST /api/signing/guest` 與填寫後預覽另需 `SIGNING_SUBMIT_ENABLED=true`；正式設定未加入，仍拒絕送出。客戶頁及填寫後預覽已有隔離測試，編輯台建立介面與完整正式流程仍未完成，不能對客戶宣稱已可簽署。SHA-256是完整性核對，不是憑證式數位簽章或本人身分認證。

`GET /api/signing/guest/preview` 產生待簽PDF並私有快取、核對雜湊；產檔完成後重查撤銷／期限／狀態，不接受簽署。已簽版本改讀固定歸檔。僅快取未命中使用Browser Run，沿用限流；正式上線前仍需總額度保護與安全暫存清理。

R2成功但D1回應失敗時，保留該私人物件，不直接刪除：D1可能已完成提交但回應遺失。後續可依D1引用核對孤立物件，不能靠錯誤訊息推定可刪除。

## 公開前必須補齊

1. 已有管理者工作區隔離API、單元整合及Workers本機runtime驗收；仍需編輯台建立／查閱／撤銷流程及正式登入端對端驗收。
2. 已有嚴格快照及圖片解碼檢查；編輯台仍需連接PNG轉換、確認預覽與明確建立動作，不能直接把含外部SVG路徑或未載入印章的草稿送出。
3. 將既有圖片驗證接入客戶送出流程，連接甲方資料表單、手寫與上傳及確認預覽；不能只依賴前端驗證。
4. 將已通過儲存核心測試的租約／冪等重試接上正式報價版型產檔器，驗證實際PDF內容與視覺，加入安全暫存清理。不能把測試產檔回應當成正式PDF驗收。
5. 客戶API與編輯台API的來源、驗證及回應必須隔離；no-store、no-referrer、禁止索引。不可因新增客戶網域就開放原本同步API。
6. 正式migration前先呈現影響與備份／回復方法；舊站／新站遷移驗收未完成，不提前私人化或關閉舊站。

## 獨立客戶頁（本機完成，未部署）

原始碼 `signing-client/`，僅用原生JavaScript／CSS，不載入編輯台、Google或Microsoft程式。執行 `node scripts/build-signing-client.mjs` 產生 `tmp/qt-signing-site`，只包含五個明確允許檔案；不可把整個Git儲存庫設成客戶站公開目錄。預定路由 `/s/<token>`；Pages回退與隱私／CSP標頭已備妥，但尚未設定客戶Pages專案或網域。

- 甲方資料、手寫畫布（pointer事件）或圖片轉PNG；欄位、筆畫、模式、上傳變動均作廢舊預覽與同意勾選。確認動作必須在填寫後預覽完成、再次勾選同意後才可用。
- 手機用明確的「開啟完整PDF預覽」連結交給閱讀器，不依賴手機內嵌PDF；桌面另有內嵌預覽與相同備援連結。實體iOS／Android及閱讀器行為仍待驗收。
- 確認後才在sessionStorage暫存原始提交（含簽名／甲方資料），支援同分頁重新整理後以同冪等鍵重試，不能改簽名覆寫。成功後清除；成功前關閉整個瀏覽器工作階段可能遺失重試資料。畫面有共用裝置與暫存說明，原始分享權杖不另外存入storage。
- 分享權杖僅使用Quote header呼叫固定API，禁止參照頁網址外送，不加第三方分析；分享網址本身仍是存取憑證，不應轉傳。到期／撤銷後不得開啟新下載；已下載檔案無法遠端收回。
- `node tests/signing-client.cjs` 以隔離手機瀏覽器模擬API，涵蓋手寫／上傳、舊預覽作廢、明確同意、第一次送出斷線、重新整理重試原資料及下載檔名。UI預設PDF回應是標記測試位元組，不代表PDF版型驗收；設定 `SIGNING_CLIENT_PDF=tmp/pdfs/signing-quick.pdf` 可用實際產生的測試PDF檢查下載／預覽連結。真正版型另由 `tests/signing-render.cjs` 驗證。

## 測試證據

`node --test tests/signing-store.test.mjs` 使用記憶體SQLite執行真正SQL與觸發器，並模擬D1 binding及私有R2。

涵蓋：舊表結構與資料保留、原始權杖不入庫、快照獨立、完整性錯誤、過期／撤銷、跨工作區撤銷拒絕、單次提交、不可逆狀態、提交／PDF不可覆寫、NULL不能繞過CHECK、容量與期限、R2衝突及D1不確定提交。

這些記憶體SQLite單元測試不等於正式Cloudflare或完整HTTP／手機簽署驗收；後續另外加入下列隔離Workers runtime測試。

`tests/signing-api.test.mjs` 透過Worker fetch入口、記憶體SQLite及模擬bindings驗證來源隔離、Google身分、工作區隔離、建立／讀取／撤銷、預設停用、白名單／限流、未知欄位與遠端圖片拒絕、無Content-Length的串流上限。

`node tests/signing-images.cjs` 使用本機Chromium實際解碼與重畫PNG，拒絕損壞PNG及超限尺寸，確認無外部圖片請求。它使用Playwright adapter測試相同瀏覽器驗證函式，不等於正式Browser Run部署驗收。

先於 `cloud-sync` 執行 `wrangler deploy --dry-run --outdir ../tmp/signing-worker-bundle`，再於專案根目錄執行 `node tests/signing-runtime.cjs`。測試使用已安裝Miniflare及workerd、暫存且不持久化的本機D1/R2，實際驗證migration觸發器、建立／讀取／撤銷HTTP、單次claim、R2條件寫入。只播種測試帳號，不呼叫遠端D1/R2或Browser Run。

`tests/signing-submit.test.mjs` 驗證相同／不同內容重試、兩客戶競爭、產檔租約、舊工作完成、產檔／R2故障、D1回應遺失、撤銷及到期、甲乙雙方同檔讀取。`node tests/signing-submit-runtime.cjs` 另在隔離workerd執行相同儲存核心；測試harness只在tmp打包，沒有正式認證入口，不可部署。產檔回應是明確標示的測試位元組，**不是實際PDF版型驗收**。

參考：[D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/)、[R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)。
