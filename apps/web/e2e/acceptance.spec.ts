import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { createDockyard, login, png, signIn } from "./helpers";
import { apiBase as api, webBase } from "./targets";


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
    data: { email, password, dockyardId: id, role: "VIEWER" },
  });
  expect(created.status()).toBe(201);
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
  const member = page.getByRole("row").filter({ hasText: email });
  await expect(member.getByText("VIEWER")).toBeVisible();

  const viewer = await browser.newPage();
  try {
    await signIn(viewer, email, password);
    await viewer.goto(webBase + "/dockyards/" + id);
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

test("only Super Admin can create a user from the Dockyard dashboard", async ({ page, browser }) => {
  await login(page);
  const dockyardId = await createDockyard(page, "Provisioning " + randomUUID());
  await expect(page.getByRole("link", { name: "User management" })).toHaveCount(0);
  await page.getByRole("button", { name: "Members" }).click();
  await expect(page.getByRole("button", { name: "Add member" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add User", exact: true }).click();
  const email = `admin-${randomUUID()}@vaultfs-test.invalid`;
  const password = "Disposable-dashboard-password-8";
  const form = page.getByRole("dialog", { name: "Create user" });
  await expect(form.locator("input, select")).toHaveCount(4);
  await form.getByLabel("Login ID (email)").fill(email);
  await form.getByLabel("Password", { exact: true }).fill(password);
  const confirmation = form.getByLabel("Confirm password", { exact: true });
  await confirmation.fill("Mismatched-password-8");
  await form.getByRole("combobox", { name: "Role", exact: true }).selectOption("ADMIN");
  await form.getByRole("button", { name: "Create account" }).click();
  await expect(form.getByRole("alert")).toHaveText("Passwords must match.");
  await confirmation.fill(password);
  await form.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("row").filter({ hasText: email }).getByText("ADMIN", { exact: true })).toBeVisible();

  const admin = await browser.newPage();
  try {
    await signIn(admin, email, password);
    await admin.goto(webBase + "/dockyards/" + dockyardId);
    await admin.getByRole("button", { name: "Members" }).click();
    await expect(admin.getByRole("row").filter({ hasText: email }).getByText("ADMIN", { exact: true })).toBeVisible();
    await expect(admin.getByRole("button", { name: "Add User", exact: true })).toHaveCount(0);
  } finally {
    await admin.close();
  }
});
