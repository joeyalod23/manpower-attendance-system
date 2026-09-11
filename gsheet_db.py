"""Google Sheets data layer.

Replaces the old SQLite database. Every table is one tab in the shared
"MANPOWER Database" spreadsheet:

    Workers     id | employee_id | lname | fname | position | status | created_at
    Attendance  id | emp_key | worker_id | punch_time | punch_type | source | imported_file | created_at
    ImportLog   id | filename | rows_total | rows_matched | rows_unmatched | imported_at
    Meta        key | value   (auto-increment counters / misc settings)
"""

from datetime import datetime

import gservices as g

HEADERS = {
    "Workers": ["id", "employee_id", "lname", "fname", "position", "status", "created_at"],
    "Attendance": ["id", "emp_key", "worker_id", "punch_time", "punch_type", "source", "imported_file", "created_at"],
    "ImportLog": ["id", "filename", "rows_total", "rows_matched", "rows_unmatched", "imported_at"],
    "Meta": ["key", "value"],
}

INT_FIELDS = ("id", "worker_id", "rows_total", "rows_matched", "rows_unmatched")


def now():
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


def _table(name):
    ncols = len(HEADERS[name])
    col_letter = chr(ord("A") + ncols - 1)
    data = g.sheet_values("{0}!A:{1}".format(name, col_letter))
    rows = []
    for i, r in enumerate(data):
        if i == 0:
            continue
        if not r or all(not str(v).strip() for v in r):
            continue
        d = {}
        for j, h in enumerate(HEADERS[name]):
            v = r[j] if j < len(r) else ""
            if h in INT_FIELDS and str(v).strip():
                try:
                    v = int(float(v))
                except (ValueError, TypeError):
                    pass
            d[h] = v
        rows.append(d)
    return rows


def _rewrite_table(name, rows):
    """Replace a whole table with the given rows (header preserved)."""
    headers = HEADERS[name]
    ncols = len(headers)
    col_letter = chr(ord("A") + ncols - 1)
    data_range = "{0}!A1:{1}".format(name, col_letter)
    g.clear_values(data_range)
    values = [headers] + [[r.get(h, "") for h in headers] for r in rows]
    g.write_values(data_range, values, raw=True)


def _load_meta():
    meta = {}
    for r in _table("Meta"):
        key = str(r.get("key", "")).strip()
        if key:
            meta[key] = r.get("value", "")
    for k, d in (("workers_seq", 0), ("attendance_seq", 0), ("importlog_seq", 0)):
        meta.setdefault(k, d)
    return meta


def _save_meta(meta):
    entries = [["key", "value"]] + [[k, str(v)] for k, v in meta.items()]
    g.write_values("Meta!A1:B{0}".format(len(entries)), entries, raw=True)


def ensure_setup():
    titles = g.get_sheet_titles()
    for t in HEADERS:
        if t not in titles:
            g.add_sheet(t)
    for t, rows in (("Workers", 10000), ("Attendance", 200000), ("ImportLog", 10000), ("Meta", 50)):
        try:
            g.set_grid_rows(t, rows)
        except Exception:
            pass
    for t in HEADERS:
        ncols = len(HEADERS[t])
        col_letter = chr(ord("A") + ncols - 1)
        data = g.sheet_values("{0}!A1:{1}".format(t, col_letter))
        if not data or data[0] != HEADERS[t]:
            g.write_values("{0}!A1:{1}".format(t, col_letter), [HEADERS[t]], raw=True)
    meta = _load_meta()
    _save_meta(meta)


# ---------------------------------------------------------------------------
# Workers
# ---------------------------------------------------------------------------
def get_workers():
    workers = _table("Workers")
    workers.sort(key=lambda w: (str(w.get("lname", "")).lower(), str(w.get("fname", "")).lower()))
    return workers


def add_worker(eid, lname, fname, position):
    eid = str(eid or "").strip()
    lname = str(lname or "").strip().upper()
    fname = str(fname or "").strip().upper()
    position = str(position or "").strip()
    for w in get_workers():
        if eid and str(w.get("employee_id", "")).strip() == eid:
            raise ValueError("Employee ID already exists")
    meta = _load_meta()
    wid = int(meta.get("workers_seq", 0)) + 1
    meta["workers_seq"] = wid
    _save_meta(meta)
    row = [wid, eid, lname, fname, position, "active", now()]
    g.append_values("Workers!A:G", [row])
    return wid


def update_worker(wid, data):
    workers = get_workers()
    target = None
    for w in workers:
        if w["id"] == wid:
            target = w
            break
    if target is None:
        raise KeyError("Not found")
    eid = str(data.get("employee_id", target.get("employee_id", ""))).strip()
    if eid:
        for w in workers:
            if w["id"] != wid and str(w.get("employee_id", "")).strip() == eid:
                raise ValueError("Employee ID already exists")
    target["employee_id"] = eid
    target["lname"] = str(data.get("lname", target.get("lname"))).strip().upper()
    target["fname"] = str(data.get("fname", target.get("fname"))).strip().upper()
    target["position"] = str(data.get("position", target.get("position"))).strip()
    target["status"] = str(data.get("status", target.get("status", "active"))).strip()
    _rewrite_table("Workers", workers)


def delete_worker(wid):
    workers = [w for w in get_workers() if w["id"] != wid]
    attendance = [a for a in _table("Attendance") if a.get("worker_id") != wid]
    _rewrite_table("Workers", workers)
    _rewrite_table("Attendance", attendance)


def batch_set_employee_ids(pairs):
    workers = get_workers()
    by_id = {w["id"]: w for w in workers}
    updated = 0
    for p in pairs:
        wid = p.get("id")
        eid = str(p.get("employee_id", "")).strip()
        w = by_id.get(wid)
        if w is None:
            continue
        dup = any(o["id"] != wid and str(o.get("employee_id", "")).strip() == eid for o in workers)
        if eid and dup:
            continue
        w["employee_id"] = eid
        updated += 1
    if updated:
        _rewrite_table("Workers", workers)
    return updated


def find_worker(emp_key):
    k = str(emp_key).strip()
    for w in get_workers():
        if str(w.get("employee_id", "")).strip() == k:
            return w
    return None


def worker_by_name(fullname):
    if not fullname:
        return None
    import re
    parts = [p.strip().upper() for p in re.split(r"[\s,]+", fullname) if p.strip()]
    for p in parts:
        for w in get_workers():
            if str(w.get("lname", "")).upper() == p or str(w.get("fname", "")).upper() == p:
                return w
    return None


# ---------------------------------------------------------------------------
# Seeding
# ---------------------------------------------------------------------------
def seed_workers(seed_rows):
    """seed_rows: iterable of [employee_id, lname, fname, position]."""
    workers = get_workers()
    existing_ids = {str(w.get("employee_id", "")).strip() for w in workers}
    meta = _load_meta()
    seq = int(meta.get("workers_seq", 0))
    pending = []
    added, skipped = 0, 0
    for eid, lname, fname, position in seed_rows:
        eid = str(eid or "").strip()
        lname = str(lname or "").strip()
        fname = str(fname or "").strip()
        position = str(position or "").strip()
        if not lname and not fname:
            continue
        if eid and eid in existing_ids:
            skipped += 1
            continue
        seq += 1
        pending.append([seq, eid, lname.upper(), fname.upper(), position, "active", now()])
        if eid:
            existing_ids.add(eid)
        added += 1
    if pending:
        meta["workers_seq"] = seq
        _save_meta(meta)
        g.append_values("Workers!A:G", pending)
    return {"ok": True, "added": added, "skipped": skipped}


# ---------------------------------------------------------------------------
# Attendance
# ---------------------------------------------------------------------------
def get_attendance():
    return _table("Attendance")


def commit_attendance(records, filename, mapping):
    meta = _load_meta()
    seq = int(meta.get("attendance_seq", 0))
    new_rows = []
    matched_ids = set()
    for rec in records:
        emp_key = str(rec.get("emp_key", "")).strip()
        worker_id = rec.get("worker_id")
        if worker_id is None and emp_key in mapping:
            worker_id = mapping[emp_key]
        if worker_id:
            matched_ids.add(worker_id)
        dt = rec.get("punch_time")
        try:
            dt = datetime.strptime(dt, "%Y-%m-%d %H:%M:%S").strftime("%Y-%m-%d %H:%M:%S")
        except Exception:
            continue
        seq += 1
        new_rows.append([
            seq, emp_key,
            "" if worker_id is None else worker_id,
            dt,
            rec.get("punch_type", ""),
            "biometric",
            filename,
            now(),
        ])
    if not new_rows:
        return {"ok": False, "inserted": 0}
    meta["attendance_seq"] = seq

    ilog_seq = int(meta.get("importlog_seq", 0)) + 1
    meta["importlog_seq"] = ilog_seq
    total = len(records)
    matched = len(matched_ids)
    g.append_values("Attendance!A:H", new_rows)
    g.append_values("ImportLog!A:F", [[
        ilog_seq, filename, total, matched, total - matched, now()]])
    _save_meta(meta)
    return {"ok": True, "inserted": len(new_rows)}


# ---------------------------------------------------------------------------
# Import log
# ---------------------------------------------------------------------------
def recent_imports(limit=3):
    imports = _table("ImportLog")
    imports_sorted = sorted(imports, key=lambda r: int(r.get("id", 0)), reverse=True)
    return imports_sorted[:limit]


# ---------------------------------------------------------------------------
# Stats / reports
# ---------------------------------------------------------------------------
def stats():
    workers = get_workers()
    attendance = _table("Attendance")
    today = datetime.now().date().isoformat()
    total = len(workers)
    active = sum(1 for w in workers if w.get("status") == "active")
    present = {a.get("worker_id") for a in attendance
               if a.get("worker_id") is not None and str(a.get("punch_time", ""))[:10] == today}
    return {
        "total_workers": total,
        "active_workers": active,
        "present_today": len(present),
        "absent_today": max(active - len(present), 0),
        "recent_imports": recent_imports(3),
    }


def _first_in_last_out(punches):
    first_in = None
    last_out = None
    for p in punches:
        t = p["punch_time"]
        if p["punch_type"] == "OUT" or (p["punch_type"] == "IN" and first_in is not None):
            if last_out is None or t > last_out:
                last_out = t
        elif first_in is None or t < first_in:
            first_in = t
    if punches:
        tmin = min(p["punch_time"] for p in punches)
        tmax = max(p["punch_time"] for p in punches)
        if first_in is None:
            first_in = tmin
        if last_out is None:
            last_out = tmax if tmax != tmin else None
    return first_in, last_out


def _punch_map_for_date(date):
    punch_map = {}
    for a in _table("Attendance"):
        if a.get("worker_id") is None:
            continue
        if str(a.get("punch_time", ""))[:10] == str(date):
            punch_map.setdefault(a["worker_id"], []).append(a)
    return punch_map


def daily_report(date):
    workers = [w for w in get_workers() if w.get("status") == "active"]
    punch_map = _punch_map_for_date(date)
    roster = []
    present_ids = set()
    for w in workers:
        punches = punch_map.get(w["id"], [])
        if punches:
            present_ids.add(w["id"])
        first_in, last_out = _first_in_last_out(punches)
        roster.append({
            "id": w["id"],
            "employee_id": w["employee_id"],
            "name": "{0}, {1}".format(w["lname"], w["fname"]),
            "position": w["position"],
            "present": bool(punches),
            "punch_count": len(punches),
            "time_in": first_in[11:16] if first_in else None,
            "time_out": last_out[11:16] if last_out else None,
        })
    roster.sort(key=lambda x: (not x["present"], x["name"]))
    total = len(workers)
    inactive = sum(1 for w in get_workers() if w.get("status") != "active")
    return {
        "date": date,
        "total_manpower": total + inactive,
        "active_manpower": total,
        "present": len(present_ids),
        "absent": total - len(present_ids),
        "inactive": inactive,
        "roster": roster,
    }


def positions_report(date):
    workers = [w for w in get_workers() if w.get("status") == "active"]
    punch_map = _punch_map_for_date(date)
    groups = {}
    display_variants = {}
    for w in workers:
        pos = (w.get("position") or "").strip() or "Not Assigned"
        norm = " ".join(pos.split()).lower()
        dv = display_variants.setdefault(norm, {})
        dv[pos] = dv.get(pos, 0) + 1
        punches = punch_map.get(w["id"], [])
        first_in, last_out = _first_in_last_out(punches)
        groups.setdefault(norm, []).append({
            "id": w["id"],
            "employee_id": w["employee_id"],
            "name": "{0}, {1}".format(w["lname"], w["fname"]),
            "present": bool(punches),
            "punch_count": len(punches),
            "time_in": first_in[11:16] if first_in else None,
            "time_out": last_out[11:16] if last_out else None,
        })
    positions = []
    for key in sorted(groups, key=lambda k: k.lower()):
        members = sorted(groups[key], key=lambda x: (not x["present"], x["name"]))
        present = sum(1 for m in members if m["present"])
        positions.append({
            "position": max(display_variants[key], key=display_variants[key].get),
            "total": len(members),
            "present": present,
            "absent": len(members) - present,
            "workers": members,
        })
    return {
        "date": date,
        "positions": positions,
        "total_present": sum(p["present"] for p in positions),
    }


def reset_all():
    _rewrite_table("Workers", [])
    _rewrite_table("Attendance", [])
    _rewrite_table("ImportLog", [])
    meta = _load_meta()
    meta.update({"workers_seq": 0, "attendance_seq": 0, "importlog_seq": 0})
    _save_meta(meta)