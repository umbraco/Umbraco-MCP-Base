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
  put(key: string, value: string): Promise<void>;
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
  await kv.put(forwardKey(alias, clientId), JSON.stringify(record));
  await kv.put(reverseKey(clientId), alias);
}

/**
 * Forward lookup — does this client have a binding for this specific tenant?
 */
export async function hasClientBinding(
  kv: KVNamespaceLike,
  alias: string,
  clientId: string
): Promise<boolean> {
  const value = await kv.get(forwardKey(alias, clientId));
  return value !== null;
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
