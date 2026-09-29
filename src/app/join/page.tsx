"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, KeyRound, ScanSearch, User, UserRound, X } from "lucide-react";
import * as K from "@/lib/crypto";
import { generatePseudo } from "@/lib/words";
import { useApp, persistRoom, type RoomMeta } from "@/lib/store";
import { ensureSession, nukeRoom } from "@/lib/rtc";
import { SectionLabel, StatusDot, STATUS_LABEL } from "@/components/ui";

export default function JoinPage() {
  const router = useRouter();
  const [hostPseudo, setHostPseudo] = useState("");
  const [code, setCode] = useState("");
  const [myPseudo, setMyPseudo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fromLink, setFromLink] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const upsertRoom = useApp((s) => s.upsertRoom);
  const room = useApp((s) => (joiningId ? s.rooms[joiningId] : undefined));

  useEffect(() => {
    setMyPseudo(generatePseudo());
    // deep-link : le secret voyage dans le fragment (#), jamais envoyé au serveur
    const hash = window.location.hash.replace(/^#/, "");
    if (hash) {
      const params = new URLSearchParams(hash);
      const p = params.get("p");
      const c = params.get("c");
      if (p) setHostPseudo(p);
      if (c) setCode(c);
      if (p && c) setFromLink(true);
      // nettoie le fragment de l'historique visible
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (room?.status === "connected") {
      router.replace(`/chat/${room.id}`);
    }
  }, [room?.status, room?.id, router]);

  const submit = async () => {
    if (busy) return;
    const err = K.validateIdentity(hostPseudo, code);
    if (err) {
      setError(err);
      return;
    }
    if (K.normPseudo(myPseudo).length < 3) {
      setError("Choisissez aussi votre propre pseudo (3 caractères min).");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const id = await K.deriveRoomId(hostPseudo, code);
      const existing = useApp.getState().rooms[id];
      if (existing) {
        // conversation déjà connue localement : on reprend
        router.replace(`/chat/${id}`);
        return;
      }
      const meta: RoomMeta = {
        id,
        role: "guest",
        selfPseudo: K.normPseudo(myPseudo),
        roomPseudo: K.normPseudo(hostPseudo),
        peerName: null,
        code: K.normCode(code),
        createdAt: Date.now(),
        endsAt: Date.now() + 3_600_000, // provisoire — l'hôte est l'autorité du timer
        status: "connecting",
        updatedAt: Date.now(),
      };
      upsertRoom(meta);
      void persistRoom(meta);
      setJoiningId(id);
      await ensureSession(meta);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (joiningId) await nukeRoom(joiningId, {});
    setJoiningId(null);
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 pb-14">
      <header className="flex items-center justify-between pt-6">
        <Link
          href="/"
          className="mono inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.2em] text-faint transition-colors hover:text-mint"
        >
          <ChevronLeft size={14} /> Accueil
        </Link>
        <span className="mono text-[10px] uppercase tracking-[0.24em] text-faint">rejoindre</span>
      </header>

      <AnimatePresence mode="wait">
        {!joiningId ? (
          <motion.section
            key="form"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="mt-10"
          >
            <h1 className="text-[30px] font-bold leading-tight tracking-tight text-ink">
              Rejoindre une <span className="text-iris">salle</span>
            </h1>
            {fromLink ? (
              <p className="mt-3 text-[13px] leading-relaxed text-mint">
                Identité récupérée depuis le lien d'invitation. Il ne reste qu'à choisir votre
                pseudo.
              </p>
            ) : (
              <p className="mt-3 text-[13px] leading-relaxed text-muted">
                Entrez le pseudo et le code de l'inviteur — ou ouvrez directement le lien / QR reçu.
              </p>
            )}

            <div className="glass mt-8 grid gap-5 rounded-2xl p-5">
              <div>
                <SectionLabel>Pseudo de l'inviteur</SectionLabel>
                <div className="input-dark mono mt-2 flex items-center rounded-xl">
                  <User size={15} className="ml-4 shrink-0 text-faint" />
                  <input
                    value={hostPseudo}
                    onChange={(e) => setHostPseudo(e.target.value)}
                    maxLength={32}
                    className="w-full bg-transparent px-3 py-3.5 text-[14px] text-ink placeholder:text-faint focus:outline-none"
                    placeholder="pseudo de la salle"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              </div>

              <div>
                <SectionLabel>Code secret</SectionLabel>
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
                </div>
              </div>

              <div>
                <SectionLabel>Votre pseudo (alias affiché)</SectionLabel>
                <div className="input-dark mono mt-2 flex items-center rounded-xl">
                  <UserRound size={15} className="ml-4 shrink-0 text-faint" />
                  <input
                    value={myPseudo}
                    onChange={(e) => setMyPseudo(e.target.value)}
                    maxLength={32}
                    className="w-full bg-transparent px-3 py-3.5 text-[14px] text-ink placeholder:text-faint focus:outline-none"
                    placeholder="votre alias"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              </div>

              {error && <p className="text-[13px] text-danger">{error}</p>}

              <button
                type="button"
                onClick={submit}
                disabled={busy || !hostPseudo || !code || !myPseudo}
                className="group mono flex items-center justify-center gap-2 rounded-xl bg-iris px-5 py-4 text-[13px] font-bold uppercase tracking-[0.22em] text-void transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
              >
                <ScanSearch size={15} strokeWidth={2.6} />
                {busy ? "Recherche…" : "Chercher et connecter"}
              </button>
            </div>
          </motion.section>
        ) : (
          <motion.section
            key="pending"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="mt-10"
          >
            <div className="glass rounded-2xl p-6 text-center">
              <div className="relative mx-auto h-20 w-20">
                <span className="animate-radar absolute inset-0 rounded-full border border-iris/50" />
                <span className="absolute inset-0 flex items-center justify-center">
                  <StatusDot status={room?.status ?? "connecting"} />
                </span>
              </div>
              <h1 className="mt-5 text-[20px] font-bold text-ink">
                {STATUS_LABEL[room?.status ?? "connecting"]}
              </h1>

              {room?.note === "unknown_or_expired" ? (
                <p className="mt-3 text-[13px] leading-relaxed text-muted">
                  <strong className="text-amber">Salle introuvable ou expirée.</strong> L'invitation
                  a peut-être dépassé 1 heure, ou l'inviteur n'est pas en ligne. Nouvelle tentative
                  automatique en cours…
                </p>
              ) : room?.note === "room_busy" ? (
                <p className="mt-3 text-[13px] leading-relaxed text-muted">
                  <strong className="text-amber">Salle déjà occupée.</strong> Quelqu'un est en train
                  de s'y connecter. Nouvelle tentative automatique…
                </p>
              ) : (
                <p className="mt-3 text-[13px] leading-relaxed text-muted">
                  Recherche dans l'annuaire éphémère, puis établissement du canal pair-à-pair
                  chiffré…
                </p>
              )}

              <div className="mono mt-5 flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.2em] text-faint">
                <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-iris" />
                handshake webrtc · ecdh éphémère
              </div>

              <button
                type="button"
                onClick={cancel}
                className="mono mx-auto mt-6 inline-flex items-center gap-2 rounded-xl border border-line px-5 py-3 text-[11px] font-bold uppercase tracking-[0.2em] text-muted transition-colors hover:border-danger/50 hover:text-danger"
              >
                <X size={13} /> Annuler la recherche
              </button>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </main>
  );
}
