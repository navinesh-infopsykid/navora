import { Eye, EyeOff, ReceiptIndianRupee } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Notice } from "../components/ui";
import { api, errorMessage, type AuthUser } from "../lib/api";
import { useAuth } from "../lib/auth";

function PasswordInput({ id, value, onChange, autoComplete }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input id={id} type={show ? "text" : "password"} className="field pr-10" value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-ink-faint hover:text-ink"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

/** Login screen. On a fresh install it becomes the "create owner account" screen. */
export default function Login({ mode }: { mode: "login" | "setup" }) {
  const { signedIn, businessName } = useAuth();
  const [login, setLogin] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "setup") {
      if (!email.trim() && !phone.trim()) return setError("Enter an email or a mobile number. You'll use it to log in.");
      if (password.length < 8) return setError("Password must be at least 8 characters.");
      if (password !== confirm) return setError("The two passwords don't match.");
    }
    setBusy(true);
    try {
      const { data } =
        mode === "setup"
          ? await api.post<{ user: AuthUser }>("/auth/setup", { name, email: email || null, phone: phone || null, password })
          : await api.post<{ user: AuthUser }>("/auth/login", { login, password });
      signedIn(data.user);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-md bg-khata text-white" aria-hidden>
            <ReceiptIndianRupee className="size-5" />
          </span>
          <span className="text-lg font-semibold">{businessName ?? "Simple Billing"}</span>
        </div>

        <form onSubmit={submit} className="bill-slip space-y-4 p-6" noValidate>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{mode === "setup" ? "Create the owner account" : "Log in"}</h1>
            <p className="mt-1 text-sm text-ink-soft">
              {mode === "setup"
                ? "This is the first login for this shop. You can add staff logins later from Settings."
                : "Use your email or mobile number."}
            </p>
          </div>

          {mode === "setup" ? (
            <>
              <div>
                <label className="label" htmlFor="name">
                  Your name
                </label>
                <input id="name" className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required autoFocus />
              </div>
              <div>
                <label className="label" htmlFor="email">
                  Email
                </label>
                <input id="email" type="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </div>
              <div>
                <label className="label" htmlFor="phone">
                  Mobile number
                </label>
                <input id="phone" className="field num" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="98765 43210" />
                <p className="mt-1 text-xs text-ink-soft">Fill in email, mobile number, or both. Either can be used to log in.</p>
              </div>
              <div>
                <label className="label" htmlFor="password">
                  Password
                </label>
                <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" />
                <p className="mt-1 text-xs text-ink-soft">At least 8 characters.</p>
              </div>
              <div>
                <label className="label" htmlFor="confirm">
                  Confirm password
                </label>
                <PasswordInput id="confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="label" htmlFor="login">
                  Email or mobile number
                </label>
                <input id="login" className="field" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" required autoFocus />
              </div>
              <div>
                <label className="label" htmlFor="password">
                  Password
                </label>
                <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
              </div>
            </>
          )}

          {error && <Notice kind="error">{error}</Notice>}

          <button type="submit" className="btn btn-primary w-full py-2.5" disabled={busy}>
            {busy ? (mode === "setup" ? "Creating…" : "Logging in…") : mode === "setup" ? "Create account and log in" : "Log in"}
          </button>

          {mode === "login" && (
            <p className="text-xs text-ink-soft">
              Forgot your password? Staff: ask the owner to set a new one. Owner: run <code className="rounded bg-rule-soft px-1">npm run user:reset-password</code> on the shop computer.
            </p>
          )}
        </form>
      </div>
    </main>
  );
}
