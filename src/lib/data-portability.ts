import { toast } from "sonner";

const LS_KEYS = [
  "alpha.chat.v1",
  "alpha.notes.v1",
  "alpha.bills.v1",
  "alpha.reminders.v1",
  "alpha.plans.v1",
  "alpha.memories.v1",
  "alpha.profile.v1",
  "alpha.settings.v1",
  "alpha.summary.v1",
];

const DB_NAME = "alpha.music.v1";
const STORE = "tracks";

export interface AlphaDataExport {
  version: 1;
  exportedAt: string;
  localStorage: Record<string, string | null>;
  music: Array<{ id: string; name: string; size: number; type: string; addedAt: number; dataUrl: string }>;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Could not open music storage."));
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] || "audio/mpeg";
  const bin = atob(base64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export async function exportAlphaData(): Promise<AlphaDataExport> {
  const localStorage: Record<string, string | null> = {};
  for (const key of LS_KEYS) {
    try { localStorage[key] = window.localStorage.getItem(key); } catch { localStorage[key] = null; }
  }

  const music: AlphaDataExport["music"] = [];
  try {
    const db = await openDb();
    const rows: any[] = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("Could not read music storage."));
      tx.oncomplete = () => db.close();
    });
    for (const row of rows) {
      if (!row.blob) continue;
      music.push({
        id: row.id,
        name: row.name,
        size: row.size,
        type: row.type,
        addedAt: row.addedAt,
        dataUrl: await blobToDataUrl(row.blob),
      });
    }
  } catch (e) {
    console.warn("Music export skipped:", e);
  }

  return { version: 1, exportedAt: new Date().toISOString(), localStorage, music };
}

export function downloadAlphaData(data: AlphaDataExport) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `alpha-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function importAlphaData(file: File): Promise<{ restored: string[] }> {
  const text = await file.text();
  const data: AlphaDataExport = JSON.parse(text);
  if (!data || data.version !== 1) throw new Error("Unrecognized Alpha backup format.");

  const restored: string[] = [];

  // Restore localStorage
  for (const key of LS_KEYS) {
    const value = data.localStorage?.[key];
    if (value !== undefined && value !== null) {
      try {
        window.localStorage.setItem(key, value);
        restored.push(key);
      } catch (e) {
        console.warn("Could not restore key:", key, e);
      }
    }
  }

  // Restore music
  if (data.music?.length) {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const track of data.music) {
        try {
          const blob = dataUrlToBlob(track.dataUrl);
          store.put({ id: track.id, name: track.name, size: track.size, type: track.type, addedAt: track.addedAt, blob });
        } catch (e) {
          console.warn("Could not restore track:", track.name, e);
        }
      }
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error("Could not restore music.")); };
    });
    restored.push(`music:${data.music.length}`);
  }

  // Reload from localStorage so the live store reflects the import
  if (typeof window !== "undefined") {
    window.location.reload();
  }

  return { restored };
}

export async function wipeAlphaData() {
  for (const key of LS_KEYS) {
    try { window.localStorage.removeItem(key); } catch {}
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error("Could not clear music."));
      tx.oncomplete = () => db.close();
    });
  } catch {}
  window.location.reload();
}
