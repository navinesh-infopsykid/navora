/**
 * Reset a login password from the terminal (for when the owner forgets it).
 * Also reactivates the account and logs it out everywhere.
 *
 *   npm run user:reset-password
 *
 * You will be asked for the email or mobile number and the new password.
 */
import readline from "node:readline";
import { prisma } from "../src/lib/db";
import { hashPassword, MIN_PASSWORD_LENGTH } from "../src/lib/password";
import { parseLoginId } from "../src/services/authService";

// One reader for all questions, so typed (or pasted) answers are never lost between prompts.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
let muted = false;
const writeOut = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput.bind(rl);
(rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
  // While typing a password, show nothing except the line break.
  if (!muted || s === "\r\n" || s === "\n") writeOut(s);
};
const lines = rl[Symbol.asyncIterator]();

async function ask(question: string, hidden = false): Promise<string> {
  process.stdout.write(question);
  muted = hidden;
  const { value } = await lines.next();
  muted = false;
  if (hidden && !process.stdin.isTTY) process.stdout.write("\n");
  const text = String(value ?? "");
  return hidden ? text : text.trim(); // passwords are used exactly as typed
}

async function main() {
  const users = await prisma.user.findMany({ orderBy: { id: "asc" } });
  if (users.length === 0) {
    console.log("There are no accounts yet. Open the app in your browser to create the owner account.");
    return;
  }
  console.log("Accounts:");
  for (const u of users) console.log(`  - ${u.name}: ${[u.email, u.phone ? `+${u.phone}` : null].filter(Boolean).join(" / ")}${u.isOwner ? " (owner)" : ""}`);

  const login = await ask("\nEmail or mobile number of the account to reset: ");
  const id = parseLoginId(login);
  const user = await prisma.user.findUnique({ where: "email" in id ? { email: id.email } : { phone: id.phone } });
  if (!user) {
    console.error("No account found with that email or mobile number.");
    process.exitCode = 1;
    return;
  }

  const password = await ask(`New password (at least ${MIN_PASSWORD_LENGTH} characters): `, true);
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters. Nothing was changed.`);
    process.exitCode = 1;
    return;
  }
  const again = await ask("Type the new password again: ", true);
  if (again !== password) {
    console.error("The two passwords did not match. Nothing was changed.");
    process.exitCode = 1;
    return;
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password), isActive: true } }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);
  console.log(`Password updated for ${user.name}. Log in with the new password.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await prisma.$disconnect();
  });
