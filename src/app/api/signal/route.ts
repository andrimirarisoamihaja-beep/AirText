// =====================================================================
// POST /api/signal — relais de signalisation éphémère (handshake WebRTC)
// Actions : create | join | answer | candidate | poll | connected | close
// Aucun message de chat ne passe ici : uniquement SDP/ICE, en RAM, TTL court.
// =====================================================================

import {
  createRoom,
  deleteRoom,
  getRoom,
  markSeen,
  notify,
  pushCandidate,
  snapshot,
  waitForChange,
  HANDSHAKE_TTL_MS,
  TOMBSTONE_MS,
} from "@/server/signaling";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ID_RE = /^[0-9a-f]{16,64}$/;
const MAX_SDP = 32_000;
const MAX_CAND = 2_000;

type Role = "host" | "guest";

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function validId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

function validRole(role: unknown): role is Role {
  return role === "host" || role === "guest";
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  const action = typeof body.action === "string" ? body.action : "";
  const id = body.id;

  if (action !== "health" && !validId(id)) return json({ error: "bad_id" }, 400);
  const roomId = id as string;

  switch (action) {
    case "health":
      return json({ ok: true });

    // ---- L'hôte déclare la salle (TTL 1 h tant que personne ne rejoint) ----
    case "create": {
      const { room, fresh } = createRoom(roomId);
      markSeen(room, "host");
      return json({ ok: true, fresh, state: room.state, expiresAt: room.expiresAt });
    }

    // ---- Le guest rejoint en déposant son offre SDP ----
    case "join": {
      const offer = typeof body.offer === "string" ? body.offer : "";
      if (!offer || offer.length > MAX_SDP) return json({ error: "bad_offer" }, 400);
      const room = getRoom(roomId);
      if (!room) return json({ error: "unknown_or_expired" }, 404);
      const stale = Date.now() - room.stateSince > 90_000;
      if ((room.state === "joining" || room.state === "answering") && !stale) {
        return json({ error: "room_busy" }, 409);
      }
      if (room.state === "connected" && !stale) {
        return json({ error: "room_inactive" }, 409);
      }
      room.offer = offer;
      room.answer = null;
      room.hostCands = [];
      room.guestCands = [];
      room.hostRead = 0;
      room.guestRead = 0;
      room.acks = new Set();
      room.state = "joining";
      room.stateSince = Date.now();
      room.expiresAt = Date.now() + HANDSHAKE_TTL_MS;
      markSeen(room, "guest");
      notify(room);
      return json({ ok: true, expiresAt: room.expiresAt });
    }

    // ---- L'hôte dépose sa réponse SDP ----
    case "answer": {
      const answer = typeof body.answer === "string" ? body.answer : "";
      if (!answer || answer.length > MAX_SDP) return json({ error: "bad_answer" }, 400);
      const room = getRoom(roomId);
      if (!room) return json({ error: "unknown_or_expired" }, 404);
      if (room.state !== "joining" && room.state !== "answering") {
        return json({ error: "not_joining" }, 409);
      }
      room.answer = answer;
      room.state = "answering";
      room.stateSince = Date.now();
      markSeen(room, "host");
      notify(room);
      return json({ ok: true });
    }

    // ---- Relai d'un candidat ICE ----
    case "candidate": {
      const role = body.role;
      const candidate = typeof body.candidate === "string" ? body.candidate : "";
      if (!validRole(role)) return json({ error: "bad_role" }, 400);
      if (candidate.length > MAX_CAND) return json({ error: "bad_candidate" }, 400);
      const room = getRoom(roomId);
      if (!room) return json({ error: "unknown_or_expired" }, 404);
      markSeen(room, role);
      const ok = pushCandidate(room, role, candidate);
      return json({ ok });
    }

    // ---- Long-poll d'état (jusqu'à 20 s) ----
    case "poll": {
      const role = body.role;
      if (!validRole(role)) return json({ error: "bad_role" }, 400);
      const room = getRoom(roomId);
      if (!room) return json({ error: "unknown_or_expired" }, 404);
      markSeen(room, role);
      try {
        await Promise.race([
          waitForChange(room, role, 20_000),
          new Promise<void>((resolve) => {
            req.signal.addEventListener("abort", () => resolve(), { once: true });
          }),
        ]);
      } catch {
        /* annulé : on répond quand même l'état courant */
      }
      const current = getRoom(roomId);
      if (!current) return json({ error: "unknown_or_expired" }, 404);
      return json(snapshot(current, role));
    }

    // ---- Accusé de connexion : purge progressive après double ACK ----
    case "connected": {
      const role = body.role;
      if (!validRole(role)) return json({ error: "bad_role" }, 400);
      const room = getRoom(roomId);
      if (!room) return json({ error: "unknown_or_expired" }, 404);
      markSeen(room, role);
      room.acks.add(role);
      if (room.state !== "connected") {
        room.state = "connected";
        room.stateSince = Date.now();
        room.expiresAt = Date.now() + TOMBSTONE_MS * 3;
        notify(room);
      }
      if (room.acks.has("host") && room.acks.has("guest")) {
        room.offer = null;
        room.answer = null;
        room.hostCands = [];
        room.guestCands = [];
        room.expiresAt = Date.now() + TOMBSTONE_MS;
      }
      return json({ ok: true });
    }

    // ---- Réinitialisation (l'hôte peut accepter une nouvelle offre) ----
    case "reset": {
      const room = getRoom(roomId);
      if (!room) return json({ ok: true }); // idempotent
      room.offer = null;
      room.answer = null;
      room.hostCands = [];
      room.guestCands = [];
      room.hostRead = 0;
      room.guestRead = 0;
      room.acks = new Set();
      room.state = "waiting";
      room.stateSince = Date.now();
      room.expiresAt = Date.now() + HANDSHAKE_TTL_MS;
      notify(room);
      return json({ ok: true });
    }

    // ---- Fermeture explicite (abandon de la salle d'attente) ----
    case "close": {
      deleteRoom(roomId);
      return json({ ok: true });
    }

    default:
      return json({ error: "bad_action" }, 400);
  }
}
