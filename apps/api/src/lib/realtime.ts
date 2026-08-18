import type { Response } from "express";

// Minimal per-user Server-Sent Events hub. Money settlements (Paypack webhook
// or a status poll) publish here so every open tab updates instantly; clients
// keep a slow poll as backup for when the stream or webhook doesn't get
// through. In-process only — fine for a single API instance.

const clients = new Map<string, Set<Response>>();

export function subscribe(userId: string, res: Response): () => void {
  let set = clients.get(userId);
  if (!set) {
    set = new Set();
    clients.set(userId, set);
  }
  set.add(res);
  return () => {
    set!.delete(res);
    if (set!.size === 0) clients.delete(userId);
  };
}

export function publish(userId: string, event: string, data: unknown): void {
  const set = clients.get(userId);
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      set.delete(res); // dead socket — drop it
    }
  }
}
