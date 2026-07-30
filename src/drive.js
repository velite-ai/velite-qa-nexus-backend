// ============================================================
// Google Drive proxy — server-side, uses a stored refresh token
// ============================================================
// The QA team's browsers NEVER talk to Google. Only this server does.
// The refresh token belongs to velite@velite.in and lives ONLY in Coolify env vars.
//
// Endpoints exposed by src/server.js delegate here.

import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { Readable } from "node:stream";

const SCOPES = ["https://www.googleapis.com/auth/drive"];

let _oauth = null;
function getOAuthClient() {
  if (_oauth) return _oauth;
  const cid = process.env.GOOGLE_CLIENT_ID;
  const csec = process.env.GOOGLE_CLIENT_SECRET;
  const rt = process.env.GOOGLE_REFRESH_TOKEN;
  if (!cid || !csec) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured");
  _oauth = new OAuth2Client(cid, csec);
  if (rt) _oauth.setCredentials({ refresh_token: rt });
  return _oauth;
}

// Manually build an OAuth client for the /setup flow (no refresh token yet)
export function getSetupOAuthClient(redirectUri) {
  const cid = process.env.GOOGLE_CLIENT_ID;
  const csec = process.env.GOOGLE_CLIENT_SECRET;
  if (!cid || !csec) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured");
  return new OAuth2Client(cid, csec, redirectUri);
}

function getDrive() {
  return google.drive({ version: "v3", auth: getOAuthClient() });
}

function getFolderId() {
  const id = process.env.GOOGLE_SHARED_FOLDER_ID;
  if (!id) throw new Error("GOOGLE_SHARED_FOLDER_ID not configured (paste the shared folder ID from Drive URL)");
  return id;
}

// ---- Small file helpers ----
export async function readJsonFile(fileName) {
  const drive = getDrive();
  const folderId = getFolderId();
  const q = `name='${fileName.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`;
  const list = await drive.files.list({ q, fields: "files(id,name,modifiedTime)", pageSize: 1 });
  const file = list.data.files?.[0];
  if (!file) return null;
  const dl = await drive.files.get({ fileId: file.id, alt: "media" }, { responseType: "text" });
  try {
    return { fileId: file.id, modifiedTime: file.modifiedTime, data: JSON.parse(dl.data) };
  } catch (e) {
    return { fileId: file.id, modifiedTime: file.modifiedTime, data: null, raw: dl.data };
  }
}

export async function writeJsonFile(fileName, jsonPayload) {
  const drive = getDrive();
  const folderId = getFolderId();
  const body = JSON.stringify(jsonPayload, null, 2);
  const media = { mimeType: "application/json", body: Readable.from(body) };

  // Find existing
  const q = `name='${fileName.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`;
  const list = await drive.files.list({ q, fields: "files(id,name)", pageSize: 1 });
  const existing = list.data.files?.[0];

  if (existing) {
    const r = await drive.files.update({ fileId: existing.id, media });
    return { fileId: existing.id, updated: true, name: r.data.name };
  } else {
    const r = await drive.files.create({
      requestBody: { name: fileName, mimeType: "application/json", parents: [folderId] },
      media,
      fields: "id,name"
    });
    return { fileId: r.data.id, updated: false, name: r.data.name };
  }
}

// ---- Binary file operations ----
export async function uploadBinary({ name, mimeType, buffer }) {
  const drive = getDrive();
  const folderId = getFolderId();
  const media = { mimeType: mimeType || "application/octet-stream", body: Readable.from(buffer) };
  const r = await drive.files.create({
    requestBody: { name, parents: [folderId], description: "QA Vault original (byte-identical, no conversion)" },
    media,
    fields: "id,name,size,md5Checksum,mimeType,webViewLink"
  });
  return r.data;
}

export async function streamBinary(fileId) {
  const drive = getDrive();
  const meta = await drive.files.get({ fileId, fields: "id,name,size,mimeType" });
  const stream = await drive.files.get({ fileId, alt: "media" }, { responseType: "stream" });
  return { meta: meta.data, stream: stream.data };
}

export async function trashFile(fileId) {
  const drive = getDrive();
  await drive.files.update({ fileId, requestBody: { trashed: true } });
  return { ok: true };
}

export async function listFolderContents(subFolderName = null) {
  const drive = getDrive();
  const folderId = getFolderId();
  const parent = subFolderName ? await getSubFolderId(subFolderName) : folderId;
  const list = await drive.files.list({
    q: `'${parent}' in parents and trashed=false`,
    fields: "files(id,name,size,mimeType,modifiedTime)",
    pageSize: 1000
  });
  return list.data.files || [];
}

async function getSubFolderId(name) {
  const drive = getDrive();
  const parent = getFolderId();
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`;
  const list = await drive.files.list({ q, fields: "files(id,name)", pageSize: 1 });
  if (list.data.files?.[0]) return list.data.files[0].id;
  // Create if missing
  const r = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parent] },
    fields: "id,name"
  });
  return r.data.id;
}

// ---- Diagnostic ----
export async function testConnection() {
  try {
    const drive = getDrive();
    const folderId = getFolderId();
    const f = await drive.files.get({ fileId: folderId, fields: "id,name,capabilities" });
    return {
      ok: true,
      folder: { id: f.data.id, name: f.data.name },
      canEdit: !!f.data.capabilities?.canEdit,
      canAddChildren: !!f.data.capabilities?.canAddChildren
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
