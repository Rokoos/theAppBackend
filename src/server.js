import express from "express";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import session from "express-session";
import passport from "passport";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import cors from "cors";

import { configurePassport } from "./steam/passport.js";
import { cspMiddleware } from "./security/csp.js";
import { powMiddleware } from "./security/pow.js";
import { authRateLimiter, decryptRateLimiter } from "./security/rateLimit.js";
import authRouter from "./steam/routes.js";
import cryptoRouter from "./crypto/routes.js";

// Resolve directory for explicit .env loading so we can support
// a single .env at the project root as well as backend/.env.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load backend/.env first (optional)...
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });
// ...then override with project root .env if present.
dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

const app = express();

const {
  SESSION_SECRET,
  FRONTEND_URL,
  NODE_ENV = "development",
} = process.env;

if (!SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set in environment");
}

app.set("trust proxy", 1);

// CORS at the very top for Railway; FRONTEND_URL = your Netlify URL (no trailing slash).
const corsOptions = {
  origin: process.env.FRONTEND_URL || process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

const sessionCookieName =
  NODE_ENV === "development" ? "steamapp.sid" : "__Host-steamapp.sid";

// Session as early as possible so passport.session() never sees req.session undefined (e.g. Railway).
app.use(
  session({
    name: sessionCookieName,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: NODE_ENV !== "development",
      sameSite: NODE_ENV === "development" ? "strict" : "none",
      path: "/",
      // Firefox: if /api/auth/me fails after login, user may need to add this site to ETP exceptions.
    },
  }),
);

// Ensure req.session exists and has regenerate/save so passport.session() never throws (e.g. on Railway).
app.use((req, res, next) => {
  if (!req.session) {
    req.session = {};
  }
  if (typeof req.session.regenerate !== "function") {
    req.session.regenerate = (cb) => (cb ? cb() : undefined);
  }
  if (typeof req.session.save !== "function") {
    req.session.save = (cb) => (cb ? cb() : undefined);
  }
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: false,
  }),
);

app.use(cspMiddleware);

app.use(compression());
app.use(express.json());
app.use(morgan(NODE_ENV === "development" ? "dev" : "combined"));

configurePassport();
app.use(passport.initialize());
app.use(passport.session());

// Railway health check (plain OK).
app.get("/health", (req, res) => res.status(200).send("OK"));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRateLimiter, powMiddleware("auth"), authRouter);
app.use(
  "/api/crypto",
  decryptRateLimiter,
  powMiddleware("crypto"),
  cryptoRouter,
);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal Server Error" });
});

const server = app.listen(process.env.PORT || 4000, "0.0.0.0", () => {
  console.log("Server running on port", process.env.PORT);
});
