"use client";

import { useState, type FormEvent } from "react";
import { api, type Key } from "../lib/dashboard-api";
import { Badge, Copy, Feedback, Modal, date, useResource } from "./common";
import { errorMessage } from "./workspace";

export function Keys({ path }: { path: string }) {
  const endpoint = path + "/api-keys";
  const list = useResource<Key[]>(endpoint);
  const [dialog, setDialog] = useState<{
    action: "Create" | "Rotate" | "Revoke";
    key?: Key;
  }>();
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function open(action: "Create" | "Rotate" | "Revoke", key?: Key) {
    setError("");
    setDialog({ action, key });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;
    const form = new FormData(event.currentTarget);
    const scopes = form.getAll("scope");
    const expiry = String(form.get("expiry") ?? "");
    if (dialog.action === "Create" && !scopes.length) {
      setError("Select at least one scope.");
      return;
    }
    if (expiry && new Date(expiry).getTime() <= Date.now()) {
      setError("Choose an expiry in the future.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const target = dialog.key
        ? endpoint + "/" + encodeURIComponent(dialog.key.id)
        : endpoint;
      if (dialog.action === "Revoke") await api(target, "DELETE");
      else {
        const result = await api<{ secret: string }>(
          target + (dialog.action === "Rotate" ? "/rotate" : ""),
          "POST",
          dialog.action === "Rotate"
            ? {}
            : {
                name: String(form.get("name")).trim() || undefined,
                scopes,
                ...(expiry
                  ? { expiresAt: new Date(expiry).toISOString() }
                  : {}),
              },
        );
        setSecret(result.secret);
      }
      setDialog(undefined);
      list.refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="spread">
        <h2>API keys</h2>
        <button className="primary" onClick={() => open("Create")}>
          Create API key
        </button>
      </div>
      <Feedback {...list} retry={list.refresh} />
      {list.value?.length === 0 && (
        <div className="empty">
          <h3>No API keys yet</h3>
          <p>Create a scoped key to connect a server application.</p>
        </div>
      )}
      {!!list.value?.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Scopes</th>
                <th>Status</th>
                <th>Expiry</th>
                <th>Last used</th>
                <th>Manage</th>
              </tr>
            </thead>
            <tbody>
              {list.value.map((key) => (
                <tr key={key.id}>
                  <td>
                    <strong>{key.name || "Unnamed key"}</strong>
                    <small className="mono">{key.prefix || key.id}</small>
                  </td>
                  <td>{key.scopes.join(", ") || "—"}</td>
                  <td>
                    <Badge
                      value={
                        key.revokedAt
                          ? "REVOKED"
                          : key.active
                            ? "ACTIVE"
                            : key.prefix
                              ? "EXPIRED"
                              : "LEGACY"
                      }
                    />
                  </td>
                  <td>{date(key.expiresAt)}</td>
                  <td>{date(key.lastUsedAt)}</td>
                  <td>
                    <div className="actions">
                      {key.active && (
                        <button onClick={() => open("Rotate", key)}>
                          Rotate
                        </button>
                      )}
                      {!key.revokedAt && (
                        <button onClick={() => open("Revoke", key)}>
                          Revoke
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog && (
        <Modal
          title={dialog.action + " API key"}
          close={() => {
            if (!busy) setDialog(undefined);
          }}
        >
          <form onSubmit={submit} className="stack">
            {dialog.action === "Create" ? (
              <>
                <label>
                  Name
                  <input name="name" maxLength={100} />
                </label>
                <fieldset>
                  <legend>Scopes</legend>
                  <div className="actions">
                    {["READ", "WRITE", "DELETE"].map((scope) => (
                      <label className="check" key={scope}>
                        <input type="checkbox" name="scope" value={scope} />
                        {scope}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label>
                  Expiry (optional, local time)
                  <input type="datetime-local" name="expiry" />
                </label>
              </>
            ) : (
              <p>
                {dialog.action === "Rotate"
                  ? "Rotation creates a replacement and invalidates the previous key immediately."
                  : "Revocation blocks all future requests using this key."}
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button
              className={dialog.action === "Revoke" ? "danger" : "primary"}
              disabled={busy}
            >
              {dialog.action === "Create"
                ? "Generate key"
                : "Confirm " + dialog.action.toLowerCase()}
            </button>
          </form>
        </Modal>
      )}
      {secret && (
        <Modal title="Your API key" close={() => setSecret("")}>
          <p>
            Copy this secret now. You cannot retrieve it after closing this
            dialog.
          </p>
          <input
            aria-label="API key secret"
            className="mono"
            value={secret}
            readOnly
            autoComplete="off"
            spellCheck={false}
          />
          <Copy value={secret} label="Copy API key" />
        </Modal>
      )}
    </section>
  );
}
