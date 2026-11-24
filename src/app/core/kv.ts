// Almacén clave-valor mínimo sobre IndexedDB (con respaldo en memoria si el navegador lo bloquea)
const DB_NAME = 'lubricentro-local-v1';
const STORE = 'kv';
const memoria = new Map<string, unknown>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function abrir(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

export async function kvGet<T>(clave: string): Promise<T | undefined> {
  const db = await abrir();
  if (!db) return memoria.get(clave) as T | undefined;
  return new Promise((resolve) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(clave);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => resolve(memoria.get(clave) as T | undefined);
  });
}

export async function kvSet(clave: string, valor: unknown): Promise<void> {
  memoria.set(clave, valor);
  const db = await abrir();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(valor, clave);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function kvDel(clave: string): Promise<void> {
  memoria.delete(clave);
  const db = await abrir();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(clave);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
