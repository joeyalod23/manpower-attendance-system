"""Google Workspace integration helpers.

Handles OAuth authentication and thin wrappers around the Google Sheets and
Google Drive APIs. The Google Sheet acts as the primary database; Drive
stores uploaded biometric logs and automated spreadsheet backups.
"""

import io
import json
import os
from datetime import datetime

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload, MediaIoBaseUpload

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CLIENT_SECRET_FILE = os.path.join(BASE_DIR, "client_secret.json")
TOKEN_FILE = os.path.join(BASE_DIR, "token.json")
DRIVE_META_FILE = os.path.join(BASE_DIR, "drive_meta.json")

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.file",
]

SPREADSHEET_TITLE = "MANPOWER Database"

ROOT_FOLDER_NAME = "MANPOWER System"
ATTENDANCE_FOLDER_NAME = "Attendance Logs"
BACKUP_FOLDER_NAME = "Backups"

SPREAD_SHEET_MIME = "application/vnd.google-apps.spreadsheet"
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
FOLDER_MIME = "application/vnd.google-apps.folder"

_credentials = None
_sheets = None
_drive = None
_spreadsheet_id = None


# ---------------------------------------------------------------------------
# OAuth
# ---------------------------------------------------------------------------
def run_auth_flow():
    port = int(os.environ.get("GOOGLE_AUTH_PORT", "8080"))
    print("=" * 64)
    print("  Google authorization required")
    print("=" * 64)
    print("A browser window will open. Sign in with the Google account that")
    print("owns the MANPOWER spreadsheet and Drive folders, then click Allow.")
    print()
    print("  Redirect URI used:  http://localhost:{0}/".format(port))
    print()
    print("If you see 'redirect_uri_mismatch', open the Google Cloud Console,")
    print("API & Services > Credentials > your OAuth client, and add")
    print("  http://localhost:{0}/".format(port))
    print("to Authorized redirect URIs, then run the app again.")
    print("=" * 64)
    with open(CLIENT_SECRET_FILE, "r", encoding="utf-8") as f:
        client_config = json.load(f)
    flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
    creds = flow.run_local_server(port=port, open_browser=True)
    return creds


def get_credentials():
    global _credentials
    if _credentials is not None:
        return _credentials
    creds = None
    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            creds = run_auth_flow()
        with open(TOKEN_FILE, "w", encoding="utf-8") as f:
            f.write(creds.to_json())
    _credentials = creds
    return _credentials


# ---------------------------------------------------------------------------
# Services
# ---------------------------------------------------------------------------
def get_sheets():
    global _sheets
    if _sheets is None:
        _sheets = build("sheets", "v4", credentials=get_credentials())
    return _sheets


def get_drive():
    global _drive
    if _drive is None:
        _drive = build("drive", "v3", credentials=get_credentials())
    return _drive


# ---------------------------------------------------------------------------
# Drive folder management
# ---------------------------------------------------------------------------
def _load_drive_meta():
    if os.path.exists(DRIVE_META_FILE):
        try:
            with open(DRIVE_META_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_drive_meta(updates):
    data = _load_drive_meta()
    data.update(updates)
    with open(DRIVE_META_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def _ensure_folder(name, parent_id=None):
    drive = get_drive()
    query = (
        "name='{0}' and '{1}' in parents and mimeType='{2}' and trashed=false"
    ).format(name, parent_id or "root", FOLDER_MIME)
    res = (
        drive.files()
        .list(q=query, fields="files(id, name)", pageSize=1)
        .execute()
    )
    files = res.get("files", [])
    if files:
        return files[0]["id"]
    body = {"name": name, "mimeType": FOLDER_MIME}
    if parent_id:
        body["parents"] = [parent_id]
    created = (
        drive.files().create(body=body, fields="id").execute()
    )
    return created["id"]


def get_folders():
    meta = _load_drive_meta()
    if meta.get("root_folder_id") and meta.get("attendance_folder_id") and meta.get("backup_folder_id"):
        return meta
    root_id = _ensure_folder(ROOT_FOLDER_NAME)
    att_id = _ensure_folder(ATTENDANCE_FOLDER_NAME, root_id)
    bak_id = _ensure_folder(BACKUP_FOLDER_NAME, root_id)
    _save_drive_meta({
        "root_folder_id": root_id,
        "attendance_folder_id": att_id,
        "backup_folder_id": bak_id,
    })
    return _load_drive_meta()


def upload_file_to_drive(local_path, filename=None, folder="attendance"):
    folders = get_folders()
    drive = get_drive()
    folder_id = folders["attendance_folder_id" if folder == "attendance" else "backup_folder_id"]
    name = filename or os.path.basename(local_path)
    q = "name='{0}' and '{1}' in parents and trashed=false".format(name, folder_id)
    exists = drive.files().list(q=q, fields="files(id)").execute().get("files") or []
    final_name = name
    if exists:
        stem, ext = os.path.splitext(name)
        final_name = "{0}_{1}{2}".format(stem, datetime.now().strftime("%Y%m%d%H%M%S"), ext)
    media = MediaFileUpload(local_path, resumable=False)
    uploaded = (
        drive.files()
        .create(
            body={"name": final_name, "parents": [folder_id]},
            media_body=media,
            fields="id, name, webViewLink",
        )
        .execute()
    )
    return uploaded


def backup_spreadsheet():
    """Export the whole spreadsheet as .xlsx and store it in Drive/Backups."""
    folders = get_folders()
    drive = get_drive()
    sid = get_spreadsheet_id()
    name = "MANPOWER_backup_{0}.xlsx".format(datetime.now().strftime("%Y%m%d_%H%M%S"))
    data = (
        drive.files()
        .export(fileId=sid, mimeType=XLSX_MIME)
        .execute()
    )
    media = MediaIoBaseUpload(io.BytesIO(data), mimetype=XLSX_MIME, resumable=False)
    uploaded = (
        drive.files()
        .create(
            body={"name": name, "parents": [folders["backup_folder_id"]]},
            media_body=media,
            fields="id, name, webViewLink",
        )
        .execute()
    )
    return uploaded


# ---------------------------------------------------------------------------
# Spreadsheet management
# ---------------------------------------------------------------------------
def find_spreadsheet():
    drive = get_drive()
    q = "name='{0}' and mimeType='{1}' and trashed=false".format(SPREADSHEET_TITLE, SPREAD_SHEET_MIME)
    res = drive.files().list(q=q, fields="files(id, name)").execute()
    return (res.get("files") or [None])[0]


def get_spreadsheet_id():
    global _spreadsheet_id
    if _spreadsheet_id:
        return _spreadsheet_id
    meta = _load_drive_meta()
    if meta.get("spreadsheet_id"):
        _spreadsheet_id = meta["spreadsheet_id"]
        return _spreadsheet_id
    found = find_spreadsheet()
    if found:
        _spreadsheet_id = found["id"]
    else:
        root_id = get_folders()["root_folder_id"]
        body = {
            "name": SPREADSHEET_TITLE,
            "mimeType": SPREAD_SHEET_MIME,
            "parents": [root_id],
        }
        created = drive_create_file(body)
        _spreadsheet_id = created["id"]
    _save_drive_meta({"spreadsheet_id": _spreadsheet_id})
    return _spreadsheet_id


def drive_create_file(body):
    return get_drive().files().create(body=body, fields="id, name, webViewLink").execute()


def get_sheet_titles():
    sheets = get_sheets()
    sid = get_spreadsheet_id()
    meta = (
        sheets.spreadsheets()
        .get(spreadsheetId=sid, fields="sheets(properties(title, sheetId))")
        .execute()
    )
    return [s["properties"]["title"] for s in meta["sheets"]]


def add_sheet(title):
    sheets = get_sheets()
    sid = get_spreadsheet_id()
    body = {"requests": [{"addSheet": {"properties": {"title": title}}}]}
    sheets.spreadsheets().batchUpdate(spreadsheetId=sid, body=body).execute()


def set_grid_rows(title, rows=50000):
    sheets = get_sheets()
    sid = get_spreadsheet_id()
    body = {"requests": [{"updateSheetProperties": {"properties": {
                "sheetId": _sheet_id_for(title),
                "gridProperties": {"rowCount": rows},
            }, "fields": "gridProperties.rowCount"}}]}
    sheets.spreadsheets().batchUpdate(spreadsheetId=sid, body=body).execute()


def _sheet_id_for(title):
    sheets = get_sheets()
    sid = get_spreadsheet_id()
    meta = (
        sheets.spreadsheets()
        .get(spreadsheetId=sid, fields="sheets(properties(title, sheetId))")
        .execute()
    )
    for s in meta["sheets"]:
        if s["properties"]["title"] == title:
            return s["properties"]["sheetId"]
    return None


def sheet_values(range_name):
    sheets = get_sheets()
    sid = get_spreadsheet_id()
    result = (
        sheets.spreadsheets()
        .values()
        .get(spreadsheetId=sid, range=range_name)
        .execute()
    )
    return result.get("values", [])


def write_values(range_name, values, raw=True):
    """Write values. raw=True stores values exactly (keeps leading zeros on ids)."""
    sheets = get_sheets()
    sid = get_spreadsheet_id()
    body = {"values": values}
    kwargs = {"valueInputOption": "RAW" if raw else "USER_ENTERED"}
    sheets.spreadsheets().values().update(
        spreadsheetId=sid, range=range_name, body=body, **kwargs
    ).execute()


def append_values(range_name, values):
    """Append rows below existing data, storing values exactly as given."""
    sheets = get_sheets()
    sid = get_spreadsheet_id()
    body = {"values": values}
    sheets.spreadsheets().values().append(
        spreadsheetId=sid,
        range=range_name,
        body=body,
        valueInputOption="RAW",
        insertDataOption="INSERT_ROWS",
    ).execute()


def clear_values(range_name):
    sheets = get_sheets()
    sid = get_spreadsheet_id()
    sheets.spreadsheets().values().clear(spreadsheetId=sid, range=range_name).execute()


def spreadsheet_url():
    return "https://docs.google.com/spreadsheets/d/{0}".format(get_spreadsheet_id())