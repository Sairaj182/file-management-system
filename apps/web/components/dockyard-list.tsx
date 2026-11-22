"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { data, type Dockyard } from "../lib/dashboard-api";
import { Badge, Feedback, Modal, useResource } from "./common";
import { errorMessage, useAccount } from "./workspace";

export function DockyardList() {
  const account = useAccount();
  const router = useRouter();
  const list = useResource<Dockyard[]>("/dockyard");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rows = list.value?.filter(
    (item) =>
      (!status || item.status === status) &&
      (item.notes + " " + item.id)
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const notes = String(new FormData(event.currentTarget).get("notes")).trim();
    setBusy(true);
    setError("");
    try {
      const item = await data<Dockyard>("/dockyard", "POST", { notes });
      router.push(`/dockyards/${item.id}`);
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  }

  return (
    <>
      <header className="heading spread">
        <div>
          <h1>Dockyards</h1>
          <p>Manage your isolated storage and project access.</p>
        </div>
        {(account.isSuperAdmin ||
          account.permissions.includes("dockyard:create:any")) && (
          <button
            className="primary"
            onClick={() => {
              setError("");
              setCreating(true);
            }}
          >
            Create Dockyard
          </button>
        )}
      </header>
      <section className="panel" aria-label="Accessible Dockyards">
        <div className="filters">
          <label>
            Search Dockyards
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notes or ID"
            />
          </label>
          <label>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option>ACTIVE</option>
              <option>INACTIVE</option>
              <option value="INCUSTODY">In custody</option>
              <option>SUSPENDED</option>
            </select>
          </label>
        </div>
        <Feedback {...list} retry={list.refresh} />
        {rows?.length === 0 && (
          <div className="empty">
            <h2>
              {list.value?.length
                ? "No matching Dockyards"
                : "No Dockyards yet"}
            </h2>
            <p>
              {list.value?.length
                ? "Change your search or status filter."
                : "Dockyards you can access will appear here."}
            </p>
          </div>
        )}
        {!!rows?.length && (
          <ul className="dock-list">
            {rows.map((item) => (
              <li key={item.id}>
                <Link href={`/dockyards/${item.id}`}>
                  <strong>{item.notes}</strong>
                  <small className="mono">{item.id}</small>
                </Link>
                <Badge value={item.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {creating && (
        <Modal
          title="Create Dockyard"
          close={() => {
            if (!busy) setCreating(false);
          }}
        >
          <form className="stack" onSubmit={create}>
            <label>
              Dockyard notes
              <input
                name="notes"
                required
                maxLength={5000}
                placeholder="Example project assets"
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "Creating…" : "Create"}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
