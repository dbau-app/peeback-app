# Peeback — Hệ thống hoàn tiền affiliate Shopee (Google Apps Script)

Toàn bộ hệ thống (giao diện + backend + database) chạy **gọn trong 1 Google Apps
Script Web App** — không cần VPS, không cần GitHub Pages riêng. Dữ liệu lưu
trong chính Google Sheet của bạn (4 tab: `Users`, `Links`, `Withdrawals`,
`Transactions`, tự động tạo khi chạy lần đầu).

Có 3 file:
- `Code.gs` — backend: xác thực (đăng ký/đăng nhập/quên mật khẩu qua email),
  làm sạch link Shopee + gắn affiliate id `17355030107`, lấy tên/ảnh sản phẩm,
  chia hoa hồng 85% thành viên / 15% admin (sau 1% phí sàn + 10% thuế TNCN),
  quản trị duyệt hoa hồng & rút tiền.
- `Index.html` — toàn bộ giao diện (trang chủ, link của tôi, ví, trang admin).
- `appsscript.json` — file cấu hình dự án (không bắt buộc dán tay, chỉ cần khi
  đồng bộ qua `clasp`, xem Phần 3).

---

## PHẦN 1 — Triển khai lên Google Sheets + Apps Script

1. Vào https://sheets.google.com → tạo 1 Sheet mới, đặt tên (VD: "Peeback DB").
2. Vào menu **Tiện ích mở rộng (Extensions) → Apps Script**.
3. Trong Apps Script, file `Code.gs` mặc định đã có sẵn — xoá hết nội dung mẫu,
   dán toàn bộ nội dung file `Code.gs` mình gửi vào.
4. Bấm dấu **+** cạnh "Files" bên trái → **HTML** → đặt tên chính xác là
   `Index` (không thêm đuôi .html, Apps Script tự thêm) → xoá nội dung mẫu,
   dán toàn bộ nội dung file `Index.html` mình gửi vào.
5. Kiểm tra dòng cấu hình đầu `Code.gs`, sửa nếu cần:
   ```js
   var SHOPEE_AFFILIATE_ID = '17355030107';
   var USER_SHARE_RATE = 0.85;
   var PLATFORM_FEE_RATE = 0.01;
   var PERSONAL_INCOME_TAX_RATE = 0.10;
   var MIN_WITHDRAW = 50000;
   ```
6. Bấm **Lưu** (biểu tượng đĩa mềm hoặc Ctrl+S).
7. Vào **Deploy (Triển khai) → New deployment (Bản triển khai mới)**:
   - Bấm bánh răng cạnh "Select type" → chọn **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Bấm **Deploy**, cấp quyền khi được hỏi (bấm "Advanced" → "Go to (tên dự án) (unsafe)" → Allow — đây là quyền bình thường vì đây là script do chính bạn triển khai).
   - Copy đường link **Web app URL** — đây chính là địa chỉ website của bạn, dạng:
     ```
     https://script.google.com/macros/s/XXXXXXXXXXXX/exec
     ```

Mở link đó ra là thấy giao diện Peeback ngay — **không cần GitHub Pages, không
cần domain riêng để chạy được** (muốn gắn domain riêng cho link này thì cần
dịch vụ trỏ domain qua URL đó, xem ghi chú ở Phần 5).

> Mỗi lần bạn sửa code, vào **Deploy → Manage deployments → biểu tượng bút chì
> → Version: New version → Deploy** thì bản deploy mới có hiệu lực.

---

## PHẦN 2 — Tạo tài khoản Admin đầu tiên

Hệ thống không có sẵn tài khoản admin — bạn cần tự tạo theo cách sau:

1. Mở link Web app ở Phần 1 → bấm **Đăng ký ngay** → đăng ký 1 tài khoản bình
   thường bằng email của bạn.
2. Kiểm tra email, nhập mã xác nhận 6 số để hoàn tất đăng ký (email gửi từ
   chính tài khoản Google mà bạn dùng để tạo Apps Script, qua `MailApp` — nếu
   không thấy, kiểm tra thư mục Spam).
3. Quay lại Google Sheet ("Peeback DB") → mở tab **Users** → tìm dòng vừa đăng
   ký → cột **Role** đang là `customer`, sửa thành `admin` (gõ đúng chữ
   thường, không dấu).
4. Quay lại web app, **đăng xuất rồi đăng nhập lại** — sẽ thấy tab **Quản trị**
   xuất hiện trên thanh menu.

Từ giờ, muốn cấp quyền admin cho ai khác, làm y hệt bước 3 cho dòng của người đó.

---

## PHẦN 3 — Đưa code lên GitHub

Có 2 cách — chọn cách 1 nếu bạn không rành dùng dòng lệnh (đơn giản nhất, chỉ
để backup/lưu trữ code), hoặc cách 2 nếu muốn đồng bộ 2 chiều thật sự giữa máy
tính/GitHub và Apps Script.

### Cách 1 — Upload thủ công qua giao diện web (đơn giản nhất)

1. Đăng nhập https://github.com → bấm **New** (tạo repository mới) → đặt tên
   (VD: `peeback-app`) → chọn Public hoặc Private → **Create repository**.
2. Ở trang repo vừa tạo, bấm **Add file → Upload files**.
3. Kéo thả (hoặc chọn) cả 3 file: `Code.gs`, `Index.html`, `appsscript.json`
   vào khung upload.
4. Cuộn xuống, bấm **Commit changes**.

Xong — code đã có trên GitHub để lưu trữ/backup. Lưu ý: đây chỉ là nơi lưu
trữ code, **sửa code ở đây không tự áp dụng vào Apps Script đang chạy thật** —
bạn vẫn phải copy-paste thủ công lại vào Apps Script (Phần 1) mỗi khi sửa, trừ
khi dùng Cách 2 bên dưới.

### Cách 2 — Đồng bộ 2 chiều bằng `clasp` (nâng cao, tuỳ chọn)

`clasp` là công cụ chính thức của Google để đẩy/kéo code giữa máy tính (và do
đó là GitHub) với Apps Script. Cần cài Node.js trên máy tính bạn dùng để thao
tác (không phải trên VPS hay server nào).

1. Cài Node.js nếu chưa có: https://nodejs.org (bản LTS).
2. Mở Terminal (Mac) hoặc PowerShell/CMD (Windows), cài `clasp`:
   ```
   npm install -g @google/clasp
   ```
3. Đăng nhập bằng tài khoản Google đang sở hữu Apps Script:
   ```
   clasp login
   ```
4. Trong Apps Script (Phần 1), vào **Project Settings (biểu tượng bánh răng)**
   → copy **Script ID**.
5. Tạo 1 thư mục trên máy, đặt 3 file `Code.gs`, `Index.html`,
   `appsscript.json` vào đó, rồi tạo file `.clasp.json` cùng thư mục:
   ```json
   { "scriptId": "DÁN_SCRIPT_ID_VÀO_ĐÂY", "rootDir": "." }
   ```
6. Đẩy code từ máy lên Apps Script:
   ```
   clasp push
   ```
   Từ giờ có thể sửa code ngay trên máy (VS Code chẳng hạn), chạy `clasp push`
   là áp dụng luôn vào Apps Script — không cần copy-paste tay.
7. Đưa thư mục này lên GitHub bằng git bình thường:
   ```
   git init
   git add .
   git commit -m "HoanVi initial commit"
   git remote add origin https://github.com/<username>/peeback-app.git
   git push -u origin main
   ```
   (Tạo repo rỗng trên GitHub trước như bước 1 của Cách 1, rồi lấy đúng link
   remote dán vào lệnh trên.)

---

## PHẦN 4 — Checklist tự kiểm tra

Mình đã kiểm tra kỹ cú pháp code (không lỗi), nhưng không gọi được tới Google
Apps Script/Sheets từ môi trường của mình để chạy thử trực tiếp. Bạn tự test
theo thứ tự sau, vướng đâu chụp lỗi (F12 → tab Console trên trình duyệt) gửi
lại:

1. Đăng ký tài khoản mới → nhận mã qua email → xác nhận → vào được trang chủ.
2. Dán 1 link sản phẩm Shopee (thử cả link đầy đủ và link rút gọn `s.shopee.vn/...`)
   → sau vài giây thấy ảnh + tên sản phẩm hiện ra, nút "Mua hàng hoàn tiền"
   có link — kiểm tra trong Google Sheet tab `Links` có dòng mới.
3. Gán tài khoản đó thành `admin` (Phần 2) → vào tab **Quản trị** → thấy link
   vừa tạo → nhập hoa hồng gốc (VD 100000) → bấm "Cập nhật hoa hồng" → kiểm
   tra Sheet tab `Links`: `UserCommission` phải bằng
   `round(100000 × 0.99 × 0.90 × 0.85)` ≈ 75.735.
4. Quay lại tab **Ví của tôi** của tài khoản đó → thấy số dư khả dụng đã cộng
   đúng số tiền ở bước 3.
5. Gửi yêu cầu rút tiền (nhập ngân hàng/STK) → sang tab Quản trị → mục "Yêu
   cầu rút tiền chờ duyệt" → bấm "Duyệt, đã chuyển" → quay lại Ví kiểm tra
   trạng thái và số dư đã trừ đúng.
6. Thử "Quên mật khẩu" → nhận mã qua email → đặt lại thành công.
7. Thử nút "↻ Cập nhật tên & hình sản phẩm" ở trang Quản trị — dùng để backfill
   cho các link cũ (nếu có) chưa có ảnh/tên.

## PHẦN 5 — Thương hiệu Peeback & cài app ngoài màn hình chính

- Đã đổi toàn bộ tên thương hiệu trong `Code.gs`/`Index.html` từ "HoànVí"
  sang **Peeback** (tiêu đề trang, email xác nhận, footer...).
- Logo bạn gửi đã được cắt gọn phần biểu tượng (túi + đồng xu + mũi tên) và
  **nhúng thẳng vào `Index.html`** dưới dạng base64 — favicon, apple-touch-icon,
  và logo ở góc trên cùng đều dùng chung 1 ảnh, không phụ thuộc file ngoài
  nào, không lo mất/hỏng link ảnh.
- Kèm theo bộ **"Peeback App Shell"** riêng (xem thư mục `peeback-pwa/` trong
  file zip) — đây là 6 file nhỏ để đưa app lên GitHub Pages dưới dạng "vỏ app"
  (icon riêng ngoài màn hình điện thoại, mở toàn màn hình không thấy thanh
  địa chỉ trình duyệt). Xem `peeback-pwa/README.md` để làm theo — chỉ cần
  sửa 1 dòng link Apps Script rồi upload lên GitHub Pages.

## PHẦN 6 — Sự khác biệt với "2 file nhỏ" bạn từng nghe qua

Nếu bạn từng đọc hướng dẫn kiểu "chỉ cần thêm `manifest.json` và
`service-worker.js`" — hướng dẫn đó giả định bạn **đã có sẵn 1 trang
`index.html`** đang chạy trên GitHub Pages để 2 file kia "bám" vào. Vì app
Peeback của bạn chạy trên Apps Script (không phải GitHub Pages), mình đã làm
thêm đúng 1 trang `index.html` nhỏ (chỉ để nhúng app thật qua khung iframe)
để 2 file `manifest.json`/`service-worker.js` có chỗ hoạt động — xem chi tiết
ở `peeback-pwa/README.md`.

## Giới hạn cần biết

- Email xác nhận/đặt lại mật khẩu gửi qua `MailApp` — tài khoản Gmail cá nhân
  miễn phí có hạn mức khoảng 100 email/ngày; nếu hệ thống đông người dùng,
  cân nhắc dùng Google Workspace (hạn mức cao hơn) hoặc dịch vụ email riêng.
- Việc lấy tên/ảnh sản phẩm gọi tới API nội bộ và trang HTML công khai của
  Shopee — nếu Shopee thay đổi cấu trúc hoặc chặn request, phần này có thể
  không lấy được, nhưng **không ảnh hưởng** đến việc tạo link affiliate (link
  vẫn tạo và hoạt động bình thường).
- Quyền admin gán thủ công qua cột `Role` trong Sheet — hãy chắc chắn chỉ chia
  sẻ quyền chỉnh sửa Google Sheet gốc cho người bạn tin tưởng.
