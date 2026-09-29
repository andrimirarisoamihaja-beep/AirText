import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { LogoMark, Wordmark, SectionLabel } from "@/components/ui";

const sections: { title: string; points: string[] }[] = [
  {
    title: "Architecture zéro connaissance",
    points: [
      "Aucun message, aucune image ne transite par un serveur. Tout circule sur un canal WebRTC DataChannel direct entre les deux appareils.",
      "Le serveur de signalisation est un annuaire éphémère en mémoire vive : il relaie uniquement les paquets SDP/ICE du handshake et ne connaît qu'un hash SHA-256 du couple pseudo+code — jamais les valeurs elles-mêmes.",
      "Aucune base de données de messages ou de contacts. Aucun log de contenu. La salle d'attente expire après 1 heure et est purgée quelques minutes après connexion.",
      "Aucun compte, aucun email, aucun numéro, aucun cookie, aucun tracker, aucune analytics.",
    ],
  },
  {
    title: "Protocole cryptographique",
    points: [
      "Identité : roomId = SHA-256(pseudo + code). Clé de base = HKDF-SHA256(code, sel = SHA-256(pseudo)) → AES-GCM 256.",
      "À chaque connexion, un échange ECDH P-256 éphémère (chiffré par la clé de base) dérive une clé de session unique : confidentialité persistante (PFS).",
      "Chaque message est chiffré AES-GCM avec un IV aléatoire de 96 bits. Les images sont découpées en fragments de 16 Ko chiffrés, avec vérification d'intégrité SHA-256 à réception.",
      "Le stockage local (IndexedDB) ne contient que les métadonnées de sessions vivantes, chiffrées par une clé d'appareil générée localement. Les messages ne sont jamais persistés.",
      "Comparez l'empreinte visuelle (barres colorées) de la salle avec votre interlocuteur pour vérifier qu'il n'y a pas d'intermédiaire.",
    ],
  },
  {
    title: "Règles de destruction",
    points: [
      "Le timer de conversation est fixé par l'inviteur. Il est impossible de le réduire — la règle est vérifiée des deux côtés.",
      "Prolongation uniquement par accord mutuel : demande → validation explicite de l'autre pair.",
      "Timer écoulé, bouton Nuke, ou fin explicite : messages, images, clés et salle sont détruits immédiatement des deux côtés, sans possibilité de récupération.",
      "Recharger la page conserve la session (métadonnées chiffrées) mais pas l'historique des messages — par conception.",
    ],
  },
  {
    title: "Limites connues",
    points: [
      "WebRTC pair-à-pair peut exposer votre IP publique à l'autre participant. Utilisez un VPN ou Tor pour la masquer.",
      "Certains réseaux d'entreprise ou opérateurs bloquent le P2P direct ; un serveur STUN public est utilisé pour la traversée NAT (aucun contenu n'y transite).",
      "Images limitées à 5 Mo après compression (redimensionnement automatique à 1600 px).",
      "Multi-conversations simultanées dans un même onglet. Plusieurs onglets sur la même conversation peuvent entrer en conflit de session.",
      "Une salle d'attente expire après 1 heure sans visiteur : l'inviteur doit alors en recréer une.",
      "Anonymat total = modération impossible. La responsabilité des échanges appartient aux utilisateurs.",
    ],
  },
  {
    title: "Déploiement",
    points: [
      "Application Next.js autonome : la signalisation tient dans une route API en mémoire (processus Node unique, rien à provisionner).",
      "Déployable gratuitement sur tout hébergeur Node (Vercel, Railway, Render…) ou en auto-hébergement : `npm run build && npm start`.",
      "HTTPS obligatoire en production : Web Crypto API et WebRTC exigent un contexte sécurisé.",
      "STUN configurable via NEXT_PUBLIC_STUN_URLS (urls séparées par des virgules).",
    ],
  },
];

export default function APropos() {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-xl px-5 pb-16">
      <header className="flex items-center justify-between pt-6">
        <Link href="/" className="flex items-center gap-3">
          <LogoMark />
          <Wordmark />
        </Link>
        <Link
          href="/"
          className="mono inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.2em] text-faint transition-colors hover:text-mint"
        >
          <ChevronLeft size={14} /> Retour
        </Link>
      </header>

      <h1 className="mt-12 text-[34px] font-bold leading-tight tracking-tight text-ink">
        Protocole <span className="text-mint text-glow-mint">&</span> transparence
      </h1>
      <p className="mt-4 text-[14px] leading-relaxed text-muted">
        Tout ce que Koragna fait — et ne fait jamais — avec vos données. Spoiler : il n'y en a
        presque pas.
      </p>

      <div className="mt-10 grid gap-8">
        {sections.map((s) => (
          <section key={s.title}>
            <SectionLabel>{s.title}</SectionLabel>
            <div className="glass mt-3 rounded-2xl p-5">
              <ul className="grid gap-3">
                {s.points.map((p, i) => (
                  <li key={i} className="flex gap-3 text-[13px] leading-relaxed text-muted">
                    <span className="mono mt-0.5 shrink-0 text-[10px] text-mint/70">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <p>{p}</p>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ))}
      </div>

      <p className="mono mt-12 text-center text-[10px] uppercase tracking-[0.24em] text-faint/70">
        fin du document — rien d'autre n'est collecté
      </p>
    </main>
  );
}
