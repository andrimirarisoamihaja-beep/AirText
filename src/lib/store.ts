"use client";

// =====================================================================
// État local multi-conversations (zustand) + persistance chiffrée.
//  • Métadonnées des salles vivantes → IndexedDB, chiffrées AES-GCM avec
//    une clé d'appareil générée localement (jamais transmise).
//  • Messages et images → MÉMOIRE VIVE UNIQUEMENT. Jamais persistés.
//    Détruits immédiatement à la fin d'une conversation.
// =====================================================================

import { create } from "zustand";
import * as idb from "./idb";
import { toB64, fromB64, encryptString, decryptString } from "./crypto";

export type RoomRole = "host" | "guest";
export type RoomStatus =
  | "waiting" // salle créée, en attente du pair (TTL serveur 1 h)
  | "connecting" // handshake WebRTC en cours
  | "connected" // canal P2P ouvert et chiffré
  | "disconnected" // conversation vivante mais pair injoignable
  | "expired"; // salle d'attente expirée côté serveur

export interface RoomMeta {
  id: string; // hash SHA-256 de pseudo+code (rien d'autre n'est public)
  role: RoomRole;
  selfPseudo: string; // notre alias affiché au pair
  roomPseudo: string; // pseudo d'identité de la salle (celui de l'inviteur)
  peerName: string | null;
  code: string; // secret partagé — jamais stocké en clair (blob chiffré)
  createdAt: number;
  endsAt: number; // deadline de la conversation (ne peut jamais diminuer)
  roomExpiresAt?: number; // TTL serveur de la salle d'attente
  status: RoomStatus;
  note?: string; // indice d'état transitoire (ex: unknown_or_expired, room_busy)
  updatedAt: number;
}

export interface SysExtend {
  type: "extend";
  newEndsAt: number;
  fromMe: boolean;
  state: "pending" | "accepted" | "rejected";
  fromName: string;
}

export interface ChatMessage {
  id: string;
  kind: "text" | "image" | "sys";
  mine: boolean;
  ts: number;
  text?: string;
  blobKey?: string;
  progress?: number; // 0..1 pendant un transfert d'image
  status?: "sending" | "sent" | "received" | "error";
  sys?: SysExtend;
}

interface AppState {
  hydrated: boolean;
  now: number;
  rooms: Record<string, RoomMeta>;
  order: string[];
  messages: Record<string, ChatMessage[]>;
  unread: Record<string, number>;
  hydrate: () => Promise<void>;
  tick: (now: number) => void;
  upsertRoom: (room: RoomMeta) => void;
  patchRoom: (id: string, patch: Partial<RoomMeta>) => void;
  removeRoom: (id: string) => void;
  addMessage: (roomId: string, msg: ChatMessage) => void;
  patchMessage: (roomId: string, msgId: string, patch: Partial<ChatMessage>) => void;
  clearMessages: (roomId: string) => void;
  bumpUnread: (roomId: string) => void;
  clearUnread: (roomId: string) => void;
}

// ------- blobs d'images : RAM uniquement, révocables -------
const blobs = new Map<string, Blob>();
const urls = new Map<string, string>();

export function putBlob(blob: Blob): string {
  const key = toB64(crypto.getRandomValues(new Uint8Array(9)));
  blobs.set(key, blob);
  urls.set(key, URL.createObjectURL(blob));
  return key;
}

export function getBlobUrl(key: string): string | null {
  return urls.get(key) ?? null;
}

export function dropBlob(key: string): void {
  const url = urls.get(key);
  if (url) URL.revokeObjectURL(url);
  urls.delete(key);
  blobs.delete(key);
}

export function getBlob(key: string): Blob | null {
  return blobs.get(key) ?? null;
}

// ------- gestionnaires d'expiration (enregistrés par le module RTC) -------
type ExpiryHandler = (room: RoomMeta) => void;
const expiryHandlers = new Set<ExpiryHandler>();
export function onRoomExpired(fn: ExpiryHandler): () => void {
  expiryHandlers.add(fn);
  return () => expiryHandlers.delete(fn);
}

// ------- persistance chiffrée (clé d'appareil) -------
const DEV_KEY_LS = "koragna:devkey:v1";
let deviceKeyPromise: Promise<CryptoKey> | null = null;

function deviceKey(): Promise<CryptoKey> {
  if (!deviceKeyPromise) {
    deviceKeyPromise = (async () => {
      let raw = localStorage.getItem(DEV_KEY_LS);
      if (!raw) {
        raw = toB64(crypto.getRandomValues(new Uint8Array(32)));
        localStorage.setItem(DEV_KEY_LS, raw);
      }
      return crypto.subtle.importKey("raw", fromB64(raw) as BufferSource, { name: "AES-GCM" }, false, [
        "encrypt",
        "decrypt",
      ]);
    })();
  }
  return deviceKeyPromise;
}

export async function persistRoom(room: RoomMeta): Promise<void> {
  try {
    const key = await deviceKey();
    const blob = await encryptString(key, JSON.stringify(room));
    await idb.saveRoomBlob(room.id, blob);
  } catch {
    /* stockage indisponible : la session reste viable en mémoire */
  }
}

export async function forgetRoom(id: string): Promise<void> {
  try {
    await idb.deleteRoomBlob(id);
  } catch {
    /* noop */
  }
}

// ------- store -------
export const useApp = create<AppState>()((set, get) => ({
  hydrated: false,
  now: Date.now(),
  rooms: {},
  order: [],
  messages: {},
  unread: {},

  hydrate: async () => {
    if (get().hydrated) return;
    const rooms: Record<string, RoomMeta> = {};
    const order: string[] = [];
    try {
      const key = await deviceKey();
      const rows = await idb.loadRoomBlobs();
      const now = Date.now();
      for (const row of rows) {
        try {
          const meta = JSON.parse(await decryptString(key, row.blob)) as RoomMeta;
          if (!meta.id || meta.endsAt <= now) {
            await idb.deleteRoomBlob(row.id); // timer écoulé → destruction silencieuse
            continue;
          }
          rooms[meta.id] = { ...meta, status: meta.status === "waiting" ? "waiting" : "disconnected" };
          order.push(meta.id);
        } catch {
          /* blob illisible → ignoré */
        }
      }
      order.sort((a, b) => rooms[b].updatedAt - rooms[a].updatedAt);
    } catch {
      /* IndexedDB indisponible (navigation privée stricte) */
    }
    set({ hydrated: true, rooms, order, now: Date.now() });
  },

  tick: (now) => {
    const { rooms } = get();
    for (const id of Object.keys(rooms)) {
      const room = rooms[id];
      if (room && room.endsAt > 0 && room.endsAt <= now) {
        expiryHandlers.forEach((fn) => fn(room));
      }
    }
    set({ now });
  },

  upsertRoom: (room) =>
    set((s) => ({
      rooms: { ...s.rooms, [room.id]: room },
      order: [room.id, ...s.order.filter((x) => x !== room.id)],
    })),

  patchRoom: (id, patch) =>
    set((s) => {
      const room = s.rooms[id];
      if (!room) return s;
      return { rooms: { ...s.rooms, [id]: { ...room, ...patch, updatedAt: Date.now() } } };
    }),

  removeRoom: (id) =>
    set((s) => {
      const rooms = { ...s.rooms };
      const unread = { ...s.unread };
      delete rooms[id];
      delete unread[id];
      return { rooms, unread, order: s.order.filter((x) => x !== id) };
    }),

  addMessage: (roomId, msg) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [roomId]: [...(s.messages[roomId] ?? []), msg].slice(-400),
      },
    })),

  patchMessage: (roomId, msgId, patch) =>
    set((s) => {
      const list = s.messages[roomId];
      if (!list) return s;
      return {
        messages: {
          ...s.messages,
          [roomId]: list.map((m) => (m.id === msgId ? { ...m, ...patch } : m)),
        },
      };
    }),

  clearMessages: (roomId) =>
    set((s) => {
      const list = s.messages[roomId] ?? [];
      list.forEach((m) => m.blobKey && dropBlob(m.blobKey));
      const messages = { ...s.messages };
      delete messages[roomId];
      return { messages };
    }),

  bumpUnread: (roomId) => set((s) => ({ unread: { ...s.unread, [roomId]: (s.unread[roomId] ?? 0) + 1 } })),
  clearUnread: (roomId) => set((s) => ({ unread: { ...s.unread, [roomId]: 0 } })),
}));
