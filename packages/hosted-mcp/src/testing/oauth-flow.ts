/**
 * OAuth flow helpers for E2E tests.
 *
 * Handles the consent screen and Umbraco login page interactions.
 */

import type { Page } from "@playwright/test";

export interface ConsentOptions {
  checkModes?: string[];
  uncheckModes?: string[];
  uncheckCollections?: string[];
  uncheckSlices?: string[];
  checkReadOnly?: boolean;
}

export interface OAuthCredentials {
  email: string;
  password: string;
}

const DEFAULT_CREDENTIALS: OAuthCredentials = {
  email: "admin@admin.com",
  password: "1234567890",
};

/**
 * Handle the OAuth flow on the consent/login page.
 *
 * @param mainPage - The main Inspector page (unused but kept for consistent call signature)
 * @param oauthPage - The page showing consent screen or Umbraco login
 * @param consentOptions - Optional consent screen interactions
 * @param credentials - Login credentials (defaults to test Umbraco admin)
 */
export async function handleOAuthFlow(
  _mainPage: Page,
  oauthPage: Page,
  consentOptions?: ConsentOptions,
  credentials?: Partial<OAuthCredentials>,
): Promise<void> {
  const creds = { ...DEFAULT_CREDENTIALS, ...credentials };

  // Consent screen — approve (with optional checkbox modifications)
  const approveButton = oauthPage.locator('button[value="approve"]');
  await approveButton.waitFor();

  if (consentOptions) {
    if (consentOptions.checkModes) {
      for (const mode of consentOptions.checkModes) {
        const checkbox = oauthPage.locator(`.mode-checkbox[value="${mode}"]`);
        if (!(await checkbox.isChecked())) await checkbox.check();
      }
    }

    if (consentOptions.uncheckModes) {
      for (const mode of consentOptions.uncheckModes) {
        const checkbox = oauthPage.locator(`.mode-checkbox[value="${mode}"]`);
        if (await checkbox.isChecked()) await checkbox.uncheck();
      }
    }

    if (consentOptions.uncheckCollections) {
      for (const name of consentOptions.uncheckCollections) {
        const checkboxes = oauthPage.locator(`.collection-checkbox[value="${name}"]`);
        const count = await checkboxes.count();
        for (let i = 0; i < count; i++) {
          const cb = checkboxes.nth(i);
          if (await cb.isEnabled() && await cb.isChecked()) await cb.uncheck();
        }
      }
    }

    if (consentOptions.uncheckSlices) {
      for (const slice of consentOptions.uncheckSlices) {
        const checkbox = oauthPage.locator(`.slice-checkbox[value="${slice}"]`);
        if (await checkbox.isChecked()) await checkbox.uncheck();
      }
    }

    if (consentOptions.checkReadOnly) {
      const readOnlyCheckbox = oauthPage.locator('input[name="readOnly"]');
      if (!(await readOnlyCheckbox.isChecked())) await readOnlyCheckbox.check();
    }
  }

  await approveButton.click();

  // Umbraco login page
  await oauthPage.waitForURL(
    (url) => url.hostname === "localhost" && url.pathname.includes("/umbraco"),
    { timeout: 15000 },
  );

  const emailInput = oauthPage.getByRole("textbox").first();
  await emailInput.waitFor({ timeout: 10000 });
  await emailInput.fill(creds.email);
  await oauthPage.getByRole("textbox").nth(1).fill(creds.password);
  await oauthPage.getByRole("button", { name: "Login" }).click();
}
