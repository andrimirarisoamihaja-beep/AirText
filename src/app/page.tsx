"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, EyeOff, Plus, Radio, ScanLine, ShieldAlert, Timer } from "lucide-react";
import { useApp, type RoomMeta } from "@/lib/store";
import { LogoMark, Wordmark, SectionLabel, Fingerprint, StatusDot, STATUS_LABEL } from "@/components/ui";
import { CountdownRing } from "@/components/CountdownRing";
import { formatRemaining, formatShort } from "@/lib/time";

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.1 } },
};
const item = {
  hidden: { opacity: 0, y: 22 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] as const } },
};

function RoomCard({ room }: { room: RoomMeta }) {
  const now = useApp((s) => s.now);
  const unread = useApp((s) => s.unread[room.id] ?? 0);
  const remaining = Math.max(0, room.endsAt - now);
  const total = Math.max(1, room.endsAt - room.createdAt);
  const fraction = remaining / total;
  const color =
    remaining < 2 * 60_000 ? "var(--color-danger)" : remaining < 10 * 60_000 ? "var(--color-amber)" : "var(--color-mint)";

  return (
    <Link href={`/chat/${room.id}`} className="group block">
      <div className="glass relative flex items-center gap-4 overflow-hidden rounded-2xl p-4 transition-all duration-300 hover:border-mint/40 hover:glow-mint">
        <CountdownRing fraction={fraction} size={46} color={color}>
          <span className="mono text-[9px] tabular" style={{ color }}>
            {remaining > 0 ? formatShort(remaining).split(" ")[0] : "—"}
          </span>
        </CountdownRing>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Fingerprint roomId={room.id} size="sm" />
            <p className="truncate text-[15px] font-medium text-ink">
              {room.peerName ?? (room.role === "host" ? "En attente du pair…" : room.roomPseudo)}
            </p>
          </div>
          <div className="mono mt-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-faint">
            <StatusDot status={room.status} />
            <span>{STATUS_LABEL[room.status]}</span>
            <span aria-hidden>·</span>
            <span className="tabular">{formatRemaining(remaining)}</span>
          </div>
        </div>
        {unread > 0 && (
          <span className="mono flex h-6 min-w-6 items-center justify-center rounded-full bg-mint px-1.5 text-[11px] font-bold text-void">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
        <ArrowRight size={16} className="shrink-0 text-faint transition-transform duration-300 group-hover:translate-x-1 group-hover:text-mint" />
      </div>
    </Link>
  );
}

export default function Home() {
  const hydrated = useApp((s) => s.hydrated);
  const rooms = useApp((s) => s.rooms);
  const list = Object.values(rooms).sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 pb-14">
      <header className="flex items-center justify-between pt-6">
        <div className="flex items-center gap-3">
          <LogoMark />
          <Wordmark />
        </div>
        <div className="mono flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-faint">
          <Radio size={12} className="text-mint" />
          <span className="hidden sm:inline">p2p · e2e · zéro compte</span>
          <span className="sm:hidden">e2e</span>
        </div>
      </header>

      <motion.section variants={container} initial="hidden" animate="show" className="mt-14">
        <motion.h1
          variants={item}
          className="text-[42px] font-bold leading-[1.04] tracking-tight text-ink sm:text-[54px]"
        >
          Un lien.
          <br />
          Deux inconnus.
          <br />
          <span className="animate-flicker bg-gradient-to-r from-mint via-mint to-iris bg-clip-text text-transparent text-glow-mint">
            Zéro trace.
          </span>
        </motion.h1>
        <motion.p variants={item} className="mt-6 max-w-md text-[15px] leading-relaxed text-muted">
          Koragna est une messagerie <strong className="text-ink">éphémère</strong> et{" "}
          <strong className="text-ink">chiffrée de bout en bout</strong>. Pas de compte, pas
          d'inscription : un pseudo, un code, et vos messages ne transitent{" "}
          <strong className="text-ink">que entre vos deux appareils</strong>.
        </motion.p>
      </motion.section>

      <motion.section variants={container} initial="hidden" animate="show" className="mt-10 grid gap-3">
        <motion.div variants={item}>
          <Link
            href="/create"
            className="group glass glow-mint relative flex items-center gap-4 overflow-hidden rounded-2xl p-5 transition-transform duration-300 active:scale-[0.985]"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-mint/12 text-mint">
              <Plus size={20} strokeWidth={2.4} />
            </span>
            <span className="flex-1">
              <span className="block text-[17px] font-semibold text-ink">Créer une discussion</span>
              <span className="mono mt-0.5 block text-[10px] uppercase tracking-[0.2em] text-faint">
                pseudo + code + timer → lien / QR
              </span>
            </span>
            <ArrowRight size={18} className="text-mint transition-transform duration-300 group-hover:translate-x-1.5" />
          </Link>
        </motion.div>
        <motion.div variants={item}>
          <Link
            href="/join"
            className="group glass relative flex items-center gap-4 overflow-hidden rounded-2xl p-5 transition-all duration-300 hover:border-iris/40 active:scale-[0.985]"
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-iris/12 text-iris">
              <ScanLine size={20} strokeWidth={2.2} />
            </span>
            <span className="flex-1">
              <span className="block text-[17px] font-semibold text-ink">Rejoindre une discussion</span>
              <span className="mono mt-0.5 block text-[10px] uppercase tracking-[0.2em] text-faint">
                pseudo + code, lien ou QR reçu
              </span>
            </span>
            <ArrowRight size={18} className="text-faint transition-transform duration-300 group-hover:translate-x-1.5 group-hover:text-iris" />
          </Link>
        </motion.div>
      </motion.section>

      {hydrated && list.length > 0 && (
        <motion.section variants={item} initial="hidden" animate="show" className="mt-11">
          <div className="mb-3 flex items-center justify-between">
            <SectionLabel>Conversations actives ({list.length})</SectionLabel>
            <span className="mono text-[10px] text-faint">multi-sessions simultanées</span>
          </div>
          <div className="grid gap-2.5">
            {list.map((room) => (
              <RoomCard key={room.id} room={room} />
            ))}
          </div>
        </motion.section>
      )}

      <motion.section
        variants={item}
        initial="hidden"
        animate="show"
        transition={{ delay: 0.4 }}
        className="mt-12 grid gap-2.5"
      >
        <SectionLabel>Avertissements</SectionLabel>
        <div className="glass rounded-2xl p-4">
          {[
            {
              icon: <ShieldAlert size={15} className="mt-0.5 shrink-0 text-amber" />,
              text: "Le pair-à-pair WebRTC peut révéler votre adresse IP à votre interlocuteur. Utilisez un VPN ou Tor pour la masquer.",
            },
            {
              icon: <EyeOff size={15} className="mt-0.5 shrink-0 text-iris" />,
              text: "Anonymat total = aucune modération possible. Vous êtes seul responsable de vos échanges.",
            },
            {
              icon: <Timer size={15} className="mt-0.5 shrink-0 text-mint" />,
              text: "Timer écoulé, Nuke ou fin explicite : messages et images sont détruits immédiatement, des deux côtés.",
            },
          ].map((n, i) => (
            <div key={i} className={`flex gap-3 py-2.5 text-[13px] leading-relaxed text-muted ${i > 0 ? "hairline-t" : ""}`}>
              {n.icon}
              <p>{n.text}</p>
            </div>
          ))}
        </div>
        <Link
          href="/a-propos"
          className="mono mt-1 inline-flex items-center gap-2 self-start text-[11px] uppercase tracking-[0.22em] text-faint transition-colors hover:text-mint"
        >
          Comprendre le protocole <ArrowRight size={12} />
        </Link>
      </motion.section>

      <footer className="mono mt-14 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-faint/70">
        <span>Koragna</span>
        <span>aucun cookie · aucun tracker · aucun compte</span>
      </footer>
    </main>
  );
}
