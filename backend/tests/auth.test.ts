import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { hashPassword, verifyPassword } from "../src/lib/password";
import { clearSessionCache } from "../src/services/authService";
import { hasTestDb, loggedInAgent, makeUser, prisma, resetDatabase, TEST_PASSWORD } from "./helpers";

describe("password hashing", () => {
  it("verifies the right password and rejects others; never stores the plain text", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).not.toContain("correct horse battery");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("Correct horse battery", hash)).toBe(false);
    expect(await hashPassword("same")).not.toBe(await hashPassword("same")); // random salt
  });
});

describe.skipIf(!hasTestDb)("authentication (database)", () => {
  beforeEach(resetDatabase);

  it("blocks the API without a login, but keeps health and status public", async () => {
    const app = createApp();
    expect((await request(app).get("/api/products")).status).toBe(401);
    expect((await request(app).get("/api/dashboard")).status).toBe(401);
    expect((await request(app).post("/api/invoices").send({})).status).toBe(401);
    expect((await request(app).get("/api/invoices/1/pdf")).status).toBe(401);
    expect((await request(app).get("/api/health")).status).toBe(200);
    const status = await request(app).get("/api/auth/status");
    expect(status.body).toEqual({ setupRequired: true, user: null, businessName: null });
  });

  it("first-run setup creates the owner once, logs them in, then closes", async () => {
    const agent = request.agent(createApp());
    const setup = await agent.post("/api/auth/setup").send({ name: "Navinesh", email: "Owner@Kriva.in", phone: "82705 70052", password: "strongpass1" });
    expect(setup.status).toBe(201);
    expect(setup.body.user).toMatchObject({ name: "Navinesh", email: "owner@kriva.in", phone: "918270570052", isOwner: true });
    expect(setup.body.user.passwordHash).toBeUndefined();
    expect(setup.headers["set-cookie"][0]).toMatch(/HttpOnly/i);
    expect((await agent.get("/api/products")).status).toBe(200);

    const again = await request(createApp()).post("/api/auth/setup").send({ name: "Intruder", email: "x@y.com", password: "strongpass1" });
    expect(again.status).toBe(409);
    expect(await prisma.user.count()).toBe(1);
  });

  it("validates setup input", async () => {
    const app = createApp();
    expect((await request(app).post("/api/auth/setup").send({ name: "A", password: "strongpass1" })).status).toBe(400); // no email/phone
    expect((await request(app).post("/api/auth/setup").send({ name: "A", email: "a@b.co", password: "short" })).status).toBe(400);
    expect((await request(app).post("/api/auth/setup").send({ name: "A", email: "not-an-email", password: "strongpass1" })).status).toBe(400);
  });

  it("logs in with email OR phone number, and rejects wrong passwords with the same message", async () => {
    await makeUser({ email: "owner@kriva.in", phone: "918270570052" });
    const app = createApp();

    const byEmail = await request(app).post("/api/auth/login").send({ login: "OWNER@kriva.in", password: TEST_PASSWORD });
    expect(byEmail.status).toBe(200);
    const byPhone = await request(app).post("/api/auth/login").send({ login: "82705 70052", password: TEST_PASSWORD });
    expect(byPhone.status).toBe(200);

    const wrong = await request(app).post("/api/auth/login").send({ login: "owner@kriva.in", password: "nope-nope" });
    const unknown = await request(app).post("/api/auth/login").send({ login: "who@kriva.in", password: "nope-nope" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toBe(unknown.body.error);
  });

  it("logout ends the session", async () => {
    const agent = await loggedInAgent();
    expect((await agent.get("/api/auth/me")).status).toBe(200);
    expect((await agent.post("/api/auth/logout")).status).toBe(200);
    expect((await agent.get("/api/auth/me")).status).toBe(401);
    expect(await prisma.session.count()).toBe(0);
  });

  it("expired sessions are rejected (once the 60-second session cache refreshes)", async () => {
    const agent = await loggedInAgent();
    expect((await agent.get("/api/products")).status).toBe(200); // session now cached
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    clearSessionCache(); // stands in for the cache's 60 seconds passing
    expect((await agent.get("/api/products")).status).toBe(401);
  });

  it("change password: needs the current one, keeps this device, logs out others", async () => {
    const phone = await loggedInAgent();
    const laptop = await loggedInAgent();
    expect((await phone.get("/api/products")).status).toBe(200); // phone's session is cached

    const bad = await laptop.post("/api/auth/change-password").send({ currentPassword: "wrong-one", newPassword: "new-password-1" });
    expect(bad.status).toBe(400);

    const ok = await laptop.post("/api/auth/change-password").send({ currentPassword: TEST_PASSWORD, newPassword: "new-password-1" });
    expect(ok.status).toBe(200);
    expect((await laptop.get("/api/products")).status).toBe(200);
    expect((await phone.get("/api/products")).status).toBe(401);

    const app = createApp();
    expect((await request(app).post("/api/auth/login").send({ login: "owner@shop.test", password: TEST_PASSWORD })).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ login: "owner@shop.test", password: "new-password-1" })).status).toBe(200);
  });

  it("only the owner manages users; deactivating a user logs them out immediately", async () => {
    const owner = await loggedInAgent();
    const created = await owner.post("/api/auth/users").send({ name: "Counter Staff", phone: "9000000001", password: "staffpass1" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Counter Staff", phone: "919000000001", isOwner: false });

    const dup = await owner.post("/api/auth/users").send({ name: "Dup", phone: "+91 90000 00001", password: "staffpass1" });
    expect(dup.status).toBe(409);

    const staff = request.agent(createApp());
    expect((await staff.post("/api/auth/login").send({ login: "9000000001", password: "staffpass1" })).status).toBe(200);
    expect((await staff.get("/api/products")).status).toBe(200);
    expect((await staff.get("/api/auth/users")).status).toBe(403);
    expect((await staff.post("/api/auth/users").send({ name: "X", email: "x@y.co", password: "xxxxxxxx" })).status).toBe(403);

    const off = await owner.patch(`/api/auth/users/${created.body.id}/status`).send({ isActive: false });
    expect(off.status).toBe(200);
    expect((await staff.get("/api/products")).status).toBe(401);
    const blocked = await request(createApp()).post("/api/auth/login").send({ login: "9000000001", password: "staffpass1" });
    expect(blocked.status).toBe(403);

    const me = (await owner.get("/api/auth/me")).body.user;
    expect((await owner.patch(`/api/auth/users/${me.id}/status`).send({ isActive: false })).status).toBe(400);

    // Owner resets the staff password; old one stops working.
    await owner.patch(`/api/auth/users/${created.body.id}/status`).send({ isActive: true });
    expect((await owner.post(`/api/auth/users/${created.body.id}/password`).send({ password: "reset-pass-9" })).status).toBe(200);
    expect((await request(createApp()).post("/api/auth/login").send({ login: "9000000001", password: "staffpass1" })).status).toBe(401);
    expect((await request(createApp()).post("/api/auth/login").send({ login: "9000000001", password: "reset-pass-9" })).status).toBe(200);
  });

  it("stores only a hash of the session token", async () => {
    const agent = request.agent(createApp());
    await makeUser();
    const res = await agent.post("/api/auth/login").send({ login: "owner@shop.test", password: TEST_PASSWORD });
    const token = /billing_session=([^;]+)/.exec(res.headers["set-cookie"][0])![1];
    const session = await prisma.session.findFirstOrThrow();
    expect(session.tokenHash).not.toBe(token);
    expect(session.tokenHash).toHaveLength(64);
  });
});
