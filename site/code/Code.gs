/**
 * MANPOWER Portal — Google Apps Script backend.
 *
 * Serves the JSON API used by the GitHub Pages frontend. Data lives in the
 * same "MANPOWER Database" spreadsheet and Drive folders as the desktop app.
 *
 * Deploy: Extensions > Apps Script > paste this file > Deploy > New deployment
 *   - Type: Web app
 *   - Execute as: Me
 *   - Who has access: Anyone
 * Copy the /exec URL into the frontend's API_BASE (site/app.js).
 *
 * Frontend talks to us with:
 *   GET  ?route=...[&date=...]
 *   POST body is JSON sent with Content-Type: text/plain (avoids CORS preflight).
 */

var SPREADSHEET_NAME = "MANPOWER Database";
var ROOT_FOLDER = "MANPOWER System";
var ATTENDANCE_FOLDER = "Attendance Logs";
var BACKUP_FOLDER = "Backups";

var HEADERS = {
  Workers: ["id", "employee_id", "lname", "fname", "position", "status", "created_at"],
  Attendance: ["id", "emp_key", "worker_id", "punch_time", "punch_type", "source", "imported_file", "created_at"],
  ImportLog: ["id", "filename", "rows_total", "rows_matched", "rows_unmatched", "imported_at"],
  Meta: ["key", "value"],
};

function utcNow() {
  return Utilities.formatDate(new Date(), "GMT", "yyyy-MM-dd HH:mm:ss");
}

function getSpreadsheet_() {
  var files = DriveApp.getFilesByName(SPREADSHEET_NAME);
  if (files.hasNext()) return SpreadsheetApp.openById(files.next().getId());
  throw new Error("Spreadsheet '" + SPREADSHEET_NAME + "' not found. Run the desktop app once to create it.");
}

function getOrCreateSheet_(ss, name) {
  var s = ss.getSheetByName(name);
  if (s) return s;
  s = ss.insertSheet(name);
  s.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]);
  return s;
}

function ensureSetup_() {
  var ss = getSpreadsheet_();
  Object.keys(HEADERS).forEach(function (name) {
    var s = getOrCreateSheet_(ss, name);
    var top = s.getRange(1, 1, 1, HEADERS[name].length).getValues()[0].join("|");
    if (top !== HEADERS[name].join("|")) {
      s.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]);
    }
  });
  return ss;
}

function readTable_(sheetName) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);
  var headers = HEADERS[sheetName];
  var last = sheet.getLastRow();
  if (last < 1) return [];
  var values = sheet.getRange(1, 1, last, headers.length).getValues();
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (!r || r.every(function (v) { return String(v).trim() === ""; })) continue;
    var d = {};
    for (var j = 0; j < headers.length; j++) {
      var v = r[j];
      if (headers[j] === "id" || headers[j] === "worker_id" ||
          headers[j] === "rows_total" || headers[j] === "rows_matched" || headers[j] === "rows_unmatched") {
        v = String(v).trim() === "" ? (headers[j] === "worker_id" ? "" : 0) : Number(v);
      }
      d[headers[j]] = v;
    }
    rows.push(d);
  }
  return rows;
}

function rewriteTable_(sheetName, rows) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);
  var headers = HEADERS[sheetName];
  var out = [headers].concat(rows.map(function (r) {
    return headers.map(function (h) { return r[h] !== undefined ? r[h] : ""; });
  }));
  var n = out.length;
  if (n > 1) {
    sheet.getRange(1, 1, n, headers.length).setNumberFormat("@").setValues(out);
  } else {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  if (sheet.getMaxRows() > Math.max(n + 1, 50)) {
    sheet.deleteRows(Math.max(n + 1, 2), sheet.getMaxRows() - Math.max(n + 1, 1));
  }
}

function appendRows_(sheetName, rows) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);
  var headers = HEADERS[sheetName];
  var last = sheet.getLastRow();
  var start = last < 1 ? 2 : last + 1;
  if (start + rows.length - 1 > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), start + rows.length - 1 - sheet.getMaxRows());
  }
  var range = sheet.getRange(start, 1, rows.length, headers.length);
  range.setNumberFormat("@").setValues(rows);
}

function meta_() {
  var m = {};
  readTable_("Meta").forEach(function (r) { if (String(r["key"]).trim()) m[r["key"]] = r["value"]; });
  if (!("workers_seq" in m)) m.workers_seq = 0;
  if (!("attendance_seq" in m)) m.attendance_seq = 0;
  if (!("importlog_seq" in m)) m.importlog_seq = 0;
  return m;
}

function saveMeta_(m) {
  var entries = [["key", "value"]];
  Object.keys(m).forEach(function (k) { entries.push([String(k), String(m[k])]); });
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName("Meta");
  sheet.getRange(1, 1, entries.length, 2).setValues(entries);
}

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------
function workers_() {
  var w = readTable_("Workers");
  w.sort(function (a, b) {
    return String(a.lname).toLowerCase() < String(b.lname).toLowerCase() ? -1 :
           String(a.lname).toLowerCase() > String(b.lname).toLowerCase() ? 1 :
           (String(a.fname).toLowerCase() < String(b.fname).toLowerCase() ? -1 : 1);
  });
  return w;
}

function addWorker_(data) {
  var lname = String(data.lname || "").trim().toUpperCase();
  var fname = String(data.fname || "").trim().toUpperCase();
  if (!lname && !fname) throw new Error("Name is required");
  var eid = String(data.employee_id || "").trim();
  var list = workers_();
  for (var i = 0; i < list.length; i++) {
    if (eid && String(list[i].employee_id).trim() === eid) throw new Error("Employee ID already exists");
  }
  var m = meta_();
  var wid = Number(m.workers_seq) + 1;
  m.workers_seq = wid;
  saveMeta_(m);
  appendRows_("Workers", [[wid, eid, lname, fname, String(data.position || "").trim(), "active", utcNow()]]);
  return { ok: true, id: wid };
}

function updateWorker_(id, data) {
  var list = workers_();
  var target = null;
  list.forEach(function (w) { if (w.id === id) target = w; });
  if (!target) throw new Error("Not found");
  var eid = String(data.employee_id !== undefined ? data.employee_id : target.employee_id).trim();
  list.forEach(function (w) {
    if (w.id !== id && eid && String(w.employee_id).trim() === eid) throw new Error("Employee ID already exists");
  });
  target.employee_id = eid;
  target.lname = String(data.lname !== undefined ? data.lname : target.lname).trim().toUpperCase();
  target.fname = String(data.fname !== undefined ? data.fname : target.fname).trim().toUpperCase();
  target.position = String(data.position !== undefined ? data.position : target.position).trim();
  target.status = String(data.status !== undefined ? data.status : target.status).trim();
  rewriteTable_("Workers", list);
  return { ok: true };
}

function deleteWorker_(id) {
  var list = workers_().filter(function (w) { return w.id !== id; });
  var att = readTable_("Attendance").filter(function (a) { return a.worker_id !== id; });
  rewriteTable_("Workers", list);
  rewriteTable_("Attendance", att);
  return { ok: true };
}

function batchEmployeeId_(pairs) {
  var list = workers_();
  var updated = 0;
  pairs.forEach(function (p) {
    var w = null;
    list.forEach(function (x) { if (x.id === p.id) w = x; });
    if (!w) return;
    var eid = String(p.employee_id || "").trim();
    var dup = list.some(function (o) { return o.id !== p.id && eid && String(o.employee_id).trim() === eid; });
    if (dup) return;
    w.employee_id = eid;
    updated++;
  });
  if (updated) rewriteTable_("Workers", list);
  return { ok: true, updated: updated };
}

function reset_() {
  rewriteTable_("Workers", []);
  rewriteTable_("Attendance", []);
  rewriteTable_("ImportLog", []);
  var m = meta_();
  m.workers_seq = 0; m.attendance_seq = 0; m.importlog_seq = 0;
  saveMeta_(m);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------
function commitAttendance_(data) {
  var records = data.records || [];
  var filename = data.filename || "";
  var fileText = data.fileText || "";
  if (!records.length) throw new Error("No records");
  var m = meta_();
  var seq = Number(m.attendance_seq);
  var rows = [];
  var matchedIds = {};
  var total = records.length;
  records.forEach(function (rec) {
    var empKey = String(rec.emp_key || "").trim();
    var workerId = rec.worker_id;
    if ((workerId === null || workerId === undefined || workerId === "") && empKey in (data.mapping || {})) {
      workerId = data.mapping[empKey];
    }
    if (workerId !== null && workerId !== undefined && String(workerId).trim() !== "") matchedIds[workerId] = true;
    var dt = parsePunch_(rec.punch_time);
    if (!dt) return;
    seq++;
    rows.push([seq, empKey, workerId === undefined || workerId === null ? "" : workerId,
               dt, rec.punch_type || "", "web", filename, utcNow()]);
  });
  if (rows.length) {
    m.attendance_seq = seq;
    appendRows_("Attendance", rows);
  }
  var ilogSeq = Number(m.importlog_seq) + 1;
  m.importlog_seq = ilogSeq;
  var matchedCount = Object.keys(matchedIds).length;
  appendRows_("ImportLog", [[ilogSeq, filename, total, matchedCount, total - matchedCount, utcNow()]]);
  saveMeta_(m);

  // Store a copy of the original log in Google Drive.
  try {
    if (fileText) {
      var folder = ensureAttendFolder_();
      var fname = filename || "attendance_" + Date.now() + ".txt";
      var stem = fname.replace(/\.[^.]*$/, "");
      var ext = fname.indexOf(".") >= 0 ? fname.substring(fname.lastIndexOf(".")) : "";
      if (folder.getFilesByName(fname).hasNext()) {
        fname = stem + "_" + new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14) + ext;
      }
      folder.createFile(fname, fileText);
    }
  } catch (e) { /* non-fatal */ }
  return { ok: true, inserted: rows.length };
}

function parsePunch_(s) {
  var t = new Date(s);
  if (!isNaN(t.getTime())) {
    var p = Utilities.formatDate(t, "GMT", "yyyy-MM-dd HH:mm:ss");
    if (p.indexOf(s) === 0 || s.indexOf(p) === 0) return p;
  }
  // Strict round-trip check to avoid date shifting user-provided strings.
  if (typeof s === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;
  return null;
}

function dailyReport_(date) {
  var workers = workers_().filter(function (w) { return String(w.status) === "active"; });
  var attendance = readTable_("Attendance").filter(function (a) {
    return String(a.punch_time).indexOf(String(date)) === 0;
  });
  var punchMap = {};
  attendance.forEach(function (a) {
    if (a.worker_id === "" || a.worker_id === null || a.worker_id === undefined) return;
    (punchMap[a.worker_id] = punchMap[a.worker_id] || []).push(a);
  });
  var roster = [];
  var present = 0;
  workers.forEach(function (w) {
    var punches = punchMap[w.id] || [];
    var fl = firstLast_(punches);
    if (punches.length) present++;
    roster.push({
      id: w.id, employee_id: w.employee_id,
      name: w.lname + ", " + w.fname, position: w.position,
      present: punches.length > 0, punch_count: punches.length,
      time_in: fl[0] ? fl[0].substring(11, 16) : null,
      time_out: fl[1] ? fl[1].substring(11, 16) : null,
    });
  });
  roster.sort(function (a, b) {
    return (a.present === b.present) ? (a.name < b.name ? -1 : 1) : (a.present ? -1 : 1);
  });
  var total = workers.length;
  var inactive = workers_().filter(function (w) { return String(w.status) !== "active"; }).length;
  return {
    date: date, total_manpower: total + inactive, active_manpower: total,
    present: present, absent: total - present, inactive: inactive, roster: roster,
  };
}

function firstLast_(punches) {
  var firstIn = null, lastOut = null;
  punches.forEach(function (p) {
    var t = String(p.punch_time);
    if (p.punch_type === "OUT" || (p.punch_type === "IN" && firstIn !== null)) {
      if (lastOut === null || t > lastOut) lastOut = t;
    } else if (firstIn === null || t < firstIn) firstIn = t;
  });
  if (punches.length) {
    var mins = [], maxs = "";
    punches.forEach(function (p) {
      var t = String(p.punch_time);
      mins.push(t);
      if (t > maxs) maxs = t;
    });
    mins.sort();
    if (firstIn === null) firstIn = mins[0];
    if (lastOut === null) lastOut = (maxs !== mins[0]) ? maxs : null;
  }
  return [firstIn, lastOut];
}

function positionsReport_(date) {
  var workers = workers_().filter(function (w) { return String(w.status) === "active"; });
  var attendance = readTable_("Attendance").filter(function (a) {
    return String(a.punch_time).indexOf(String(date)) === 0;
  });
  var punchMap = {};
  attendance.forEach(function (a) {
    if (a.worker_id === "" || a.worker_id === null || a.worker_id === undefined) return;
    (punchMap[a.worker_id] = punchMap[a.worker_id] || []).push(a);
  });
  var groups = {};
  var variants = {};
  workers.forEach(function (w) {
    var pos = String(w.position || "").trim() || "Not Assigned";
    var norm = pos.toLowerCase().replace(/\s+/g, " ");
    (variants[norm] = variants[norm] || {})[pos] = (variants[norm][pos] || 0) + 1;
    (groups[norm] = groups[norm] || []).push({ w: w, punches: punchMap[w.id] || [] });
  });
  var positions = Object.keys(groups).sort().map(function (key) {
    var members = groups[key].map(function (g) {
      var fl = firstLast_(g.punches);
      return {
        id: g.w.id, employee_id: g.w.employee_id,
        name: g.w.lname + ", " + g.w.fname, position: g.w.position,
        present: g.punches.length > 0, punch_count: g.punches.length,
        time_in: fl[0] ? fl[0].substring(11, 16) : null,
        time_out: fl[1] ? fl[1].substring(11, 16) : null,
      };
    });
    members.sort(function (a, b) {
      return (a.present === b.present) ? (a.name < b.name ? -1 : 1) : (a.present ? -1 : 1);
    });
    var present = members.filter(function (x) { return x.present; }).length;
    var display = Object.keys(variants[key]).sort(function (a, b) {
      return variants[key][b] - variants[key][a];
    })[0];
    return { position: display, total: members.length, present: present, absent: members.length - present, workers: members };
  });
  var totalPresent = positions.reduce(function (s, p) { return s + p.present; }, 0);
  return { date: date, positions: positions, total_present: totalPresent };
}

// ---------------------------------------------------------------------------
// Drive
// ---------------------------------------------------------------------------
function ensureRootFolder_() {
  var it = DriveApp.getRootFolder().getFoldersByName(ROOT_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(ROOT_FOLDER);
}

function ensureAttendFolder_() {
  var root = ensureRootFolder_();
  var it = root.getFoldersByName(ATTENDANCE_FOLDER);
  return it.hasNext() ? it.next() : root.createFolder(ATTENDANCE_FOLDER);
}

function ensureBackupFolder_() {
  var root = ensureRootFolder_();
  var it = root.getFoldersByName(BACKUP_FOLDER);
  return it.hasNext() ? it.next() : root.createFolder(BACKUP_FOLDER);
}

function backup_() {
  var ss = getSpreadsheet_();
  var name = "MANPOWER_backup_" + Utilities.formatDate(new Date(), "GMT", "yyyyMMdd_HHmmss") + ".xlsx";
  var file = DriveApp.getFileById(ss.getId()).makeCopy(name, ensureBackupFolder_());
  return { ok: true, name: name, url: file.getUrl() };
}

function status_() {
  ensureSetup_();
  var ss = getSpreadsheet_();
  return {
    ok: true,
    connected: true,
    spreadsheet_url: ss.getUrl(),
    drive_root_url: ensureRootFolder_().getUrl(),
    attendance_folder_id: ensureAttendFolder_().getId(),
    backup_folder_id: ensureBackupFolder_().getId(),
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
function toJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handleError_(e) {
  var msg = e && e.message ? e.message : String(e);
  return toJson_({ ok: false, error: msg });
}

function doGet_(e) {
  var p = (e && e.parameter) || {};
  var route = p.route || "stats";
  try {
    switch (route) {
      case "status": return toJson_(status_());
      case "stats": return toJson_(stats_());
      case "workers": return toJson_(workers_());
      case "daily": return toJson_(dailyReport_(p.date || today_()));
      case "positions": return toJson_(positionsReport_(p.date || today_()));
      default: return toJson_({ ok: false, error: "Unknown route: " + route });
    }
  } catch (err) { return handleError_(err); }
}

function doPost_(e) {
  var route = (e && e.parameter && e.parameter.route) || "";
  var body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return toJson_({ ok: false, error: "Invalid JSON body" });
  }
  try {
    switch (route) {
      case "workers-add": return toJson_(addWorker_(body));
      case "workers-update": return toJson_(updateWorker_(Number(body.id), body));
      case "workers-delete": return toJson_(deleteWorker_(Number(body.id)));
      case "workers-batch-id": return toJson_(batchEmployeeId_(body.pairs || []));
      case "attendance-commit": return toJson_(commitAttendance_(body));
      case "reset": return toJson_(reset_());
      case "backup": return toJson_(backup_());
      case "status": return toJson_(status_());
      default: return toJson_({ ok: false, error: "Unknown route: " + route });
    }
  } catch (err) { return handleError_(err); }
}

function today_() {
  return Utilities.formatDate(new Date(), "GMT", "yyyy-MM-dd");
}

function stats_() {
  var workers = workers_();
  var attendance = readTable_("Attendance");
  var today = today_();
  var total = workers.length;
  var active = workers.filter(function (w) { return String(w.status) === "active"; }).length;
  var presentSet = {};
  attendance.forEach(function (a) {
    if (String(a.punch_time + "").indexOf(today) === 0 && a.worker_id !== "" && a.worker_id !== null) {
      presentSet[a.worker_id] = true;
    }
  });
  var imports = readTable_("ImportLog").slice(-3).reverse();
  return {
    total_workers: total, active_workers: active,
    present_today: Object.keys(presentSet).length,
    absent_today: Math.max(active - Object.keys(presentSet).length, 0),
    recent_imports: imports,
  };
}

function doGet(e) { return doGet_(e); }
function doPost(e) { return doPost_(e); }