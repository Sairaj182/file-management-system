"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import { ApiError, api, data, type StoredFile } from "../lib/dashboard-api";
import { Badge, Copy, Feedback, Modal, date, useResource } from "./common";
import { errorMessage } from "./workspace";

type FilePage = { files: StoredFile[]; total: number; limit: number };
type UploadResult = {
  data?: StoredFile[];
  errors?: { filename?: string; error: string }[];
  error?: string;
};
const size = (bytes: number) =>
  bytes >= 1048576
    ? (bytes / 1048576).toFixed(1) + " MiB"
    : bytes >= 1024
      ? (bytes / 1024).toFixed(1) + " KiB"
      : bytes + " B";

function upload(
  endpoint: string,
  files: FileList,
  onProgress: (value: number) => void,
) {
  return new Promise<UploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/vault-api" + endpoint);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((100 * event.loaded) / event.total));
    };
    xhr.onerror = () => reject(new Error("Upload connection failed."));
    xhr.onload = () => {
      if (xhr.status === 401) {
        reject(new ApiError(401, "Your session ended."));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText) as UploadResult);
      } catch {
        reject(new Error("Upload failed (" + xhr.status + ")."));
      }
    };
    const form = new FormData();
    for (const file of files) form.append("file", file);
    xhr.send(form);
  });
}

function Preview({ href }: { href: string }) {
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let url = "";
    fetch(href, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok)
          throw new ApiError(response.status, "File preview is unavailable.");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setImage(url);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(errorMessage(cause));
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [href]);
  return image ? (
    <Image
      className="preview"
      src={image}
      alt="File preview"
      width={600}
      height={400}
      unoptimized
    />
  ) : (
    <Feedback loading={!error} error={error} />
  );
}

export function Files({
  path,
  mayWrite,
  maxSize,
  maxCount,
  maxTtl,
}: {
  path: string;
  mayWrite: boolean;
  maxSize: number;
  maxCount: number;
  maxTtl: number;
}) {
  const endpoint = path + "/files";
  const [page, setPage] = useState(1);
  const list = useResource<FilePage>(endpoint + "?page=" + page + "&limit=20");
  const [dialog, setDialog] = useState<{
    action: "details" | "preview" | "delete" | "link";
    file: StoredFile;
  }>();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number>();
  const [link, setLink] = useState<{ url: string; expiresAt: string }>();
  function open(
    action: NonNullable<typeof dialog>["action"],
    file: StoredFile,
  ) {
    setDialogError("");
    setLink(undefined);
    setDialog({ action, file });
  }
  async function sendFiles(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const files = (form.elements.namedItem("files") as HTMLInputElement).files;
    setStatus("");
    setError("");
    if (!files?.length) return;
    if (
      files.length > maxCount ||
      [...files].some((file) => file.size > maxSize || file.size === 0)
    ) {
      setError(
        `Choose up to ${maxCount} nonempty files, each no larger than ${size(maxSize)}.`,
      );
      return;
    }
    setProgress(0);
    try {
      const result = await upload(endpoint, files, setProgress);
      if (result.data?.length) {
        setStatus(`Uploaded ${result.data.length} file(s).`);
        form.reset();
        setPage(1);
        list.refresh();
      }
      setError(
        result.errors
          ?.map((item) =>
            [item.filename, item.error].filter(Boolean).join(": "),
          )
          .join("\n") ||
          result.error ||
          "",
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setProgress(undefined);
    }
  }
  async function verify(file: StoredFile) {
    setBusy(true);
    setStatus("");
    setError("");
    try {
      const result = await data<{ matches: boolean }>(
        endpoint + "/" + file.id + "/verify",
        "POST",
      );
      if (result.matches)
        setStatus("SHA-256 verified for " + file.originalName + ".");
      else {
        setError("Checksum mismatch. The file was quarantined.");
        list.refresh();
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog) return;
    const form = new FormData(event.currentTarget);
    const target = endpoint + "/" + dialog.file.id;
    setBusy(true);
    setDialogError("");
    try {
      if (dialog.action === "delete") {
        await api(target, "DELETE");
        setDialog(undefined);
        setStatus("File deleted.");
        if (list.value?.files.length === 1 && page > 1) setPage(page - 1);
        list.refresh();
      } else {
        setLink(
          await data(target + "/signed-url", "POST", {
            expiresInSeconds: Number(form.get("ttl")),
          }),
        );
      }
    } catch (cause) {
      setDialogError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="spread">
        <h2>Files</h2>
        {list.value && <span className="muted">{list.value.total} total</span>}
      </div>
      {mayWrite && (
        <form className="upload" onSubmit={sendFiles}>
          <label>
            Choose files
            <input
              type="file"
              name="files"
              accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
              multiple
              required
              disabled={progress !== undefined}
            />
            <small>
              PNG, JPEG or WebP · up to {maxCount} files · {size(maxSize)} each
            </small>
          </label>
          <button className="primary" disabled={progress !== undefined}>
            Upload files
          </button>
          {progress !== undefined && (
            <label>
              {progress < 100 ? `Uploading ${progress}%` : "Validating files…"}
              <progress value={progress} max={100} />
            </label>
          )}
        </form>
      )}
      {status && (
        <p role="status" className="notice">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <Feedback {...list} retry={list.refresh} />
      {list.value?.files.length === 0 && (
        <div className="empty">
          <h3>No files on this page</h3>
          <p>Files uploaded to this Dockyard will appear here.</p>
        </div>
      )}
      {!!list.value?.files.length && (
        <div className="table-wrap file-table">
          <table role="table">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">
                  File
                </th>
                <th role="columnheader" scope="col">
                  Status
                </th>
                <th role="columnheader" scope="col">
                  Size
                </th>
                <th role="columnheader" scope="col">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {list.value.files.map((file) => (
                <tr role="row" key={file.id}>
                  <td role="cell">
                    <strong>{file.originalName}</strong>
                    <small>{date(file.createdAt)}</small>
                  </td>
                  <td role="cell">
                    <Badge value={file.state} />
                  </td>
                  <td role="cell">{size(Number(file.sizeBytes))}</td>
                  <td role="cell">
                    <div className="actions">
                      <button onClick={() => open("details", file)}>
                        Details
                      </button>
                      {file.state === "AVAILABLE" && (
                        <>
                          {["image/png", "image/jpeg", "image/webp"].includes(
                            file.contentType,
                          ) && (
                            <button onClick={() => open("preview", file)}>
                              Preview
                            </button>
                          )}
                          <a
                            className="button"
                            href={
                              "/vault-api" +
                              endpoint +
                              "/" +
                              file.id +
                              "/download"
                            }
                          >
                            Download
                          </a>
                          <button disabled={busy} onClick={() => verify(file)}>
                            Verify SHA-256
                          </button>
                          <button onClick={() => open("link", file)}>
                            Signed link
                          </button>
                        </>
                      )}
                      {mayWrite &&
                        !["STAGED", "DELETING"].includes(file.state) && (
                          <button onClick={() => open("delete", file)}>
                            Delete
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
      {(page > 1 || (!!list.value && list.value.total > list.value.limit)) && (
        <nav className="pager actions" aria-label="File pagination">
          <button disabled={page === 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>Page {page}</span>
          <button
            disabled={
              !list.value || page * list.value.limit >= list.value.total
            }
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </nav>
      )}
      {dialog && (
        <Modal
          title={
            dialog.action === "preview"
              ? "Preview"
              : dialog.action === "details"
                ? "File details"
                : dialog.action === "delete"
                  ? "Delete file"
                  : "Temporary download link"
          }
          close={() => {
            if (!busy) {
              setLink(undefined);
              setDialog(undefined);
            }
          }}
        >
          <p className="filename">
            <strong>{dialog.file.originalName}</strong>
          </p>
          {dialog.action === "preview" && (
            <Preview
              href={
                "/vault-api" + endpoint + "/" + dialog.file.id + "/download"
              }
            />
          )}
          {dialog.action === "details" && (
            <FileDetails path={endpoint + "/" + dialog.file.id} />
          )}
          {(dialog.action === "delete" || dialog.action === "link") &&
            !link && (
              <form className="stack" onSubmit={submit}>
                {dialog.action === "delete" ? (
                  <p>
                    This removes the stored file and disables its download
                    links.
                  </p>
                ) : (
                  <label>
                    Expires in (seconds)
                    <input
                      name="ttl"
                      type="number"
                      min={1}
                      max={maxTtl}
                      defaultValue={Math.min(60, maxTtl)}
                      required
                    />
                  </label>
                )}
                {dialogError && (
                  <p role="alert" className="error">
                    {dialogError}
                  </p>
                )}
                <button
                  disabled={busy}
                  className={dialog.action === "delete" ? "danger" : "primary"}
                >
                  {dialog.action === "delete"
                    ? "Confirm delete"
                    : "Generate link"}
                </button>
              </form>
            )}
          {link && (
            <>
              <label>
                Signed URL
                <input value={link.url} readOnly />
              </label>
              <p>
                Expires {date(link.expiresAt)}. Anyone with this link can use it
                until it expires or the file becomes unavailable.
              </p>
              <Copy value={link.url} label="Copy signed link" />
            </>
          )}
        </Modal>
      )}
    </section>
  );
}

function FileDetails({ path }: { path: string }) {
  const file = useResource<StoredFile>(path);
  if (!file.value) return <Feedback {...file} retry={file.refresh} />;
  return (
    <dl className="details">
      <dt>State</dt>
      <dd>
        <Badge value={file.value.state} />
      </dd>
      <dt>Type</dt>
      <dd>{file.value.contentType}</dd>
      <dt>Size</dt>
      <dd>{size(Number(file.value.sizeBytes))}</dd>
      <dt>SHA-256</dt>
      <dd className="mono">{file.value.sha256 ?? "—"}</dd>
      <dt>Created</dt>
      <dd>{date(file.value.createdAt)}</dd>
    </dl>
  );
}
