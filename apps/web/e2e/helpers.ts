import { expect, type Page } from "@playwright/test";

export const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVQImWMwcT8BRwzEcQAD8hQx1zpSVgAAAABJRU5ErkJggg==",
  "base64",
);

export async function login(page: Page) {
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!email || !password)
    throw new Error("Set the disposable dashboard test account credentials.");
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
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
