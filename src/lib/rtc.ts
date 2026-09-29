"use client";

// =====================================================================
// KORAGNA — Sessions WebRTC DataChannel (pair-à-pair, chiffré de bout en bout)
// =====================================================================

import * as K from "./crypto";
import { signal, SignalError, type PollResult } from "./signal";
import {
  useApp,
  persistRoom,
  forgetRoom,
  putBlob,
  onRoomExpired,
  type RoomMeta,
} from "./store";
import { compressImage } from "./image";

// Message Easter Egg dans la console
if (typeof window !== "undefined") {
  console.clear();
  console.log("Salut petit curieux, ;-)");
}

const CHUNK = 16 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_BUFFERED = 1 << 20;

let cachedIceServers: RTCIceServer[] = [
  {
    urls: [
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
      "stun:stun2.l.google.com:19302",
    ],
  },
];

async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const res = await fetch("/api/turn");
    if (res.ok) {
      const servers = (await res.json()) as RTCIceServer[];
      if (Array.isArray(servers) && servers.length > 0) {
        cachedIceServers = servers;
      }
    }
  } catch {
    /* fallback silencieux */
  }
  return cachedIceServers;
}

type AppMsg =
  | { op: "hello"; pub: string; name: string; endsAt?: number; fp: string }
  | { op: "text"; id: string; text: string; ts: number }
  | { op: "image-meta"; id: string; mime: string; size: number; chunks: number; sha256: string }
  | { op: "image-chunk"; id: string; i: number; d: string }
  | { op: "extend-request"; sysId: string; newEndsAt: number }
  | { op: "extend-accept"; sysId: string; newEndsAt: number }
  | { op: "extend-reject"; sysId: string; newEndsAt: number }
  | { op: "bye"; reason: "timer" | "leave" | "nuke" };

interface Envelope {
  v: 1;
  e: "b" | "s";
  d: string;
}

interface IncomingImage {
  meta: { mime: string; size: number; chunks: number; sha256: string };
  parts: (Uint8Array | null)[];
  got: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class PeerSession {
  readonly id: string;
  readonly role: "host" | "guest";
  private baseKey: CryptoKey | null = null;
  private sessionKey: CryptoKey | null = null;
  private ecdh: K.ECDHPair | null = null;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private abort = new AbortController();
  private dead = false;
  private running = false;
  private channelOpen = false;
  private lastOffer: string | null = null;
  private remoteSet = false;
  private incoming = new Map<string, IncomingImage>();
  private pendingCandidates: RTCIceCandidateInit[] = [];

  constructor(meta: RoomMeta) {
    this.id = meta.id;
    this.role = meta.role;
  }

  private room(): RoomMeta | null {
    return useApp.getState().rooms[this.id] ?? null;
  }
  private patch(patch: Partial<RoomMeta>) {
    if (this.room()) useApp.getState().patchRoom(this.id, patch);
  }

  get identity(): { pseudo: string; code: string } | null {
    const r = this.room();
    return r ? { pseudo: r.roomPseudo, code: r.code } : null;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const ident = this.identity;
    if (!ident) return;

    await fetchIceServers();

    this.baseKey = await K.deriveBaseKey(ident.pseudo, ident.code);
    if (this.role === "host") void this.hostLoop();
    else void this.guestLoop();
  }

  stop(): void {
    this.dead = true;
    this.abort.abort();
    this.abort = new AbortController();
    this.closePc();
  }

  private closePc(): void {
    if (this.dc) {
      this.dc.onopen = null;
      this.dc.onclose = null;
      this.dc.onerror = null;
      this.dc.onmessage = null;
      try {
        this.dc.close();
      } catch {
        /* noop */
      }
    }

    if (this.pc) {
      this.pc.onicecandidate = null;
      this.pc.oniceconnectionstatechange = null;
      this.pc.onconnectionstatechange = null;
      this.pc.ondatachannel = null;
      try {
        this.pc.close();
      } catch {
        /* noop */
      }
    }

    this.dc = null;
    this.pc = null;
    this.channelOpen = false;
    this.sessionKey = null;
    this.ecdh = null;
    this.remoteSet = false;
    this.pendingCandidates = [];
    this.incoming.clear();
  }

  private setupPc(initiator: boolean): RTCPeerConnection {
    this.closePc();
    this.ecdh = null;
    const pc = new RTCPeerConnection({ iceServers: cachedIceServers });
    this.pc = pc;

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      void signal(
        {
          action: "candidate",
          id: this.id,
          role: this.role,
          candidate: JSON.stringify(ev.candidate),
        },
        this.abort.signal,
      ).catch(() => undefined);
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") {
        this.handleDrop();
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.handleDrop();
      }
    };

    if (initiator) {
      const dc = pc.createDataChannel("koragna", { ordered: true });
      this.bindChannel(dc);
    } else {
      pc.ondatachannel = (ev) => {
        this.bindChannel(ev.channel);
      };
    }
    return pc;
  }

  private bindChannel(dc: RTCDataChannel): void {
    this.dc = dc;
    dc.binaryType = "arraybuffer";
    dc.bufferedAmountLowThreshold = MAX_BUFFERED / 2;

    dc.onopen = () => {
      void this.onOpen();
    };

    dc.onclose = () => {
      this.handleDrop();
    };

    dc.onerror = () => {
      if (dc.readyState === "closed" || dc.readyState === "closing") {
        this.handleDrop();
      }
    };

    dc.onmessage = (ev) => void this.onWire(String(ev.data));
  }

  private async onOpen(): Promise<void> {
    this.channelOpen = true;
    this.patch({ status: "connecting", note: undefined });
    this.ecdh = await K.generateECDH();
    const room = this.room();
    const hello: AppMsg = {
      op: "hello",
      pub: await K.exportPubRaw(this.ecdh.publicKey),
      name: room?.selfPseudo ?? "anonyme",
      fp: this.id,
      ...(this.role === "host" ? { endsAt: room?.endsAt } : {}),
    };
    await this.sendRaw("b", hello);
  }

  private handleDrop(): void {
    if (this.dead || !this.room()) return;
    const wasOpen = this.channelOpen;
    this.closePc();
    this.sessionKey = null;
    if (wasOpen) this.patch({ status: "disconnected" });
    if (this.role === "host") {
      void signal(
        { action: "reset", id: this.id, role: "host" },
        this.abort.signal,
      ).catch(() => undefined);
    }
  }

  // ---------- boucle hôte ----------
  private async hostEnsure(): Promise<boolean> {
    try {
      const res = await signal<{ expiresAt: number; fresh: boolean }>(
        { action: "create", id: this.id },
        this.abort.signal,
      );
      const room = this.room();
      if (room && room.status !== "connected") {
        this.patch({ status: "waiting", roomExpiresAt: res.expiresAt });
      } else {
        this.patch({ roomExpiresAt: res.expiresAt });
      }
      return true;
    } catch {
      return false;
    }
  }

  async revive(): Promise<void> {
    if (this.dead) return;
    const ok = await this.hostEnsure();
    if (ok) {
      this.patch({ status: "waiting", note: undefined });
      void this.hostLoop();
    }
  }

  private async hostLoop(): Promise<void> {
    await this.hostEnsure();
    while (!this.dead && !this.abort.signal.aborted) {
      try {
        if (this.channelOpen) {
          await sleep(3000);
          continue;
        }

        const snap = await signal<PollResult>(
          { action: "poll", id: this.id, role: "host" },
          this.abort.signal,
        );
        if (this.dead || this.channelOpen) return;

        if (snap.offer && snap.offer !== this.lastOffer) {
          await this.answerOffer(snap.offer);
        }
        for (const c of snap.candidates) await this.addCandidate(c);
      } catch (e) {
        if (this.dead || this.abort.signal.aborted) return;
        if (e instanceof SignalError && e.status === 404) {
          const room = this.room();
          if (this.channelOpen || room?.status === "connected") {
            await this.hostEnsure();
            continue;
          }
          this.patch({ status: "expired" });
          return;
        }
        await sleep(2500);
      }
    }
  }

  private async answerOffer(offer: string): Promise<void> {
    if (this.channelOpen) return;
    this.lastOffer = offer;
    const pc = this.setupPc(false);
    try {
      await pc.setRemoteDescription({ type: "offer", sdp: offer });
      this.remoteSet = true;
      await this.flushPendingCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await signal(
        { action: "answer", id: this.id, answer: answer.sdp ?? "" },
        this.abort.signal,
      );
      this.patch({ status: "connecting" });
    } catch {
      /* ignore */
    }
  }

  // ---------- boucle invité ----------
  private async guestLoop(): Promise<void> {
    let first = true;
    while (!this.dead && !this.abort.signal.aborted) {
      try {
        if (this.channelOpen) return;

        this.patch({ status: "connecting" });
        const pc = this.setupPc(true);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await signal(
          { action: "join", id: this.id, offer: offer.sdp ?? "" },
          this.abort.signal,
        );
        first = false;
        this.patch({ note: undefined });
        await this.guestWaitAnswer();
        if (this.channelOpen) return;
      } catch (e) {
        if (this.dead || this.abort.signal.aborted) return;
        if (e instanceof SignalError) {
          if (e.status === 404) {
            this.patch({ status: "disconnected", note: "unknown_or_expired" });
            await sleep(first ? 3500 : 5000);
          } else if (e.code === "room_busy") {
            this.patch({ note: "room_busy" });
            await sleep(6000);
          } else if (e.code === "room_inactive" || e.code === "not_joining") {
            await sleep(4000);
          } else {
            await sleep(3000);
          }
        } else {
          await sleep(3000);
        }
      }
      first = false;
    }
  }

  private async guestWaitAnswer(): Promise<void> {
    const start = Date.now();
    while (!this.dead && !this.channelOpen && Date.now() - start < 50_000) {
      const snap = await signal<PollResult>(
        { action: "poll", id: this.id, role: "guest" },
        this.abort.signal,
      );
      if (snap.answer && !this.remoteSet && this.pc) {
        this.remoteSet = true;
        try {
          await this.pc.setRemoteDescription({ type: "answer", sdp: snap.answer });
          await this.flushPendingCandidates();
        } catch {
          return;
        }
      }
      for (const c of snap.candidates) await this.addCandidate(c);
      await sleep(1500);
    }
  }

  private async addCandidate(raw: string): Promise<void> {
    if (!this.pc) return;
    let init: RTCIceCandidateInit;
    try {
      init = JSON.parse(raw) as RTCIceCandidateInit;
    } catch {
      return;
    }

    if (!this.pc.remoteDescription) {
      this.pendingCandidates.push(init);
      return;
    }

    try {
      await this.pc.addIceCandidate(init);
    } catch {
      /* candidat obsolète */
    }
  }

  private async flushPendingCandidates(): Promise<void> {
    if (!this.pc || !this.pc.remoteDescription) return;
    const queued = this.pendingCandidates.splice(0);
    for (const c of queued) {
      try {
        await this.pc.addIceCandidate(c);
      } catch {
        /* ignore */
      }
    }
  }

  // ---------- transport chiffré ----------
  private async sendRaw(kind: "b" | "s", msg: AppMsg): Promise<boolean> {
    const key = kind === "s" ? this.sessionKey : this.baseKey;
    const dc = this.dc;

    if (!key || !dc || dc.readyState !== "open") {
      return false;
    }
    try {
      const env: Envelope = {
        v: 1,
        e: kind,
        d: await K.encryptString(key, JSON.stringify(msg)),
      };
      dc.send(JSON.stringify(env));
      return true;
    } catch {
      return false;
    }
  }

  async sendApp(msg: AppMsg): Promise<boolean> {
    return this.sendRaw("s", msg);
  }

  private async drain(): Promise<void> {
    const dc = this.dc;
    if (dc && dc.bufferedAmount > MAX_BUFFERED) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 4000);
        dc.onbufferedamountlow = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  }

  // ---------- réception ----------
  private async onWire(raw: string): Promise<void> {
    let env: Envelope;
    try {
      env = JSON.parse(raw) as Envelope;
    } catch {
      return;
    }
    const key = env.e === "s" ? this.sessionKey : this.baseKey;
    if (!key) return;
    let msg: AppMsg;
    try {
      msg = JSON.parse(await K.decryptString(key, env.d)) as AppMsg;
    } catch {
      return;
    }

    switch (msg.op) {
      case "hello":
        await this.onHello(msg);
        break;
      case "text":
        this.onText(msg);
        break;
      case "image-meta":
        this.onImageMeta(msg);
        break;
      case "image-chunk":
        await this.onImageChunk(msg);
        break;
      case "extend-request":
        this.onExtendRequest(msg);
        break;
      case "extend-accept":
        applyExtend(this.id, msg.newEndsAt);
        this.patchSys(msg.sysId, "accepted");
        break;
      case "extend-reject":
        this.patchSys(msg.sysId, "rejected");
        break;
      case "bye":
        void nukeRoom(this.id, { remote: true });
        break;
    }
  }

  private async onHello(msg: Extract<AppMsg, { op: "hello" }>): Promise<void> {
    if (msg.fp !== this.id || !this.ecdh) return;
    this.sessionKey = await K.deriveSessionKey(this.ecdh, msg.pub, this.id);
    const room = this.room();
    const name = String(msg.name).slice(0, 40) || "anonyme";
    if (this.role === "guest" && msg.endsAt && msg.endsAt > Date.now()) {
      this.patch({
        endsAt: msg.endsAt,
        peerName: name,
        status: "connected",
        note: undefined,
      });
    } else {
      this.patch({ peerName: name, status: "connected", note: undefined });
    }
    const updated = this.room();
    if (updated) void persistRoom(updated);
    void signal(
      { action: "connected", id: this.id, role: this.role },
      this.abort.signal,
    ).catch(() => undefined);
  }

  private onText(msg: Extract<AppMsg, { op: "text" }>): void {
    const store = useApp.getState();
    store.addMessage(this.id, {
      id: msg.id,
      kind: "text",
      mine: false,
      ts: msg.ts,
      text: String(msg.text).slice(0, 4000),
      status: "received",
    });
    store.bumpUnread(this.id);
    store.patchRoom(this.id, {});
  }

  private onImageMeta(msg: Extract<AppMsg, { op: "image-meta" }>): void {
    if (msg.size > MAX_IMAGE_BYTES || msg.chunks > 512) return;
    this.incoming.set(msg.id, {
      meta: msg,
      parts: new Array<Uint8Array | null>(msg.chunks).fill(null),
      got: 0,
    });
    useApp.getState().addMessage(this.id, {
      id: msg.id,
      kind: "image",
      mine: false,
      ts: Date.now(),
      status: "received",
      progress: 0,
    });
  }

  private async onImageChunk(
    msg: Extract<AppMsg, { op: "image-chunk" }>,
  ): Promise<void> {
    const inc = this.incoming.get(msg.id);
    if (!inc || msg.i < 0 || msg.i >= inc.meta.chunks || inc.parts[msg.i]) return;
    inc.parts[msg.i] = K.fromB64(msg.d);
    inc.got += 1;
    const store = useApp.getState();
    store.patchMessage(this.id, msg.id, { progress: inc.got / inc.meta.chunks });
    if (inc.got < inc.meta.chunks) return;

    const total = inc.parts.reduce((n, p) => n + (p?.length ?? 0), 0);
    const full = new Uint8Array(total);
    let off = 0;
    for (const p of inc.parts) {
      if (p) {
        full.set(p, off);
        off += p.length;
      }
    }
    this.incoming.delete(msg.id);
    const hash = await K.sha256Hex(full);
    if (hash !== inc.meta.sha256 || total !== inc.meta.size) {
      store.patchMessage(this.id, msg.id, { status: "error" });
      return;
    }
    const blobKey = putBlob(new Blob([full as BlobPart], { type: inc.meta.mime }));
    store.patchMessage(this.id, msg.id, {
      blobKey,
      progress: 1,
      status: "received",
    });
    store.bumpUnread(this.id);
  }

  private onExtendRequest(
    msg: Extract<AppMsg, { op: "extend-request" }>,
  ): void {
    const room = this.room();
    if (!room) return;
    if (msg.newEndsAt <= room.endsAt) return;
    const store = useApp.getState();
    store.addMessage(this.id, {
      id: msg.sysId,
      kind: "sys",
      mine: false,
      ts: Date.now(),
      sys: {
        type: "extend",
        newEndsAt: msg.newEndsAt,
        fromMe: false,
        state: "pending",
        fromName: room.peerName ?? "pair",
      },
    });
    store.bumpUnread(this.id);
  }

  private patchSys(sysId: string, state: "accepted" | "rejected"): void {
    const list = useApp.getState().messages[this.id] ?? [];
    const found = list.find((m) => m.id === sysId);
    if (found?.sys) {
      useApp.getState().patchMessage(this.id, sysId, {
        sys: { ...found.sys, state },
      });
    }
  }
}

// =====================================================================
// Orchestration publique
// =====================================================================

const sessions = new Map<string, PeerSession>();

export async function ensureSession(room: RoomMeta): Promise<void> {
  let s = sessions.get(room.id);
  if (!s) {
    s = new PeerSession(room);
    sessions.set(room.id, s);
  }
  await s.start();
}

export function getSession(roomId: string): PeerSession | undefined {
  return sessions.get(roomId);
}

export async function sendText(roomId: string, text: string): Promise<boolean> {
  const s = sessions.get(roomId);
  const trimmed = text.trim();
  if (!s || !trimmed) return false;
  const msgId = K.randomId();
  const ok = await s.sendApp({
    op: "text",
    id: msgId,
    text: trimmed.slice(0, 4000),
    ts: Date.now(),
  });
  if (ok) {
    useApp.getState().addMessage(roomId, {
      id: msgId,
      kind: "text",
      mine: true,
      ts: Date.now(),
      text: trimmed,
      status: "sent",
    });
    useApp.getState().patchRoom(roomId, {});
  }
  return ok;
}

export async function sendImage(roomId: string, file: File): Promise<boolean> {
  const s = sessions.get(roomId);
  if (!s) return false;
  const store = useApp.getState();
  try {
    const blob = await compressImage(file);
    if (blob.size > MAX_IMAGE_BYTES) {
      store.addMessage(roomId, {
        id: K.randomId(),
        kind: "sys",
        mine: true,
        ts: Date.now(),
        text: "Image trop lourde après compression (5 Mo max).",
      });
      return false;
    }
    const buf = new Uint8Array(await blob.arrayBuffer());
    const sha256 = await K.sha256Hex(buf);
    const chunks = Math.ceil(buf.length / CHUNK);
    const msgId = K.randomId();
    const blobKey = putBlob(blob);
    store.addMessage(roomId, {
      id: msgId,
      kind: "image",
      mine: true,
      ts: Date.now(),
      blobKey,
      status: "sending",
      progress: 0,
    });
    const metaOk = await s.sendApp({
      op: "image-meta",
      id: msgId,
      mime: blob.type,
      size: buf.length,
      chunks,
      sha256,
    });
    if (!metaOk) throw new Error("canal fermé");
    for (let i = 0; i < chunks; i++) {
      const part = buf.subarray(i * CHUNK, Math.min(buf.length, (i + 1) * CHUNK));
      const ok = await s.sendApp({
        op: "image-chunk",
        id: msgId,
        i,
        d: K.toB64(part),
      });
      if (!ok) throw new Error("canal fermé");
      store.patchMessage(roomId, msgId, { progress: (i + 1) / chunks });
      await s["drain"]();
    }
    store.patchMessage(roomId, msgId, { status: "sent", progress: 1 });
    store.patchRoom(roomId, {});
    return true;
  } catch {
    return false;
  }
}

export async function requestExtend(roomId: string, addMs: number): Promise<void> {
  const room = useApp.getState().rooms[roomId];
  const s = sessions.get(roomId);
  if (!room || !s) return;
  const newEndsAt = room.endsAt + addMs;
  const sysId = K.randomId();
  useApp.getState().addMessage(roomId, {
    id: sysId,
    kind: "sys",
    mine: true,
    ts: Date.now(),
    sys: {
      type: "extend",
      newEndsAt,
      fromMe: true,
      state: "pending",
      fromName: room.selfPseudo,
    },
  });
  const ok = await s.sendApp({ op: "extend-request", sysId, newEndsAt });
  if (!ok) {
    const msg = useApp.getState().messages[roomId]?.find((m) => m.id === sysId);
    if (msg?.sys) {
      useApp.getState().patchMessage(roomId, sysId, {
        sys: { ...msg.sys, state: "rejected" },
      });
    }
  }
}

export async function respondExtend(
  roomId: string,
  sysId: string,
  accept: boolean,
): Promise<void> {
  const store = useApp.getState();
  const msg = store.messages[roomId]?.find((m) => m.id === sysId);
  if (!msg?.sys || msg.sys.state !== "pending") return;
  const s = sessions.get(roomId);
  const newEndsAt = msg.sys.newEndsAt;
  store.patchMessage(roomId, sysId, {
    sys: { ...msg.sys, state: accept ? "accepted" : "rejected" },
  });
  if (accept) applyExtend(roomId, newEndsAt);
  await s?.sendApp({
    op: accept ? "extend-accept" : "extend-reject",
    sysId,
    newEndsAt,
  });
}

function applyExtend(roomId: string, newEndsAt: number): void {
  const store = useApp.getState();
  const room = store.rooms[roomId];
  if (!room) return;
  if (newEndsAt <= room.endsAt) return;
  if (newEndsAt - Date.now() > 31 * 24 * 3600 * 1000) return;
  store.patchRoom(roomId, { endsAt: newEndsAt });
  const updated = store.rooms[roomId];
  if (updated) void persistRoom(updated);
}

export async function nukeRoom(
  roomId: string,
  opts?: { remote?: boolean },
): Promise<void> {
  const s = sessions.get(roomId);
  if (s && !opts?.remote) {
    await s.sendApp({ op: "bye", reason: "nuke" });
    await sleep(60);
  }
  s?.stop();
  sessions.delete(roomId);
  const store = useApp.getState();
  store.clearMessages(roomId);
  store.removeRoom(roomId);
  await forgetRoom(roomId);
  if (s) {
    void signal({ action: "close", id: roomId }).catch(() => undefined);
  }
}

export async function abandonRoom(roomId: string): Promise<void> {
  await nukeRoom(roomId, {});
}

export async function reviveHostRoom(roomId: string): Promise<void> {
  const s = sessions.get(roomId);
  if (s) await s.revive();
}

if (typeof window !== "undefined") {
  onRoomExpired((room) => {
    void nukeRoom(room.id, {});
  });
}