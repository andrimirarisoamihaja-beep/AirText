// Stockage local IndexedDB — encapsulation minimale, zéro dépendance.
// Ne sert QU'À persister les métadonnées chiffrées des conversations vivantes.
// AUCUN message n'est persisté : tout est détruit en fin de conversation.

const DB_NAME = "koragna-v1";
const STORE = "rooms";

interface StoredBlob {
  id: string;
  blob: string; // JSON chiffré (AES-GCM, clé dérivée de pseudo+code) en base64
  updatedAt: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
        t.onerror = () => reject(t.error);
      })
  );
}

export async function saveRoomBlob(id: string, blob: string): Promise<void> {
  await tx("readwrite", (s) => s.put({ id, blob, updatedAt: Date.now() } satisfies StoredBlob));
}

export async function loadRoomBlobs(): Promise<StoredBlob[]> {
  return tx("readonly", (s) => s.getAll() as IDBRequest<StoredBlob[]>);
}

export async function deleteRoomBlob(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

export async function clearAll(): Promise<void> {
  await tx("readwrite", (s) => s.clear());
}
