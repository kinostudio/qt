# QT 編輯台品牌

- `kino-mark.svg`：使用者既有奇諾圖記原檔，用於桌面導覽列與手機頁首，搭配「奇諾影像報價系統」文字。
- `qt-app.svg`：品牌藍底、白色原圖記與厚實幾何 QT 標準字；QT 寬度與圖記接近，不是小字說明。圖記及識別保留在 maskable 安全區域內；不重設奇諾商標。圖示引用以 v=2 更新快取，manifest id 不變。
- `qt-32.png`：分頁圖示備援；`qt-180.png`：Apple 主畫面；`qt-192.png`、`qt-512.png`：Web App 圖示。
- `manifest.webmanifest`：名稱「奇諾影像報價系統」、簡稱「KINO 報價」，主站根路徑開啟，standalone 顯示。沒有 service worker／離線快取，不儲存登入或報價資料。

PNG 由 `node scripts/build-brand-icons.cjs` 從向量檔產生，需開發環境既有 Playwright 與 Edge。生成檔已提交，正式 Pages 建置不需執行此步驟。不要改變報價單內可自訂的 `data.logo`、既有列印素材或客戶簽署站品牌。

主畫面實際安裝及圖示更新依裝置／瀏覽器而異；舊捷徑可能需要重新加入，不能以 manifest 驗證代替實機安裝驗收。
