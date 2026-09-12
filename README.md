# MANPOWER Attendance System

Flask-based manpower / attendance tracking system. Data is stored in a
**Google Sheet** (the database) and uploaded biometric logs plus automated
backups are kept in **Google Drive**.

## Features

- Import biometric device exports (CSV, TXT, DAT, XLSX) with automatic
  column detection (ZKTeco/ADMS formats supported).
- Smart matching of punch records to workers by Standard ID or name.
- Daily report, positions report, workers management.
- Dashboard with today's present / absent / active counts.
- Google Sheets database (Workers, Attendance, ImportLog tabs).
- Google Drive integration:
  - every uploaded biometric log is copied to `MANPOWER System/Attendance Logs`
  - the spreadsheet is exported to `MANPOWER System/Backups` automatically
    after each import commit, and on demand from **Settings → Backup Now**.

## Setup

1. Install Python 3.10+ and run:

   ```bash
   pip install -r requirements.txt
   ```

2. Add your Google OAuth credentials. Download the OAuth client JSON from
   [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   and save it in this folder as `client_secret.json`.

   Make sure these APIs are enabled in the Google Cloud project:
   - Google Sheets API
   - Google Drive API

3. Optional: place `MANPOWER HC.xlsx` (employee roster) in this folder, then
   use **Settings → Re-seed from MANPOWER HC.xlsx** to populate workers.

4. Run the app:

   ```bash
   python app.py
   ```
   or double-click `run.bat`.

   On first run a browser opens to authorize the app (account must own the
   spreadsheet / Drive folders). **If you see `redirect_uri_mismatch`**, add
   `http://localhost:8080/` to the OAuth client's *Authorized redirect URIs*
   in the Cloud Console, then restart.

5. Open http://127.0.0.1:5000

## Google Sheet / Drive layout

- Spreadsheet **MANPOWER Database** — created automatically in
  `MANPOWER System` on Drive. Tabs: `Workers`, `Attendance`, `ImportLog`,
  `Meta`.
- Drive folders: `MANPOWER System/Attendance Logs`, `MANPOWER System/Backups`.

## Live web portal (GitHub Pages + Google Apps Script)

A static web portal lives in `site/` and is published with GitHub Pages
(no server needed). The backend is a Google Apps Script web app that talks
to the same Google Sheet database.

1. Push this repo to GitHub (done: `joeyalod23/manpower-attendance-system`).
   The portal files in `site/` are published from the `gh-pages` branch.
2. Create an Apps Script project at https://script.google.com, paste the
   contents of `site/code/Code.gs`, then **Deploy → New deployment →
   Web app**:
   - *Execute as:* **Me** (the account that owns the sheet / Drive folders)
   - *Who has access:* **Anyone**
3. Copy the deployment URL (ends in `/exec`).
4. In `site/app.js` set `API_BASE` to that URL, then push an update
   (`git push origin gh-pages`).
5. The portal is live at:
   https://joeyalod23.github.io/manpower-attendance-system

The portal and the desktop app share the same Google Sheet database.

## Notes

- `client_secret.json`, `token.json`, `drive_meta.json`, the Excel roster and
  biometric logs are git-ignored (credentials + personal data stay local).
- Deleting a worker also removes their attendance history from the sheet.