// =====================================================================
// 家而適｜售後系統 Google Apps Script
// 使用方式：將本檔與 ItemPicker.html 貼到試算表綁定的 Apps Script 專案，
// 執行一次 setupSheets()，再重新部署網頁應用程式（新版本）。
// =====================================================================

const FOLDER_ID = "1iUJ4eQOCf2jn8VwTUUVweBuyYmDB3BIm";
const TZ = "Asia/Taipei";
const WARRANTY_MONTHS = 12; // 保固：購買後 1 年
const ITEM_HEADER = "品項*數量";

// 需要回答膠片相關題目的問題類型，其餘類型改填「產品照片＋現況描述」
const FILM_ISSUE_TYPES = ["膠片掉落", "勾盤掉落"];

const SHEET = {
  SERVICE: "客服",
  SHIPPING: "物流",
  PRIVATE: "私下購買",
  EXCHANGE: "換貨",
  REFUND: "退貨退款",
  ARCHIVE: "已結案紀錄",
  FOLLOW: "待關心",
  ITEMS: "品項清單"
};

// 尚未結案的分頁（重複送單檢查用）
const OPEN_SHEETS = [SHEET.SERVICE, SHEET.SHIPPING, SHEET.PRIVATE, SHEET.EXCHANGE, SHEET.REFUND];

// 客人送單時的診斷資料，一路帶到結案
const DIAG_HEADERS = ["送單時間", "購買日期", "保固狀態", "膠片情況", "現況描述"];

const CUSTOMER_HEADERS = [
  "LINE姓名", "聯絡電話", "購買通路", "通路訂單編號",
  "客戶專屬相簿", "產品名稱", "商品異常情況", "牆面材質", "使用輔助膠片"
];

// 各分頁欄位（依名稱對應，順序即缺欄時插入的位置）
const HEADERS = {
  "客服": [
    "案件編號", "送單時間"
  ].concat(CUSTOMER_HEADERS, [
    "膠片情況", "現況描述", "購買日期", "保固狀態",
    "客服備註", ITEM_HEADER, "收件資訊", "出貨備註", "處理狀態", "狀態備註", "追蹤提醒"
  ]),
  "物流": ["案件編號", "轉單時間"].concat(CUSTOMER_HEADERS, DIAG_HEADERS, [
    "客服備註", "追蹤提醒", ITEM_HEADER, "收件資訊", "出貨備註",
    "最新效期日期", "寄件日期", "寄件方式", "物流單號", "出貨狀態"
  ]),
  "私下購買": ["案件編號", "轉單時間"].concat(CUSTOMER_HEADERS, DIAG_HEADERS, [
    "客服備註", "追蹤提醒", ITEM_HEADER, "收件資訊", "出貨備註", "匯款帳號後5碼", "金額",
    "最新效期日期", "寄件日期", "寄件方式", "物流單號", "狀態"
  ]),
  "換貨": ["案件編號", "轉單時間"].concat(CUSTOMER_HEADERS, DIAG_HEADERS, [
    "客服備註", "追蹤提醒", ITEM_HEADER, "收件資訊", "出貨備註",
    "最新效期日期", "寄件日期", "寄件方式", "物流單號", "派車日期", "狀態"
  ]),
  "退貨退款": ["案件編號", "轉單時間"].concat(CUSTOMER_HEADERS, DIAG_HEADERS, [
    "客服備註", "追蹤提醒", ITEM_HEADER, "收件資訊", "收件方式",
    "物流單號", "派車日期", "退款資訊", "退款金額", "退款日期", "處理狀態"
  ]),
  "已結案紀錄": ["案件編號", "結案時間", "結案類型"].concat(CUSTOMER_HEADERS, DIAG_HEADERS, [
    "客服備註", ITEM_HEADER, "寄件方式", "寄件日期", "物流單號", "派車日期",
    "匯款帳號後5碼", "金額", "退款金額",
    "出貨/退款細節", "收件/退款資訊與單號", "出貨備註",
    "追蹤提醒", "處理狀態", "已排入關心"
  ]),
  "待關心": [
    "案件編號", "提醒日期", "關心類型", "LINE姓名", "聯絡電話", "產品名稱", "通路訂單編號", "處理狀態", "關心備註"
  ],
  "品項清單": ["品名", "類別", "啟用"]
};

// 舊表頭改名（同一件事統一名稱）："*" 套用到所有分頁
const RENAMES = {
  "*": [["諮詢分類", "商品異常情況"]],
  "客服": [["時間", "送單時間"], ["備註", "客服備註"]]
};

const SERVICE_STATUSES = ["待處理", "轉物流", "轉私下購買", "轉換貨", "轉退貨退款", "推薦購買結案", "諮詢完成"];
const REMOVED_SERVICE_STATUSES = ["待客人補件", "私下購買 轉物流"];
const SHIPPING_STATUSES = ["待出貨", "已寄出結案"];
const PRIVATE_STATUSES = ["待對帳", "已入帳待出貨", "已寄出結案"];
const EXCHANGE_STATUSES = ["待收件", "已派車", "已收回待寄出", "已寄出結案"];
const REFUND_STATUSES = ["待收件", "已退款結案"];
const STATUS_NOTES = ["急", "等客人照片中", "客人已回照片", "客人已回訊息"];
const SHIPPING_NOTES = ["提供回郵", "提供最新效期"];
const SHIP_METHODS = ["郵局", "大榮", "超商7-11"];
const FOLLOW_CYCLES = ["1個月", "4個月", "6個月", "12個月"];

// 選擇某狀態前必須先填好的欄位：{ 分頁: { 狀態: [欄位] } }
const REQUIRED = {
  "客服": {
    "轉物流": [ITEM_HEADER, "收件資訊"],
    "轉私下購買": [ITEM_HEADER, "收件資訊"],
    "轉換貨": [ITEM_HEADER, "收件資訊"],
    "轉退貨退款": [ITEM_HEADER]
  },
  "私下購買": {
    "已入帳待出貨": ["匯款帳號後5碼", "金額"],
    "已寄出結案": ["匯款帳號後5碼", "金額"]
  },
  "退貨退款": {
    "已退款結案": ["退款資訊", "退款金額"]
  }
};

// 各分頁的狀態欄與觸發動作（有動作的狀態會把該列搬走）
const ROUTES = {
  "客服": {
    status: "處理狀態",
    actions: {
      "轉物流": c => transferTo(c, SHEET.SHIPPING, { "出貨狀態": "待出貨" }),
      "轉私下購買": c => transferTo(c, SHEET.PRIVATE, { "狀態": "待對帳" }),
      "轉換貨": c => transferTo(c, SHEET.EXCHANGE, { "狀態": "待收件" }),
      "轉退貨退款": c => transferTo(c, SHEET.REFUND, { "收件方式": "大榮", "處理狀態": "待收件" }),
      "推薦購買結案": c => archive(c.rec, "推薦購買", "引導至官網購買", "-"),
      "諮詢完成": c => archive(c.rec, "純諮詢解答", "提供線上解答完畢", "-")
    }
  },
  "物流": { status: "出貨狀態", actions: { "已寄出結案": c => closeShipping(c) } },
  "私下購買": { status: "狀態", actions: { "已寄出結案": c => closePrivate(c) } },
  "換貨": { status: "狀態", actions: { "已寄出結案": c => closeExchange(c) } },
  "退貨退款": { status: "處理狀態", actions: { "已退款結案": c => closeRefund(c) } }
};

// 前台產品清單（初始化「品項清單」的成品用）
const PRODUCTS = [
  "洗衣粉放置架", "廚房衛浴置物架", "中型多用途置物架", "廚衛瓶罐置物架", "扇型角落架",
  "保鮮膜廚房紙巾置物架", "雙層鍋蓋架", "雙掛毛巾架", "面紙衛生紙置物架", "料理刀砧板鍋蓋架",
  "資源回收垃圾袋架", "迷你鍋蓋砧板架", "廚房紙巾壁掛架", "菜瓜布水槽放置架", "廚房抹布放置架",
  "砧板吊掛架", "單桿毛巾架", "牙刷牙膏漱口杯壁掛架", "盥洗用具壁掛架", "捲筒衛生紙架",
  "香皂架", "吹風機壁掛架", "單瓶沐浴乳架", "蓮蓬頭壁掛架", "雙桿毛巾架",
  "掃把拖把雨傘放置夾", "居家多功能掛勾(小)", "5勾 (小五勾)", "居家多功能掛勾(大)", "5勾 (大五勾)",
  "E型單支雙勾", "E型3支6勾", "S型單支雙勾", "S型3支6勾", "蝴蝶單支三勾",
  "蝴蝶2支6勾", "紅酒香檳杯壁掛", "壁掛式碟子盤子收納架", "壁掛食用碗收納", "壁掛玻璃馬克杯",
  "不鏽鋼掛勾5S", "304不鏽鋼鋼片五連掛勾架(U型)", "不鏽鋼廚衛鋼片平台置物架", "筷子湯匙刀叉壁掛架", "雙瓶沐浴乳架",
  "廚房洗潔用品架", "四方高欄角落架", "日式斜放三層架", "歐式可調式三層架", "不滴水香皂架",
  "籃子平台單手撕", "大象衣物掛勾架", "多功能抽取式衛生紙", "泡沫幕斯款沐浴乳架", "四層鍋蓋架",
  "伸縮雙桿毛巾架", "密合彈蓋垃圾袋壁掛架", "430不鏽鋼掃除用具夾(活動式一排3夾)", "304不鏽鋼鋼片U型掛勾架(6勾)", "304不鏽鋼精緻肥皂盒(集水方盒)",
  "蓮蓬頭架(5段可調角度)", "瀝水掛架配件", "優質鋁合金摺疊衛浴置物架"
];

// ============================ 網頁進入點 ============================

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('家而適｜售後快查與協助')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

function doPost(e) {
  let result;
  try {
    if (!e || !e.postData || !e.postData.contents) {
      result = { status: "ok" };
    } else {
      const postData = JSON.parse(e.postData.contents);
      result = (postData.action === "submitForm") ? processDiagnosis(postData) : { status: "ok" };
    }
  } catch (err) {
    Logger.log("doPost Error: " + err);
    result = { status: "error", message: String(err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function processDiagnosis(data) {
  const str = k => String(data[k] == null ? "" : data[k]).trim();
  const f = {
    userName: str("userName"),
    userPhone: str("userPhone"),
    purchaseChannel: str("purchaseChannel"),
    orderId: str("orderId"),
    product: str("product"),
    purchaseDate: str("purchaseDate"),
    issueType: str("issueType"),
    wallType: str("wallType"),
    helperSheet: str("helperSheet"),
    description: str("description")
  };
  const filmConditions = Array.isArray(data.filmConditions) ? data.filmConditions.map(String) : [];
  const isFilm = FILM_ISSUE_TYPES.indexOf(f.issueType) !== -1;

  // 1. 伺服器端必填檢查（前台檢查可被略過）
  const missing = [];
  if (!f.userName) missing.push("LINE 名稱");
  if (!f.userPhone) missing.push("聯絡電話");
  if (!f.purchaseChannel) missing.push("購買通路");
  if (!f.orderId) missing.push("通路訂單編號");
  if (!f.product) missing.push("產品");
  if (!parseYmd(f.purchaseDate)) missing.push("購買日期");
  if (!f.issueType) missing.push("商品異常情況");
  if (!data.proofImgBase64) missing.push("購買證明");
  if (isFilm) {
    if (!f.helperSheet) missing.push("是否使用輔助膠片");
    if (filmConditions.length === 0) missing.push("膠片情況");
    if (!data.wallImgBase64) missing.push("牆面照片");
    if (f.helperSheet === "是" && !data.helperSheetImgBase64) missing.push("輔助膠片照片");
    if (!data.filmImgBase64) missing.push("膠片扣在架子照片");
    if (!data.storageImgBase64) missing.push("收納物品照片");
  } else {
    if (!f.description) missing.push("現況描述");
    if (!data.productImgBase64) missing.push("產品照片");
  }
  if (missing.length) {
    return { status: "error", message: "缺少必填資料：" + missing.join("、") };
  }

  // 2. 取得案件編號（只在產生編號時鎖定）
  const caseId = withLock(10000, nextCaseId);

  // 3. 建立客戶資料夾並存照片（不需鎖定，避免多人同時送單互相等待）
  const mainFolder = DriveApp.getFolderById(FOLDER_ID);
  const folderName = [caseId, f.userName || "未留名", f.product || "未選擇"].join("_").replace(/[\/\\]/g, "-");
  const customerFolder = mainFolder.createFolder(folderName);
  const folderUrl = customerFolder.getUrl();
  const p = f.product;
  saveFileToDrive(customerFolder, data.proofImgBase64, "購買證明或保固證明_" + p + ".jpg");
  if (isFilm) {
    saveFileToDrive(customerFolder, data.wallImgBase64, "牆面照片_" + p + ".jpg");
    if (f.helperSheet === "是") saveFileToDrive(customerFolder, data.helperSheetImgBase64, "輔助膠片照片_" + p + ".jpg");
    saveFileToDrive(customerFolder, data.filmImgBase64, "膠片扣在架子照片_" + p + ".jpg");
    saveFileToDrive(customerFolder, data.storageImgBase64, "收納物品如何放置照片_" + p + ".jpg");
  } else {
    saveFileToDrive(customerFolder, data.productImgBase64, "產品照片_" + p + ".jpg");
  }

  // 4. 寫入「客服」分頁
  const purchaseDate = parseYmd(f.purchaseDate);
  withLock(10000, () => {
    const dupIds = findOpenCasesByOrderId(f.orderId);
    const row = {
      "案件編號": caseId,
      "送單時間": fmt(new Date()),
      "LINE姓名": f.userName,
      "聯絡電話": f.userPhone,
      "購買通路": f.purchaseChannel,
      "通路訂單編號": f.orderId,
      "客戶專屬相簿": { formula: '=HYPERLINK("' + folderUrl + '", "開啟相簿")' },
      "產品名稱": f.product,
      "商品異常情況": f.issueType,
      "牆面材質": isFilm ? f.wallType : "",
      "使用輔助膠片": isFilm ? f.helperSheet : "",
      "膠片情況": isFilm ? filmConditions.join("、") : "",
      "現況描述": f.description,
      "購買日期": purchaseDate,
      "保固狀態": warrantyStatus(purchaseDate, new Date()),
      "狀態備註": dupIds.length ? "⚠ 可能重複送單：" + dupIds.join("、") : "",
      "處理狀態": "待處理"
    };
    appendRowObj(getOrCreateSheet(SHEET.SERVICE), row);
  });

  return { status: "success", caseId: caseId, userName: f.userName, userPhone: f.userPhone };
}

// 依日期遞增：20261024-001
function nextCaseId() {
  const props = PropertiesService.getScriptProperties();
  const day = fmt(new Date(), "yyyyMMdd");
  const key = "caseSeq_" + day;
  const seq = Number(props.getProperty(key) || 0) + 1;
  if (seq === 1) {
    // 新的一天：清掉舊日期的計數
    Object.keys(props.getProperties()).forEach(k => {
      if (k.indexOf("caseSeq_") === 0 && k !== key) props.deleteProperty(k);
    });
  }
  props.setProperty(key, String(seq));
  return day + "-" + ("00" + seq).slice(-3);
}

// 在尚未結案的分頁中找相同訂單編號的案件
function findOpenCasesByOrderId(orderId) {
  const target = normalizeId(orderId);
  if (!target) return [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ids = [];
  OPEN_SHEETS.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastRow() <= 1) return;
    const headers = getHeaders(sheet);
    const oCol = headers.indexOf("通路訂單編號");
    const idCol = headers.indexOf("案件編號");
    if (oCol === -1) return;
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
    values.forEach(r => {
      if (normalizeId(r[oCol]) === target) ids.push((idCol === -1 ? "" : r[idCol]) + "（" + name + "）");
    });
  });
  return ids;
}

function normalizeId(v) {
  return String(v == null ? "" : v).replace(/\s+/g, "").toUpperCase();
}

function warrantyStatus(purchaseDate, today) {
  if (!purchaseDate) return "未填購買日期";
  const todayKey = fmt(today, "yyyyMMdd");
  if (fmt(purchaseDate, "yyyyMMdd") > todayKey) return "購買日期異常";
  const end = addMonths(purchaseDate, WARRANTY_MONTHS);
  return (todayKey <= fmt(end, "yyyyMMdd") ? "保固內" : "已過保") + "（至 " + fmt(end, "yyyy/MM/dd") + "）";
}

// ============================ 狀態分流 ============================

function onEdit(e) {
  if (!e || !e.range) return;
  const range = e.range;
  if (range.getNumRows() !== 1 || range.getNumColumns() !== 1) return;
  const sheet = range.getSheet();
  const route = ROUTES[sheet.getName()];
  if (!route) return;
  const row = range.getRow();
  const col = range.getColumn();
  if (row <= 1) return;

  const value = String(e.value == null ? "" : e.value).trim();
  const action = route.actions[value];
  const required = (REQUIRED[sheet.getName()] || {})[value] || [];
  if (!action && !required.length) return;
  applyRenames(sheet);
  const headers = getHeaders(sheet);
  if (headers[col - 1] !== route.status) return;

  // 先記下這一列的案件編號，排隊等鎖期間若其他人搬走前面的列，仍可找回正確的列
  const idCol = headers.indexOf("案件編號") + 1;
  const caseId = idCol ? String(sheet.getRange(row, idCol).getValue()).trim() : "";

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const currentRow = locateRow(sheet, row, idCol, caseId);
    if (!currentRow || String(sheet.getRange(currentRow, col).getValue()).trim() !== value) {
      toast("資料列已變動，未自動轉單，請重新選擇一次狀態。");
      return;
    }

    const rec = readRowObj(sheet, currentRow, headers);
    const statusCell = sheet.getRange(currentRow, col);
    const missing = required.filter(h => headers.indexOf(h) !== -1 && isBlank(rec.v[h]));
    if (missing.length) {
      statusCell.setValue(e.oldValue || (sheet.getName() === SHEET.SERVICE ? "待處理" : ""));
      statusCell.setNote("無法選「" + value + "」，請先填寫：" + missing.join("、"));
      toast("請先填寫：" + missing.join("、") + "，再選擇「" + value + "」。");
      return;
    }
    if (!action) {
      statusCell.setNote("");
      return;
    }

    action({ sheet: sheet, row: currentRow, headers: headers, rec: rec });
    sheet.deleteRow(currentRow);
  } catch (err) {
    Logger.log("onEdit Error: " + err);
    toast("自動轉單失敗：" + (err.message || err) + "。請重新選擇一次狀態。");
  } finally {
    lock.releaseLock();
  }
}

function locateRow(sheet, row, idCol, caseId) {
  if (!idCol || !caseId) return row;
  if (String(sheet.getRange(row, idCol).getValue()).trim() === caseId) return row;
  const last = sheet.getLastRow();
  if (last <= 1) return 0;
  const ids = sheet.getRange(2, idCol, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === caseId) return i + 2;
  }
  return 0;
}

function transferTo(c, sheetName, extra) {
  const obj = baseObj(c.rec);
  obj["轉單時間"] = fmt(new Date());
  Object.keys(extra).forEach(k => { obj[k] = extra[k]; });
  appendRowObj(getOrCreateSheet(sheetName), obj);
}

function closeShipping(c) {
  const v = c.rec.v;
  // 舊資料可能有「出貨類型＝私下購買」的列
  const type = v["出貨類型"] === "私下購買" ? "私下購買寄出" : "補件寄出";
  archive(c.rec, type, shippingDetail(v), shippingLogistics(v));
}

function closePrivate(c) {
  const v = c.rec.v;
  archive(c.rec, "私下購買寄出",
    shippingDetail(v) + " | 金額:" + cellText(v["金額"], "未填"),
    shippingLogistics(v) + " | 匯款後5碼:" + cellText(v["匯款帳號後5碼"], "未填"));
}

function closeExchange(c) {
  const v = c.rec.v;
  archive(c.rec, "換貨",
    shippingDetail(v) + " | 派車日:" + cellText(v["派車日期"], "未填"),
    shippingLogistics(v));
}

function closeRefund(c) {
  const v = c.rec.v;
  const detail = "品項*數量:" + cellText(v[ITEM_HEADER]) +
    " | 派車日:" + cellText(v["派車日期"], "未填") +
    " | 退款金額:" + cellText(v["退款金額"], "未填") +
    " | 退款日:" + cellText(v["退款日期"], "未填");
  const logi = "收件/退款帳號:" + cellText(v["收件資訊"]) + " / " + cellText(v["退款資訊"]) +
    " | 收件單號:" + cellText(v["物流單號"], "無");
  const obj = archiveObj(c.rec, "退貨退款", detail, logi);
  obj["出貨備註"] = "-";
  appendRowObj(getOrCreateSheet(SHEET.ARCHIVE), obj);
}

function shippingDetail(v) {
  return "品項*數量:" + cellText(v[ITEM_HEADER]) +
    " | 最新效期:" + cellText(v["最新效期日期"], "無") +
    " | 寄件日:" + cellText(v["寄件日期"], "無");
}

function shippingLogistics(v) {
  return "收件:" + cellText(v["收件資訊"]) + " | 方式:" + cellText(v["寄件方式"]) +
    " (單號:" + cellText(v["物流單號"], "無") + ")";
}

function archive(rec, closeType, detail, logi) {
  appendRowObj(getOrCreateSheet(SHEET.ARCHIVE), archiveObj(rec, closeType, detail, logi));
}

// 同名欄位（診斷資料、品項、單號、金額等）直接帶入已結案紀錄
function archiveObj(rec, closeType, detail, logi) {
  const obj = baseObj(rec);
  obj["結案時間"] = fmt(new Date());
  obj["結案類型"] = closeType;
  obj["出貨/退款細節"] = detail;
  obj["收件/退款資訊與單號"] = logi;
  obj["處理狀態"] = "已結案";
  obj["已排入關心"] = "";
  return obj;
}

// ============================ 每日追蹤 ============================

function checkDailyFollowUpTrigger() {
  withLock(30000, () => {
    const archiveSheet = prepareArchiveSheet();
    if (archiveSheet.getLastRow() <= 1) return;
    const headers = getHeaders(archiveSheet);
    const data = archiveSheet.getRange(2, 1, archiveSheet.getLastRow() - 1, headers.length).getValues();
    const col = name => headers.indexOf(name);
    const flagCol = col("已排入關心") + 1;
    const now = new Date();
    const todayKey = fmt(now, "yyyyMMdd");
    const todayStr = fmt(now, "yyyy/MM/dd");
    const followSheet = getOrCreateSheet(SHEET.FOLLOW);

    data.forEach((r, i) => {
      if (!isBlank(r[col("已排入關心")])) return;
      const due = followUpDueDate(r[col("結案時間")], r[col("追蹤提醒")]);
      // 用「已到期且未排入」判斷：觸發器某天沒跑，隔天仍會補上；重跑也不會重複
      if (!due || fmt(due, "yyyyMMdd") > todayKey) return;
      appendRowObj(followSheet, {
        "案件編號": r[col("案件編號")],
        "提醒日期": todayStr,
        "關心類型": String(r[col("追蹤提醒")]).trim() + "定時關心",
        "LINE姓名": r[col("LINE姓名")],
        "聯絡電話": r[col("聯絡電話")],
        "產品名稱": r[col("產品名稱")],
        "通路訂單編號": r[col("通路訂單編號")],
        "處理狀態": "待關心"
      });
      archiveSheet.getRange(i + 2, flagCol).setValue(todayStr);
    });
  });
}

function followUpDueDate(closeValue, cycle) {
  const closeDate = toDate(closeValue);
  const text = String(cycle == null ? "" : cycle).trim();
  if (!closeDate || !text) return null;
  let months = 0;
  const m = text.match(/(\d+)\s*個?月/);
  const y = text.match(/(\d+)\s*年/);
  if (m) months = Number(m[1]);
  else if (y) months = Number(y[1]) * 12;
  if (!months) return null;
  return addMonths(closeDate, months);
}

// 確保「已結案紀錄」有「已排入關心」欄；首次新增時，把已過期的舊資料標記為略過，避免一次湧入大量待關心
function prepareArchiveSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET.ARCHIVE);
  if (!sheet) sheet = ss.insertSheet(SHEET.ARCHIVE);
  applyRenames(sheet);
  const added = ensureLayout(sheet, HEADERS[SHEET.ARCHIVE]);
  if (added.indexOf("已排入關心") !== -1 && sheet.getLastRow() > 1) {
    const headers = getHeaders(sheet);
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
    const todayKey = fmt(new Date(), "yyyyMMdd");
    const flags = data.map(r => {
      const due = followUpDueDate(r[headers.indexOf("結案時間")], r[headers.indexOf("追蹤提醒")]);
      return [due && fmt(due, "yyyyMMdd") < todayKey ? "舊資料略過" : ""];
    });
    sheet.getRange(2, headers.indexOf("已排入關心") + 1, flags.length, 1).setValues(flags);
  }
  return sheet;
}

// ============================ 品項選擇器 ============================

function onOpen() {
  SpreadsheetApp.getUi().createMenu("售後工具")
    .addItem("填寫品項", "openItemPicker")
    .addSeparator()
    .addItem("初始化／更新表格", "setupSheets")
    .addToUi();
}

function openItemPicker() {
  const html = HtmlService.createHtmlOutputFromFile("ItemPicker").setTitle("填寫品項");
  SpreadsheetApp.getUi().showSidebar(html);
}

function getItemPickerData() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const cell = sheet.getActiveCell();
  const result = { items: loadItemList(), target: null, error: "" };
  const name = sheet.getName();
  const headers = getHeaders(sheet);
  const row = cell.getRow();
  if (!ROUTES[name]) {
    result.error = "請到「客服／物流／私下購買／換貨／退貨退款」分頁使用。";
  } else if (headers[cell.getColumn() - 1] !== ITEM_HEADER) {
    result.error = "請先點選「" + ITEM_HEADER + "」欄的儲存格，再按「讀取目前儲存格」。";
  } else if (row <= 1) {
    result.error = "請點選資料列（第 2 列以下）。";
  } else {
    const idCol = headers.indexOf("案件編號");
    const nameCol = headers.indexOf("LINE姓名");
    result.target = {
      sheet: name,
      row: row,
      caseId: idCol === -1 ? "" : String(sheet.getRange(row, idCol + 1).getValue()).trim(),
      customer: nameCol === -1 ? "" : String(sheet.getRange(row, nameCol + 1).getValue()),
      current: String(cell.getValue() || "")
    };
  }
  return result;
}

function saveItemPicker(target, text) {
  return withLock(10000, () => {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(target.sheet);
    if (!sheet) throw new Error("找不到分頁：" + target.sheet);
    const headers = getHeaders(sheet);
    const col = headers.indexOf(ITEM_HEADER) + 1;
    const idCol = headers.indexOf("案件編號") + 1;
    if (!col) throw new Error("此分頁沒有「" + ITEM_HEADER + "」欄");
    const row = locateRow(sheet, target.row, idCol, target.caseId);
    if (!row) throw new Error("找不到案件 " + target.caseId + "，可能已被轉到其他分頁。");
    sheet.getRange(row, col).setValue(sanitizeText(text));
    return { row: row };
  });
}

function loadItemList() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.ITEMS);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  const headers = getHeaders(sheet);
  const n = headers.indexOf("品名"), c = headers.indexOf("類別"), a = headers.indexOf("啟用");
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
    .filter(r => String(r[n]).trim() && String(a === -1 ? "" : r[a]).trim() !== "否")
    .map(r => ({ name: String(r[n]).trim(), category: c === -1 ? "" : String(r[c]).trim() }));
}

// ============================ 初始化 ============================

// 手動執行一次：補齊欄位、下拉選單、文字格式、品項清單與每日觸發器
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [SHEET.SERVICE, SHEET.SHIPPING, SHEET.PRIVATE, SHEET.EXCHANGE, SHEET.REFUND, SHEET.FOLLOW, SHEET.ITEMS]
    .forEach(name => getOrCreateSheet(name));
  prepareArchiveSheet();

  // 客服分頁不再填退款資訊（改在退貨退款分頁填）；有資料時保留，請人工確認後再刪
  const messages = [];
  if (!dropColumnIfEmpty(ss.getSheetByName(SHEET.SERVICE), "退款資訊")) {
    messages.push("客服分頁的「退款資訊」欄還有資料，請先搬到退貨退款分頁後手動刪除此欄。");
  }

  setListValidation(SHEET.SERVICE, "處理狀態", SERVICE_STATUSES, REMOVED_SERVICE_STATUSES);
  setListValidation(SHEET.SERVICE, "狀態備註", STATUS_NOTES);
  setListValidation(SHEET.SERVICE, "出貨備註", SHIPPING_NOTES);
  setListValidation(SHEET.SHIPPING, "出貨狀態", SHIPPING_STATUSES);
  setListValidation(SHEET.PRIVATE, "狀態", PRIVATE_STATUSES);
  setListValidation(SHEET.EXCHANGE, "狀態", EXCHANGE_STATUSES);
  setListValidation(SHEET.REFUND, "處理狀態", REFUND_STATUSES);
  setListValidation(SHEET.REFUND, "收件方式", SHIP_METHODS);
  [SHEET.SHIPPING, SHEET.PRIVATE, SHEET.EXCHANGE]
    .forEach(name => setListValidation(name, "寄件方式", SHIP_METHODS));
  setListValidation(SHEET.FOLLOW, "處理狀態", ["待關心", "已關心"]);
  setListValidation(SHEET.ITEMS, "類別", ["配件", "成品"]);
  setListValidation(SHEET.ITEMS, "啟用", ["是", "否"]);
  [SHEET.SERVICE, SHEET.SHIPPING, SHEET.PRIVATE, SHEET.EXCHANGE, SHEET.REFUND]
    .forEach(name => setListValidation(name, "追蹤提醒", FOLLOW_CYCLES));

  // 電話、訂單編號、物流單號、匯款後5碼設成純文字，避免開頭 0 消失或長數字變成科學記號
  [SHEET.SERVICE, SHEET.SHIPPING, SHEET.PRIVATE, SHEET.EXCHANGE, SHEET.REFUND, SHEET.ARCHIVE, SHEET.FOLLOW].forEach(name => {
    const sheet = ss.getSheetByName(name);
    const headers = getHeaders(sheet);
    ["聯絡電話", "通路訂單編號", "物流單號", "匯款帳號後5碼"].forEach(h => {
      const i = headers.indexOf(h);
      if (i !== -1) sheet.getRange(2, i + 1, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat("@");
    });
  });

  const items = ss.getSheetByName(SHEET.ITEMS);
  if (items.getLastRow() <= 1) {
    items.getRange(2, 1, PRODUCTS.length, 3).setValues(PRODUCTS.map(p => [p, "成品", "是"]));
  }

  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "checkDailyFollowUpTrigger")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("checkDailyFollowUpTrigger").timeBased().everyDays(1).atHour(9).inTimezone(TZ).create();

  toast(["表格初始化完成。請到「品項清單」補上配件品名。"].concat(messages).join(" "));
}

// 設定下拉選單；若欄位原本已有清單，保留原選項再補上缺少的，並拿掉 remove 中的選項
function setListValidation(sheetName, header, values, remove) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return;
  const col = getHeaders(sheet).indexOf(header) + 1;
  if (!col) return;
  const range = sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1);
  let list = values.slice();
  const existing = sheet.getRange(2, col).getDataValidation();
  if (existing && existing.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
    const old = existing.getCriteriaValues()[0] || [];
    list = old.concat(values.filter(v => old.indexOf(v) === -1));
  }
  list = list.filter(v => (remove || []).indexOf(v) === -1);
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build();
  range.setDataValidation(rule);
}

// 欄位整欄空白才刪除；沒有這欄或已刪除回傳 true，還有資料回傳 false
function dropColumnIfEmpty(sheet, header) {
  const col = getHeaders(sheet).indexOf(header) + 1;
  if (!col) return true;
  if (sheet.getLastRow() > 1) {
    const values = sheet.getRange(2, col, sheet.getLastRow() - 1, 1).getValues();
    if (values.some(r => !isBlank(r[0]))) return false;
  }
  sheet.deleteColumn(col);
  return true;
}

// ============================ 共用工具 ============================

function getOrCreateSheet(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  applyRenames(sheet);
  const added = ensureLayout(sheet, HEADERS[sheetName] || []);
  // 舊資料沒有案件編號時補上，讓轉單能以編號定位
  if (added.indexOf("案件編號") !== -1 && ROUTES[sheetName] && sheet.getLastRow() > 1) {
    const n = sheet.getLastRow() - 1;
    const ids = [];
    for (let i = 1; i <= n; i++) ids.push(["舊-" + sheetName + "-" + ("00" + i).slice(-3)]);
    sheet.getRange(2, getHeaders(sheet).indexOf("案件編號") + 1, n, 1).setValues(ids);
  }
  return sheet;
}

// 舊表頭改名：有舊名、沒有新名時才改，只改第 1 列文字，資料不動
function applyRenames(sheet) {
  const pairs = (RENAMES["*"] || []).concat(RENAMES[sheet.getName()] || []);
  if (!pairs.length) return;
  const headers = getHeaders(sheet);
  pairs.forEach(([from, to]) => {
    const i = headers.indexOf(from);
    if (i !== -1 && headers.indexOf(to) === -1) {
      sheet.getRange(1, i + 1).setValue(to);
      headers[i] = to;
    }
  });
}

// 依欄位名稱補齊表頭：缺少的欄位插在清單中前一個欄位的右側，不搬動既有資料。回傳新增的欄位
function ensureLayout(sheet, headers) {
  if (!headers.length) return [];
  let current = getHeaders(sheet);
  if (current.filter(h => h).length === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return headers.slice();
  }
  const added = [];
  headers.forEach((h, i) => {
    if (current.indexOf(h) !== -1) return;
    let after = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = current.indexOf(headers[j]);
      if (k !== -1) { after = k + 1; break; }
    }
    if (after === 0) sheet.insertColumnBefore(1);
    else sheet.insertColumnAfter(after);
    sheet.getRange(1, after + 1).setValue(h);
    added.push(h);
    current = getHeaders(sheet);
  });
  return added;
}

function getHeaders(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
}

// 讀一列：v 為值、f 為公式（保留「開啟相簿」超連結）
function readRowObj(sheet, row, headers) {
  const range = sheet.getRange(row, 1, 1, headers.length);
  const values = range.getValues()[0];
  const formulas = range.getFormulas()[0];
  const rec = { v: {}, f: {} };
  headers.forEach((h, i) => {
    if (!h) return;
    rec.v[h] = values[i];
    if (formulas[i]) rec.f[h] = formulas[i];
  });
  return rec;
}

function baseObj(rec) {
  const obj = {};
  Object.keys(rec.v).forEach(h => { obj[h] = rec.f[h] ? { formula: rec.f[h] } : rec.v[h]; });
  return obj;
}

// 依目標分頁表頭寫入；不存在的欄位忽略
function appendRowObj(sheet, obj) {
  const headers = getHeaders(sheet);
  sheet.appendRow(headers.map(h => toCell(obj[h])));
}

function toCell(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && v.formula) return v.formula;
  if (isDate(v)) return v;
  if (typeof v === "string") return sanitizeText(v);
  return v;
}

// 避免文字被當成公式（= + - @ 開頭），或被轉成數字（電話開頭 0 消失、長訂單號變科學記號）
function sanitizeText(s) {
  const str = String(s);
  if (/^[=+\-@]/.test(str) || /^\d[\d\s.]*$/.test(str)) return "'" + str;
  return str;
}

function cellText(v, emptyText) {
  if (isDate(v)) return fmt(v, "yyyy/MM/dd");
  const s = String(v == null ? "" : v).trim();
  return s || (emptyText === undefined ? "" : emptyText);
}

function isDate(v) {
  return Object.prototype.toString.call(v) === "[object Date]";
}

function isBlank(v) {
  return v === null || v === undefined || String(v).trim() === "";
}

function fmt(d, pattern) {
  return Utilities.formatDate(d, TZ, pattern || "yyyy/MM/dd HH:mm");
}

function toDate(v) {
  if (isDate(v)) return isNaN(v.getTime()) ? null : v;
  if (isBlank(v)) return null;
  const d = new Date(String(v).replace(/-/g, "/"));
  return isNaN(d.getTime()) ? null : d;
}

// "2026-03-05" → Date（台灣時間當天中午，避免時區造成日期偏移）
function parseYmd(s) {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 4, 0, 0));
  return isNaN(d.getTime()) ? null : d;
}

// 加月份；月底自動調整（1/31 + 1 個月 = 2/28）
function addMonths(d, n) {
  const r = new Date(d.getTime());
  const day = r.getDate();
  r.setDate(1);
  r.setMonth(r.getMonth() + n);
  const lastDay = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(day, lastDay));
  return r;
}

function withLock(ms, fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(ms);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function toast(msg) {
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(msg, "售後系統", 8);
  } catch (e) {
    Logger.log(msg);
  }
}

function saveFileToDrive(folder, base64Data, filename) {
  if (!base64Data || typeof base64Data !== 'string' || base64Data.indexOf(",") === -1) return false;
  try {
    const parts = base64Data.split(",");
    const contentTypeMatch = parts[0].match(/:(.*?);/);
    const contentType = contentTypeMatch ? contentTypeMatch[1] : "image/jpeg";
    const blob = Utilities.newBlob(Utilities.base64Decode(parts[1]), contentType, filename);
    folder.createFile(blob);
    return true;
  } catch (e) {
    Logger.log("Save File Error: " + e);
    return false;
  }
}
