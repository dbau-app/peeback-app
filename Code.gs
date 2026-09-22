/* =========================================================
   HOÀNVÍ — Backend (Google Apps Script + Google Sheets)
   Mở file này từ trong chính Google Sheet dữ liệu của bạn
   (Tiện ích mở rộng > Apps Script) để SpreadsheetApp.getActiveSpreadsheet()
   tự động trỏ đúng vào Sheet đó.

   PHÂN QUYỀN: quyền admin gắn theo tài khoản trong sheet Users
   (cột Role = admin / customer). Tài khoản admin đầu tiên phải
   được gán thủ công (xem hướng dẫn triển khai).

   LINK AFFILIATE: dùng đúng định dạng chính thức của Shopee
   (an_redir) — xem hàm toAffiliateLink() bên dưới.
   ========================================================= */

var SHEET_USERS = 'Users';
var SHEET_LINKS = 'Links';
var SHEET_WD = 'Withdrawals';
var SHEET_TX = 'Transactions';

// Mã Affiliate ID Shopee của bạn (số thuần, không có tiền tố "an_")
var SHOPEE_AFFILIATE_ID = '17355030107';
var USER_SHARE_RATE = 0.85;             // 85% hoa hồng thực nhận trả về thành viên, 15% admin giữ
var PLATFORM_FEE_RATE = 0.01;           // 1% phí sàn trừ trên hoa hồng Shopee duyệt
var PERSONAL_INCOME_TAX_RATE = 0.10;    // 10% thuế TNCN trừ sau phí sàn
var MIN_WITHDRAW = 50000;
var CODE_TTL_MINUTES = 10;

/* ---------- Web app entry point ---------- */
function doGet(e) {
  ensureSheets();
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Peeback')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* ---------- Sheet setup ---------- */
function ensureSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var specs = {
    Users: ['ID', 'Name', 'Email', 'PasswordHash', 'Salt', 'Verified', 'VerifyCode', 'VerifyExpiry', 'Token', 'TokenExpiry', 'Role', 'TrackingCode', 'CreatedAt'],
    // ProductName + ProductImage được thêm ở cuối để KHÔNG làm lệch
    // các cột commission hiện có của sheet Links.
    Links: ['ID', 'UserId', 'OriginalUrl', 'CleanUrl', 'AffiliateUrl', 'SubId', 'Status', 'GrossCommission', 'NetCommission', 'UserCommission', 'AdminCommission', 'CreatedAt', 'UpdatedAt', 'ProductName', 'ProductImage'],
    Withdrawals: ['ID', 'UserId', 'Amount', 'Bank', 'Account', 'Holder', 'Status', 'CreatedAt'],
    Transactions: ['ID', 'UserId', 'Type', 'Amount', 'Sign', 'Date', 'RelatedId']
  };
  Object.keys(specs).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.appendRow(specs[name]);
      sh.setFrozenRows(1);
      return;
    }

    // Migration an toàn: nếu sheet đã tồn tại từ phiên bản cũ,
    // tự động thêm các header mới ở CUỐI sheet.
    var lastCol = sh.getLastColumn();
    var headers = lastCol > 0
      ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function(v){ return String(v).trim(); })
      : [];

    specs[name].forEach(function(header) {
      if (headers.indexOf(header) === -1) {
        sh.getRange(1, sh.getLastColumn() + 1).setValue(header);
        headers.push(header);
      }
    });

    if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);
  });
}

function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

/* ---------- Helpers ---------- */
function genId(prefix, len) {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var s = '';
  for (var i = 0; i < (len || 6); i++) s += chars[Math.floor(Math.random() * chars.length)];
  return (prefix || '') + s;
}

function genVerifyCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashPass(password, salt) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + salt);
  return raw.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function findUserByEmail(email) {
  var sh = getSheet(SHEET_USERS);
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][2]).toLowerCase() === String(email).toLowerCase()) return { row: i + 1, values: data[i] };
  }
  return null;
}

function getUserByToken(token) {
  if (!token) return null;
  var sh = getSheet(SHEET_USERS);
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][8] && data[i][8] === token) {
      if (new Date(data[i][9]) < new Date()) return null;
      return {
        row: i + 1, id: data[i][0], name: data[i][1], email: data[i][2],
        role: data[i][10] || 'customer', trackingCode: data[i][11]
      };
    }
  }
  return null;
}

function requireAdmin(token) {
  var u = getUserByToken(token);
  if (!u || u.role !== 'admin') return null;
  return u;
}

function formatDate(d) {
  if (!(d instanceof Date)) d = new Date(d);
  return Utilities.formatDate(d, Session.getScriptTimeZone() || 'Asia/Ho_Chi_Minh', 'dd/MM/yyyy HH:mm');
}

function sendVerificationEmail(email, name, code) {
  var subject = 'Mã xác nhận Peeback của bạn';
  var body = 'Chào ' + name + ',\n\n' +
    'Mã xác nhận tài khoản Peeback của bạn là: ' + code + '\n\n' +
    'Mã có hiệu lực trong ' + CODE_TTL_MINUTES + ' phút. Nếu bạn không yêu cầu đăng ký, vui lòng bỏ qua email này.';
  MailApp.sendEmail(email, subject, body);
}

/* ---------- Auth: đăng ký + xác nhận email ---------- */
function registerUser(name, email, password) {
  ensureSheets();
  name = (name || '').trim();
  email = (email || '').trim().toLowerCase();
  password = password || '';
  if (!name || !email || !password) return { success: false, message: 'Vui lòng nhập đầy đủ thông tin.' };
  if (!isValidEmail(email)) return { success: false, message: 'Email không hợp lệ.' };
  if (password.length < 6) return { success: false, message: 'Mật khẩu tối thiểu 6 ký tự.' };

  var existing = findUserByEmail(email);
  var code = genVerifyCode();
  var expiry = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);
  var salt = Utilities.getUuid();
  var hash = hashPass(password, salt);
  var sh = getSheet(SHEET_USERS);

  if (existing) {
    if (existing.values[5] === true) return { success: false, message: 'Email này đã được đăng ký. Vui lòng đăng nhập.' };
    sh.getRange(existing.row, 2).setValue(name);
    sh.getRange(existing.row, 4).setValue(hash);
    sh.getRange(existing.row, 5).setValue(salt);
    sh.getRange(existing.row, 7).setValue(code);
    sh.getRange(existing.row, 8).setValue(expiry);
  } else {
    var id = 'U-' + genId('', 6);
    var trackingCode = genId('', 8); // Mã tracking cố định, riêng biệt cho từng tài khoản — dùng trong sub_id
    // Cột: ID,Name,Email,PasswordHash,Salt,Verified,VerifyCode,VerifyExpiry,Token,TokenExpiry,Role,TrackingCode,CreatedAt
    sh.appendRow([id, name, email, hash, salt, false, code, expiry, '', '', 'customer', trackingCode, new Date()]);
  }

  sendVerificationEmail(email, name, code);
  return { success: true, email: email, message: 'Đã gửi mã xác nhận đến ' + email + '.' };
}

function verifyEmail(email, code) {
  ensureSheets();
  email = (email || '').trim().toLowerCase();
  var found = findUserByEmail(email);
  if (!found) return { success: false, message: 'Email chưa được đăng ký.' };
  var row = found.values;
  if (row[5] === true) return { success: false, message: 'Email này đã được xác nhận, vui lòng đăng nhập.' };
  if (String(row[6]) !== String(code).trim()) return { success: false, message: 'Mã xác nhận không đúng.' };
  if (new Date(row[7]) < new Date()) return { success: false, message: 'Mã xác nhận đã hết hạn, vui lòng gửi lại mã.' };

  var token = Utilities.getUuid();
  var expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  var sh = getSheet(SHEET_USERS);
  sh.getRange(found.row, 6).setValue(true);
  sh.getRange(found.row, 7).setValue('');
  sh.getRange(found.row, 9).setValue(token);
  sh.getRange(found.row, 10).setValue(expiry);
  return { success: true, token: token, user: { id: row[0], name: row[1], email: row[2], role: row[10] || 'customer', trackingCode: row[11] } };
}

function resendVerification(email) {
  ensureSheets();
  email = (email || '').trim().toLowerCase();
  var found = findUserByEmail(email);
  if (!found) return { success: false, message: 'Email chưa được đăng ký.' };
  if (found.values[5] === true) return { success: false, message: 'Email này đã được xác nhận, vui lòng đăng nhập.' };

  var code = genVerifyCode();
  var expiry = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);
  var sh = getSheet(SHEET_USERS);
  sh.getRange(found.row, 7).setValue(code);
  sh.getRange(found.row, 8).setValue(expiry);
  sendVerificationEmail(email, found.values[1], code);
  return { success: true, message: 'Đã gửi lại mã xác nhận.' };
}

function loginUser(email, password) {
  ensureSheets();
  email = (email || '').trim().toLowerCase();
  var found = findUserByEmail(email);
  if (!found) return { success: false, message: 'Email chưa được đăng ký.' };
  var row = found.values;
  if (hashPass(password, row[4]) !== row[3]) return { success: false, message: 'Mật khẩu không đúng.' };
  if (row[5] !== true) return { success: false, needVerify: true, email: row[2], message: 'Vui lòng xác nhận email trước khi đăng nhập.' };

  var token = Utilities.getUuid();
  var expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  var sh = getSheet(SHEET_USERS);
  sh.getRange(found.row, 9).setValue(token);
  sh.getRange(found.row, 10).setValue(expiry);
  return { success: true, token: token, user: { id: row[0], name: row[1], email: row[2], role: row[10] || 'customer', trackingCode: row[11] } };
}

function logoutUser(token) {
  var sh = getSheet(SHEET_USERS);
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][8] === token) { sh.getRange(i + 1, 9).setValue(''); break; }
  }
  return { success: true };
}

/* ---------- Đổi mật khẩu (khi đã đăng nhập) ---------- */
function changePassword(token, oldPassword, newPassword) {
  var user = getUserByToken(token);
  if (!user) return { success: false, message: 'Phiên đăng nhập đã hết hạn.' };
  if (!newPassword || newPassword.length < 6) return { success: false, message: 'Mật khẩu mới tối thiểu 6 ký tự.' };

  var sh = getSheet(SHEET_USERS);
  var row = sh.getRange(user.row, 1, 1, sh.getLastColumn()).getValues()[0];
  if (hashPass(oldPassword || '', row[4]) !== row[3]) return { success: false, message: 'Mật khẩu hiện tại không đúng.' };

  var salt = Utilities.getUuid();
  var hash = hashPass(newPassword, salt);
  sh.getRange(user.row, 4).setValue(hash);
  sh.getRange(user.row, 5).setValue(salt);
  return { success: true };
}

/* ---------- Quên mật khẩu (chưa đăng nhập) ---------- */
function sendPasswordResetEmail(email, name, code) {
  var subject = 'Mã đặt lại mật khẩu Peeback';
  var body = 'Chào ' + name + ',\n\n' +
    'Mã đặt lại mật khẩu Peeback của bạn là: ' + code + '\n\n' +
    'Mã có hiệu lực trong ' + CODE_TTL_MINUTES + ' phút. Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.';
  MailApp.sendEmail(email, subject, body);
}

function requestPasswordReset(email) {
  ensureSheets();
  email = (email || '').trim().toLowerCase();
  var found = findUserByEmail(email);
  if (!found) return { success: false, message: 'Email chưa được đăng ký.' };

  var code = genVerifyCode();
  var expiry = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);
  var sh = getSheet(SHEET_USERS);
  sh.getRange(found.row, 7).setValue(code);
  sh.getRange(found.row, 8).setValue(expiry);
  sendPasswordResetEmail(email, found.values[1], code);
  return { success: true, message: 'Đã gửi mã đặt lại mật khẩu đến ' + email + '.' };
}

function resetPassword(email, code, newPassword) {
  ensureSheets();
  email = (email || '').trim().toLowerCase();
  var found = findUserByEmail(email);
  if (!found) return { success: false, message: 'Email chưa được đăng ký.' };
  var row = found.values;
  if (String(row[6]) !== String(code).trim()) return { success: false, message: 'Mã xác nhận không đúng.' };
  if (new Date(row[7]) < new Date()) return { success: false, message: 'Mã xác nhận đã hết hạn, vui lòng gửi lại mã.' };
  if (!newPassword || newPassword.length < 6) return { success: false, message: 'Mật khẩu mới tối thiểu 6 ký tự.' };

  var salt = Utilities.getUuid();
  var hash = hashPass(newPassword, salt);
  var token = Utilities.getUuid();
  var expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  var sh = getSheet(SHEET_USERS);
  sh.getRange(found.row, 4).setValue(hash);
  sh.getRange(found.row, 5).setValue(salt);
  sh.getRange(found.row, 7).setValue('');
  if (row[5] !== true) sh.getRange(found.row, 6).setValue(true); // xác nhận luôn email nếu chưa verify
  sh.getRange(found.row, 9).setValue(token);
  sh.getRange(found.row, 10).setValue(expiry);
  return { success: true, token: token, user: { id: row[0], name: row[1], email: row[2], role: row[10] || 'customer', trackingCode: row[11] } };
}

/* ---------- Shopee: làm sạch link + gắn affiliate theo đúng chuẩn an_redir ---------- */
// Nhận diện mọi tên miền Shopee hay gặp: trang chính, link rút gọn các kiểu
// Nhận diện tương đối 1 host có phải Shopee hay không (dùng để xác nhận SAU
// khi đã theo hết redirect — không dùng để chặn link ở bước đầu, vì Shopee có
// nhiều domain rút gọn khác nhau và có thể đổi/thêm domain mới bất kỳ lúc nào)
function isShopeeHost(url) {
  var m = url.match(/^https?:\/\/([^\/]+)/i);
  var host = m ? m[1].toLowerCase() : '';
  return host.indexOf('shopee') > -1 || host.indexOf('shpee') > -1 || host.indexOf('shp.ee') > -1;
}

// Chỉ kiểm tra xem chuỗi nhập vào có "giống" 1 URL hay không (để không cố xử
// lý những thứ rõ ràng không phải link)
function looksLikeUrl(url) {
  return /^https?:\/\/[^\s]+\.[^\s]+/i.test(url);
}

// Người dùng có thể dán link thiếu "https://" phía trước — tự thêm vào
function normalizeUrlInput(url) {
  url = (url || '').trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  return url;
}

// Nếu link dán vào đã là link affiliate (an_redir?origin_link=...) — của Shopee
// hoặc của một hệ thống khác — lấy đúng link gốc được mã hoá bên trong ra
function extractOriginLink(url) {
  var m = url.match(/[?&]origin_link=([^&]+)/i);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
}

// Trích xuất shopid/itemid từ mọi định dạng link sản phẩm Shopee hay gặp:
// /product/<shopid>/<itemid> · ...-i.<shopid>.<itemid> · ?shopid=&itemid=
// · /<slug-bat-ky>/<shopid>/<itemid> (vd: link tracking affiliate co dang
//   /opaanlp/1422928233/45400840271 — slug khong co dang "product")
function extractShopItem(url) {
  var m1 = url.match(/-i\.(\d+)\.(\d+)/);
  if (m1) return { shopId: m1[1], itemId: m1[2] };
  var m2 = url.match(/\/product\/(\d+)\/(\d+)/);
  if (m2) return { shopId: m2[1], itemId: m2[2] };
  var mShop = url.match(/[?&]shopid=(\d+)/i);
  var mItem = url.match(/[?&]itemid=(\d+)/i);
  if (mShop && mItem) return { shopId: mShop[1], itemId: mItem[1] };
  // Fallback tong quat: 2 doan duong dan lien tiep la so thuan (bo qua
  // slug phia truoc, vi Shopee dung nhieu slug khac nhau tuy nguon link)
  var m3 = url.match(/\/(\d{5,12})\/(\d{5,15})(?:[/?#]|$)/);
  if (m3) return { shopId: m3[1], itemId: m3[2] };
  return null;
}

// Theo dõi redirect thủ công để lấy URL đích cuối cùng của các link rút gọn.
// Trả về chính url đầu vào nếu không có redirect (response 200) hoặc lỗi mạng.
function resolveRedirect(url, maxHops) {
  var current = url;
  for (var i = 0; i < (maxHops || 5); i++) {
    var res;
    try {
      res = UrlFetchApp.fetch(current, { followRedirects: false, muteHttpExceptions: true });
    } catch (e) {
      break;
    }
    var code = res.getResponseCode();
    if (code >= 300 && code < 400) {
      var headers = res.getAllHeaders();
      var loc = headers['Location'] || headers['location'];
      if (!loc) break;
      if (loc.indexOf('http') !== 0) {
        var m = current.match(/^https?:\/\/[^\/]+/);
        loc = (m ? m[0] : '') + loc;
      }
      current = loc;
    } else {
      break;
    }
  }
  return current;
}

// Làm sạch MỌI biến thể link Shopee — link dài, link rút gọn (bất kỳ domain
// rút gọn nào: s.shopee.vn, shope.ee, shp.ee, shpee.vn, hay domain mới nào
// Shopee dùng sau này), link web, link đã có sẵn tracking/affiliate cũ — về
// đúng link sản phẩm gốc, không kèm query rác.
//
// Cách làm: KHÔNG đoán trước domain rút gọn có phải Shopee hay không — cứ
// theo hết chuỗi redirect thực tế của link, rồi mới kiểm tra xem điểm đến
// cuối cùng có phải Shopee hay không. Nhờ vậy hệ thống tự động hỗ trợ được
// mọi domain rút gọn Shopee đang dùng hoặc sẽ dùng trong tương lai.
function cleanShopeeLink(rawUrl) {
  var url = normalizeUrlInput(rawUrl);
  if (!looksLikeUrl(url)) return null;

  for (var iter = 0; iter < 6; iter++) {
    var origin = extractOriginLink(url);
    if (origin) { url = normalizeUrlInput(origin); continue; }

    var item = extractShopItem(url);
    if (item) return 'https://shopee.vn/product/' + item.shopId + '/' + item.itemId;

    var resolved = resolveRedirect(url);
    if (resolved !== url) { url = resolved; continue; }

    break;
  }

  if (!isShopeeHost(url)) return null; // Sau khi theo hết redirect, không dẫn tới Shopee

  // Không nhận diện được shopid/itemid (vd: link trang shop, trang chủ, link
  // voucher...) — vẫn dùng được, chỉ bỏ query rác phía sau
  return url.split('?')[0];
}

// Mỗi tài khoản có 1 mã tracking cố định (TrackingCode) — dùng làm sub_id để
// đối soát hoa hồng theo tài khoản. Không gắn thêm thông tin theo từng link.
function buildSubId(userTrackingCode) {
  return [userTrackingCode, '0', '0', '0', '0'].join('-');
}

// Dựng đúng link affiliate theo chuẩn chính thức của Shopee (an_redir):
// https://s.shopee.vn/an_redir?origin_link=<origin_link đã mã hoá>&affiliate_id=...&sub_id=...
function toAffiliateLink(cleanUrl, subId) {
  var encodedOrigin = encodeURIComponent(cleanUrl);
  return 'https://s.shopee.vn/an_redir?origin_link=' + encodedOrigin +
    '&affiliate_id=' + SHOPEE_AFFILIATE_ID + '&sub_id=' + subId;
}


/* =========================================================
   SHOPEE PRODUCT METADATA
   Lấy tên + hình sản phẩm để hiển thị ở User và Admin.
   Không làm fail việc tạo affiliate link nếu Shopee chặn metadata.
   ========================================================= */

function decodeHtmlEntities(str) {
  str = String(str || '');

  var named = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' '
  };

  Object.keys(named).forEach(function(k) {
    str = str.split(k).join(named[k]);
  });

  str = str.replace(/&#(\d+);/g, function(_, n) {
    try { return String.fromCharCode(parseInt(n, 10)); } catch (e) { return _; }
  });

  str = str.replace(/&#x([0-9a-f]+);/gi, function(_, n) {
    try { return String.fromCharCode(parseInt(n, 16)); } catch (e) { return _; }
  });

  return str;
}

function cleanProductName(name) {
  name = decodeHtmlEntities(String(name || ''))
    .replace(/\\s+/g, ' ')
    .trim();

  // Bỏ hậu tố thường gặp của title trang Shopee.
  name = name
    .replace(/\s*[|·-]\s*Shopee(?:\s+Việt Nam)?\s*$/i, '')
    .replace(/\s*-\s*Shopee\.vn\s*$/i, '')
    .trim();

  return name;
}

function extractMetaContent(html, attr, value) {
  html = String(html || '');
  attr = String(attr || '');
  value = String(value || '');

  var escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // <meta property="og:title" content="...">
  var re1 = new RegExp(
    '<meta[^>]+(?:' + attr + ')=[\'"]' + escaped +
    '[\'"][^>]+content=[\'"]([^\'"]+)[\'"]',
    'i'
  );

  var m = html.match(re1);
  if (m) return decodeHtmlEntities(m[1]);

  // <meta content="..." property="og:title">
  var re2 = new RegExp(
    '<meta[^>]+content=[\'"]([^\'"]+)[\'"][^>]+(?:' + attr +
    ')=[\'"]' + escaped + '[\'"]',
    'i'
  );

  m = html.match(re2);
  return m ? decodeHtmlEntities(m[1]) : '';
}

function extractJsonLdProduct(html) {
  var out = { name: '', image: '' };
  var re = /<script[^>]+type=[\'"]application\/ld\+json[\'"][^>]*>([\s\S]*?)<\/script>/gi;
  var m;

  while ((m = re.exec(html)) !== null) {
    try {
      var raw = m[1]
        .replace(/^\s*<!--/, '')
        .replace(/-->\s*$/, '')
        .trim();

      var data = JSON.parse(raw);
      var items = Array.isArray(data) ? data : [data];

      // Một số JSON-LD chứa @graph.
      items.forEach(function(item) {
        if (!item) return;

        if (item['@graph'] && Array.isArray(item['@graph'])) {
          items = items.concat(item['@graph']);
        }

        var type = item['@type'];
        var isProduct = type === 'Product' ||
          (Array.isArray(type) && type.indexOf('Product') > -1);

        if (!isProduct) return;

        if (!out.name && item.name) out.name = cleanProductName(item.name);

        if (!out.image && item.image) {
          if (Array.isArray(item.image)) {
            out.image = item.image[0] || '';
          } else if (typeof item.image === 'string') {
            out.image = item.image;
          } else if (item.image.url) {
            out.image = item.image.url;
          }
        }
      });
    } catch (e) {
      // JSON-LD lỗi không làm hỏng luồng lấy link.
    }
  }

  return out;
}

function normalizeShopeeImage(image) {
  image = String(image || '').trim();
  if (!image) return '';

  if (/^https?:\/\//i.test(image)) return image;

  // Shopee API thường trả về file id.
  if (/^[A-Za-z0-9_-]{10,}$/.test(image)) {
    return 'https://down-vn.img.susercontent.com/file/' + image;
  }

  return image;
}

function fetchShopeeItemApiMetadata(cleanUrl) {
  var out = { name: '', image: '' };
  var item = extractShopItem(cleanUrl);
  if (!item) { Logger.log('[ItemAPI] Khong tach duoc shopId/itemId tu: ' + cleanUrl); return out; }

  var apiUrl =
    'https://shopee.vn/api/v4/item/get?shopid=' +
    encodeURIComponent(item.shopId) +
    '&itemid=' +
    encodeURIComponent(item.itemId);

  try {
    var res = UrlFetchApp.fetch(apiUrl, {
      method: 'get',
      followRedirects: true,
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
        'Accept': 'application/json,text/plain,*/*',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://shopee.vn/'
      }
    });

    var code = res.getResponseCode();
    var bodySnippet = res.getContentText().slice(0, 300);
    Logger.log('[ItemAPI] URL=' + apiUrl + ' | HTTP=' + code + ' | Body(300 ky tu dau)=' + bodySnippet);

    if (code < 200 || code >= 300) {
      return out;
    }

    var json = JSON.parse(res.getContentText());
    var data = json && json.data ? json.data : {};
    var product = data.item || data;

    if (product) {
      out.name = cleanProductName(product.name || product.title || '');

      var images = product.images || product.image_list || [];
      if (Array.isArray(images) && images.length) {
        out.image = normalizeShopeeImage(images[0]);
      }

      if (!out.image && product.image) {
        out.image = normalizeShopeeImage(product.image);
      }
    }
    Logger.log('[ItemAPI] Ket qua parse: name=' + out.name + ' | image=' + out.image);
  } catch (e) {
    Logger.log('[ItemAPI] Loi: ' + e.message);
    // Fallback sang HTML bên dưới.
  }

  return out;
}

function fetchShopeeHtmlMetadata(cleanUrl) {
  var out = { name: '', image: '' };

  try {
    var res = UrlFetchApp.fetch(cleanUrl, {
      method: 'get',
      followRedirects: true,
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });

    var html = res.getContentText();
    Logger.log('[HTML] URL=' + cleanUrl + ' | HTTP=' + res.getResponseCode() + ' | do dai HTML=' + (html ? html.length : 0) + ' | 200 ky tu dau=' + (html ? html.slice(0, 200) : ''));
    if (!html) return out;

    out.name = cleanProductName(
      extractMetaContent(html, 'property', 'og:title') ||
      extractMetaContent(html, 'name', 'twitter:title') ||
      extractMetaContent(html, 'property', 'twitter:title')
    );

    out.image = normalizeShopeeImage(
      extractMetaContent(html, 'property', 'og:image') ||
      extractMetaContent(html, 'property', 'og:image:secure_url') ||
      extractMetaContent(html, 'name', 'twitter:image')
    );

    var jsonLd = extractJsonLdProduct(html);

    if (!out.name && jsonLd.name) out.name = jsonLd.name;
    if (!out.image && jsonLd.image) out.image = normalizeShopeeImage(jsonLd.image);

    // Fallback cuối cùng: <title>
    if (!out.name) {
      var titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (titleMatch) out.name = cleanProductName(titleMatch[1]);
    }
    Logger.log('[HTML] Ket qua parse: name=' + out.name + ' | image=' + out.image);
  } catch (e) {
    Logger.log('[HTML] Loi: ' + e.message);
    // Không throw để affiliate link vẫn được tạo.
  }

  return out;
}

function fetchShopeeProductMetadata(cleanUrl) {
  var out = { name: '', image: '' };

  // 1. Ưu tiên API sản phẩm vì thường cho tên + image chính xác hơn.
  var apiMeta = fetchShopeeItemApiMetadata(cleanUrl);
  if (apiMeta.name) out.name = apiMeta.name;
  if (apiMeta.image) out.image = apiMeta.image;

  // 2. Fallback HTML Open Graph / JSON-LD.
  if (!out.name || !out.image) {
    var htmlMeta = fetchShopeeHtmlMetadata(cleanUrl);
    if (!out.name) out.name = htmlMeta.name;
    if (!out.image) out.image = htmlMeta.image;
  }

  return {
    name: cleanProductName(out.name),
    image: normalizeShopeeImage(out.image)
  };
}

function getLinkColumnMap() {
  ensureSheets();
  var sh = getSheet(SHEET_LINKS);
  var lastCol = sh.getLastColumn();
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];

  var map = {};
  headers.forEach(function(h, i) {
    map[String(h).trim()] = i + 1;
  });

  return map;
}

/*
 * Chạy 1 lần sau khi deploy phiên bản này để bổ sung
 * ProductName/ProductImage cho các link cũ.
 *
 * Có thể chạy trực tiếp trong Apps Script bằng hàm:
 * backfillProductMetadata()
 */
function backfillProductMetadata() {
  ensureSheets();

  var sh = getSheet(SHEET_LINKS);
  var data = sh.getDataRange().getValues();
  if (data.length <= 1) {
    return { success: true, updated: 0, total: 0 };
  }

  var map = getLinkColumnMap();
  var nameCol = map.ProductName;
  var imageCol = map.ProductImage;

  if (!nameCol || !imageCol) {
    throw new Error('Thiếu cột ProductName/ProductImage trong sheet Links.');
  }

  var updated = 0;

  for (var i = 1; i < data.length; i++) {
    var cleanUrl = data[i][3];
    var oldName = data[i][nameCol - 1];
    var oldImage = data[i][imageCol - 1];

    if (!cleanUrl) continue;
    if (oldName && oldImage) continue;

    try {
      var meta = fetchShopeeProductMetadata(cleanUrl);

      if (meta.name) sh.getRange(i + 1, nameCol).setValue(meta.name);
      if (meta.image) sh.getRange(i + 1, imageCol).setValue(meta.image);

      if (meta.name || meta.image) updated++;

      Utilities.sleep(300);
    } catch (e) {
      console.log('Backfill row ' + (i + 1) + ': ' + e.message);
    }
  }

  return {
    success: true,
    updated: updated,
    total: data.length - 1
  };
}

/*
 * Admin có thể gọi từ giao diện để cập nhật metadata cho các link
 * đang thiếu tên/hình. Giới hạn mỗi lần chạy theo thời gian Apps Script.
 */
function adminBackfillProductMetadata(token) {
  var admin = requireAdmin(token);
  if (!admin) return { success: false, message: 'Bạn không có quyền quản trị.' };

  try {
    return backfillProductMetadata();
  } catch (e) {
    return { success: false, message: e.message || 'Không thể cập nhật dữ liệu sản phẩm.' };
  }
}

function createTrackingLink(token, productUrl) {
  var user = getUserByToken(token);
  if (!user) return { success: false, message: 'Phiên đăng nhập đã hết hạn.' };
  if (!productUrl || !productUrl.trim()) return { success: false, message: 'Vui lòng dán link sản phẩm.' };

  var url = normalizeUrlInput(productUrl);
  if (!looksLikeUrl(url)) return { success: false, message: 'Link không hợp lệ.' };

  var clean;
  try {
    clean = cleanShopeeLink(url);
  } catch (e) {
    return { success: false, message: 'Không thể xử lý link này, vui lòng thử lại.' };
  }

  if (!clean) {
    return {
      success: false,
      message: 'Link này không dẫn tới Shopee — hệ thống chỉ hỗ trợ link Shopee.'
    };
  }

  // Lấy metadata sau khi đã xác định được link sản phẩm gốc.
  // Nếu Shopee chặn metadata thì vẫn tạo affiliate link bình thường.
  var productMeta = { name: '', image: '' };
  try {
    productMeta = fetchShopeeProductMetadata(clean);
  } catch (e) {
    console.log('Product metadata error: ' + e.message);
  }

  var id = genId('LK-', 6);
  var subId = buildSubId(user.trackingCode);
  var affiliateUrl = toAffiliateLink(clean, subId);
  var now = new Date();

  var map = getLinkColumnMap();

  var row = [];
  row[map.ID - 1] = id;
  row[map.UserId - 1] = user.id;
  row[map.OriginalUrl - 1] = url;
  row[map.CleanUrl - 1] = clean;
  row[map.AffiliateUrl - 1] = affiliateUrl;
  row[map.SubId - 1] = subId;
  row[map.Status - 1] = 'Chưa có hoa hồng';
  row[map.GrossCommission - 1] = 0;
  row[map.NetCommission - 1] = 0;
  row[map.UserCommission - 1] = 0;
  row[map.AdminCommission - 1] = 0;
  row[map.CreatedAt - 1] = now;
  row[map.UpdatedAt - 1] = now;
  row[map.ProductName - 1] = productMeta.name || '';
  row[map.ProductImage - 1] = productMeta.image || '';

  // Bảo đảm đủ số cột hiện tại của sheet.
  var width = getSheet(SHEET_LINKS).getLastColumn();
  while (row.length < width) row.push('');

  getSheet(SHEET_LINKS).appendRow(row);

  return {
    success: true,
    shortLink: affiliateUrl,
    cleanLink: clean,
    productName: productMeta.name || '',
    productImage: productMeta.image || ''
  };
}

function getLinksForUser(userId) {
  var data = getSheet(SHEET_LINKS).getDataRange().getValues();
  var map = getLinkColumnMap();
  var out = [];

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][map.UserId - 1]) === String(userId)) {
      out.push({
        id: data[i][map.ID - 1],
        original: data[i][map.OriginalUrl - 1],
        clean: data[i][map.CleanUrl - 1],
        affiliate: data[i][map.AffiliateUrl - 1],
        subId: data[i][map.SubId - 1],
        status: data[i][map.Status - 1],
        gross: data[i][map.GrossCommission - 1],
        net: data[i][map.NetCommission - 1],
        userShare: data[i][map.UserCommission - 1],
        adminShare: data[i][map.AdminCommission - 1],
        created: formatDate(data[i][map.CreatedAt - 1]),
        productName: data[i][map.ProductName - 1] || '',
        productImage: data[i][map.ProductImage - 1] || ''
      });
    }
  }

  return out.reverse();
}

/* ---------- Reads: withdrawals / transactions ---------- */
function getTransactionsForUser(userId) {
  var data = getSheet(SHEET_TX).getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]) === String(userId)) {
      out.push({ id: data[i][0], type: data[i][2], amount: data[i][3], sign: data[i][4], date: formatDate(data[i][5]), relatedId: data[i][6] });
    }
  }
  return out.reverse();
}

function getWithdrawalsForUser(userId) {
  var data = getSheet(SHEET_WD).getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]) === String(userId)) {
      out.push({ id: data[i][0], amount: data[i][2], bank: data[i][3], account: data[i][4], holder: data[i][5], status: data[i][6], created: formatDate(data[i][7]) });
    }
  }
  return out.reverse();
}

function computeAvailable(userId) {
  var tx = getTransactionsForUser(userId);
  var avail = 0;
  tx.forEach(function (t) {
    if (t.sign === 'plus') avail += t.amount;
    if (t.sign === 'minus') avail -= t.amount;
  });
  return avail;
}

/* ---------- Dashboard (thành viên) ---------- */
function getDashboard(token) {
  var user = getUserByToken(token);
  if (!user) return { success: false, message: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.' };

  var links = getLinksForUser(user.id);
  var tx = getTransactionsForUser(user.id);
  var wds = getWithdrawalsForUser(user.id);

  var lifetimeCommission = 0;
  links.forEach(function (l) { if (l.status === 'Đã ghi nhận hoa hồng') lifetimeCommission += l.userShare; });
  var balanceAvailable = computeAvailable(user.id);
  var totalWithdrawn = 0;
  wds.forEach(function (w) { if (w.status === 'Đã chuyển khoản') totalWithdrawn += w.amount; });

  return {
    success: true, user: user,
    balanceAvailable: balanceAvailable, lifetimeCommission: lifetimeCommission, totalWithdrawn: totalWithdrawn,
    totalLinks: links.length, links: links.slice(0, 30), transactions: tx, withdrawals: wds
  };
}

/* ---------- Withdrawal (thành viên) ---------- */
function requestWithdrawal(token, amount, bank, account, holder) {
  var user = getUserByToken(token);
  if (!user) return { success: false, message: 'Phiên đăng nhập đã hết hạn.' };
  amount = parseInt(amount, 10) || 0;
  if (amount < MIN_WITHDRAW) return { success: false, message: 'Số tiền rút tối thiểu là ' + MIN_WITHDRAW.toLocaleString('vi-VN') + 'đ.' };
  if (!bank || !account || !holder) return { success: false, message: 'Vui lòng điền đầy đủ thông tin ngân hàng.' };
  var available = computeAvailable(user.id);
  if (amount > available) return { success: false, message: 'Số dư khả dụng không đủ.' };

  var id = genId('RT-', 6);
  getSheet(SHEET_WD).appendRow([id, user.id, amount, bank.trim(), account.trim(), holder.trim(), 'Đang xử lý', new Date()]);
  getSheet(SHEET_TX).appendRow([genId('TX-', 6), user.id, 'Yêu cầu rút tiền · ' + bank.trim() + ' ••' + account.trim().slice(-4), amount, 'minus', new Date(), id]);
  return { success: true };
}

/* =========================================================
   ADMIN — nhập/cập nhật hoa hồng link, duyệt rút tiền
   Quyền admin gắn theo tài khoản (cột Role trong sheet Users).
   ========================================================= */
function adminGetLinks(token) {
  var admin = requireAdmin(token);
  if (!admin) return { success: false, message: 'Bạn không có quyền quản trị.' };

  var users = getSheet(SHEET_USERS).getDataRange().getValues();
  var userMap = {};
  for (var i = 1; i < users.length; i++) {
    userMap[users[i][0]] = { name: users[i][1], email: users[i][2] };
  }

  var data = getSheet(SHEET_LINKS).getDataRange().getValues();
  var map = getLinkColumnMap();
  var links = [];
  var totalGross = 0, totalNet = 0, totalUserShare = 0, totalAdminShare = 0;

  for (var i = 1; i < data.length; i++) {
    var status = data[i][map.Status - 1];

    links.push({
      id: data[i][map.ID - 1],
      userId: data[i][map.UserId - 1],
      userName: (userMap[data[i][map.UserId - 1]] || {}).name || '—',
      userEmail: (userMap[data[i][map.UserId - 1]] || {}).email || '—',
      original: data[i][map.OriginalUrl - 1],
      clean: data[i][map.CleanUrl - 1],
      affiliate: data[i][map.AffiliateUrl - 1],
      subId: data[i][map.SubId - 1],
      status: status,
      gross: data[i][map.GrossCommission - 1],
      net: data[i][map.NetCommission - 1],
      userShare: data[i][map.UserCommission - 1],
      adminShare: data[i][map.AdminCommission - 1],
      created: formatDate(data[i][map.CreatedAt - 1]),
      productName: data[i][map.ProductName - 1] || '',
      productImage: data[i][map.ProductImage - 1] || ''
    });

    if (status === 'Đã ghi nhận hoa hồng') {
      totalGross += Number(data[i][map.GrossCommission - 1]) || 0;
      totalNet += Number(data[i][map.NetCommission - 1]) || 0;
      totalUserShare += Number(data[i][map.UserCommission - 1]) || 0;
      totalAdminShare += Number(data[i][map.AdminCommission - 1]) || 0;
    }
  }

  return {
    success: true,
    links: links.reverse(),
    summary: {
      totalGross: totalGross,
      totalNet: totalNet,
      totalUserShare: totalUserShare,
      totalAdminShare: totalAdminShare
    }
  };
}

// Công thức chia hoa hồng:
// 1) Hoa hồng gốc (Shopee duyệt) → trừ 1% phí sàn
// 2) Trừ tiếp 10% thuế TNCN trên phần còn lại → ra "hoa hồng thực nhận"
// 3) Hoa hồng thực nhận chia 85% cho thành viên, 15% admin giữ lại
function computeCommissionSplit(gross) {
  var afterPlatformFee = gross * (1 - PLATFORM_FEE_RATE);
  var net = Math.round(afterPlatformFee * (1 - PERSONAL_INCOME_TAX_RATE)); // hoa hồng thực nhận
  var userShare = Math.round(net * USER_SHARE_RATE);
  var adminShare = net - userShare; // phần còn lại của net, tránh lệch số do làm tròn
  return { net: net, userShare: userShare, adminShare: adminShare };
}

function adminUpdateLinkCommission(token, linkId, grossCommission) {
  var admin = requireAdmin(token);
  if (!admin) return { success: false, message: 'Bạn không có quyền quản trị.' };
  var gross = parseFloat(grossCommission);
  if (isNaN(gross) || gross < 0) return { success: false, message: 'Số tiền hoa hồng không hợp lệ.' };

  var split = computeCommissionSplit(gross);

  var sh = getSheet(SHEET_LINKS);
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === linkId) {
      var oldUserShare = data[i][9] || 0;
      var linkUserId = data[i][1];

      sh.getRange(i + 1, 7).setValue('Đã ghi nhận hoa hồng'); // Status
      sh.getRange(i + 1, 8).setValue(gross);                  // GrossCommission
      sh.getRange(i + 1, 9).setValue(split.net);              // NetCommission (thực nhận)
      sh.getRange(i + 1, 10).setValue(split.userShare);       // UserCommission (85%)
      sh.getRange(i + 1, 11).setValue(split.adminShare);      // AdminCommission (15%)
      sh.getRange(i + 1, getLinkColumnMap().UpdatedAt).setValue(new Date()); // UpdatedAt

      var delta = split.userShare - oldUserShare;
      if (delta !== 0) {
        var label = oldUserShare ? 'Điều chỉnh hoa hồng link · ' + linkId : 'Hoa hồng link · ' + linkId;
        getSheet(SHEET_TX).appendRow([genId('TX-', 6), linkUserId, label, Math.abs(delta), delta > 0 ? 'plus' : 'minus', new Date(), linkId]);
      }
      return { success: true };
    }
  }
  return { success: false, message: 'Không tìm thấy link.' };
}

function adminCancelLink(token, linkId) {
  var admin = requireAdmin(token);
  if (!admin) return { success: false, message: 'Bạn không có quyền quản trị.' };
  var sh = getSheet(SHEET_LINKS);
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === linkId) {
      var oldUserShare = data[i][9] || 0;
      var linkUserId = data[i][1];
      if (oldUserShare > 0) {
        getSheet(SHEET_TX).appendRow([genId('TX-', 6), linkUserId, 'Huỷ hoa hồng link · ' + linkId, oldUserShare, 'minus', new Date(), linkId]);
      }
      sh.getRange(i + 1, 7).setValue('Đã huỷ');  // Status
      sh.getRange(i + 1, 8).setValue(0);          // GrossCommission
      sh.getRange(i + 1, 9).setValue(0);          // NetCommission
      sh.getRange(i + 1, 10).setValue(0);         // UserCommission
      sh.getRange(i + 1, 11).setValue(0);         // AdminCommission
      sh.getRange(i + 1, getLinkColumnMap().UpdatedAt).setValue(new Date()); // UpdatedAt
      return { success: true };
    }
  }
  return { success: false, message: 'Không tìm thấy link.' };
}

function adminGetWithdrawals(token) {
  var admin = requireAdmin(token);
  if (!admin) return { success: false, message: 'Bạn không có quyền quản trị.' };
  var users = getSheet(SHEET_USERS).getDataRange().getValues();
  var userMap = {};
  for (var i = 1; i < users.length; i++) userMap[users[i][0]] = { name: users[i][1], email: users[i][2] };

  var data = getSheet(SHEET_WD).getDataRange().getValues();
  var out = [];
  for (var i = 1; i < data.length; i++) {
    if (data[i][6] === 'Đang xử lý') {
      out.push({
        id: data[i][0], userName: (userMap[data[i][1]] || {}).name || '—',
        amount: data[i][2], bank: data[i][3], account: data[i][4], holder: data[i][5],
        created: formatDate(data[i][7])
      });
    }
  }
  return { success: true, withdrawals: out.reverse() };
}

function adminCompleteWithdrawal(token, withdrawId) {
  var admin = requireAdmin(token);
  if (!admin) return { success: false, message: 'Bạn không có quyền quản trị.' };
  var sh = getSheet(SHEET_WD);
  var data = sh.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === withdrawId) {
      sh.getRange(i + 1, 7).setValue('Đã chuyển khoản');
      return { success: true };
    }
  }
  return { success: false, message: 'Không tìm thấy yêu cầu rút tiền.' };
}

/* =========================================================
   HÀM TEST THỦ CÔNG — chạy trực tiếp trong Apps Script để xem
   Shopee trả về gì khi lấy tên/ảnh sản phẩm (chẩn đoán lỗi
   "không xem trước được sản phẩm").

   Cách dùng:
   1. Sửa dòng TEST_URL bên dưới thành 1 link sản phẩm Shopee thật.
   2. Ở thanh công cụ Apps Script, chọn hàm "testProductPreview"
      trong ô dropdown, bấm nút ▶ (Run).
   3. Xem kết quả ở "Execution log" (View > Logs, hoặc Ctrl+Enter).
   ========================================================= */
function testProductPreview() {
  var TEST_URL = 'https://s.shopee.vn/5Asda4ZHxK';

  Logger.log('===== BƯỚC 1: Làm sạch link =====');
  var clean = cleanShopeeLink(TEST_URL);
  Logger.log('Link sau khi làm sạch: ' + clean);

  if (!clean) {
    Logger.log('=> cleanShopeeLink() trả về null, nghĩa là link không được nhận diện là Shopee sau khi theo redirect. Kiểm tra lại TEST_URL.');
    return;
  }

  Logger.log('===== BƯỚC 2: Gọi API sản phẩm Shopee =====');
  var apiMeta = fetchShopeeItemApiMetadata(clean);
  Logger.log('Kết quả API: ' + JSON.stringify(apiMeta));

  Logger.log('===== BƯỚC 3: Đọc HTML trang sản phẩm (og:title/og:image) =====');
  var htmlMeta = fetchShopeeHtmlMetadata(clean);
  Logger.log('Kết quả HTML: ' + JSON.stringify(htmlMeta));

  Logger.log('===== KẾT QUẢ CUỐI CÙNG (như hệ thống thật sẽ dùng) =====');
  var finalMeta = fetchShopeeProductMetadata(clean);
  Logger.log(JSON.stringify(finalMeta));
}
