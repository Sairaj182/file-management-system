"use client";

import Link from "next/link";
import { useState } from "react";
import type { Dockyard } from "../lib/dashboard-api";
import { Badge, Copy, Feedback, useResource } from "./common";
import { useAccount } from "./workspace";
import { Files } from "./files";
import { Members } from "./members";
import { Keys } from "./keys";

const sections = ["Files", "Members", "API keys", "Connect a project"] as const;

export function DockyardDetail({
  id,
  publicApi,
  limits,
}: {
  id: string;
  publicApi: string;
  limits: { maxSize: number; maxCount: number; maxTtl: number };
}) {
  const account = useAccount();
  const path = "/dockyard/" + encodeURIComponent(id);
  const yard = useResource<Dockyard>(path);
  const [selected, setSelected] = useState<(typeof sections)[number]>("Files");
  if (!yard.value)
    return (
      <>
        <Link href="/dockyards">Dockyards</Link>
        <Feedback {...yard} retry={yard.refresh} />
      </>
    );
  const { memberRole, status, notes } = yard.value;
  const mayManageMembers = account.isSuperAdmin || memberRole === "OWNER";
  const mayWrite =
    account.isSuperAdmin || memberRole === "OWNER" || memberRole === "MANAGER";
  return (
    <>
      <Link className="crumb" href="/dockyards">
        Dockyards
      </Link>
      <header className="heading spread">
        <div>
          <h1>{notes}</h1>
          <p className="mono">{id}</p>
        </div>
        <Badge value={status} />
      </header>
      <nav aria-label="Dockyard sections" className="sections">
        {sections
          .filter((section) =>
            section === "Members"
              ? mayManageMembers
              : section === "API keys"
                ? mayWrite
                : true,
          )
          .map((section) => (
            <button
              key={section}
              aria-current={selected === section ? "page" : undefined}
              onClick={() => setSelected(section)}
            >
              {section}
            </button>
          ))}
      </nav>
      {selected === "Files" &&
        (status === "ACTIVE" ? (
          <Files path={path} mayWrite={mayWrite} {...limits} />
        ) : (
          <p className="panel">
            File operations are available when the Dockyard is active.
          </p>
        ))}
      {selected === "Members" && mayManageMembers && (
        <Members
          path={path}
          accessChanged={() => {
            setSelected("Files");
            yard.refresh();
          }}
        />
      )}
      {selected === "API keys" && mayWrite && <Keys path={path} />}
      {selected === "Connect a project" && (
        <Connect id={id} publicApi={publicApi} mayWrite={mayWrite} />
      )}
    </>
  );
}

function Connect({
  id,
  publicApi,
  mayWrite,
}: {
  id: string;
  publicApi: string;
  mayWrite: boolean;
}) {
  const variables = `VAULTFS_API_URL=${publicApi}\nVAULTFS_DOCKYARD_ID=${id}\nVAULTFS_API_KEY=<your-secret>`;
  const example = `import { openAsBlob } from "node:fs";

const { VAULTFS_API_URL, VAULTFS_DOCKYARD_ID, VAULTFS_API_KEY } = process.env;
const headers = { "X-API-Key": VAULTFS_API_KEY };

const check = await fetch(VAULTFS_API_URL + "/integration/me", { headers });
if (!check.ok) throw new Error("VaultFS authentication failed: " + check.status);

const form = new FormData();
form.append("file", await openAsBlob("./image.png"), "image.png");
const url = VAULTFS_API_URL + "/dockyard/" + encodeURIComponent(VAULTFS_DOCKYARD_ID) + "/files";
const upload = await fetch(url, { method: "POST", headers, body: form });
const result = await upload.json();
if (!upload.ok || !result.success) throw new Error("Upload failed: " + upload.status);
console.log(result.data[0].id);`;
  return (
    <section className="panel stack">
      <h2>Connect a project</h2>
      <p>
        {mayWrite
          ? "Create a key under API keys and select WRITE to upload files."
          : "Ask a Dockyard Owner or Manager for a scoped API key."}{" "}
        Store its secret in your server environment.
      </p>
      <dl className="details">
        <dt>Dockyard ID</dt>
        <dd>{id}</dd>
        <dt>VaultFS API base URL</dt>
        <dd>{publicApi}</dd>
      </dl>
      <h3>Server environment</h3>
      <pre>{variables}</pre>
      <div>
        <Copy value={variables} label="Copy environment template" />
      </div>
      <h3>Authenticate and upload with Node.js</h3>
      <p>
        The credentials check calls <code>GET /integration/me</code>. Upload
        uses a PNG, JPEG, or WebP file.
      </p>
      <pre>{example}</pre>
      <div>
        <Copy value={example} label="Copy Node.js example" />
      </div>
    </section>
  );
}
