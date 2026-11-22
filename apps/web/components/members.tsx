"use client";

import { useState, type FormEvent } from "react";
import { api, type Member, type Role } from "../lib/dashboard-api";
import { Badge, Feedback, Modal, useResource } from "./common";
import { errorMessage, useAccount } from "./workspace";

const roles = ["VIEWER", "MANAGER", "OWNER"] as const;
function RoleSelect({ initial = "VIEWER" }: { initial?: Role }) {
  return (
    <div className="field">
      <label htmlFor="member-role">Role</label>
      <select id="member-role" name="role" defaultValue={initial}>
        {roles.map((role) => (
          <option key={role}>{role}</option>
        ))}
      </select>
    </div>
  );
}

export function Members({
  path,
  accessChanged,
}: {
  path: string;
  accessChanged: () => void;
}) {
  const account = useAccount();
  const list = useResource<Member[]>(path + "/members");
  const [edit, setEdit] = useState<{
    mode: "add" | "edit" | "remove";
    item?: Member;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const owners = list.value?.filter((member) => member.role === "OWNER").length;
  function open(mode: "add" | "edit" | "remove", item?: Member) {
    setError("");
    setEdit({ mode, item });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!edit) return;
    const form = new FormData(event.currentTarget);
    const item = edit.item;
    const endpoint =
      path + "/members" + (item ? "/" + encodeURIComponent(item.userId) : "");
    setBusy(true);
    try {
      if (edit.mode === "remove") await api(endpoint, "DELETE");
      else if (edit.mode === "edit")
        await api(endpoint, "PATCH", { role: form.get("role") });
      else
        await api(endpoint, "POST", {
          userId: String(form.get("userId")).trim(),
          role: form.get("role"),
        });
      setEdit(undefined);
      if (item?.userId === account.user.id) accessChanged();
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
        <button className="primary" onClick={() => open("add")}>
          Add member
        </button>
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
                    <strong>{item.user.name}</strong>
                    <small>{item.user.email}</small>
                  </td>
                  <td>
                    <Badge value={item.role} />
                  </td>
                  <td>
                    {owners === 1 && item.role === "OWNER" ? (
                      <span className="muted">Last owner</span>
                    ) : (
                      <div className="actions">
                        <button onClick={() => open("edit", item)}>
                          Change role
                        </button>
                        <button onClick={() => open("remove", item)}>
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
      {edit && (
        <Modal
          title={
            edit.mode === "add"
              ? "Add member"
              : edit.mode === "edit"
                ? "Change role"
                : "Remove member"
          }
          close={() => {
            if (!busy) setEdit(undefined);
          }}
        >
          <form onSubmit={submit} className="stack">
            {edit.mode === "add" && (
              <label>
                User ID
                <input
                  name="userId"
                  required
                  placeholder="Existing VaultFS user ID"
                />
              </label>
            )}
            {edit.item && (
              <p>
                {edit.mode === "remove"
                  ? "Remove access for "
                  : "Change permissions for "}
                <strong>{edit.item.user.name}</strong>?
              </p>
            )}
            {edit.mode !== "remove" && <RoleSelect initial={edit.item?.role} />}
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
