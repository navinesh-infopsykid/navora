/**
 * Accounts and login sessions.
 *
 * - Users log in with their email OR phone number, plus a password.
 * - The first account (created on the setup screen) is the owner. After that,
 *   only the owner can add users. There is no public sign-up.
 * - A login creates a random session token. The browser keeps it in an
 *   httpOnly cookie (JavaScript cannot read it); the database keeps only its
 *   SHA-256 hash, so a leaked database cannot be used to log in.
 */
import crypto from "node:crypto";
import type { User } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../lib/db";
import { badRequest, conflict, HttpError, notFound } from "../lib/errors";
import { getDummyHash, hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from "../lib/password";
import { normalizePhone } from "../lib/phone";

export type PublicUser = Pick<User, "id" | "name" | "email" | "phone" | "isOwner" | "isActive" | "lastLoginAt" | "createdAt">;

export function toPublicUser(user: User): PublicUser {
  const { id, name, email, phone, isOwner, isActive, lastLoginAt, createdAt } = user;
  return { id, name, email, phone, isOwner, isActive, lastLoginAt, createdAt };
}

export const unauthorized = (message = "Please log in to continue") => new HttpError(401, message);

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

function checkPasswordStrength(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) throw badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  if (password.length > 200) throw badRequest("Password is too long");
}

/** Normalise email/phone input. Returns which kind of login it is. */
export function parseLoginId(input: string): { email: string } | { phone: string } {
  const value = input.trim();
  if (value.includes("@")) {
    const email = value.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("Enter a valid email address");
    return { email };
  }
  const phone = normalizePhone(value, config.defaultCountryCode);
  if (!phone) throw badRequest("Enter your email or mobile number");
  return { phone };
}

interface NewUserInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  password: string;
}

async function buildUserData(input: NewUserInput) {
  let email: string | null = null;
  if (input.email?.trim()) {
    const parsed = parseLoginId(input.email);
    if (!("email" in parsed)) throw badRequest("Enter a valid email address");
    email = parsed.email;
  }
  const phone = input.phone?.trim() ? normalizePhone(input.phone, config.defaultCountryCode) : null;
  if (!email && !phone) throw badRequest("Enter an email or a mobile number for logging in");
  checkPasswordStrength(input.password);

  const clash = await prisma.user.findFirst({
    where: { OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] },
  });
  if (clash) throw conflict(clash.email === email && email ? "An account with this email already exists" : "An account with this mobile number already exists");

  return { name: input.name.trim(), email, phone, passwordHash: await hashPassword(input.password) };
}

/** Is this a fresh install that still needs its owner account? */
export async function isSetupRequired() {
  return (await prisma.user.count()) === 0;
}

/** Creates the owner account. Only works while there are no users at all. */
export async function setupOwner(input: NewUserInput) {
  const data = await buildUserData(input);
  return prisma.$transaction(async (tx) => {
    // Lock so two people can't both become owner at the same moment.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(424242)`;
    if ((await tx.user.count()) > 0) throw conflict("Setup is already complete. Please log in.");
    return tx.user.create({ data: { ...data, isOwner: true } });
  });
}

export async function createUser(input: NewUserInput) {
  return prisma.user.create({ data: await buildUserData(input) });
}

/** Checks email/phone + password. Same error for "no such user" and "wrong password". */
export async function authenticate(loginId: string, password: string) {
  const id = parseLoginId(loginId);
  const user = await prisma.user.findUnique({ where: "email" in id ? { email: id.email } : { phone: id.phone } });
  const ok = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !ok) throw unauthorized("Incorrect email/phone or password");
  if (!user.isActive) throw new HttpError(403, "This account has been deactivated. Ask the owner to reactivate it.");
  return user;
}

export async function createSession(userId: number, userAgent?: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + config.auth.sessionDays * 24 * 60 * 60 * 1000);
  await prisma.$transaction([
    prisma.session.create({ data: { userId, tokenHash: hashToken(token), userAgent: userAgent?.slice(0, 200), expiresAt } }),
    prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } }),
    // Housekeeping: remove this user's expired sessions.
    prisma.session.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } }),
  ]);
  return { token, expiresAt };
}

// ---------------------------------------------------------------------------
// Session cache
//
// Every API request needs "who is logged in?". Asking the database each time costs
// two network round trips, so the answer is remembered in memory for 60 seconds.
// Logout, password changes and deactivation clear it immediately on this server.
// (If you ever run several copies of the server, other copies notice within 60 s.)
// ---------------------------------------------------------------------------

const SESSION_CACHE_MS = 60_000;
interface CachedSession {
  user: User;
  sessionId: number;
  expiresAt: Date;
  cachedAt: number;
}
const sessionCache = new Map<string, CachedSession>();

/** Forget cached sessions for one user (or everyone). */
export function clearSessionCache(userId?: number) {
  if (userId === undefined) return sessionCache.clear();
  for (const [key, value] of sessionCache) if (value.user.id === userId) sessionCache.delete(key);
}

/** Returns the logged-in user for a cookie token, or null if the session is missing, expired or the user is deactivated. */
export async function getSessionUser(token: string | undefined) {
  if (!token) return null;
  const tokenHash = hashToken(token);

  const cached = sessionCache.get(tokenHash);
  if (cached && Date.now() - cached.cachedAt < SESSION_CACHE_MS && cached.expiresAt > new Date()) {
    return { user: cached.user, sessionId: cached.sessionId };
  }
  sessionCache.delete(tokenHash);

  const session = await prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt < new Date() || !session.user.isActive) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  // Record activity at most every 10 minutes, without making the request wait for it.
  if (Date.now() - session.lastUsedAt.getTime() > 10 * 60 * 1000) {
    void prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }
  if (sessionCache.size > 1000) sessionCache.clear(); // simple size cap
  sessionCache.set(tokenHash, { user: session.user, sessionId: session.id, expiresAt: session.expiresAt, cachedAt: Date.now() });
  return { user: session.user, sessionId: session.id };
}

export async function deleteSession(token: string | undefined) {
  if (!token) return;
  sessionCache.delete(hashToken(token));
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

/** Change your own password. Logs out your other devices. */
export async function changePassword(userId: number, currentSessionId: number, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw badRequest("Current password is incorrect");
  checkPasswordStrength(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } }),
    prisma.session.deleteMany({ where: { userId, id: { not: currentSessionId } } }),
  ]);
  clearSessionCache(userId);
}

/** Owner sets a new password for someone (e.g. staff forgot it). Logs that user out everywhere. */
export async function setUserPassword(userId: number, newPassword: string) {
  checkPasswordStrength(newPassword);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound("User not found");
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
  clearSessionCache(userId);
}

export async function listUsers() {
  const users = await prisma.user.findMany({ orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }] });
  return users.map(toPublicUser);
}

/** Owner turns a staff account on or off. Turning off logs them out immediately. */
export async function setUserActive(actingUserId: number, userId: number, isActive: boolean) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound("User not found");
  if (user.id === actingUserId) throw badRequest("You cannot deactivate your own account");
  if (user.isOwner) throw badRequest("The owner account cannot be deactivated");
  const [updated] = await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { isActive } }),
    ...(isActive ? [] : [prisma.session.deleteMany({ where: { userId } })]),
  ]);
  clearSessionCache(userId);
  return toPublicUser(updated);
}
