# 客戶簽署儲存層（尚未公開啟用）

本機模組：`cloud-sync/src/signing-store.js`。新增 migration：`0008_quote_signing.sql`。

目前完成儲存層、SQL 狀態轉移，以及管理者建立／讀取／撤銷、客戶讀取API；不是完整客戶簽署功能。API在開發分支接入Worker，但預設關閉，未接入編輯台或客戶頁，也未向正式D1套用migration或部署這批Worker。

## API 與啟用邊界

- `POST /api/signing`：Google登入、簽署帳號白名單、明確確認報價內容、嚴格快照驗證及用量限制後，建立固定版本並返回專用連結。
- `GET /api/signing/<id>`：只允許該版本所屬工作區管理者，保留查看已過期／撤銷版本的能力；不返回R2位置或原始分享權杖。
- `DELETE /api/signing/<id>`：撤銷連結，不刪除快照或已簽PDF。
- `GET /api/signing/guest`：使用 `Authorization: Quote <分享權杖>` 讀取單份快照。權杖不放在API查詢網址或API路徑，避免一般API網址日誌收集權杖。
- `quote.kinostudio.tw` 的CORS只新增到上述客戶讀取端點，不開放 `/api/sync`、`/api/stamps` 或管理者端點；分享權杖不能當Google登入Token。
- 未設定 `SIGNING_ENABLED=true` 時不啟用。管理者另外必須在 `SIGNING_ALLOWED_EMAILS` 白名單中；正式設定尚未加入這兩個值。不可在完整提交／PDF／客戶頁與遷站驗收完成前啟用。
- 建立沿用既有 `PDF_RATE_LIMITER` 的同一使用者限流額度；有圖片時使用既有Browser Run binding解碼。這會使用瀏覽器額度，但本批測試全部在本機，沒有正式Browser Run呼叫。

## 快照及圖片驗證

API只接受報價已知欄位，不接受工作區、登入憑證、任意HTML或外部圖片URL。檢查分類、項目、數量與單價、條款、付款、簽署及列印設定型別與容量；串流請求即使沒有Content-Length也受20MB上限約束。

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

`SIGNING_SQL.claim` 是單次條件 UPDATE，檢查未過期、未撤銷、仍在待簽；回傳空值代表本次沒有取得簽署權。`finish` 必須匹配已接受提交的雜湊，簽後PDF位置、雜湊、時間不可更新。相同冪等鍵與相同提交的重試判斷，仍需在API整合時實作，不能把第二次claim當新簽署。

R2成功但D1回應失敗時，保留該私人物件，不直接刪除：D1可能已完成提交但回應遺失。後續可依D1引用核對孤立物件，不能靠錯誤訊息推定可刪除。

## 公開前必須補齊

1. 已有管理者工作區隔離API、單元整合及Workers本機runtime驗收；仍需編輯台建立／查閱／撤銷流程及正式登入端對端驗收。
2. 已有嚴格快照及圖片解碼檢查；編輯台仍需連接PNG轉換、確認預覽與明確建立動作，不能直接把含外部SVG路徑或未載入印章的草稿送出。
3. 客戶只能更新甲方資料與簽名／印章，不接受客戶回傳金額或條款作為正式版本。上傳圖片需驗證實際格式、大小、尺寸及解碼結果。
4. 限時／撤銷、相同冪等鍵重試、跨工作區及兩個客戶競爭測試；PDF失敗留在submitting，可安全重試，成功保存固定PDF後才標記signed。
5. 客戶API與編輯台API的來源、驗證及回應必須隔離；no-store、no-referrer、禁止索引。不可因新增客戶網域就開放原本同步API。
6. 正式migration前先呈現影響與備份／回復方法；舊站／新站遷移驗收未完成，不提前私人化或關閉舊站。

## 測試證據

`node --test tests/signing-store.test.mjs` 使用記憶體SQLite執行真正SQL與觸發器，並模擬D1 binding及私有R2。

涵蓋：舊表結構與資料保留、原始權杖不入庫、快照獨立、完整性錯誤、過期／撤銷、跨工作區撤銷拒絕、單次提交、不可逆狀態、提交／PDF不可覆寫、NULL不能繞過CHECK、容量與期限、R2衝突及D1不確定提交。

這些記憶體SQLite單元測試不等於正式Cloudflare或完整HTTP／手機簽署驗收；後續另外加入下列隔離Workers runtime測試。

`tests/signing-api.test.mjs` 透過Worker fetch入口、記憶體SQLite及模擬bindings驗證來源隔離、Google身分、工作區隔離、建立／讀取／撤銷、預設停用、白名單／限流、未知欄位與遠端圖片拒絕、無Content-Length的串流上限。

`node tests/signing-images.cjs` 使用本機Chromium實際解碼與重畫PNG，拒絕損壞PNG及超限尺寸，確認無外部圖片請求。它使用Playwright adapter測試相同瀏覽器驗證函式，不等於正式Browser Run部署驗收。

先於 `cloud-sync` 執行 `wrangler deploy --dry-run --outdir ../tmp/signing-worker-bundle`，再於專案根目錄執行 `node tests/signing-runtime.cjs`。測試使用已安裝Miniflare及workerd、暫存且不持久化的本機D1/R2，實際驗證migration觸發器、建立／讀取／撤銷HTTP、單次claim、R2條件寫入。只播種測試帳號，不呼叫遠端D1/R2或Browser Run。

參考：[D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/)、[R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)。
