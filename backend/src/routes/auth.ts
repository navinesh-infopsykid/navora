import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config";
import { prisma } from "../lib/db";
import { parse, parseId } from "../lib/validation";
import { clearSessionCookie, readCookie, requireOwner, SESSION_COOKIE, setSessionCookie } from "../middleware/auth";
import * as auth from "../services/authService";

const router = Router();

// Slows down password guessing: 10 failed attempts per 15 minutes per computer.
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: config.isTest ? 1000 : 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Wait 15 minutes and try again." },
});

const passwordField = z.string().min(1, "Password is required").max(200);
const newUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  email: z.string().trim().max(120).nullish(),
  phone: z.string().trim().max(25).nullish(),
  password: passwordField,
});

// GET /api/auth/status -> is setup needed, and who is logged in?
router.get("/status", async (req, res) => {
  const [settings, setupRequired] = await Promise.all([
    prisma.businessSettings.findUnique({ where: { id: 1 }, select: { businessName: true } }),
    auth.isSetupRequired(),
  ]);
  res.json({
    setupRequired,
    user: req.user ? auth.toPublicUser(req.user) : null,
    businessName: settings?.businessName ?? null, // shown on the login screen
  });
});

// POST /api/auth/setup -> create the owner account (only on a fresh install) and log in
router.post("/setup", loginLimiter, async (req, res) => {
  const user = await auth.setupOwner(parse(newUserSchema, req.body));
  const session = await auth.createSession(user.id, req.get("user-agent"));
  setSessionCookie(res, session.token, session.expiresAt);
  res.status(201).json({ user: auth.toPublicUser(user) });
});

// POST /api/auth/login  { "login": "you@shop.com" or "98765 43210", "password": "..." }
router.post("/login", loginLimiter, async (req, res) => {
  const body = parse(z.object({ login: z.string().trim().min(1, "Enter your email or mobile number").max(120), password: passwordField }), req.body);
  const user = await auth.authenticate(body.login, body.password);
  const session = await auth.createSession(user.id, req.get("user-agent"));
  setSessionCookie(res, session.token, session.expiresAt);
  res.json({ user: auth.toPublicUser(user) });
});

router.post("/logout", async (req, res) => {
  await auth.deleteSession(readCookie(req, SESSION_COOKIE));
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/me", (req, res) => {
  res.json({ user: auth.toPublicUser(req.user!) });
});

// POST /api/auth/change-password { currentPassword, newPassword } -> also logs out your other devices
router.post("/change-password", loginLimiter, async (req, res) => {
  const body = parse(z.object({ currentPassword: passwordField, newPassword: passwordField }), req.body);
  await auth.changePassword(req.user!.id, req.sessionId!, body.currentPassword, body.newPassword);
  res.json({ ok: true });
});

// ----- User management (owner only) -----

router.get("/users", requireOwner, async (_req, res) => {
  res.json(await auth.listUsers());
});

router.post("/users", requireOwner, async (req, res) => {
  const user = await auth.createUser(parse(newUserSchema, req.body));
  res.status(201).json(auth.toPublicUser(user));
});

router.patch("/users/:id/status", requireOwner, async (req, res) => {
  const { isActive } = parse(z.object({ isActive: z.boolean() }), req.body);
  res.json(await auth.setUserActive(req.user!.id, parseId(req.params.id), isActive));
});

router.post("/users/:id/password", requireOwner, async (req, res) => {
  const { password } = parse(z.object({ password: passwordField }), req.body);
  await auth.setUserPassword(parseId(req.params.id), password);
  res.json({ ok: true });
});

export default router;
