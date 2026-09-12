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

## Deploy online (Render, free tier)

The repo includes a `render.yaml`, so you can deploy straight from GitHub:

1. Push this repo to GitHub (already done: `joeyalod23/manpower-attendance-system`).
2. Sign up at https://render.com (free) and choose **New → Blueprint**,
   pick the repo — Render reads `render.yaml` and creates the web service.
3. In the service's **Environment** tab set two variables to the *contents*
   (JSON) of your local files (needed because credentials are git-ignored):
   - `GOOGLE_CLIENT_CONFIG` → contents of `client_secret.json`
   - `GOOGLE_TOKEN_JSON` → contents of `token.json`
4. Deploy, then open the generated URL.

The app works identically online: the Google Sheet is the database and Drive
stores the attendance logs and backups.

## Notes

- `client_secret.json`, `token.json`, `drive_meta.json`, the Excel roster and
  biometric logs are git-ignored (credentials + personal data stay local).
- Deleting a worker also removes their attendance history from the sheet.