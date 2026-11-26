import { expect, test } from "@playwright/test";
import { chooseOption } from "./controls";

test("desktop panels use compact controls and report operations in toasts", async ({
  page,
}, testInfo) => {
  await page.goto("/?playground=1");

  await page
    .getByRole("button", { name: "Remote Explorer", exact: true })
    .click();
  const ssh = page.getByRole("region", { name: "SSH servers" });
  await expect(
    ssh.getByRole("heading", { name: "No SSH hosts" }),
  ).toBeVisible();
  await expect(
    ssh.getByRole("textbox", { name: "Filter SSH servers" }),
  ).toHaveCount(0);
  await ssh.getByRole("button", { name: "Add host", exact: true }).click();
  const server = page.getByRole("dialog", { name: "Add SSH server" });
  await expect(server).toHaveClass(/devyy-modal/);
  const modalRadius = await server.evaluate(
    (dialog) => getComputedStyle(dialog).borderRadius,
  );
  await server.getByLabel("Host", { exact: true }).fill("test.example.com");
  await server.getByLabel("Username").fill("dev");
  await server.getByLabel("Display name").fill("Dev server");
  await server.getByRole("button", { name: "Save server" }).click();
  await expect(
    ssh.getByRole("button", { name: "Dev server", exact: true }),
  ).toBeVisible();

  await expect(
    ssh.getByRole("textbox", { name: "Filter SSH servers" }),
  ).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath("ssh.png") });
  await page.getByRole("tab", { name: "Ports" }).click();
  await expect(
    page.getByRole("heading", { name: "No forwarded ports" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Filter ports" })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Forward a port", exact: true })
    .click();
  const port = page.getByRole("dialog", { name: "Forward a port" });
  await expect(port).toHaveClass(/devyy-modal/);
  await expect(port).toHaveCSS("border-radius", modalRadius);
  await port.getByLabel("Local port").fill("3000");
  const box = await port.boundingBox();
  expect(box!.x + box!.width / 2).toBeCloseTo(
    page.viewportSize()!.width / 2,
    0,
  );
  await chooseOption(port.getByRole("combobox", { name: "Access" }), "public");
  await expect(
    port.getByText("Anyone with the address can open this service."),
  ).toBeVisible();
  await port.getByRole("button", { name: "Forward port" }).click();
  await expect(
    port.getByText("Open Devyy on your desktop to forward a port."),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("port.png") });
  await port.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Devyy account" }).click();
  const settings = page.getByRole("dialog", { name: "Preferences" });
  await expect(settings.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(
    settings.getByText("Account server", { exact: true }),
  ).toHaveCount(0);
  await settings.getByRole("tab", { name: "Source control" }).click();
  await expect(
    settings.getByRole("heading", { name: "Commit author" }),
  ).toBeVisible();
  await expect(
    settings.getByText("Source control provider", { exact: true }),
  ).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("source-control.png") });
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Toggle AI workspace" }).click();
  const title = page.getByRole("button", {
    name: "AI conversation history",
    exact: true,
  });
  await title.click();
  await expect(
    page
      .getByRole("dialog", { name: "Conversation history" })
      .getByRole("textbox", { name: "Search conversations" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Skills", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  const options = page.getByRole("button", { name: /Agent options:/ });
  await options.click();
  await chooseOption(page.getByRole("combobox", { name: "Agent mode" }), "ask");
  await expect(options).toHaveAccessibleName(
    "Agent options: Ask, Attachments only",
  );
  await page.keyboard.press("Escape");
  await page.screenshot({ path: testInfo.outputPath("agent.png") });
  await page.getByLabel("Conversation actions").click();
  await expect(
    page.getByRole("button", { name: "AI usage", exact: true }),
  ).toBeVisible();
});
