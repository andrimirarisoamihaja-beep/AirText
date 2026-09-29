// Client HTTP du serveur de signalisation éphémère.
// Le serveur ne fait QUE relayer SDP/ICE dans une mémoire volatile (TTL court).
// Aucun message, aucune image, aucun contenu ne transite par lui.

export class SignalError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export interface PollResult {
  state: "waiting" | "joining" | "answering" | "connected" | "unknown";
  offer?: string;
  answer?: string;
  candidates: string[];
  expiresAt: number;
  peerAlive: boolean;
}

export async function signal<T = Record<string, unknown>>(
  body: Record<string, unknown>,
  signalAbort?: AbortSignal
): Promise<T> {
  const res = await fetch("/api/signal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: signalAbort,
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new SignalError(data.error ?? `http_${res.status}`, res.status);
  }
  return (await res.json()) as T;
}
