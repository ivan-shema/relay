import express from "express";
import cors from "cors";
import { env } from "./env";
import { errorHandler } from "./lib/http";
import { authRouter } from "./routes/auth";
import { placesRouter } from "./routes/places";
import { tripsRouter } from "./routes/trips";
import { bookingsRouter } from "./routes/bookings";
import { paymentsRouter } from "./routes/payments";
import { trackingRouter } from "./routes/tracking";
import { ratingsRouter } from "./routes/ratings";
import { plannedRouter } from "./routes/planned";
import { driverRouter } from "./routes/driver";
import { operatorRouter } from "./routes/operator";
import { adminRouter } from "./routes/admin";
import { meRouter } from "./routes/me";
import { documentsRouter } from "./routes/documents";
import { ticketsRouter } from "./routes/tickets";

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.webOrigin, credentials: true }));
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ ok: true, service: "relay-api" }));

  app.use("/auth", authRouter);
  app.use("/places", placesRouter);
  app.use("/trips", tripsRouter);
  app.use("/bookings", bookingsRouter);
  app.use("/payments", paymentsRouter);
  app.use("/tracking", trackingRouter);
  app.use("/ratings", ratingsRouter);
  app.use("/planned", plannedRouter);
  app.use("/driver", driverRouter);
  app.use("/operator", operatorRouter);
  app.use("/admin", adminRouter);
  app.use("/me", meRouter);
  app.use("/documents", documentsRouter);
  app.use("/tickets", ticketsRouter);

  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use(errorHandler);

  return app;
}
