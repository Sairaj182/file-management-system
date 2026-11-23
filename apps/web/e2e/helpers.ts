import { expect, type Page } from "@playwright/test";
import { setTimeout } from "node:timers/promises";
import { webBase } from "./targets";

export const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVQImWMwcT8BRwzEcQAD8hQx1zpSVgAAAABJRU5ErkJggg==",
  "base64",
);

export async function login(page: Page) {
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!email || !password)
    throw new Error("Set the disposable dashboard test account credentials.");
  await signIn(page, email, password);
}

export async function signIn(page: Page, email: string, password: string) {
  await page.goto(webBase + "/login");
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    const response = page.waitForResponse(
      (candidate) => new URL(candidate.url()).pathname === "/vault-api/auth/sign-in/email" &&
        candidate.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Sign in" }).click();
    if ((await response).status() !== 429 || attempt === 1) break;
    // The local Docker suite shares Better Auth's ten-second sign-in window.
    await setTimeout(11_000);
  }
  await expect(page.getByRole("heading", { name: "Dockyards" })).toBeVisible();
}

export async function createDockyard(page: Page, notes: string) {
  await page.getByRole("button", { name: "Create Dockyard" }).click();
  await page.getByLabel("Dockyard notes").fill(notes);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: notes, exact: true }),
  ).toBeVisible();
  return new URL(page.url()).pathname.split("/").at(-1)!;
}
