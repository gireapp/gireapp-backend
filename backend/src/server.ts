import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import { globalLimiter } from "./middlewares/rateLimit.middleware";
import { requestLogger } from "./middlewares/requestLogger.middleware";
import { notFoundHandler, globalErrorHandler } from "./middlewares/globalErrorHandler.middleware";
import { logger } from "./utils/logger";

// .env.local wins over .env; Prisma CLI (migrate/db push) only reads .env
dotenv.config({ path: [".env.local", ".env"] });

const app = express();
const PORT = process.env.PORT || 8000;

// Trust proxy for correct IP identification behind load balancers/Render/Heroku
app.set('trust proxy', 1);

// ── Security Middlewares (order matters) ──
app.use(helmet());
app.use(express.json({ limit: '1mb' }));  // Limit body size to prevent DoS
app.use(cookieParser());
app.use(globalLimiter);

// CORS configuration - only allow requests from frontend
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
app.use(cors({
  origin: frontendUrl,
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
