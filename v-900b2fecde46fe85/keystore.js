// Shared by the lock page and the service worker: the unlocked AES key lives in IndexedDB on this device only.
const VK_DB = 'vaka-kilit', VK_STORE = 'k';
function vkOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(VK_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(VK_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function vkGet() {
  const db = await vkOpen();
  return new Promise((res, rej) => {
    const q = db.transaction(VK_STORE).objectStore(VK_STORE).get('key');
    q.onsuccess = async () => {
      const v = q.result;
      if (!v) return res(null);
      // Raw bytes are the fallback for browsers that cannot store a CryptoKey.
      if (v instanceof ArrayBuffer) return res(await crypto.subtle.importKey('raw', v, 'AES-GCM', false, ['decrypt']));
      res(v);
    };
    q.onerror = () => rej(q.error);
  });
}
async function vkPut(v) {
  const db = await vkOpen();
  return new Promise((res, rej) => {
    const t = db.transaction(VK_STORE, 'readwrite');
    t.objectStore(VK_STORE).put(v, 'key');
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}
async function vkDecrypt(key, buf) {
  const b = new Uint8Array(buf);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, key, b.slice(12));
}
async function vkGunzip(buf) {
  const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(s).arrayBuffer();
}
