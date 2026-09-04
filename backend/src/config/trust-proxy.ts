/**
 * Which upstream hops Express may believe when resolving `req.ip`.
 *
 * Trusting a hop *count* breaks whenever the platform adds a hop: with `1`,
 * Render's second forwarding hop meant `req.ip` resolved to Render's own 10.x
 * address, so every visitor collapsed into a handful of rate-limit buckets.
 *
 * Trusting the private ranges instead makes Express walk X-Forwarded-For from
 * the right, skip the platform's hops however many there are, and stop at the
 * first public address — the real client. A forged X-Forwarded-For sits to the
 * left of the address Render appends, so it is ignored rather than believed;
 * `true` would take the leftmost entry and let anyone forge past the limiter.
 */
export const TRUST_PROXY = 'loopback, linklocal, uniquelocal';
