// =====================================================================
// KORAGNA — Module cryptographique (Web Crypto API native, zéro dépendance)
//
//  1. roomId    = SHA-256("KORAGNA-ROOM/v1/" + pseudo + ":" + code)  (32 hex)
//                 → c'est la SEULE chose que voit le serveur de signalisation.
//  2. baseKey   = HKDF-SHA256(ikm=code, salt=SHA-256(pseudo), info="koragna-base")
//                 → clé AES-GCM partagée, chiffre le handshake (authentifié).
//  3. sessionKey= HKDF-SHA256(ikm=secret ECDH P-256 éphémère, salt=roomId)
//                 → chiffre tout le contenu (texte, images). PFS : une nouvelle
//                   paire ECDH est générée à chaque (re)connexion.
//  4. Le stockage IndexedDB est chiffré avec baseKey.
// =====================================================================

const subtle = (): SubtleCrypto => {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Web Crypto API indisponible (contexte non sécurisé ?)");
  }
  return crypto.subtle;
};

const te = new TextEncoder();
const td = new TextDecoder();

export const utf8 = (s: string): Uint8Array => te.encode(s);
export const fromUtf8 = (b: Uint8Array): string => td.decode(b);

// ---------- base64 robuste (gros buffers, sans stack overflow) ----------
export function toB64(bytes: Uint8Array): string {
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + step)));
  }
  return btoa(bin);
}

export function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- normalisation des entrées utilisateur ----------
export function normPseudo(p: string): string {
  return p.trim().replace(/\s+/g, " ");
}
export function normCode(c: string): string {
  return c.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-");
}

export function validateIdentity(pseudo: string, code: string): string | null {
  const p = normPseudo(pseudo);
  const c = normCode(code);
  if (p.length < 3) return "Le pseudo doit contenir au moins 3 caractères.";
  if (p.length > 32) return "Le pseudo est trop long (32 caractères max).";
  if (c.length < 12) return "Le code est trop court (12 caractères min).";
  if (c.length > 128) return "Le code est trop long (128 caractères max).";
  if (!/^[a-z0-9-]+$/.test(c)) return "Le code ne doit contenir que lettres, chiffres et tirets.";
  return null;
}

// ---------- hachage ----------
export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === "string" ? te.encode(data) : data;
  return new Uint8Array(await subtle().digest("SHA-256", bytes as BufferSource));
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  return Array.from(await sha256(data))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function randomId(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  return toB64(crypto.getRandomValues(new Uint8Array(16)));
}

// ---------- dérivations d'identité ----------
export async function deriveRoomId(pseudo: string, code: string): Promise<string> {
  const hex = await sha256Hex(`KORAGNA-ROOM/v1/${normPseudo(pseudo)}:${normCode(code)}`);
  return hex.slice(0, 32);
}

async function hkdfAesKey(ikm: Uint8Array, salt: Uint8Array, info: string): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: te.encode(info) as BufferSource },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function deriveBaseKey(pseudo: string, code: string): Promise<CryptoKey> {
  const p = normPseudo(pseudo);
  const c = normCode(code);
  const salt = await sha256(`KORAGNA-SALT/v1/${p}`);
  return hkdfAesKey(te.encode(c), salt, "koragna-base");
}

// ---------- ECDH éphémère ----------
export interface ECDHPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

export async function generateECDH(): Promise<ECDHPair> {
  const pair = await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  return { privateKey: pair.privateKey, publicKey: pair.publicKey };
}

export async function exportPubRaw(pub: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await subtle().exportKey("raw", pub));
  return toB64(raw);
}

export async function importPubRaw(b64: string): Promise<CryptoKey> {
  return subtle().importKey("raw", fromB64(b64) as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
}

export async function deriveSessionKey(pair: ECDHPair, peerPubB64: string, roomId: string): Promise<CryptoKey> {
  const peerPub = await importPubRaw(peerPubB64);
  const bits = await subtle().deriveBits({ name: "ECDH", public: peerPub }, pair.privateKey, 256);
  const ikm = new Uint8Array(bits);
  const salt = te.encode(`KORAGNA-SESALT/v1/${roomId}`);
  return hkdfAesKey(ikm, salt, "koragna-session");
}

// ---------- AES-GCM (IV aléatoire 96 bits préfixé) ----------
export async function encryptBytes(key: CryptoKey, plain: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, key, plain as BufferSource));
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv, 0);
  out.set(cipher, iv.length);
  return out;
}

export async function decryptBytes(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const iv = data.subarray(0, 12);
  const cipher = data.subarray(12);
  const plain = await subtle().decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, cipher as BufferSource);
  return new Uint8Array(plain);
}

export async function encryptString(key: CryptoKey, s: string): Promise<string> {
  return toB64(await encryptBytes(key, te.encode(s)));
}

export async function decryptString(key: CryptoKey, b64: string): Promise<string> {
  return td.decode(await decryptBytes(key, fromB64(b64)));
}

// ---------- empreinte visuelle (vérification d'identité du pair) ----------
export function fingerprintHues(roomId: string): number[] {
  const hues: number[] = [];
  for (let i = 0; i < 6; i++) {
    const byte = parseInt(roomId.slice(i * 2, i * 2 + 2), 16);
    hues.push(Math.round((byte / 255) * 360));
  }
  return hues;
}

export function shortFingerprint(roomId: string): string {
  return roomId.slice(0, 4) + "·" + roomId.slice(4, 8) + "·" + roomId.slice(8, 12);
}
