import { KeyRound, UserPlus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage, type AuthUser } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDateTime, formatPhone } from "../lib/format";
import { Modal, Notice } from "./ui";

/** "Your account": change your own password. */
export function ChangePassword() {
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next.length < 8) return setMessage({ kind: "error", text: "New password must be at least 8 characters." });
    if (next !== confirm) return setMessage({ kind: "error", text: "The two new passwords don't match." });
    setBusy(true);
    setMessage(null);
    try {
      await api.post("/auth/change-password", { currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      setConfirm("");
      setMessage({ kind: "success", text: "Password changed. Other devices using this account have been logged out." });
    } catch (err) {
      setMessage({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel max-w-2xl p-5 sm:p-6">
      <h2 className="font-semibold">Your account</h2>
      <p className="mt-1 text-sm text-ink-soft">
        {user?.name}: logs in with {[user?.email, user?.phone ? formatPhone(user.phone) : null].filter(Boolean).join(" or ")}
      </p>
      <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="currentPassword">
            Current password
          </label>
          <input id="currentPassword" type="password" className="field" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </div>
        <div>
          <label className="label" htmlFor="newPassword">
            New password
          </label>
          <input id="newPassword" type="password" className="field" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
        </div>
        <div>
          <label className="label" htmlFor="confirmPassword">
            Confirm new password
          </label>
          <input id="confirmPassword" type="password" className="field" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </div>
        {message && (
          <div className="sm:col-span-3">
            <Notice kind={message.kind}>{message.text}</Notice>
          </div>
        )}
        <div className="flex justify-end sm:col-span-3">
          <button type="submit" className="btn btn-secondary" disabled={busy}>
            <KeyRound className="size-4" aria-hidden /> {busy ? "Saving…" : "Change password"}
          </button>
        </div>
      </form>
    </section>
  );
}

/** "Users" (owner only): add staff logins, turn them off, set a new password. */
export function ManageUsers() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AuthUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<AuthUser | null>(null);

  async function load() {
    try {
      const { data } = await api.get<AuthUser[]>("/auth/users");
      setUsers(data);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggle(u: AuthUser) {
    try {
      await api.patch(`/auth/users/${u.id}/status`, { isActive: !u.isActive });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <section className="panel max-w-2xl p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Users</h2>
          <p className="mt-1 text-sm text-ink-soft">People who can log in to this shop's billing.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => setAdding(true)}>
          <UserPlus className="size-4" aria-hidden /> Add user
        </button>
      </div>

      {error && (
        <div className="mt-3">
          <Notice kind="error">{error}</Notice>
        </div>
      )}

      <ul className="mt-4 divide-y divide-rule-soft border-t border-rule">
        {(users ?? []).map((u) => (
          <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className={`min-w-0 ${u.isActive ? "" : "text-ink-faint"}`}>
              <p className="font-medium">
                {u.name} <span className="text-xs font-normal text-ink-soft">{u.isOwner ? "Owner" : u.isActive ? "Staff" : "Staff, deactivated"}</span>
              </p>
              <p className="num text-xs text-ink-soft">
                {[u.email, u.phone ? formatPhone(u.phone) : null].filter(Boolean).join(" · ")}
                {u.lastLoginAt ? `, last login ${formatDateTime(u.lastLoginAt)}` : ", never logged in"}
              </p>
            </div>
            {!u.isOwner && u.id !== me?.id && (
              <div className="flex gap-1">
                <button type="button" className="btn btn-ghost px-2.5" onClick={() => setResetting(u)}>
                  Set password
                </button>
                <button type="button" className="btn btn-ghost px-2.5" onClick={() => void toggle(u)}>
                  {u.isActive ? "Deactivate" : "Activate"}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <AddUserModal
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={() => {
          setAdding(false);
          void load();
        }}
      />
      <SetPasswordModal user={resetting} onClose={() => setResetting(null)} />
    </section>
  );
}

function AddUserModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setEmail("");
      setPhone("");
      setPassword("");
      setError(null);
    }
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() && !phone.trim()) return setError("Enter an email or a mobile number for this person to log in with.");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    setBusy(true);
    try {
      await api.post("/auth/users", { name, email: email || null, phone: phone || null, password });
      onAdded();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Add user" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="newUserName">
            Name
          </label>
          <input id="newUserName" className="field" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="newUserEmail">
              Email
            </label>
            <input id="newUserEmail" type="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="newUserPhone">
              Mobile number
            </label>
            <input id="newUserPhone" className="field num" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="98765 43210" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="newUserPassword">
            Password
          </label>
          <input id="newUserPassword" type="text" className="field" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" required />
          <p className="mt-1 text-xs text-ink-soft">At least 8 characters. Tell this person their password; they can change it in Settings.</p>
        </div>
        <p className="text-xs text-ink-soft">Staff can make bills, manage items and stock, and view invoices. Only the owner can manage users.</p>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Adding…" : "Add user"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SetPasswordModal({ user, onClose }: { user: AuthUser | null; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPassword("");
    setMessage(null);
  }, [user]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (password.length < 8) return setMessage({ kind: "error", text: "Password must be at least 8 characters." });
    setBusy(true);
    try {
      await api.post(`/auth/users/${user.id}/password`, { password });
      setMessage({ kind: "success", text: `New password set for ${user.name}. They have been logged out everywhere.` });
      setPassword("");
    } catch (err) {
      setMessage({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={user !== null} title={`Set a new password for ${user?.name ?? ""}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="resetPassword">
            New password
          </label>
          <input id="resetPassword" type="text" className="field" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" required autoFocus />
        </div>
        {message && <Notice kind={message.kind}>{message.text}</Notice>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Set password"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
