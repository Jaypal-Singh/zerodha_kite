// app.js
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import helmet from "helmet";
import compression from "compression";
import { config } from "./config.js";

// Routes
import authRouter from "./Routes/AuthRoute.js";
import instrumentStockNameRoute from "./Routes/instrumentStockNameRoute.js";
import optionChainRoute from "./Routes/optionChainRoute.js";
import chartRoute from "./Routes/ChartRoute.js";
import quotesRoute from "./Routes/quotes.js";
import instrumentsRoute from "./Routes/instruments.js";
import debugRoute from "./Routes/debug.js";
import userWatchlistRoute from "./Routes/UserWatchlistRoute.js";
import orderRoute from "./Routes/orderRoute.js";
import fundRoute from "./Routes/fundRoute.js"
import registrationRoute from "./Routes/registrationRoute.js"
import kiteAuthRoute from "./Routes/kiteAuthRoute.js"

export function createApp() {
  const app = express();

  // ----- CORS SETUP (UPDATED) -----
  // We explicitly define the allowed public and local origins here
  const defaultOrigins = [
    "http://localhost:5173",                   // Local Vite frontend
    "http://127.0.0.1:5173",                   // Local IP
    "https://kite.wolfkrypt.me",  // Render frontend (production)
  ];

  // If you have extra origins in your config file, we add them too
  const configOrigins = (config.origin || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const corsOpts = {
    origin: [...defaultOrigins, ...configOrigins], // Merge lists
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204,
  };

  app.use(cors(corsOpts));
  // -------------------------------

  // Security headers
  app.use(helmet());

  // GZIP compression - reduces payload size by ~70% (improves load time)
  app.use(compression({ threshold: 1024 })); // Only compress responses > 1KB

  app.set("trust proxy", 1); // Essential for Cloudflare Tunnel to pass correct IPs
  app.use(cookieParser());
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // ----- Auth helpers -----
  const REQUIRE_AUTH = process.env.NODE_ENV === "production";
  const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

  function authStrict(req, res, next) {
    if (!REQUIRE_AUTH) return next();
    const bearer = req.headers.authorization || "";
    const m = bearer.match(/^Bearer\s+(.+)$/i);
    const token = m?.[1] || req.cookies?.accessToken;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  // Quotes auth: allow if server has valid bearer/cookie token present
  function authQuotes(req, res, next) {
    if (!REQUIRE_AUTH) return next();
    const bearer = req.headers.authorization || "";
    const m = bearer.match(/^Bearer\s+(.+)$/i);
    const token = m?.[1] || req.cookies?.accessToken;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    return next();
  }

  // ----- Routes -----
  app.use("/api/debug", debugRoute);
  app.use("/api/kite", kiteAuthRoute);  // Kite login/token routes
  app.use("/api/auth", authRouter);  // Auth routes are public (login, logout, etc.)
  app.use("/api", instrumentStockNameRoute);
  app.use("/api", optionChainRoute);
  app.use("/api/chart", chartRoute);
  app.use("/api/instruments", instrumentsRoute);
  app.use("/api/quotes", authQuotes, quotesRoute);
  app.use("/api/watchlist", userWatchlistRoute);
  app.use("/api/orders", orderRoute);
  app.use("/api/funds", fundRoute);
  app.use("/api/registration", registrationRoute); // Public - no auth required

  // Version endpoint for cache busting - INCREMENT VERSION ON EVERY DEPLOYMENT
  const APP_VERSION = '1.8.8';
  app.get("/api/version", (_req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.json({
      version: APP_VERSION,
      serverTime: new Date().toISOString()
    });
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use((req, res) => res.status(404).json({ error: "Not Found" }));
  app.use((err, _req, res, _next) => {
    console.error("API Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  });

  return app;
}
