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

export interface OAuthFlowOptions {
  /**
   * Predicate matching the redirected Umbraco login URL. Defaults to a
   * `localhost` + `/umbraco` path matcher for the in-repo test instance.
   * Override when the OAuth provider lives somewhere else (e.g. Umbraco Cloud).
   */
  umbracoLoginUrlMatch?: (url: URL) => boolean;
}

const DEFAULT_CREDENTIALS: OAuthCredentials = {
  email: "admin@admin.com",
  password: "1234567890",
};

const DEFAULT_LOGIN_URL_MATCH = (url: URL) =>
  url.hostname === "localhost" && url.pathname.includes("/umbraco");

/**
 * Handle the OAuth flow on the consent/login page.
 *
 * @param mainPage - The main Inspector page (unused but kept for consistent call signature)
 * @param oauthPage - The page showing consent screen or Umbraco login
 * @param consentOptions - Optional consent screen interactions
 * @param credentials - Login credentials (defaults to test Umbraco admin)
 * @param options - Additional flow customisation (e.g. login URL matcher)
 */
export async function handleOAuthFlow(
  _mainPage: Page,
  oauthPage: Page,
  consentOptions?: ConsentOptions,
  credentials?: Partial<OAuthCredentials>,
  options?: OAuthFlowOptions,
): Promise<void> {
  const creds = { ...DEFAULT_CREDENTIALS, ...credentials };
  const loginUrlMatch =
    options?.umbracoLoginUrlMatch ?? DEFAULT_LOGIN_URL_MATCH;

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
  await oauthPage.waitForURL(loginUrlMatch, { timeout: 30000 });

  // Wait for the page's JavaScript bundle to settle before filling fields —
  // Cloud's login form uses a client-side framework that won't accept input
  // until it has bootstrapped.
  await oauthPage.waitForLoadState("networkidle", { timeout: 30000 });

  const loginButton = oauthPage.getByRole("button", { name: "Login" });
  await loginButton.waitFor({ timeout: 30000 });

  const emailInput = oauthPage.getByRole("textbox").first();
  const passwordInput = oauthPage.getByRole("textbox").nth(1);

  // Use pressSequentially + Tab rather than fill — frameworks that bind
  // value via JS often miss the synthetic single-event from fill().
  await emailInput.click();
  await emailInput.pressSequentially(creds.email, { delay: 25 });
  await emailInput.press("Tab");

  await passwordInput.click();
  await passwordInput.pressSequentially(creds.password, { delay: 25 });
  await passwordInput.press("Tab");

  await loginButton.click();
}

/**
 * Approve the consent screen for an Umbraco Cloud OAuth flow. The Cloud
 * project's short-circuit composer redirects to Umbraco ID SSO from there;
 * the caller drives the B2C login form afterwards.
 */
export async function handleUmbracoCloudOAuthFlow(
  oauthPage: Page,
  consentOptions?: ConsentOptions,
): Promise<void> {
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
}
