// Loads dotenv + validates AUTH_SECRET; must be the first import so env is
// ready before hoisted module imports read process.env
import "./config/env";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { globalLimiter } from "./middlewares/rateLimit.middleware";
import { requestLogger } from "./middlewares/requestLogger.middleware";
import { notFoundHandler, globalErrorHandler } from "./middlewares/globalErrorHandler.middleware";
import { logger } from "./utils/logger";

const app = express();
const PORT = process.env.PORT || 8000;

// Trust proxy for correct IP identification behind load balancers/Render/Heroku
app.set('trust proxy', 1);

// ── Security Middlewares (order matters) ──
app.use(helmet({
  // JSON-only API: lock everything down; no external resources ever load from here
  contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));
app.use(express.json({ limit: '1mb' }));  // Limit body size to prevent DoS
app.use(cookieParser());
app.use(globalLimiter);

// CORS — comma-separated allowlist, e.g. "https://app.gireapp.com,https://staging.gireapp.com"
const ALLOWED_ORIGINS = (process.env.FRONTEND_URL || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser clients (no Origin header) and allowlisted origins
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      logger.security('CORS: origin rejected', { origin });
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// ── Request Logging (Phase 4 — before routes) ──
app.use(requestLogger);

// ── Routes ──

// Basic Health Check Route
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

import authRouter from "./routes/auth.routes";
import courseRouter from "./routes/course.routes";
import dashboardRouter from "./routes/dashboard.routes";
app.use("/api/auth", authRouter);
app.use("/api/courses", courseRouter);
app.use("/api/dashboard", dashboardRouter);

// ── Error Handling (Phase 3 — MUST be after all routes) ──
app.use(notFoundHandler);
app.use(globalErrorHandler);

// ── Start Server ──
app.listen(PORT, () => {
  logger.info('Server started', { port: PORT, env: process.env.NODE_ENV || 'development' });
});
