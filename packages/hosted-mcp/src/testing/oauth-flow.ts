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

export interface UmbracoCloudSsoOptions {
  /** Email of the Umbraco ID / Azure B2C account. */
  email: string;
  /** Password of the Umbraco ID / Azure B2C account. */
  password: string;
}

/**
 * Pre-authenticate against an Umbraco Cloud project using Umbraco ID SSO.
 *
 * The project's OAuth backoffice authorize endpoint shows a local login form
 * with no external-provider button. To use SSO we instead drive the project's
 * regular `/umbraco` route, which auto-redirects to `identity.umbraco.com` →
 * Azure B2C. Once we authenticate there, the project's session cookie is set
 * and any subsequent OAuth flow completes silently (no login UI).
 *
 * Call this before initiating the OAuth flow (e.g. before `connectInspector`).
 *
 * @returns the page after returning to the project, ready to be closed.
 */
export async function authenticateUmbracoCloudSso(
  page: Page,
  projectBaseUrl: string,
  options: UmbracoCloudSsoOptions,
): Promise<void> {
  await page.goto(`${projectBaseUrl.replace(/\/$/, "")}/umbraco`);

  // Wait until we land on identity.umbraco.com / Azure B2C.
  await page.waitForURL(
    (url) =>
      url.hostname === "identity.umbraco.com" ||
      url.hostname.endsWith("b2clogin.com") ||
      url.hostname === "login.microsoftonline.com",
    { timeout: 60_000 },
  );
  await page.waitForLoadState("networkidle", { timeout: 60_000 });

  // Fill email. The Umbraco ID flow renders email+password on one page;
  // older B2C flows use two pages — we handle both.
  const emailField = page
    .locator(
      'input[type="email"], input[name="email"], input#email, input#signInName',
    )
    .first();
  await emailField.waitFor({ timeout: 30_000 });
  await emailField.click();
  await emailField.pressSequentially(options.email, { delay: 25 });

  const passwordField = page
    .locator('input[type="password"], input[name="password"], input#password')
    .first();

  if (!(await passwordField.isVisible().catch(() => false))) {
    const nextButton = page
      .getByRole("button", { name: /next|continue/i })
      .first();
    if (await nextButton.isVisible().catch(() => false)) {
      await nextButton.click();
      await passwordField.waitFor({ timeout: 30_000 });
    }
  }

  await passwordField.click();
  await passwordField.pressSequentially(options.password, { delay: 25 });

  const submitButton = page
    .getByRole("button", { name: /sign in|log in|login|submit|next/i })
    .first();
  await submitButton.click();

  // Wait until we land back on the project's host.
  const projectHost = new URL(projectBaseUrl).hostname;
  await page.waitForURL((url) => url.hostname === projectHost, {
    timeout: 60_000,
  });
}

/**
 * Drive the OAuth flow on the Umbraco Cloud project assuming the user is
 * already authenticated to the project (use `authenticateUmbracoCloudSso`
 * first). Approves consent and waits for the OAuth flow to complete silently.
 */
export async function handleUmbracoCloudOAuthFlow(
  _mainPage: Page,
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
