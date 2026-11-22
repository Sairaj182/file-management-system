"use client";

import { useState, type FormEvent } from "react";
import { api } from "../lib/dashboard-api";

export function Login({ expired }: { expired: boolean }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    (
      event.currentTarget.elements.namedItem("password") as HTMLInputElement
    ).value = "";
    setBusy(true);
    setError("");
    try {
      await api("/auth/sign-in/email", "POST", {
        email: form.get("email"),
        password: form.get("password"),
      });
      window.location.replace("/dockyards");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign in failed.");
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <div className="login-inner">
        <div className="brand">
          <span className="mark" aria-hidden="true">
            V
          </span>{" "}
          VaultFS
        </div>
        <h1>Sign in</h1>
        <p>Manage your Dockyards, files, and API keys.</p>
        {expired && <p role="status">Your session ended. Sign in again.</p>}
        <form className="stack panel" onSubmit={signIn}>
          <label>
            Email
            <input required name="email" type="email" autoComplete="username" />
          </label>
          <label>
            Password
            <input
              required
              name="password"
              type="password"
              autoComplete="current-password"
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
