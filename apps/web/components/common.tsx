"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { data } from "../lib/dashboard-api";
import { errorMessage } from "./workspace";

export function useResource<T>(path: string) {
  const [result, setResult] = useState<{
    path: string;
    revision: number;
    value?: T;
    error?: string;
  }>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    data<T>(path).then(
      (value) => {
        if (active) setResult({ path, revision, value });
      },
      (error) => {
        if (active) setResult({ path, revision, error: errorMessage(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [path, revision]);
  const current =
    result?.path === path && result.revision === revision ? result : undefined;
  return {
    value: current?.value,
    error: current?.error,
    loading: !current,
    refresh: () => setRevision((n) => n + 1),
  };
}

export function Feedback({
  loading,
  error,
  retry,
}: {
  loading?: boolean;
  error?: string;
  retry?: () => void;
}) {
  if (loading)
    return (
      <div className="skeleton panel" role="status" aria-label="Loading">
        <i />
        <i />
        <i />
      </div>
    );
  if (error)
    return (
      <div className="panel">
        <p className="error" role="alert">
          {error}
        </p>
        {retry && <button onClick={retry}>Retry</button>}
      </div>
    );
  return null;
}
export function Badge({ value }: { value: string }) {
  return (
    <span className={`badge ${value.toLowerCase()}`}>
      {value.replaceAll("_", " ").replace(/^INCUSTODY$/, "IN CUSTODY")}
    </span>
  );
}
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="spread">
        <h2>{title}</h2>
        <button onClick={close}>Close</button>
      </div>
      {children}
    </dialog>
  );
}
export function Copy({ value, label }: { value: string; label: string }) {
  const [status, setStatus] = useState("");
  return (
    <>
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setStatus("Copied");
          } catch {
            setStatus("Select the text and copy it manually.");
          }
        }}
      >
        {label}
      </button>
      <span className="muted" role="status">
        {status}
      </span>
    </>
  );
}
export function date(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}
