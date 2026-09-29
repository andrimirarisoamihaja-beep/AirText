// =====================================================================
// KORAGNA — Annuaire éphémère de signalisation (mémoire volatile uniquement)
//
//  • Aucune base de données. Aucun contenu. Uniquement SDP + ICE, en RAM.
//  • Une salle "en attente" expire après 1 h (règle métier stricte).
//  • Une fois les deux pairs connectés, tout est purgé (tombstone ~3 min).
//  • Zéro connaissance : roomId est un hash SHA-256 de pseudo+code.
// =====================================================================

export type RoomState = "waiting" | "joining" | "answering" | "connected";
export type Role = "host" | "guest";

export interface Room {
  id: string;
  createdAt: number;
  expiresAt: number;
  state: RoomState;
  stateSince: number;
  offer: string | null;
  answer: string | null;
  hostCands: string[]; // candidats produits par l'hôte → consommés par le guest
  guestCands: string[]; // candidats du guest → consommés par l'hôte
  hostRead: number;
  guestRead: number;
  hostSeen: number;
  guestSeen: number;
  acks: Set<Role>;
  hostSig: string;
  guestSig: string;
  waiters: Set<() => void>;
}

export const WAITING_TTL_MS = 60 * 60 * 1000; // 1 h — timeout d'attente strict
export const HANDSHAKE_TTL_MS = 12 * 60 * 1000; // fenêtre max du handshake
export const TOMBSTONE_MS = 3 * 60 * 1000; // purge post-connexion
const MAX_ROOMS = 1000;
const MAX_CANDIDATES = 80;

interface GlobalStore {
  rooms: Map<string, Room>;
  sweeperStarted: boolean;
}

const g = globalThis as unknown as { __koragnaSignal?: GlobalStore };
const store: GlobalStore = (g.__koragnaSignal ??= { rooms: new Map(), sweeperStarted: false });

function startSweeper() {
  if (store.sweeperStarted) return;
  store.sweeperStarted = true;
  const t = setInterval(() => sweep(), 30 * 1000);
  if (typeof t.unref === "function") t.unref();
}

export function sweep() {
  const now = Date.now();
  for (const [id, room] of store.rooms) {
    if (room.expiresAt <= now) {
      room.waiters.forEach((w) => w());
      store.rooms.delete(id);
    }
  }
  // garde-fou mémoire
  if (store.rooms.size > MAX_ROOMS) {
    const sorted = [...store.rooms.values()].sort((a, b) => a.createdAt - b.createdAt);
    for (let i = 0; i < sorted.length - MAX_ROOMS; i++) store.rooms.delete(sorted[i].id);
  }
}

function touch(room: Room) {
  room.hostSig = "";
  room.guestSig = "";
  room.waiters.forEach((w) => w());
  room.waiters.clear();
}

export function getRoom(id: string): Room | null {
  const room = store.rooms.get(id) ?? null;
  if (room && room.expiresAt <= Date.now()) {
    store.rooms.delete(id);
    return null;
  }
  return room;
}

/** L'hôte déclare la salle. Recréation autorisée si expirée ou déjà connectée. */
export function createRoom(id: string): { room: Room; fresh: boolean } {
  startSweeper();
  sweep();
  const existing = getRoom(id);
  if (existing && (existing.state === "waiting" || existing.state === "joining" || existing.state === "answering")) {
    return { room: existing, fresh: false };
  }
  if (existing) store.rooms.delete(id);
  const room: Room = {
    id,
    createdAt: Date.now(),
    expiresAt: Date.now() + WAITING_TTL_MS,
    state: "waiting",
    stateSince: Date.now(),
    offer: null,
    answer: null,
    hostCands: [],
    guestCands: [],
    hostRead: 0,
    guestRead: 0,
    hostSeen: Date.now(),
    guestSeen: 0,
    acks: new Set(),
    hostSig: "",
    guestSig: "",
    waiters: new Set(),
  };
  store.rooms.set(id, room);
  return { room, fresh: true };
}

export function deleteRoom(id: string) {
  const room = store.rooms.get(id);
  if (room) touch(room);
  store.rooms.delete(id);
}

export function notify(room: Room) {
  touch(room);
}

/** Signature d'état pour long-polling : change dès qu'il y a du nouveau pour ce rôle. */
function sigFor(room: Room, role: Role): string {
  const cands = role === "host" ? room.guestCands.length : room.hostCands.length;
  return `${room.state}|${cands}|${room.answer ? 1 : 0}`;
}

export interface PollSnapshot {
  state: RoomState;
  offer?: string;
  answer?: string;
  candidates: string[];
  expiresAt: number;
  peerAlive: boolean;
}

export function snapshot(room: Room, role: Role): PollSnapshot {
  const candidates =
    role === "host"
      ? room.guestCands.slice(room.hostRead)
      : room.hostCands.slice(room.guestRead);
  if (role === "host") room.hostRead = room.guestCands.length;
  else room.guestRead = room.hostCands.length;

  const peerSeen = role === "host" ? room.guestSeen : room.hostSeen;
  const snap: PollSnapshot = {
    state: room.state,
    candidates,
    expiresAt: room.expiresAt,
    peerAlive: peerSeen > 0 && Date.now() - peerSeen < 25_000,
  };
  if (role === "host" && room.offer) snap.offer = room.offer;
  if (role === "guest" && room.answer) snap.answer = room.answer;
  return snap;
}

export function markSeen(room: Room, role: Role) {
  const now = Date.now();
  if (role === "host") room.hostSeen = now;
  else room.guestSeen = now;
}

/** Long-poll : répond dès qu'il y a du nouveau (max `maxWaitMs`). */
export async function waitForChange(room: Room, role: Role, maxWaitMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const sig = sigFor(room, role);
    const known = role === "host" ? room.hostSig : room.guestSig;
    if (sig !== known) {
      if (role === "host") room.hostSig = sig;
      else room.guestSig = sig;
      return;
    }
    const remaining = maxWaitMs - (Date.now() - start);
    const step = Math.min(remaining, 20_000);
    const woke = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), step);
      room.waiters.add(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    void woke;
    if (!store.rooms.has(room.id)) return; // salle supprimée pendant l'attente
  }
  const sig = sigFor(room, role);
  if (role === "host") room.hostSig = sig;
  else room.guestSig = sig;
}

export function pushCandidate(room: Room, role: Role, candidate: string): boolean {
  const list = role === "host" ? room.hostCands : room.guestCands;
  if (list.length >= MAX_CANDIDATES) return false;
  list.push(candidate);
  touch(room);
  return true;
}
