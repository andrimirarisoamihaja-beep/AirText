"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronLeft,
  Clock,
  Flame,
  ImagePlus,
  MessagesSquare,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  useApp,
  getBlobUrl,
  type ChatMessage,
  type RoomMeta,
} from "@/lib/store";
import {
  ensureSession,
  sendText,
  sendImage,
  requestExtend,
  respondExtend,
  nukeRoom,
  reviveHostRoom,
} from "@/lib/rtc";
import { Fingerprint, StatusDot, HoldButton } from "@/components/ui";
import { CountdownRing } from "@/components/CountdownRing";
import { formatRemaining, formatClock, durationLabel } from "@/lib/time";
import { shortFingerprint } from "@/lib/crypto";

const EMPTY: ChatMessage[] = [];
const EXTEND_PRESETS = [
  15 * 60_000,
  30 * 60_000,
  3_600_000,
  6 * 3_600_000,
  24 * 3_600_000,
];

function timerColor(remaining: number): string {
  if (remaining < 2 * 60_000) return "var(--color-danger)";
  if (remaining < 10 * 60_000) return "var(--color-amber)";
  return "var(--color-mint)";
}

// ------------------- bulles -------------------
function Bubble({ msg, mine }: { msg: ChatMessage; mine: boolean }) {
  const url = msg.blobKey ? getBlobUrl(msg.blobKey) : null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={`flex ${mine ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[82%] rounded-2xl px-4 py-2.5 ${
          mine
            ? "rounded-br-md border border-mint/25 bg-mint/10 text-ink"
            : "rounded-bl-md border border-line bg-panel2 text-ink"
        }`}
      >
        {msg.kind === "image" ? (
          <div className="relative overflow-hidden rounded-lg">
            {url ? (
              <a href={url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt="image chiffrée"
                  className="max-h-72 w-auto rounded-lg"
                />
              </a>
            ) : (
              <div className="flex h-32 w-48 items-center justify-center rounded-lg bg-void/50">
                <span className="mono text-[10px] uppercase tracking-[0.2em] text-faint">
                  {msg.status === "error"
                    ? "intégrité invalide"
                    : "déchiffrement…"}
                </span>
              </div>
            )}
            {typeof msg.progress === "number" &&
              msg.progress < 1 &&
              msg.status !== "error" && (
                <div className="absolute inset-x-0 bottom-0 h-1 bg-void/60">
                  <div
                    className="h-full bg-mint transition-all"
                    style={{ width: `${Math.round(msg.progress * 100)}%` }}
                  />
                </div>
              )}
          </div>
        ) : (
          <p className="whitespace-pre-wrap wrap-break-word text-[14.5px] leading-relaxed">
            {msg.text}
          </p>
        )}
        <p
          className={`mono mt-1 text-right text-[9px] uppercase tracking-[0.14em] ${
            mine ? "text-mint/60" : "text-faint"
          }`}
        >
          {formatClock(msg.ts)}
          {mine && msg.status === "sending" ? " · envoi" : ""}
          {msg.status === "error" ? " · erreur" : ""}
        </p>
      </div>
    </motion.div>
  );
}

function SysCard({ room, msg }: { room: RoomMeta; msg: ChatMessage }) {
  const sys = msg.sys;
  if (!sys) {
    return (
      <p className="mono my-2 text-center text-[10px] uppercase tracking-[0.18em] text-faint">
        {msg.text}
      </p>
    );
  }

  // Calcul correct de la durée ajoutée
  const addedMs = Math.max(0, sys.newEndsAt - room.endsAt);
  const deltaText = durationLabel(addedMs);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass mx-auto w-full max-w-[92%] rounded-2xl p-4 text-center"
    >
      {sys.state === "pending" ? (
        <>
          <p className="text-[13px] text-ink">
            {sys.fromMe
              ? "Prolongation demandée"
              : `${sys.fromName} propose de prolonger`}{" "}
            <span className="mono font-semibold text-mint">+{deltaText}</span>
          </p>
          <p className="mono mt-1 text-[10px] uppercase tracking-[0.16em] text-faint">
            {sys.fromMe
              ? "en attente de validation du pair…"
              : "accord mutuel requis — jamais de réduction"}
          </p>
          {!sys.fromMe && (
            <div className="mt-3 flex justify-center gap-2.5">
              <button
                type="button"
                onClick={() => respondExtend(room.id, msg.id, true)}
                className="mono rounded-lg bg-mint px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-void transition-all hover:brightness-110 active:scale-95"
              >
                Accepter
              </button>
              <button
                type="button"
                onClick={() => respondExtend(room.id, msg.id, false)}
                className="mono rounded-lg border border-line px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-muted transition-colors hover:border-danger/50 hover:text-danger active:scale-95"
              >
                Refuser
              </button>
            </div>
          )}
        </>
      ) : sys.state === "accepted" ? (
        <p className="mono text-[11px] uppercase tracking-[0.16em] text-mint">
          <ShieldCheck size={12} className="mr-1.5 inline" />
          timer prolongé (+{deltaText}) — accord mutuel
        </p>
      ) : (
        <p className="mono text-[11px] uppercase tracking-[0.16em] text-faint">
          prolongation refusée — timer inchangé
        </p>
      )}
    </motion.div>
  );
}

// ------------------- page -------------------
export default function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const hydrated = useApp((s) => s.hydrated);
  const room = useApp((s) => s.rooms[id]);
  const msgs = useApp((s) => s.messages[id]) ?? EMPTY;
  // sélecteurs à références stables uniquement (sinon boucle infinie)
  const order = useApp((s) => s.order);
  const rooms = useApp((s) => s.rooms);
  const otherRooms = useMemo(
    () =>
      order
        .filter((r) => r !== id)
        .map((r) => rooms[r])
        .filter(Boolean),
    [order, rooms, id],
  );
  const now = useApp((s) => s.now);
  const clearUnread = useApp((s) => s.clearUnread);

  const [draft, setDraft] = useState("");
  const [showExtend, setShowExtend] = useState(false);
  const [showRooms, setShowRooms] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // connexion / reconnexion de la session à l'ouverture
  useEffect(() => {
    if (!hydrated) return;
    const meta = useApp.getState().rooms[id];
    if (!meta) {
      router.replace("/");
      return;
    }
    if (meta.status !== "expired") void ensureSession(meta);
  }, [hydrated, id, router]);

  // salle détruite localement (nuke / timer) → retour accueil
  useEffect(() => {
    if (hydrated && !room) router.replace("/");
  }, [hydrated, room, router]);

  // unread + scroll
  useEffect(() => {
    clearUnread(id);
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [msgs.length, id, clearUnread]);

  if (!hydrated || !room) {
    return (
      <main className="flex h-dvh items-center justify-center">
        <span className="mono animate-pulse-soft text-[11px] uppercase tracking-[0.3em] text-faint">
          déchiffrement…
        </span>
      </main>
    );
  }

  const remaining = Math.max(0, room.endsAt - now);
  const total = Math.max(1, room.endsAt - room.createdAt);
  const color = timerColor(remaining);
  const connected = room.status === "connected";
  const pendingFromMe = msgs.some(
    (m) =>
      m.sys?.type === "extend" && m.sys.state === "pending" && m.sys.fromMe,
  );

  const onSend = async () => {
    const text = draft.trim();
    if (!text || sending || !connected) return;
    setSending(true);
    const ok = await sendText(id, text);
    if (ok) setDraft("");
    if (taRef.current) taRef.current.style.height = "auto";
    setSending(false);
  };

  const onPick = async (file: File | null) => {
    if (!file || !connected) return;
    if (!file.type.startsWith("image/")) return;
    setSending(true);
    await sendImage(id, file);
    setSending(false);
  };

  const statusText =
    room.status === "waiting"
      ? "salle ouverte — le pair peut rejoindre à tout moment"
      : room.status === "connecting"
        ? "établissement du canal chiffré…"
        : room.status === "disconnected"
          ? room.note === "unknown_or_expired"
            ? "pair hors ligne — nouvelle tentative automatique…"
            : "pair hors ligne — reconnexion automatique…"
          : "";

  return (
    <main className="mx-auto flex h-dvh w-full max-w-2xl flex-col relative">
      {/* ------- Zone pour fermer les popups au clic à l'extérieur ------- */}
      {(showExtend || showRooms) && (
        <div
          className="fixed inset-0 z-10 bg-transparent"
          onClick={() => {
            setShowExtend(false);
            setShowRooms(false);
          }}
        />
      )}

      {/* ------- entête ------- */}
      <header className="glass-deep z-20 flex items-center gap-3 border-b border-line px-4 pb-3 pt-4">
        <Link
          href="/"
          aria-label="Retour"
          className="rounded-lg p-2 text-faint transition-colors hover:text-mint"
        >
          <ChevronLeft size={18} />
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Fingerprint roomId={id} size="sm" />
            <p className="truncate text-[15px] font-semibold text-ink">
              {room.peerName ??
                (room.role === "host"
                  ? "En attente du pair…"
                  : room.roomPseudo)}
            </p>
            <StatusDot status={room.status} />
          </div>
          <p className="mono mt-0.5 truncate text-[9px] uppercase tracking-[0.2em] text-faint">
            empreinte {shortFingerprint(id)} · aes-gcm · ecdh p-256
          </p>
        </div>

        {/* timer */}
        <div className="flex items-center gap-2">
          <CountdownRing
            fraction={remaining / total}
            size={40}
            color={color}
            stroke={3}
          >
            <Clock size={12} style={{ color }} />
          </CountdownRing>
          <span
            className="mono tabular hidden text-[12px] sm:block"
            style={{ color }}
          >
            {formatRemaining(remaining)}
          </span>
        </div>

        {/* prolonger */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setShowExtend((v) => !v);
              setShowRooms(false);
            }}
            aria-label="Prolonger la conversation"
            className={`relative rounded-lg border p-2 transition-colors ${
              showExtend
                ? "border-mint bg-mint/10 text-mint"
                : "border-line text-muted hover:border-mint/50 hover:text-mint"
            }`}
          >
            <Clock size={15} />
            {pendingFromMe && (
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber animate-pulse" />
            )}
          </button>
          <AnimatePresence>
            {showExtend && (
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.97 }}
                className="glass-deep absolute right-0 top-11 z-30 w-60 rounded-xl p-3 shadow-2xl border border-line"
              >
                <p className="mono text-[10px] uppercase tracking-[0.2em] text-faint text-center">
                  prolonger — accord mutuel
                </p>

                {!connected ? (
                  <p className="mono my-3 text-center text-[10px] uppercase tracking-wider text-amber">
                    canal non connecté
                  </p>
                ) : pendingFromMe ? (
                  <p className="mono my-3 text-center text-[10px] uppercase tracking-wider text-amber">
                    demande déjà en attente…
                  </p>
                ) : (
                  <div className="mt-2.5 grid grid-cols-2 gap-1.5">
                    {EXTEND_PRESETS.map((ms, index) => (
                      <button
                        key={ms}
                        type="button"
                        onClick={() => {
                          void requestExtend(id, ms);
                          setShowExtend(false);
                        }}
                        className={`mono rounded-lg border border-line px-2 py-2 text-[11px] font-medium text-muted transition-all hover:border-mint/60 hover:bg-mint/10 hover:text-mint active:scale-95 ${
                          index === EXTEND_PRESETS.length - 1
                            ? "col-span-2"
                            : ""
                        }`}
                      >
                        +{durationLabel(ms)}
                      </button>
                    ))}
                  </div>
                )}

                <p className="mono mt-2.5 text-center text-[9px] leading-relaxed tracking-wide text-faint">
                  réduction impossible · validation du pair requise
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* multi-conversations */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setShowRooms((v) => !v);
              setShowExtend(false);
            }}
            aria-label="Changer de conversation"
            className={`relative rounded-lg border p-2 transition-colors ${
              showRooms
                ? "border-mint bg-mint/10 text-mint"
                : "border-line text-muted hover:border-mint/50 hover:text-mint"
            }`}
          >
            <MessagesSquare size={15} />
            {otherRooms.length > 0 && (
              <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-iris text-[8px] font-bold text-void">
                {otherRooms.length}
              </span>
            )}
          </button>
          <AnimatePresence>
            {showRooms && (
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.97 }}
                className="glass-deep absolute right-0 top-11 z-30 w-64 rounded-xl p-2 shadow-2xl border border-line"
              >
                {otherRooms.length === 0 ? (
                  <p className="mono px-2 py-3 text-[10px] uppercase tracking-[0.18em] text-faint text-center">
                    aucune autre conversation
                  </p>
                ) : (
                  otherRooms.map((r) => (
                    <Link
                      key={r.id}
                      href={`/chat/${r.id}`}
                      onClick={() => setShowRooms(false)}
                      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 transition-colors hover:bg-white/4"
                    >
                      <StatusDot status={r.status} pulse={false} />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                        {r.peerName ?? r.roomPseudo}
                      </span>
                      <span className="mono tabular text-[10px] text-faint">
                        {
                          formatRemaining(Math.max(0, r.endsAt - now))
                            .split(" ")
                            .slice(-1)[0]
                        }
                      </span>
                    </Link>
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* nuke / suppression */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              if (
                confirm(
                  "Voulez-vous vraiment détruire définitivement cette discussion ? Cette action est irréversible.",
                )
              ) {
                void nukeRoom(id, {});
                router.replace("/");
              }
            }}
            aria-label="Supprimer la discussion"
            title="Détruire cette discussion"
            className="rounded-lg border border-danger/40 p-2 text-danger transition-colors hover:bg-danger/10 active:scale-95"
          >
            <Trash2 size={15} />
          </button>

          <HoldButton
            onConfirm={() => {
              void nukeRoom(id, {});
              router.replace("/");
            }}
            aria-label="Tout détruire"
            className="rounded-lg border border-danger/40 p-2 text-danger transition-colors"
          >
            <Flame size={15} />
          </HoldButton>
        </div>
      </header>

      {/* ------- bannière d'état ------- */}
      {room.status === "expired" ? (
        <div className="border-b border-danger/30 bg-danger/10 px-4 py-3 text-center">
          <p className="mono text-[11px] uppercase tracking-[0.16em] text-danger">
            salle d&apos;attente expirée (1 h) —{" "}
            <button
              type="button"
              onClick={() => void reviveHostRoom(id)}
              className="underline underline-offset-2"
            >
              recréer
            </button>
          </p>
        </div>
      ) : !connected ? (
        <div className="border-b border-line bg-panel/70 px-4 py-2.5 text-center">
          <p className="mono animate-pulse-soft text-[10px] uppercase tracking-[0.18em] text-muted">
            {statusText}
          </p>
        </div>
      ) : null}

      {/* ------- messages ------- */}
      <div
        ref={scrollRef}
        className="chat-scroll flex-1 space-y-3 overflow-y-auto px-4 py-5"
      >
        {msgs.length === 0 && (
          <div className="mx-auto mt-16 max-w-xs text-center">
            <ShieldCheck size={22} className="mx-auto text-mint/60" />
            <p className="mono mt-3 text-[10px] uppercase leading-relaxed tracking-[0.2em] text-faint">
              canal chiffré de bout en bout
              <br />
              rien n&apos;est stocké, nulle part
            </p>
          </div>
        )}
        {msgs.map((m) =>
          m.kind === "sys" ? (
            <SysCard key={m.id} room={room} msg={m} />
          ) : (
            <Bubble key={m.id} msg={m} mine={m.mine} />
          ),
        )}
      </div>

      {/* ------- compositeur ------- */}
      <footer className="glass-deep border-t border-line px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            disabled={!connected || sending}
            onChange={(e) => {
              void onPick(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!connected || sending}
            aria-label="Envoyer une image"
            className="rounded-xl border border-line p-3 text-muted transition-colors hover:border-mint/50 hover:text-mint disabled:pointer-events-none disabled:opacity-35"
          >
            <ImagePlus size={17} />
          </button>
          <div className="input-dark flex flex-1 items-end rounded-xl">
            <textarea
              ref={taRef}
              value={draft}
              rows={1}
              onChange={(e) => {
                setDraft(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height =
                  Math.min(140, e.target.scrollHeight) + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void onSend();
                }
              }}
              placeholder={
                connected ? "Message chiffré…" : "En attente du canal chiffré…"
              }
              disabled={!connected}
              className="max-h-[140px] w-full resize-none bg-transparent px-4 py-3 text-[14.5px] text-ink placeholder:text-faint focus:outline-none disabled:opacity-50"
            />
          </div>
          <button
            type="button"
            onClick={() => void onSend()}
            disabled={!connected || !draft.trim() || sending}
            aria-label="Envoyer"
            className="rounded-xl bg-mint p-3 text-void transition-all hover:brightness-110 active:scale-95 disabled:pointer-events-none disabled:opacity-35"
          >
            <Send size={17} strokeWidth={2.4} />
          </button>
        </div>
        <p className="mono mt-2 flex items-center justify-between px-1 text-[9px] uppercase tracking-[0.18em] text-faint/80">
          <span>p2p · rien sur serveur</span>
          <span>e2e aes-gcm</span>
        </p>
      </footer>
    </main>
  );
}
