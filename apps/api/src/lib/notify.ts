import { prisma } from "../prisma";
import { publish } from "./realtime";
import { sendMail } from "./mailer";

// Single entry point for user notifications: persists the row (source of
// truth for the bell), pushes it over the SSE stream so open tabs update
// instantly, and mirrors it to the user's email. Call AFTER the business
// transaction commits — a notification must never fire for a rolled-back
// action, and losing one to a crash after commit is acceptable.
export async function notify(userId: string, title: string, message: string): Promise<void> {
  const n = await prisma.notification.create({ data: { userId, title, message } });

  publish(userId, "notification", {
    id: n.id,
    title: n.title,
    body: n.message,
    time: n.createdAt.toISOString(),
  });

  // Fire-and-forget: a slow or failing mail server must not block (or fail)
  // the API response — the in-app notification is already persisted.
  void (async () => {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    await sendMail(user.email, `Relay — ${title}`, message);
  })().catch((e) => console.error(`[mail] failed to send "${title}" to user ${userId}:`, e));
}
