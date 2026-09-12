/*
 * MANPOWER Live Portal — frontend (served by GitHub Pages).
 *
 * Talks to the Google Apps Script web app (the backend/database). Set
 * API_BASE to your deployed Apps Script /exec URL, e.g.
 *   const API_BASE = "https://script.google.com/macros/s/ABCDEFG/exec";
 */

const API_BASE = "PASTE_APPS_SCRIPT_URL_HERE";

// ---------------------------------------------------------------------------
// API layer (GET via query string, POST as JSON in a text/plain body so the
// cross-origin request stays CORS-simple).
// ---------------------------------------------------------------------------
async function api(route, opts = {}) {
    const method = opts.method || 'GET';
    const params = opts.params || {};
    const qs = new URLSearchParams({ route, ...params }).toString();
    const init = { method };
    if (method !== 'GET') {
        init.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
        init.body = JSON.stringify(opts.body || {});
    }
    const res = await fetch(API_BASE + '?' + qs, init);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('Backend returned unreadable data. Is API_BASE set correctly?'); }
    if (data && data.ok === false) throw new Error(data.error || 'Request failed');
    return data;
}

function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function toast(msg, type = 'success') {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    document.getElementById('toastWrap').appendChild(el);
    setTimeout(() => el.remove(), 3500);
}

// ---------------------------------------------------------------------------
// Biometric log parsing (ported from the desktop app's Python parser)
// ---------------------------------------------------------------------------
function pad2(n) { n = Number(n); return n < 10 ? '0' + n : '' + n; }

function parseDatePieces(s) {
    const tries = [
        { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, mo: 1, d: 2, y: 3 },
        { re: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, y: 1, mo: 2, d: 3 },
        { re: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, mo: 1, d: 2, y: 3 },
        { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, d: 1, mo: 2, y: 3 },
        { re: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, d: 1, mo: 2, y: 3 },
        { re: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, y: 1, mo: 2, d: 3 },
    ];
    for (const t of tries) {
        const m = String(s).trim().match(t.re);
        if (m) return [pad2(m[t.y]), pad2(m[t.mo]), pad2(m[t.d])];
    }
    return null;
}

function splitDatetime(s) {
    s = String(s).trim();
    const timeTries = [
        { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/, mo: 1, d: 2, y: 3 },
        { re: /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/, y: 1, mo: 2, d: 3 },
        { re: /^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/, mo: 1, d: 2, y: 3 },
        { re: /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/, y: 1, mo: 2, d: 3 },
    ];
    for (const t of timeTries) {
        const m = s.match(t.re);
        if (m) {
            return pad2(m[t.y]) + '-' + pad2(m[t.mo]) + '-' + pad2(m[t.d]) + ' ' +
                   pad2(m[4]) + ':' + pad2(m[5]) + ':' + pad2(m[6] || 0);
        }
    }
    const p = parseDatePieces(s);
    if (p) return p.join('-') + ' 00:00:00';
    const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:[.]\d+)?(?:Z|([+-]\d{2}:?\d{2}))?$/);
    if (iso) return pad2(iso[1]) + '-' + pad2(iso[2]) + '-' + pad2(iso[3]) + ' ' +
                   pad2(iso[4]) + ':' + pad2(iso[5]) + ':' + pad2(iso[6] || 0);
    return null;
}

function parseDateAndTime(dval, tval) {
    if (dval === null || dval === undefined) return null;
    const d = String(dval).trim();
    const t = tval === null || tval === undefined ? null : String(tval).trim();
    if (t !== null && t !== '') {
        const p = parseDatePieces(d);
        if (p) {
            const tm = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
            if (tm) return p.join('-') + ' ' + pad2(tm[1]) + ':' + pad2(tm[2]) + ':' + pad2(tm[3] || 0);
            return p.join('-') + ' 00:00:00';
        }
        const dt = splitDatetime(d);
        if (dt) {
            const tm = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
            if (tm) return dt.slice(0, 10) + ' ' + pad2(tm[1]) + ':' + pad2(tm[2]) + ':' + pad2(tm[3] || 0);
            return dt;
        }
        return null;
    }
    return splitDatetime(dval);
}

function looksLikeKey(s, keys) {
    s = String(s).trim().toLowerCase().replace(/_/g, '').replace(/-/g, '').replace(/ /g, '');
    return keys.indexOf(s) >= 0 || keys.some(k => s.indexOf(k) >= 0);
}

function normalizeRows(rawRows) {
    if (!rawRows.length) return [];
    let header = null, startIdx = 0;
    for (let i = 0; i < Math.min(20, rawRows.length); i++) {
        const joined = rawRows[i].join(' ').toLowerCase();
        if (/date|time|user|\bid\b|name|punch|check|record/.test(joined)) { header = rawRows[i]; startIdx = i + 1; break; }
    }
    if (header === null) { header = ['id', 'datetime']; startIdx = 0; }
    const h = header.map(x => String(x).trim().toLowerCase());

    function findCol(keys) {
        for (let idx = 0; idx < h.length; idx++) if (looksLikeKey(h[idx], keys)) return idx;
        return null;
    }

    const iDt = findCol(['datetime', 'dateandtime', 'date and time', 'attendance time', 'punchtime', 'recordtime', 'record time']);
    const iDate = findCol(['date']);
    const iTime = findCol(['time']);
    const iId = findCol(['userid', 'user id', 'userno', 'eno', 'employeeid', 'employee id', 'empid', 'badge', 'idno', 'id no', 'enrollid', 'srno', 'id']);
    const iName = findCol(['name', 'employeename', 'employee name', 'fullname']);
    const iFname = findCol(['firstname', 'first name', 'fname', 'givenname']);
    const iLname = findCol(['lastname', 'last name', 'lname', 'surname']);
    let iType = findCol(['verified', 'verification', 'recordstate', 'record state', 'state', 'punchtype', 'type', 'status', 'inout', 'in/out', 'io']);

    if (iType === null && iId !== null && iDt !== null) {
        const colVals = {};
        for (let r = startIdx; r < Math.min(startIdx + 200, rawRows.length); r++) {
            const row = rawRows[r];
            for (let c = 0; c < row.length; c++) {
                (colVals[c] = colVals[c] || new Set()).add(String(row[c]).trim());
            }
        }
        for (const ci of Object.keys(colVals).map(Number)) {
            if (ci === iId || ci === iDt || ci === iDate || ci === iTime) continue;
            const vals = colVals[ci];
            let all05 = true;
            for (const v of vals) { if (!/^[0-5]$/.test(v)) { all05 = false; break; } }
            if (all05 && vals.size >= 2) { iType = ci; break; }
        }
    }

    const records = [];
    for (let k = startIdx; k < rawRows.length; k++) {
        const rw = rawRows[k];
        if (!rw || rw.every(c => String(c).trim() === '')) continue;
        const padArr = rw.concat(new Array(Math.max(0, h.length - rw.length)).fill(''));

        let dt = null;
        if (iDt !== null) dt = splitDatetime(padArr[iDt]);
        else if (iDate !== null) dt = parseDateAndTime(padArr[iDate], iTime !== null ? padArr[iTime] : null);
        if (dt === null) continue;

        let empKey = '';
        if (iId !== null) empKey = String(padArr[iId]).trim();
        if (!empKey && (header[0] === 'id' || header[0] === 'emp')) empKey = String(rw[0]).trim();

        let name = '';
        if (iName !== null) name = String(padArr[iName]).trim();
        else if (iFname !== null || iLname !== null) {
            name = (String(padArr[iFname] || '').trim() + ' ' + String(padArr[iLname] || '').trim()).trim();
        }

        let ptype = '';
        if (iType !== null) {
            const t = String(padArr[iType]).trim().toLowerCase();
            const zk = { '0': 'IN', '1': 'OUT', '2': 'OUT', '3': 'IN', '4': 'IN', '5': 'OUT' };
            if (t in zk) ptype = zk[t];
            else if (['in', 'checkin', 'check in', 'entry', 'i'].indexOf(t) >= 0) ptype = 'IN';
            else if (['out', 'checkout', 'check out', 'exit', 'o'].indexOf(t) >= 0) ptype = 'OUT';
            else ptype = String(padArr[iType]).trim();
        }

        records.push({ emp_key: empKey, name, punch_time: dt, punch_type: ptype });
    }
    return records;
}

function parseBiometricText(text, filename) {
    const ext = (filename.split('.').pop() || '').toLowerCase();
    const rawRows = [];
    const lines = text.split(/\r?\n/);
    if (ext === 'csv') {
        const sample = text.slice(0, 4096);
        const delim = sample.indexOf(',') >= 0 ? ',' : sample.indexOf(';') >= 0 ? ';' : sample.indexOf('\t') >= 0 ? '\t' : ',';
        for (const line of lines) {
            if (!line.trim()) continue;
            rawRows.push(line.split(delim).map(c => c.trim()));
        }
    } else {
        for (const line of lines) {
            if (!line.trim()) continue;
            if (line.indexOf(',') >= 0) rawRows.push(line.split(',').map(c => c.trim()));
            else if (line.indexOf('\t') >= 0) rawRows.push(line.split('\t').map(c => c.trim()));
            else rawRows.push(line.trim().split(/\s+/));
        }
    }
    return normalizeRows(rawRows);
}

// ---------------------------------------------------------------------------
// Matching helpers (mirror the desktop app)
// ---------------------------------------------------------------------------
function findWorker(workers, empKey) {
    const k = String(empKey).trim();
    return workers.find(w => String(w.employee_id || '').trim() === k) || null;
}
function workerByName(workers, fullname) {
    if (!fullname) return null;
    const parts = fullname.toUpperCase().split(/[\s,]+/).filter(Boolean);
    for (const p of parts) {
        const w = workers.find(x => String(x.lname || '').toUpperCase() === p || String(x.fname || '').toUpperCase() === p);
        if (w) return w;
    }
    return null;
}
function matchRecords(workers, records) {
    const matched = [], unmatched = [];
    for (const rec of records) {
        const w = findWorker(workers, rec.emp_key) || workerByName(workers, rec.name);
        if (w) matched.push({ ...rec, worker_id: w.id, employee_id: w.employee_id, name: w.lname + ', ' + w.fname });
        else unmatched.push(rec);
    }
    return { matched, unmatched };
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
const Views = {
    async dashboard() {
        const s = await api('stats');
        return `
            <div class="topbar">
                <div><h1>Dashboard</h1><div class="date">${new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div></div>
                <button class="btn btn-accent" onclick="Views.nav('import')"><i class="fas fa-file-upload"></i> Import Biometric Log</button>
            </div>
            <div class="cards">
                <div class="card"><div class="label">Total Manpower</div><div class="value">${s.total_workers}</div><div class="sub">All registered workers</div></div>
                <div class="card green"><div class="label">Active</div><div class="value">${s.active_workers}</div><div class="sub">Currently active workers</div></div>
                <div class="card cyan"><div class="label">Present Today</div><div class="value">${s.present_today}</div><div class="sub">Scanned today</div></div>
                <div class="card red"><div class="label">Absent Today</div><div class="value">${s.absent_today}</div><div class="sub">Active but no scan today</div></div>
            </div>
            <div class="panel">
                <h3>Recent Imports</h3>
                ${s.recent_imports.length ? `
                <div class="table-wrap"><table>
                    <thead><tr><th>File</th><th>Records</th><th>Matched</th><th>Unmatched</th><th>Time</th></tr></thead>
                    <tbody>
                        ${s.recent_imports.map(i => `<tr><td>${esc(i.filename)}</td><td>${i.rows_total}</td><td style="color:var(--green)">${i.rows_matched}</td><td style="color:var(--red)">${i.rows_unmatched}</td><td>${esc(i.imported_at)}</td></tr>`).join('')}
                    </tbody>
                </table></div>` : '<div class="empty"><i class="fas fa-inbox"></i><p>No attendance imports yet. Import a biometric log to get started.</p></div>'}
            </div>
            <div class="panel">
                <h3>Quick Actions</h3>
                <div style="display:flex;gap:.8rem;flex-wrap:wrap">
                    <button class="btn btn-primary" onclick="Views.nav('workers')"><i class="fas fa-user-plus"></i> Manage Workers</button>
                    <button class="btn btn-green" onclick="Views.nav('report')"><i class="fas fa-calendar-check"></i> View Daily Report</button>
                </div>
            </div>`;
    },

    async workers() {
        const workers = await api('workers');
        return `
            <div class="topbar">
                <div><h1>Workers</h1><div class="date">${workers.length} registered</div></div>
                <div style="display:flex;gap:.8rem">
                    <button class="btn btn-primary" onclick="openWorkerModal()"><i class="fas fa-user-plus"></i> Add Worker</button>
                    <button class="btn btn-accent" onclick="openBatchIdModal()"><i class="fas fa-id-badge"></i> Assign Standard IDs</button>
                </div>
            </div>
            <div class="panel">
                <div class="toolbar">
                    <input class="search" id="workerSearch" placeholder="Search name, ID, position..." oninput="filterWorkers()">
                    <span class="ml sum">
                        <span class="chip chip-blue">${workers.filter(w => w.status === 'active').length} Active</span>
                        <span class="chip chip-gray">${workers.filter(w => w.status !== 'active').length} Inactive</span>
                    </span>
                </div>
                <div class="table-wrap"><table>
                    <thead><tr>
                        <th>#</th><th>Standard ID</th><th>Last Name</th><th>First Name</th><th>Position</th><th>Status</th><th style="width:120px">Actions</th>
                    </tr></thead>
                    <tbody id="workersTbody">${renderWorkerRows(workers)}</tbody>
                </table></div>
            </div>`;
    },

    async import() {
        return `
            <div class="topbar">
                <div><h1>Import Attendance Log</h1><div class="date">Upload a biometric device export</div></div>
                <a class="btn btn-ghost" href="#" onclick="sampleFormats(event)"><i class="fas fa-info-circle"></i> Supported Formats</a>
            </div>
            <div class="panel">
                <div class="import-zone" id="dropZone">
                    <i class="fas fa-cloud-upload-alt"></i>
                    <h3>Drop your biometric log here</h3>
                    <p>or click to browse  (CSV, TXT, DAT)</p>
                    <input type="file" id="fileInput" accept=".csv,.txt,.dat" style="display:none">
                </div>
                <div class="sum" id="parseSummary"></div>
            </div>
            <div class="panel" id="previewPanel" style="display:none">
                <h3 id="previewTitle">Preview</h3>
                <div id="previewBody"></div>
            </div>`;
    },

    async report() {
        const today = new Date().toISOString().slice(0, 10);
        return `
            <div class="topbar">
                <div><h1>Daily Manpower Report</h1></div>
                <button class="btn btn-green" onclick="exportReportCsv()"><i class="fas fa-download"></i> Export CSV</button>
            </div>
            <div class="panel">
                <div class="toolbar" style="align-items:center">
                    <div class="form-group" style="margin:0">
                        <label for="reportDate">Report Date</label>
                        <input type="date" id="reportDate" value="${today}" onchange="loadReport()">
                    </div>
                    <div class="form-group" style="margin:0">
                        <label>Quick Backtrack</label>
                        <select id="quickDate" onchange="setReportDateFromSelect()">
                            <option value="0">Today</option>
                            <option value="1">Yesterday</option>
                            <option value="2">2 days ago</option>
                            <option value="7">Last week</option>
                        </select>
                    </div>
                </div>
                <div id="reportContent"><div class="empty"><i class="fas fa-spinner fa-spin"></i><p>Loading...</p></div></div>
            </div>`;
    },

    async positions() {
        const today = new Date().toISOString().slice(0, 10);
        return `
            <div class="topbar">
                <div><h1>Manpower by Position</h1><div class="date">Present attendance per position</div></div>
            </div>
            <div class="panel">
                <div class="toolbar" style="align-items:center">
                    <div class="form-group" style="margin:0">
                        <label for="posDate">Report Date</label>
                        <input type="date" id="posDate" value="${today}" onchange="loadPositions()">
                    </div>
                    <div class="form-group" style="margin:0">
                        <label>Quick Backtrack</label>
                        <select id="posQuickDate" onchange="setPosDateFromSelect()">
                            <option value="0">Today</option>
                            <option value="1">Yesterday</option>
                            <option value="2">2 days ago</option>
                            <option value="7">Last week</option>
                        </select>
                    </div>
                    <div class="sum ml" id="posSummary"></div>
                </div>
                <div id="posContent"><div class="empty"><i class="fas fa-spinner fa-spin"></i><p>Loading...</p></div></div>
            </div>`;
    },

    async settings() {
        return `
            <div class="topbar"><div><h1>Settings</h1></div></div>
            <div class="panel">
                <h3>Google Backend</h3>
                <div id="googleStatus"><div class="empty"><i class="fas fa-spinner fa-spin"></i><p>Checking connection...</p></div></div>
            </div>
            <div class="panel">
                <h3>Data</h3>
                <div class="form-grid" style="max-width:500px">
                    <div class="form-group"><label>Backup Database to Drive</label><button class="btn btn-green" onclick="backupToDrive()"><i class="fas fa-cloud-upload-alt"></i> Backup Now</button></div>
                    <div class="form-group"><label>Danger Zone</label><button class="btn btn-danger" onclick="confirmReset()"><i class="fas fa-trash"></i> Reset All Data</button></div>
                </div>
                <div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid var(--border);color:var(--gray);font-size:.85rem">
                    <p><strong>How it works:</strong> This live portal is served from GitHub Pages. Its backend is a Google Apps Script connected to the shared <em>MANPOWER Database</em> spreadsheet and Google Drive folders. Imported biometric logs (CSV/TXT/DAT) are parsed in your browser, saved to the sheet, and a copy of each log is stored in Drive.</p>
                    <p style="margin-top:.5rem"><strong>Seeding from Excel / XLSX imports</strong> are available in the desktop app.</p>
                </div>
            </div>`;
    }
};

// ---------------------------------------------------------------------------
// Worker rows & modals
// ---------------------------------------------------------------------------
function renderWorkerRows(workers) {
    return workers.map((w, i) => `
        <tr data-search="${esc((w.lname + ' ' + w.fname + ' ' + w.employee_id + ' ' + w.position).toLowerCase())}">
            <td>${i + 1}</td>
            <td><strong>${w.employee_id ? esc(w.employee_id) : '<span style="color:var(--red)">—</span>'}</strong></td>
            <td>${esc(w.lname)}</td>
            <td>${esc(w.fname)}</td>
            <td>${esc(w.position)}</td>
            <td>${w.status === 'active' ? '<span class="badge badge-green">Active</span>' : '<span class="badge badge-red">Inactive</span>'}</td>
            <td>
                <button class="btn btn-ghost btn-sm" onclick="openWorkerModal(${w.id})"><i class="fas fa-edit"></i></button>
                <button class="btn btn-danger btn-sm" onclick="deleteWorker(${w.id}, '${esc(w.lname + ', ' + w.fname)}')"><i class="fas fa-trash"></i></button>
            </td>
        </tr>`).join('');
}
function filterWorkers() {
    const q = (document.getElementById('workerSearch').value || '').toLowerCase().trim();
    document.querySelectorAll('#workersTbody tr').forEach(tr => {
        tr.style.display = tr.dataset.search.includes(q) ? '' : 'none';
    });
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
let currentView = 'dashboard';
async function nav(view) {
    currentView = view;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
    const area = document.getElementById('mainArea');
    area.innerHTML = '<div class="empty"><i class="fas fa-spinner fa-spin"></i><p>Loading...</p></div>';
    try {
        if (!/^https:\/\/script\.google\.com\/macros\/s\//.test(API_BASE)) {
            throw new Error('Set API_BASE in app.js to your deployed Apps Script URL.');
        }
        area.innerHTML = await Views[view]();
        if (view === 'report') loadReport();
        if (view === 'import') setupImportZone();
        if (view === 'positions') loadPositions();
        if (view === 'settings') loadGoogleStatus();
    } catch (e) {
        area.innerHTML = `<div class="empty"><i class="fas fa-exclamation-triangle"></i><p>${esc(e.message)}</p></div>`;
    }
}
window.nav = nav;
function bindNav() {
    document.querySelectorAll('.nav-item').forEach(n => n.addEventListener('click', () => nav(n.dataset.view)));
}
Views.nav = nav;
window.Views = Views;

// ---------------------------------------------------------------------------
// Worker modal
// ---------------------------------------------------------------------------
let editWorkerId = null;
async function openWorkerModal(id = null) {
    editWorkerId = id;
    let w = {};
    if (id) {
        const ws = await api('workers');
        w = ws.find(x => x.id === id) || {};
    }
    document.getElementById('modalBackdrop').classList.add('active');
    document.getElementById('modalBox').innerHTML = `
        <div class="modal-head"><h3>${id ? 'Edit Worker' : 'Add Worker'}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
        <div class="modal-body">
            <div class="form-grid">
                <div class="form-group"><label>Standard Employee ID</label><input id="mEmpId" value="${esc(w.employee_id || '')}"></div>
                <div class="form-group"><label>Status</label><select id="mStatus"><option value="active" ${w.status !== 'inactive' ? 'selected' : ''}>Active</option><option value="inactive" ${w.status === 'inactive' ? 'selected' : ''}>Inactive</option></select></div>
                <div class="form-group"><label>Last Name *</label><input id="mLname" value="${esc(w.lname || '')}"></div>
                <div class="form-group"><label>First Name *</label><input id="mFname" value="${esc(w.fname || '')}"></div>
                <div class="form-group"><label>Position</label><input id="mPos" value="${esc(w.position || '')}"></div>
            </div>
            <div style="display:flex;gap:.8rem;justify-content:flex-end;margin-top:1.2rem">
                <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
                <button class="btn btn-primary" onclick="saveWorker()">${id ? 'Save Changes' : 'Add Worker'}</button>
            </div>
        </div>`;
    window.openWorkerModal = openWorkerModal;
}
async function saveWorker() {
    const body = {
        employee_id: document.getElementById('mEmpId').value,
        lname: document.getElementById('mLname').value,
        fname: document.getElementById('mFname').value,
        position: document.getElementById('mPos').value,
        status: document.getElementById('mStatus').value
    };
    if (!body.lname && !body.fname) return toast('Name is required', 'error');
    try {
        await api(editWorkerId ? 'workers-update' : 'workers-add', { method: 'POST', body: editWorkerId ? { ...body, id: editWorkerId } : body });
        toast(editWorkerId ? 'Worker updated' : 'Worker added');
        closeModal();
        nav('workers');
    } catch (e) { toast(e.message, 'error'); }
}
window.saveWorker = saveWorker;

async function deleteWorker(id, name) {
    if (!confirm(`Delete ${name}?\nThis also removes their attendance history.`)) return;
    try { await api('workers-delete', { method: 'POST', body: { id } }); toast('Worker deleted'); nav('workers'); }
    catch (e) { toast(e.message, 'error'); }
}
window.deleteWorker = deleteWorker;

// ---------------------------------------------------------------------------
// Batch assign employee ID
// ---------------------------------------------------------------------------
async function openBatchIdModal() {
    const workers = await api('workers');
    document.getElementById('modalBackdrop').classList.add('active');
    document.getElementById('modalBox').innerHTML = `
        <div class="modal-head"><h3>Assign Standard Employee IDs</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
        <div class="modal-body">
            <p style="color:var(--gray);margin-bottom:1rem">Enter the standard ID for each worker below. IDs must match the number enrolled in the biometric device so attendance logs link automatically.</p>
            <div class="table-wrap" style="max-height:60vh;overflow-y:auto"><table>
                <thead><tr><th>Worker</th><th>Position</th><th>Standard ID</th></tr></thead>
                <tbody>
                    ${workers.map(w => `<tr>
                        <td>${esc(w.lname)}, ${esc(w.fname)}</td><td>${esc(w.position)}</td>
                        <td><input id="bid_${w.id}" value="${esc(w.employee_id || '')}" style="width:110px;padding:.45rem;border:2px solid var(--border);border-radius:6px"></td>
                    </tr>`).join('')}
                </tbody>
            </table></div>
            <div style="display:flex;gap:.8rem;justify-content:flex-end;margin-top:1.2rem">
                <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
                <button class="btn btn-accent" onclick="saveBatchIds()"><i class="fas fa-save"></i> Save All IDs</button>
            </div>
        </div>`;
    window.openBatchIdModal = openBatchIdModal;
}
async function saveBatchIds() {
    const pairs = [...document.querySelectorAll('[id^="bid_"]')].map(el => ({
        id: parseInt(el.id.replace('bid_', '')),
        employee_id: el.value.trim()
    }));
    try {
        const r = await api('workers-batch-id', { method: 'POST', body: { pairs } });
        toast(`Saved ${r.updated} employee ID${r.updated === 1 ? '' : 's'}`);
        closeModal();
        nav('workers');
    } catch (e) { toast(e.message, 'error'); }
}
window.saveBatchIds = saveBatchIds;

// ---------------------------------------------------------------------------
// Import (client-side parsing)
// ---------------------------------------------------------------------------
let importPreview = null;
function setupImportZone() {
    const zone = document.getElementById('dropZone');
    const input = document.getElementById('fileInput');
    zone.onclick = () => input.click();
    zone.ondragover = e => { e.preventDefault(); zone.classList.add('drag'); };
    zone.ondragleave = () => zone.classList.remove('drag');
    zone.ondrop = e => { e.preventDefault(); zone.classList.remove('drag'); if (e.dataTransfer.files.length) uploadFile(e.dataTransfer.files[0]); };
    input.onchange = () => { if (input.files.length) uploadFile(input.files[0]); };
}
async function uploadFile(file) {
    const zone = document.getElementById('dropZone');
    zone.innerHTML = `<i class="fas fa-spinner fa-spin"></i><h3>Parsing ${esc(file.name)}...</h3>`;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'xlsx' || ext === 'xls') {
        zone.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:var(--red)"></i><h3>Excel not supported here</h3><p>Convert to CSV or use the desktop app for XLSX files.</p><input type="file" id="fileInput" accept=".csv,.txt,.dat" style="display:none">`;
        setTimeout(() => setupImportZone(), 50);
        return;
    }
    try {
        const text = await file.text();
        const records = parseBiometricText(text, file.name);
        if (!records.length) throw new Error('Could not parse any records from this file. Check the format.');
        const workers = await api('workers');
        const { matched, unmatched } = matchRecords(workers, records);
        importPreview = { file: file.name, fileText: text, total_records: records.length, matched, unmatched };
        zone.innerHTML = `
            <i class="fas fa-check-circle" style="color:var(--green)"></i>
            <h3>${esc(file.name)}</h3>
            <p>Successfully parsed — drop another file or click to browse</p>
            <input type="file" id="fileInput" accept=".csv,.txt,.dat" style="display:none">`;
        document.getElementById('parseSummary').innerHTML = `
            <span class="chip chip-blue">${records.length} Records</span>
            <span class="chip chip-green">${matched.length} Matched</span>
            <span class="chip chip-red">${unmatched.length} Unmatched</span>
            <button class="btn btn-green btn-sm" onclick="commitImport()"><i class="fas fa-save"></i> Save to Attendance</button>`;
        renderPreview(importPreview);
    } catch (e) {
        zone.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:var(--red)"></i><h3>Parse failed</h3><p>${esc(e.message)}</p><p style="font-size:.8rem">Try converting to CSV with columns: User ID, Date, Time</p><input type="file" id="fileInput" accept=".csv,.txt,.dat" style="display:none">`;
        toast(e.message, 'error');
    }
    setTimeout(() => setupImportZone(), 50);
}
function renderPreview(data) {
    const panel = document.getElementById('previewPanel');
    panel.style.display = 'block';
    document.getElementById('previewTitle').textContent = `Preview — ${data.file}`;
    let html = '';
    if (data.unmatched.length) {
        html += `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:.8rem 1rem;margin-bottom:1rem">
            <strong style="color:var(--red)">${data.unmatched.length} records could not be matched to workers</strong>
            <div class="table-wrap" style="margin-top:.8rem"><table>
                <thead><tr><th>Emp Key</th><th>Name</th><th>Time</th><th>Match To</th></tr></thead>
                <tbody>${data.unmatched.slice(0, 20).map((u, ui) => `
                    <tr><td>${esc(u.emp_key)}</td><td>${esc(u.name)}</td><td>${esc(u.punch_time)}</td>
                    <td><input style="width:120px;padding:.4rem;border:2px solid var(--border);border-radius:6px" placeholder="worker id?" id="mapidx_${ui}"></td></tr>`).join('')}
                </tbody></table></div>
        </div>`;
    }
    html += `<div class="table-wrap" style="max-height:50vh;overflow-y:auto"><table>
        <thead><tr><th>Emp Key</th><th>Worker</th><th>Time</th><th>Type</th></tr></thead>
        <tbody>${data.matched.slice(0, 300).map(m => `
            <tr><td>${esc(m.emp_key)}</td><td>${esc(m.name)}</td><td>${esc(m.punch_time)}</td><td>${esc(m.punch_type)}</td></tr>`).join('')}
        </tbody></table></div>`;
    document.getElementById('previewBody').innerHTML = html;
}
async function commitImport() {
    const data = importPreview;
    if (!data) return;
    const mapping = {};
    document.querySelectorAll('[id^="mapidx_"]').forEach(el => {
        const idx = parseInt(el.id.replace('mapidx_', ''));
        const val = el.value.trim();
        if (val && data.unmatched[idx]) mapping[data.unmatched[idx].emp_key] = parseInt(val);
    });
    const records = data.matched.concat(data.unmatched.map(u => ({ ...u, worker_id: mapping[u.emp_key] || null })));
    try {
        const r = await api('attendance-commit', { method: 'POST', body: { records, filename: data.file, mapping, fileText: data.fileText } });
        toast(`Saved ${r.inserted} attendance records`);
        importPreview = null;
        nav('import');
    } catch (e) { toast(e.message, 'error'); }
}
window.commitImport = commitImport;
window.sampleFormats = e => { e.preventDefault(); alert('Supported formats:\n\n1. ZKTeco/ADMS .dat export (e.g. *attlog.dat):\n   UserID, 2026-09-01 05:37:37, 1, 0, 15, 0\n2. ZKTeco CSV: UserID, Date, Time, ...\n3. Any CSV/TXT with ID, Date, Time columns\n\nIn/Out codes (0=in, 1=out, 4/5=overtime) are mapped automatically.\nTip: Match worker Standard IDs to the device user/enroll numbers.'); };

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
let reportData = null;
async function loadReport() {
    const date = document.getElementById('reportDate').value;
    const box = document.getElementById('reportContent');
    box.innerHTML = '<div class="empty"><i class="fas fa-spinner fa-spin"></i><p>Loading...</p></div>';
    try {
        const r = await api('daily', { params: { date } });
        reportData = r;
        const pct = r.active_manpower ? Math.round(r.present / r.active_manpower * 100) : 0;
        box.innerHTML = `
            <div class="cards" style="margin-top:1rem">
                <div class="card"><div class="label">Total Manpower</div><div class="value">${r.total_manpower}</div><div class="sub">All workers incl. inactive</div></div>
                <div class="card"><div class="label">Active Manpower</div><div class="value">${r.active_manpower}</div><div class="sub">Active workers for ${esc(r.date)}</div></div>
                <div class="card orange"><div class="label">Present</div><div class="value">${r.present}</div><div class="sub">Scanned on this date</div></div>
                <div class="card red"><div class="label">Absent</div><div class="value">${r.absent}</div><div class="sub">Active but not scanned</div></div>
                <div class="card cyan"><div class="label">Attendance Rate</div><div class="value">${pct}%</div><div class="sub">Present / Active</div></div>
            </div>
            <div class="progress"><div style="width:${pct}%"></div></div>
            <div class="toolbar" style="margin-top:1.2rem">
                <h3 style="margin:0;margin-right:auto">Roster — ${esc(r.date)}</h3>
                <span class="sum"><span class="chip chip-green">${r.present} Present</span><span class="chip chip-red">${r.absent} Absent</span></span>
            </div>
            <div class="table-wrap">
                <table>
                    <thead><tr><th>#</th><th>Standard ID</th><th>Name</th><th>Position</th><th>Status</th><th>Time In</th><th>Time Out</th><th>Scans</th></tr></thead>
                    <tbody>
                        ${r.roster.length ? r.roster.map((w, i) => `
                            <tr>
                                <td>${i + 1}</td>
                                <td>${w.employee_id ? esc(w.employee_id) : '<span style="color:var(--red)">—</span>'}</td>
                                <td>${esc(w.name)}</td>
                                <td>${esc(w.position)}</td>
                                <td>${w.present ? '<span class="badge badge-green">Present</span>' : '<span class="badge badge-red">Absent</span>'}</td>
                                <td>${w.time_in || '—'}</td>
                                <td>${w.time_out || '—'}</td>
                                <td>${w.punch_count}</td>
                            </tr>`).join('') : '<tr><td colspan="8" class="empty"><i class="fas fa-users-slash"></i><p>No active workers found</p></td></tr>'}
                    </tbody>
                </table>
            </div>`;
    } catch (e) {
        box.innerHTML = `<div class="empty"><i class="fas fa-exclamation-triangle"></i><p>${esc(e.message)}</p></div>`;
    }
}
function setReportDateFromSelect() {
    const n = parseInt(document.getElementById('quickDate').value);
    const d = new Date(); d.setDate(d.getDate() - n);
    document.getElementById('reportDate').value = d.toISOString().slice(0, 10);
    loadReport();
}
function exportReportCsv() {
    if (!reportData) return;
    const rows = [['No.', 'Standard ID', 'Name', 'Position', 'Status', 'Time In', 'Time Out', 'Scans']];
    reportData.roster.forEach((w, i) => rows.push([i + 1, w.employee_id || '', `${w.name}`, w.position, w.present ? 'PRESENT' : 'ABSENT', w.time_in || '', w.time_out || '', w.punch_count]));
    rows.push([]);
    rows.push(['DATE', reportData.date]);
    rows.push(['TOTAL MANPOWER', reportData.total_manpower]);
    rows.push(['ACTIVE MANPOWER', reportData.active_manpower]);
    rows.push(['PRESENT', reportData.present]);
    rows.push(['ABSENT', reportData.absent]);
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `daily_report_${reportData.date}.csv`;
    a.click();
}
window.loadReport = loadReport;
window.setReportDateFromSelect = setReportDateFromSelect;
window.exportReportCsv = exportReportCsv;

// ---------------------------------------------------------------------------
// Positions report
// ---------------------------------------------------------------------------
let posData = null;
async function loadPositions() {
    const date = document.getElementById('posDate').value;
    const box = document.getElementById('posContent');
    const sum = document.getElementById('posSummary');
    box.innerHTML = '<div class="empty"><i class="fas fa-spinner fa-spin"></i><p>Loading...</p></div>';
    try {
        const r = await api('positions', { params: { date } });
        posData = r;
        sum.innerHTML = `<span class="chip chip-blue">${r.positions.length} Positions</span><span class="chip chip-green">${r.total_present} Present</span>`;
        box.innerHTML = r.positions.length ? `
            <div class="pos-grid">
                ${r.positions.map(p => `
                    <div class="pos-card ${p.present ? '' : 'pos-empty'}">
                        <div class="pos-head">
                            <h4>${esc(p.position)}</h4>
                            <span class="pos-count">
                                <span class="chip ${p.present ? 'chip-green' : 'chip-red'}">${p.present}/${p.total}</span>
                            </span>
                        </div>
                        <div class="pos-body">
                            ${p.workers.length ? `<table class="pos-table">
                                <tbody>${p.workers.map(w => `
                                    <tr>
                                        <td><span class="dot ${w.present ? 'dot-on' : 'dot-off'}"></span></td>
                                        <td>${w.employee_id ? esc(w.employee_id) : '—'}</td>
                                        <td>${esc(w.name)}</td>
                                        <td class="pos-time">${w.present ? (esc(w.time_in || '') + ' → ' + esc(w.time_out || '')) : '<span class="muted">absent</span>'}</td>
                                    </tr>`).join('')}
                                </tbody>
                            </table>` : '<p class="muted">No workers</p>'}
                        </div>
                    </div>`).join('')}
            </div>` : '<div class="empty"><i class="fas fa-users-slash"></i><p>No active workers</p></div>';
    } catch (e) {
        box.innerHTML = `<div class="empty"><i class="fas fa-exclamation-triangle"></i><p>${esc(e.message)}</p></div>`;
    }
}
function setPosDateFromSelect() {
    const n = parseInt(document.getElementById('posQuickDate').value);
    const d = new Date(); d.setDate(d.getDate() - n);
    document.getElementById('posDate').value = d.toISOString().slice(0, 10);
    loadPositions();
}
window.loadPositions = loadPositions;
window.setPosDateFromSelect = setPosDateFromSelect;

// ---------------------------------------------------------------------------
// Settings / Google
// ---------------------------------------------------------------------------
async function loadGoogleStatus() {
    const box = document.getElementById('googleStatus');
    if (!box) return;
    try {
        const r = await api('status');
        if (!r.ok) throw new Error(r.error || 'Not connected');
        box.innerHTML = `
            <div style="display:flex;gap:.8rem;align-items:center;flex-wrap:wrap;margin-bottom:.6rem">
                <span class="badge badge-green">Connected</span>
                <a class="btn btn-ghost btn-sm" href="${esc(r.spreadsheet_url)}" target="_blank" rel="noopener"><i class="fas fa-table"></i> Open Database Spreadsheet</a>
                <a class="btn btn-ghost btn-sm" href="${esc(r.drive_root_url)}" target="_blank" rel="noopener"><i class="fas fa-folder-open"></i> Open Google Drive folder</a>
            </div>
            <p style="color:var(--gray);font-size:.85rem;margin:0">Backend: Google Apps Script → MANPOWER Database sheet.<br>Imported logs → Drive "MANPOWER System/Attendance Logs", backups → "Backups".</p>`;
    } catch (e) {
        box.innerHTML = `<div style="display:flex;gap:.8rem;align-items:center;flex-wrap:wrap">
            <span class="badge badge-red">Not Connected</span>
            <span style="color:var(--gray);font-size:.85rem">${esc(e.message)}</span>
        </div>`;
    }
}
async function backupToDrive() {
    try {
        const r = await api('backup', { method: 'POST' });
        toast(`Backup saved: ${r.name}`);
        loadGoogleStatus();
    } catch (e) { toast(e.message, 'error'); }
}
async function confirmReset() {
    if (!confirm('WARNING: This will delete ALL workers and attendance data. Continue?')) return;
    if (!confirm('Are you absolutely sure? This cannot be undone.')) return;
    try {
        await api('reset', { method: 'POST' });
        toast('Database reset');
        nav('dashboard');
    } catch (e) { toast(e.message, 'error'); }
}
window.backupToDrive = backupToDrive;
window.confirmReset = confirmReset;

// ---------------------------------------------------------------------------
// Modal helpers & boot
// ---------------------------------------------------------------------------
window.closeModal = () => document.getElementById('modalBackdrop').classList.remove('active');
document.getElementById('modalBackdrop').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('active'); });
document.addEventListener('DOMContentLoaded', () => { bindNav(); nav('dashboard'); });