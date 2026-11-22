import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { createDockyard, login, png } from "./helpers";

const api = "http://127.0.0.1:4315/api";

test("external upload is visible and manageable in VaultFS", async ({
  page,
  request,
}) => {
  await login(page);
  const id = await createDockyard(page, "Acceptance " + randomUUID());
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Files", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "API keys" }).click();
  await page.getByRole("button", { name: "Create API key" }).click();
  await page.getByLabel("Name", { exact: true }).fill("External project");
  for (const scope of ["READ", "WRITE"])
    await page.getByLabel(scope, { exact: true }).check();
  await page.getByRole("button", { name: "Generate key" }).click();
  const secret = page.getByRole("textbox", { name: "API key secret" });
  await expect(secret).toBeVisible();
  const headers = { "X-API-Key": await secret.inputValue() };
  await page.getByRole("button", { name: "Close" }).click();
  await expect(secret).toHaveCount(0);
  expect(
    (await request.get(api + "/integration/me", { headers })).status(),
  ).toBe(200);

  const uploaded = await request.post(api + "/dockyard/" + id + "/files", {
    headers,
    multipart: {
      file: { name: "external.png", mimeType: "image/png", buffer: png },
    },
  });
  expect(uploaded.status()).toBe(201);
  await page.getByRole("button", { name: "Files", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "external.png" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByRole("img", { name: "File preview" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  const download = page.waitForEvent("download");
  await row.getByRole("link", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toBe("external.png");

  await row.getByRole("button", { name: "Verify SHA-256" }).click();
  await expect(
    page.getByText("SHA-256 verified for external.png."),
  ).toBeVisible();
  await row.getByRole("button", { name: "Signed link" }).click();
  await page.getByRole("button", { name: "Generate link" }).click();
  const signed = page.getByLabel("Signed URL");
  await expect(signed).toBeVisible();
  expect((await request.get(await signed.inputValue())).status()).toBe(200);
  await page.getByRole("button", { name: "Close" }).click();
  await row.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByText("File deleted.")).toBeVisible();

  await page.getByRole("button", { name: "API keys" }).click();
  await page.getByRole("button", { name: "Revoke", exact: true }).click();
  await page.getByRole("button", { name: "Confirm revoke" }).click();
  await expect(page.getByText("REVOKED", { exact: true })).toBeVisible();
  expect(
    (await request.get(api + "/integration/me", { headers })).status(),
  ).toBe(401);
});

test("browser uploads multiple files and member permissions control the dashboard", async ({
  page,
  browser,
}) => {
  await login(page);
  const id = await createDockyard(page, "Permission test " + randomUUID());
  const email = randomUUID() + "@vaultfs-test.invalid";
  const password = "Viewer-" + randomUUID() + "-7!";
  const created = await page.request.post(api + "/users", {
    data: { name: "Acceptance member", email, password },
  });
  expect(created.status()).toBe(201);
  const { user } = (await created.json()) as { user: { id: string } };
  await page
    .getByLabel("Choose files")
    .setInputFiles(
      ["first.png", "second.png"].map((name) => ({
        name,
        mimeType: "image/png",
        buffer: png,
      })),
    );
  await page.getByRole("button", { name: "Upload files" }).click();
  await expect(page.getByText("Uploaded 2 file(s).")).toBeVisible();

  await page.getByRole("button", { name: "Members" }).click();
  await page.getByRole("button", { name: "Add member" }).click();
  await page.getByLabel("User ID").fill(user.id);
  await page.getByRole("button", { name: "Save member" }).click();
  const member = page.getByRole("row").filter({ hasText: email });
  await expect(member.getByText("VIEWER")).toBeVisible();

  const viewer = await browser.newPage();
  try {
    await viewer.goto("http://127.0.0.1:4316/login");
    await viewer.getByLabel("Email").fill(email);
    await viewer.getByLabel("Password").fill(password);
    await viewer.getByRole("button", { name: "Sign in" }).click();
    await expect(
      viewer.getByRole("heading", { name: "Dockyards" }),
    ).toBeVisible();
    await viewer.goto("http://127.0.0.1:4316/dockyards/" + id);
    await expect(viewer.getByRole("link", { name: "Download" })).toHaveCount(2);
    for (const name of ["Upload files", "API keys", "Members", "Delete"]) {
      await expect(
        viewer.getByRole("button", { name, exact: true }),
      ).toHaveCount(0);
    }

    await member.getByRole("button", { name: "Change role" }).click();
    await page
      .getByRole("combobox", { name: "Role", exact: true })
      .selectOption("MANAGER");
    await page.getByRole("button", { name: "Save member" }).click();
    await expect(member.getByText("MANAGER")).toBeVisible();
    await viewer.reload();
    await expect(
      viewer.getByRole("button", { name: "Upload files" }),
    ).toBeVisible();

    await member.getByRole("button", { name: "Remove", exact: true }).click();
    await page.getByRole("button", { name: "Confirm removal" }).click();
    await expect(member).toHaveCount(0);
    await viewer.reload();
    await expect(
      viewer.getByText("Dockyard not found", { exact: true }),
    ).toBeVisible();
  } finally {
    await viewer.close();
  }
});

test("protected routes require a session and sign-out clears access", async ({
  page,
}) => {
  await page.goto("/dockyards");
  await expect(page).toHaveURL(/\/login$/);
  await login(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/dockyards");
  await expect(page).toHaveURL(/\/login$/);
});
