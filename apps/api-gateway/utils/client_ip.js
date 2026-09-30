import { isIPv4, isIPv6 } from "node:net";
import { getConnInfo } from "@hono/node-server/conninfo";

/**
 * Server-side client IP resolution (Phase 3A).
 *
 * Contract:
 *  - resolveClientIp(c) -> normalized client IP string, or null if unavailable.
 *  - Purity: no database, no Redis, no network calls, no request mutation.
 *  - Normalization lives in normalizeAddress() only (single source of truth).
 *
 * Trust model (TRUSTED_PROXY_HOPS, read from process.env on every call):
 *  - 0 (default / any invalid value): DIRECT mode. The TCP socket peer from
 *    getConnInfo(c) is authoritative. All forwarded headers
 *    (X-Forwarded-For, X-Real-IP, CF-Connecting-IP, Forwarded) are ignored
 *    and never consulted - they are client-controlled and spoofable when
 *    there is no trusted proxy in front of the gateway.
 *  - 1..MAX_TRUSTED_PROXY_HOPS: TRUSTED PROXY mode. Exactly N proxies are
 *    assumed between clients and the gateway, each appending the address it
 *    received the connection from (de-facto XFF append convention). The
 *    client is taken from the right-to-left position: index
 *    (entries.length - N). If the chain is shorter than N, the header is
 *    absent, the anchor socket is missing, or the selected entry is not a
 *    valid IP, we return null (fail-safe - never guess, never take XFF[0]).
 *    Limitation (documented, not guessed away): hop counting assumes every
 *    trusted proxy appends exactly one entry; there is no CIDR-based hop
 *    validation in this layer.
 *  - Values above the cap (misconfiguration) fall back to 0 (direct mode),
 *    never to "trust everything".
 *
 * This module is intentionally NOT wired into any enforcement point yet.
 * Enforcement / organization whitelist checks are later phases.
 */

const MAX_TRUSTED_PROXY_HOPS = 8;

/**
 * Parses TRUSTED_PROXY_HOPS safely.
 * Invalid, negative, fractional, non-numeric or out-of-range values -> 0
 * (direct socket mode). They must never become a trusted proxy config.
 */
export function parseTrustedProxyHops(raw = process.env.TRUSTED_PROXY_HOPS) {
  if (raw === undefined || raw === null) return 0;
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) return 0;
  const value = Number.parseInt(text, 10);
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TRUSTED_PROXY_HOPS) return 0;
  return value;
}

/**
 * Classifies an already-normalized address: "IPv4" | "IPv6" | null.
 */
export function classifyIp(address) {
  if (typeof address !== "string" || address === "") return null;
  if (isIPv4(address)) return "IPv4";
  if (isIPv6(address)) return "IPv6";
  return null;
}

function hexPairToDotted(high, low) {
  const h = Number.parseInt(high, 16);
  const l = Number.parseInt(low, 16);
  return [(h >> 8) & 255, h & 255, (l >> 8) & 255, l & 255].join(".");
}

/**
 * Single normalization point for every IP the gateway reads.
 *  - trims whitespace, strips IPv6 zone ids (fe80::1%eth0)
 *  - IPv4-mapped IPv6 (::ffff:1.2.3.4 dotted, ::ffff:7f00:1 hex) -> IPv4
 *  - native IPv6 kept verbatim (never coerced, never corrupted)
 *  - anything else -> null (controlled failure; no invented addresses)
 */
export function normalizeAddress(raw) {
  if (typeof raw !== "string") return null;
  let address = raw.trim();
  const zoneIndex = address.indexOf("%");
  if (zoneIndex !== -1) address = address.slice(0, zoneIndex).trim();
  if (address === "") return null;

  const lower = address.toLowerCase();
  if (lower.startsWith("::ffff:")) {
    const rest = address.slice(7);
    if (isIPv4(rest)) return rest;
    const hex = rest.match(/^([0-9a-fA-F]{1,4}):([0-9a-fA-F]{1,4})$/);
    if (hex) return hexPairToDotted(hex[1], hex[2]);
    return null;
  }

  if (isIPv4(address)) return address;
  if (isIPv6(address)) return address;
  return null;
}

function socketAddressOf(c) {
  try {
    const info = getConnInfo(c);
    return info?.remote?.address;
  } catch {
    return undefined;
  }
}

function forwardedChain(c) {
  try {
    const raw = typeof c?.req?.header === "function" ? c.req.header("x-forwarded-for") : undefined;
    if (typeof raw !== "string" || raw.trim() === "") return null;
    const entries = raw
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");
    return entries.length > 0 ? entries : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the client IP for a request context.
 * Returns a normalized IP string, or null when it cannot be determined
 * safely. Never throws.
 */
export function resolveClientIp(c) {
  try {
    const hops = parseTrustedProxyHops();
    const socketIp = normalizeAddress(socketAddressOf(c));

    if (hops === 0) {
      // Direct mode: socket peer only. Forwarded headers are never read.
      return socketIp;
    }

    // Trusted proxy mode (1..MAX_TRUSTED_PROXY_HOPS).
    if (socketIp === null) return null;
    const chain = forwardedChain(c);
    if (chain === null) return null;
    if (chain.length < hops) return null;

    const candidate = chain[chain.length - hops];
    return normalizeAddress(candidate);
  } catch {
    return null;
  }
}
