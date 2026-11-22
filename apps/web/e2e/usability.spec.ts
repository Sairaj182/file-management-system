import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
import { createDockyard, login, png } from "./helpers";

test("login and dashboard pass axe and stay within a mobile viewport", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.map(
      (item) => item.id,
    ),
  ).toEqual([]);
  await login(page);
  await createDockyard(page, "Product images");
  await page.getByLabel("Choose files").setInputFiles({
    name: "brand-swatch.png",
    mimeType: "image/png",
    buffer: png,
  });
  await page.getByRole("button", { name: "Upload files" }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "brand-swatch.png" }),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.map(
      (item) => item.id,
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath("dockyard-mobile.png") });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: info.outputPath("dockyard-desktop.png") });
  await page.getByRole("button", { name: "API keys" }).click();
  await page.getByRole("button", { name: "Create API key" }).click();
  await expect(
    page.getByRole("dialog", { name: "Create API key" }),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.map(
      (item) => item.id,
    ),
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
