"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "react-qr-code";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, Flame, KeyRound, RefreshCw, User, Zap } from "lucide-react";
import * as K from "@/lib/crypto";
import { generateCode, generatePseudo } from "@/lib/words";
import { useApp, persistRoom, type RoomMeta } from "@/lib/store";
import { ensureSession, abandonRoom, reviveHostRoom } from "@/lib/rtc";
import { SectionLabel, CopyButton, HoldButton } from "@/components/ui";
import { CountdownRing } from "@/components/CountdownRing";
import { formatRemaining, durationLabel } from "@/lib/time";

const PRESETS = [
  { label: "15 min", ms: 15 * 60_000 },
  { label: "1 h", ms: 3_600_000 },
  { label: "6 h", ms: 6 * 3_600_000 },
  { label: "24 h", ms: 24 * 3_600_000 },
  { label: "48 h", ms: 48 * 3_600_000 },
  { label: "7 j", ms: 7 * 24 * 3_600_000 },
];

const ONE_HOUR = 3_600_000;

export default function CreatePage() {
  const router = useRouter();
  const [pseudo, setPseudo] = useState("");
  const [code, setCode] = useState("");
  const [duration, setDuration] = useState(PRESETS[3].ms);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);

  const upsertRoom = useApp((s) => s.upsertRoom);
  const room = useApp((s) => (roomId ? s.rooms[roomId] : undefined));
  const now = useApp((s) => s.now);

  useEffect(() => {
    setPseudo(generatePseudo());
    setCode(generateCode());
  }, []);

  // bascule automatique vers le chat quand le pair est là
  useEffect(() => {
    if (room?.status === "connected") {
      router.replace(`/chat/${room.id}`);
    }
  }, [room?.status, room?.id, router]);

  const submit = async () => {
    if (busy) return;
    const err = K.validateIdentity(pseudo, code);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const id = await K.deriveRoomId(pseudo, code);
      const existing = useApp.getState().rooms[id];
      if (existing) {
        setError("Cette identité a déjà une conversation en cours sur cet appareil.");
        return;
      }
      const meta: RoomMeta = {
        id,
        role: "host",
        selfPseudo: K.normPseudo(pseudo),
        roomPseudo: K.normPseudo(pseudo),
        peerName: null,
        code: K.normCode(code),
        createdAt: Date.now(),
        endsAt: Date.now() + duration,
        status: "waiting",
        updatedAt: Date.now(),
      };
      upsertRoom(meta);
      void persistRoom(meta);
      setRoomId(id);
      await ensureSession(meta);
    } finally {
      setBusy(false);
    }
  };

  const abandon = async () => {
    if (!roomId) return;
    await abandonRoom(roomId);
    setRoomId(null);
    router.push("/");
  };

  const inviteUrl =
    room && typeof window !== "undefined"
      ? `${window.location.origin}/join#p=${encodeURIComponent(room.roomPseudo)}&c=${encodeURIComponent(room.code)}`
      : "";
  const waitingLeft = room?.roomExpiresAt ? Math.max(0, room.roomExpiresAt - now) : 0;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 pb-14">
      <header className="flex items-center justify-between pt-6">
        <Link
          href="/"
          className="mono inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.2em] text-faint transition-colors hover:text-mint"
        >
          <ChevronLeft size={14} /> Accueil
        </Link>
        <span className="mono text-[10px] uppercase tracking-[0.24em] text-faint">créer</span>
      </header>

      <AnimatePresence mode="wait">
        {!roomId ? (
          <motion.section
            key="form"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="mt-10"
          >
            <h1 className="text-[30px] font-bold leading-tight tracking-tight text-ink">
              Nouvelle salle <span className="text-mint">éphémère</span>
            </h1>
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              Le couple <strong className="text-ink">pseudo + code</strong> est l'identité de la
              salle — il n'est jamais envoyé en clair, seulement son empreinte.
            </p>

            <div className="glass mt-8 grid gap-5 rounded-2xl p-5">
              <div>
                <SectionLabel>Votre pseudo</SectionLabel>
                <div className="input-dark mono mt-2 flex items-center rounded-xl">
                  <User size={15} className="ml-4 shrink-0 text-faint" />
                  <input
                    value={pseudo}
                    onChange={(e) => setPseudo(e.target.value)}
                    maxLength={32}
                    className="w-full bg-transparent px-3 py-3.5 text-[14px] text-ink placeholder:text-faint focus:outline-none"
                    placeholder="pseudo"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => setPseudo(generatePseudo())}
                    className="mr-2 rounded-lg p-2 text-faint transition-colors hover:text-mint"
                    aria-label="Générer un pseudo aléatoire"
                  >
                    <RefreshCw size={15} />
                  </button>
                </div>
              </div>

              <div>
                <SectionLabel>Code secret partagé</SectionLabel>
                <div className="input-dark mono mt-2 flex items-center rounded-xl">
                  <KeyRound size={15} className="ml-4 shrink-0 text-faint" />
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    maxLength={128}
                    className="w-full bg-transparent px-3 py-3.5 text-[14px] text-ink placeholder:text-faint focus:outline-none"
                    placeholder="mots-aléatoires"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => setCode(generateCode())}
                    className="mr-2 rounded-lg p-2 text-faint transition-colors hover:text-mint"
                    aria-label="Générer un code aléatoire"
                  >
                    <RefreshCw size={15} />
                  </button>
                </div>
                <p className="mono mt-2 text-[10px] leading-relaxed tracking-wide text-faint">
                  dérivation HKDF → AES-GCM 256 · le code ne quitte jamais votre appareil
                </p>
              </div>

              <div>
                <SectionLabel>Durée de la conversation</SectionLabel>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p.ms}
                      type="button"
                      onClick={() => setDuration(p.ms)}
                      className={`mono rounded-xl border px-3 py-2.5 text-[12px] tracking-wide transition-all ${
                        duration === p.ms
                          ? "border-mint/60 bg-mint/10 text-mint"
                          : "border-line text-muted hover:border-line2 hover:text-ink"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <p className="mono mt-2 text-[10px] leading-relaxed tracking-wide text-faint">
                  irréductible · prolongeable uniquement par accord mutuel
                </p>
              </div>

              {error && <p className="text-[13px] text-danger">{error}</p>}

              <button
                type="button"
                onClick={submit}
                disabled={busy || !pseudo || !code}
                className="group mono flex items-center justify-center gap-2 rounded-xl bg-mint px-5 py-4 text-[13px] font-bold uppercase tracking-[0.22em] text-void transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
              >
                <Zap size={15} strokeWidth={2.6} />
                {busy ? "Initialisation…" : "Créer la salle"}
              </button>
            </div>
          </motion.section>
        ) : (
          <motion.section
            key="waiting"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="mt-10"
          >
            {room?.status === "expired" ? (
              <div className="glass rounded-2xl p-6 text-center">
                <Flame size={26} className="mx-auto text-danger" />
                <h1 className="mt-4 text-[22px] font-bold text-ink">Salle expirée</h1>
                <p className="mt-2 text-[13px] leading-relaxed text-muted">
                  Personne n'a rejoint sous <strong className="text-ink">1 heure</strong> : la salle
                  a été effacée de l'annuaire. Recréez-la pour générer une nouvelle fenêtre.
                </p>
                <div className="mt-6 flex justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => roomId && reviveHostRoom(roomId)}
                    className="mono rounded-xl bg-mint px-5 py-3 text-[12px] font-bold uppercase tracking-[0.2em] text-void transition-all hover:brightness-110 active:scale-[0.98]"
                  >
                    Recréer la salle
                  </button>
                  <HoldButton
                    onConfirm={abandon}
                    className="mono rounded-xl border border-danger/40 px-5 py-3 text-[12px] font-bold uppercase tracking-[0.2em] text-danger"
                  >
                    <Flame size={14} /> Maintenir pour détruire
                  </HoldButton>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h1 className="text-[24px] font-bold leading-tight tracking-tight text-ink">
                      En attente du pair…
                    </h1>
                    <p className="mono mt-2 text-[11px] uppercase tracking-[0.18em] text-faint">
                      durée de la conversation : {durationLabel((room?.endsAt ?? 0) - (room?.createdAt ?? 0))}
                    </p>
                  </div>
                  <CountdownRing fraction={waitingLeft / ONE_HOUR} size={62} color="var(--color-amber)">
                    <span className="mono text-[8px] leading-tight text-amber">TTL</span>
                  </CountdownRing>
                </div>

                <div className="glass mt-6 rounded-2xl p-6">
                  <div className="relative mx-auto w-fit">
                    <div className="rounded-2xl bg-white/[0.03] p-4">
                      {inviteUrl && (
                        <QRCode value={inviteUrl} size={184} bgColor="transparent" fgColor="#e9edf5" level="M" />
                      )}
                    </div>
                    <span className="animate-radar pointer-events-none absolute inset-0 -z-10 rounded-full border border-mint/40" />
                  </div>

                  <p className="mt-5 text-center text-[13px] text-muted">
                    Faites scanner ce QR ou envoyez le lien. Le secret voyage{" "}
                    <strong className="text-ink">dans le fragment</strong> (#) du lien — invisible
                    pour le serveur.
                  </p>

                  <div className="mono mt-4 break-all rounded-xl border border-line bg-void/60 p-3 text-[11px] leading-relaxed text-muted">
                    {inviteUrl}
                  </div>
                  <div className="mt-4 flex items-center justify-center gap-3">
                    <CopyButton value={inviteUrl} label="Copier le lien" />
                    <CopyButton value={room ? `${room.roomPseudo} / ${room.code}` : ""} label="Pseudo + code" />
                  </div>
                </div>

                <div className="mono mt-4 flex items-center justify-between rounded-xl border border-line px-4 py-3 text-[11px] uppercase tracking-[0.16em]">
                  <span className="text-faint">expiration de la salle</span>
                  <span className="tabular text-amber">{formatRemaining(waitingLeft)}</span>
                </div>
                <p className="mt-3 text-[12px] leading-relaxed text-muted">
                  Si personne ne rejoint sous 1 heure, la salle est détruite côté serveur et le lien
                  devient invalide.
                </p>

                <div className="mt-6">
                  <HoldButton
                    onConfirm={abandon}
                    className="mono w-full rounded-xl border border-danger/40 px-5 py-3.5 text-[12px] font-bold uppercase tracking-[0.2em] text-danger"
                  >
                    <Flame size={14} /> Maintenir pour abandonner et détruire
                  </HoldButton>
                </div>
              </>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </main>
  );
}
