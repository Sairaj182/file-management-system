import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { upstream } from "../../lib/upstream";
import type { Account } from "../../lib/dashboard-api";
import { Workspace } from "../../components/workspace";

export default async function DockyardsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookie = (await cookies()).toString();
  if (!cookie) redirect("/login");
  const response = await fetch(upstream("/users/me"), {
    headers: { cookie },
    cache: "no-store",
  }).catch(() => null);
  if (response?.status === 401 || response?.status === 403) redirect("/login");
  if (!response?.ok)
    return (
      <main className="login">
        <div className="login-inner">
          <h1>VaultFS is unavailable</h1>
          <p>Reload this page to try again.</p>
        </div>
      </main>
    );
  const { user, permissions, isSuperAdmin } =
    (await response.json()) as Account;
  return (
    <Workspace
      account={{
        user: { id: user.id, name: user.name, email: user.email },
        permissions,
        isSuperAdmin,
      }}
    >
      {children}
    </Workspace>
  );
}
