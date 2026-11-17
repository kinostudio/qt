# 下載 PDF 的甲方填寫欄位

- 「下載 PDF」會加入甲方抬頭、代表人、統編與電話四個 AcroForm 文字欄位。既有內容會預填，客戶可在支援表單的 PDF 閱讀器中修改。
- 「列印／另存 PDF」是一般列印結果，不含這些互動欄位。
- 簽名、印章仍使用閱讀器的「填寫與簽署」工具放入；沒有建立憑證簽章，也不驗證簽署者身分。不同閱讀器操作可能不同。
- 保留客戶回傳的原始 PDF；重新列印可能移除互動欄位。

## 實作與資料邊界

瀏覽器傳送現有列印樹至原本的 PDF API。Worker 在列印樣式、字型和分頁完成後，量測帶有 `data-pdf-client-field` 的表格格子，再輸出 PDF 與 Base64 編碼的欄位座標／預填值回應標頭。這些內容與原本報價相同，回應設為 `no-store`，不記錄進 D1／R2。

瀏覽器以自託管 `assets/pdf-form.js` 加入欄位及完整中文字型。此步在使用者裝置執行，不增加 Worker 字型處理的 CPU 負擔；PDF 檔案大小和裝置記憶體用量會增加。PDF 閱讀器編輯字型使用 Unicode CID 對應，避免新增中文字出現錯字。

舊版前端不送 `editableClientFields: true`，Worker 不移除原有表格文字、不產生欄位資訊，維持一般 PDF。

## 建置與驗證

在 `cloud-sync` 執行 `npm run build:pdf-form` 更新瀏覽器套件，輸出需隨前端提交。

- `node --test tests/*.test.mjs`：表單結構、預填值、中文字型、舊版呼叫及 API 保護。
- PowerShell：`$env:TEST_PDF='1'; node tests/mobile-sync-mock.cjs`：隔離雲端回應、實際 Chromium 列印、快速報價 100%／70% 與詳細報價 85%。
- `node tests/pdf-form-reader.cjs`：以隔離的 PDF.js 閱讀器填寫並儲存中文。
- 使用 bundled Python 執行 `tests/pdf-form-verify.py`：獨立檢查 canonical fields、widgets、appearance 與中文存檔值，再以 Poppler 渲染圖像檢查對齊。

上述測試不登入正式帳號、不寫入正式雲端資料；不等於 Acrobat、iPhone 或 Android 實機驗收。
