"use client";

import { useState, type FormEvent } from "react";
import { api, type Role } from "../lib/dashboard-api";
import { errorMessage } from "./workspace";

const roles = ["ADMIN", "MANAGER", "VIEWER"] as const;

export function RoleSelect({ initial = "VIEWER" }: { initial?: Role }) {
  return (
    <label>
      Role
      <select name="role" defaultValue={initial}>
        {roles.map((role) => <option key={role}>{role}</option>)}
      </select>
    </label>
  );
}

export function CreateUserForm({
  dockyardId,
  onCreated,
  onBusy,
}: {
  dockyardId: string;
  onCreated: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const elements = event.currentTarget;
    const form = new FormData(elements);
    const password = form.get("password");
    if (password !== form.get("confirmPassword")) {
      setError("Passwords must match.");
      return;
    }
    setBusy(true);
    onBusy(true);
    setError("");
    (elements.elements.namedItem("password") as HTMLInputElement).value = "";
    (elements.elements.namedItem("confirmPassword") as HTMLInputElement).value = "";
    try {
      await api("/users", "POST", {
        email: form.get("email"),
        password,
        dockyardId,
        role: form.get("role"),
      });
      onCreated();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label>
        Login ID (email)
        <input name="email" type="email" required maxLength={254} autoComplete="off" />
      </label>
      <label>
        Password
        <input name="password" type="password" minLength={8} maxLength={128} required autoComplete="new-password" />
      </label>
      <label>
        Confirm password
        <input name="confirmPassword" type="password" minLength={8} maxLength={128} required autoComplete="new-password" />
      </label>
      <RoleSelect />
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create account"}
      </button>
    </form>
  );
}
