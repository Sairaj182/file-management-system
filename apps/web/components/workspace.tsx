"use client";

import Link from "next/link";
import { createContext, useContext, useState, type ReactNode } from "react";
import { ApiError, api, type Account } from "../lib/dashboard-api";

const AccountContext = createContext<Account | null>(null);
export function useAccount() {
  return useContext(AccountContext)!;
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    window.location.replace("/login?expired=1");
    return "Your session ended. Sign in again.";
  }
  return error instanceof Error
    ? error.message
    : "Something went wrong. Try again.";
}

export function Workspace({
  account,
  children,
}: {
  account: Account;
  children: ReactNode;
}) {
  const [error, setError] = useState("");
  async function logout() {
    try {
      await api("/auth/sign-out", "POST", {});
      window.location.replace("/login");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  return (
    <AccountContext.Provider value={account}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link href="/dockyards" className="brand">
          <span className="mark" aria-hidden="true">
            V
          </span>{" "}
          VaultFS
        </Link>
        <nav aria-label="Workspace">
          <Link className="nav-link" href="/dockyards">
            ▤ &nbsp; Dockyards
          </Link>
        </nav>
        <div className="account">
          <strong>{account.user.name}</strong>
          <small>{account.user.email}</small>
          <button onClick={logout}>Sign out</button>
          {error && <p role="alert">{error}</p>}
        </div>
      </aside>
      <main id="main" className="workspace" tabIndex={-1}>
        {children}
      </main>
    </AccountContext.Provider>
  );
}
