"use client";

import { useState, type FormEvent } from "react";
import { api, type Member } from "../lib/dashboard-api";
import { Badge, Feedback, Modal, useResource } from "./common";
import { errorMessage, useAccount } from "./workspace";
import { CreateUserForm, RoleSelect } from "./user-provisioning";

export function Members({
  path,
  dockyardId,
  canProvision,
  accessChanged,
}: {
  path: string;
  dockyardId: string;
  canProvision: boolean;
  accessChanged: () => void;
}) {
  const account = useAccount();
  const list = useResource<Member[]>(path + "/members");
  const [edit, setEdit] = useState<{ mode: "create" } | { mode: "edit" | "remove"; item: Member }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const admins = list.value?.filter((member) => member.role === "ADMIN").length;
  function openMember(mode: "edit" | "remove", item: Member) {
    setError("");
    setEdit({ mode, item });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!edit || edit.mode === "create") return;
    const form = new FormData(event.currentTarget);
    const item = edit.item;
    const endpoint = path + "/members/" + encodeURIComponent(item.userId);
    setBusy(true);
    try {
      if (edit.mode === "remove") await api(endpoint, "DELETE");
      else await api(endpoint, "PATCH", { role: form.get("role") });
      setEdit(undefined);
      if (item.userId === account.user.id) accessChanged();
      else list.refresh();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="spread">
        <h2>Members</h2>
        {canProvision && <button className="primary" onClick={() => setEdit({ mode: "create" })}>Add User</button>}
      </div>
      <Feedback {...list} retry={list.refresh} />
      {list.value?.length === 0 && (
        <p className="empty">No members to display.</p>
      )}
      {!!list.value?.length && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Manage</th>
              </tr>
            </thead>
            <tbody>
              {list.value.map((item) => (
                <tr key={item.userId}>
                  <td>
                    <strong>{item.user.name || item.user.email}</strong>
                    {item.user.name && item.user.name !== item.user.email && <small>{item.user.email}</small>}
                  </td>
                  <td>
                    <Badge value={item.role} />
                  </td>
                  <td>
                    {admins === 1 && item.role === "ADMIN" ? (
                      <span className="muted">Last Admin</span>
                    ) : (
                      <div className="actions">
                        <button onClick={() => openMember("edit", item)}>
                          Change role
                        </button>
                        <button onClick={() => openMember("remove", item)}>
                          Remove
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit?.mode === "create" && (
        <Modal title="Create user" close={() => { if (!busy) setEdit(undefined); }}>
          <CreateUserForm dockyardId={dockyardId} onBusy={setBusy}
            onCreated={() => { setEdit(undefined); list.refresh(); }} />
        </Modal>
      )}
      {edit && edit.mode !== "create" && (
        <Modal
          title={edit.mode === "edit" ? "Change role" : "Remove member"}
          close={() => {
            if (!busy) setEdit(undefined);
          }}
        >
          <form onSubmit={submit} className="stack">
            <p>
              {edit.mode === "remove" ? "Remove access for " : "Change permissions for "}
              <strong>{edit.item.user.name || edit.item.user.email}</strong>?
            </p>
            {edit.mode === "edit" && <RoleSelect initial={edit.item.role} />}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button
              className={edit.mode === "remove" ? "danger" : "primary"}
              disabled={busy}
            >
              {edit.mode === "remove" ? "Confirm removal" : "Save member"}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}
