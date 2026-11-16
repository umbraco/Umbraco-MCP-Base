/**
 * Per-tenant client-id binding store.
 *
 * Two records per registration, both written at /at/<alias>/register:
 *
 *   at:<alias>:client:<client_id>   forward index — "is this client allowed at this tenant?"
 *   client:<client_id>:tenant       reverse index — "which tenant is this client registered for?"
 *
 * Forward feeds /at/<alias>/authorize and /at/<alias>/token.
 * Reverse feeds root /authorize confused-deputy defence under siteRouting.
 *
 * Both are load-bearing for security — without the reverse index, an attacker
 * who registered a client_id at /at/A/register could authorise for tenant B
 * via root /authorize?resource=${origin}/at/B&client_id=<their A client>.
 */

interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

const FORWARD_PREFIX = "at:";
const REVERSE_PREFIX = "client:";

function forwardKey(alias: string, clientId: string): string {
  return `${FORWARD_PREFIX}${alias}:client:${clientId}`;
}

function reverseKey(clientId: string): string {
  return `${REVERSE_PREFIX}${clientId}:tenant`;
}

interface ForwardRecord {
  createdAt: number;
}

/**
 * Bindings expire when unused, so abandoned registrations don't accumulate.
 * A binding in use is rewritten (both keys, fresh TTL) once it is older than
 * `BINDING_REFRESH_AFTER_MS`, so it outlives its client registration however
 * long the OAuth provider keeps that (90 days by default).
 */
export const BINDING_TTL_SECONDS = 120 * 24 * 60 * 60;
const BINDING_REFRESH_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Write the binding pair. KV doesn't expose multi-key transactions — we write
 * forward then reverse. If the second write fails, the forward record is
 * orphaned but harmless (extra row, no security impact — the reverse-index
 * check at root authorize will return null, which fails the binding check).
 */
export async function putClientBinding(
  kv: KVNamespaceLike,
  alias: string,
  clientId: string
): Promise<void> {
  const record: ForwardRecord = { createdAt: Date.now() };
  const options = { expirationTtl: BINDING_TTL_SECONDS };
  await kv.put(forwardKey(alias, clientId), JSON.stringify(record), options);
  await kv.put(reverseKey(clientId), alias, options);
}

/**
 * Forward lookup — does this client have a binding for this specific tenant?
 * Extends the binding's lifetime when it is due (see `BINDING_TTL_SECONDS`).
 */
export async function hasClientBinding(
  kv: KVNamespaceLike,
  alias: string,
  clientId: string
): Promise<boolean> {
  const value = await kv.get(forwardKey(alias, clientId));
  if (value === null) return false;
  if (isDueForRefresh(value)) {
    // Best effort: the binding is valid either way.
    await putClientBinding(kv, alias, clientId).catch(() => undefined);
  }
  return true;
}

function isDueForRefresh(value: string): boolean {
  try {
    const createdAt = (JSON.parse(value) as Partial<ForwardRecord>).createdAt;
    return typeof createdAt !== "number" || Date.now() - createdAt > BINDING_REFRESH_AFTER_MS;
  } catch {
    return true;
  }
}

/**
 * Reverse lookup — which tenant did this client register for?
 * Returns null when the client_id was never bound (e.g. registered at root
 * `/register` without siteRouting, or a fabricated client_id).
 */
export async function getClientTenant(
  kv: KVNamespaceLike,
  clientId: string
): Promise<string | null> {
  return kv.get(reverseKey(clientId));
}

/**
 * Delete both forward and reverse keys. Looks up the alias via reverse first
 * so the forward key path is exact. No-op when the client is not bound.
 */
export async function revokeClient(
  kv: KVNamespaceLike,
  clientId: string
): Promise<void> {
  const alias = await kv.get(reverseKey(clientId));
  if (!alias) return;
  await kv.delete(forwardKey(alias, clientId));
  await kv.delete(reverseKey(clientId));
}
