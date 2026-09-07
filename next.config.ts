import type { NextConfig } from "next";
import path from "node:path";

// Next.js doesn't emit CSP nonces for its own hydration bootstrap scripts
// without extra middleware wiring, so script-src/style-src need
// 'unsafe-inline' to avoid breaking every page — CSP still meaningfully
// restricts *remote* script/style/frame/object origins, which is the
// higher-value protection here (this app never uses
// dangerouslySetInnerHTML, so the inline-script injection surface CSP
// would otherwise close is already small).
//
// 'unsafe-eval' is added to script-src in development only: React/Next dev
// mode (and Turbopack HMR) use eval() to reconstruct server error stacks in
// the browser. Neither React nor Next.js use eval() in production, so it's
// omitted there.
const isDev = process.env.NODE_ENV === "development";

// Paddle's checkout overlay (Paddle.js) needs three carve-outs: its script
// from Paddle's CDN, the checkout iframe itself (both sandbox and
// production domains, so switching PADDLE_ENVIRONMENT never needs a
// redeploy of this header), and the API calls Paddle.js makes directly
// from the browser (pricing/localization lookups, event reporting). This
// is the only third-party origin allowed anywhere in this policy.
const PADDLE_SCRIPT_ORIGIN = "https://cdn.paddle.com";
const PADDLE_CHECKOUT_ORIGINS = "https://checkout.paddle.com https://sandbox-checkout.paddle.com";
const PADDLE_API_ORIGINS = "https://api.paddle.com https://sandbox-api.paddle.com";
// Permissions-Policy allowlist origins are quoted strings, unlike CSP's
// bare-origin syntax — a separate, correctly-quoted form of the same list.
const PADDLE_CHECKOUT_ORIGINS_QUOTED = '"https://checkout.paddle.com" "https://sandbox-checkout.paddle.com"';

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${PADDLE_SCRIPT_ORIGIN}${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  `connect-src 'self' ${PADDLE_CHECKOUT_ORIGINS} ${PADDLE_API_ORIGINS}`,
  `frame-src ${PADDLE_CHECKOUT_ORIGINS}`,
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // Aegis uses none of these browser capabilities itself; deny them for
  // every origin so a future dependency or injected script can't silently
  // start. `payment` is the one exception: it's a top-level restriction, so
  // denying it here would also block Apple Pay/Google Pay inside Paddle's
  // checkout iframe even though the iframe's own `allow` attribute permits
  // it — a child frame can only narrow permissions granted here, never
  // widen them.
  {
    key: "Permissions-Policy",
    value: `camera=(), microphone=(), geolocation=(), payment=(self ${PADDLE_CHECKOUT_ORIGINS_QUOTED}), usb=(), browsing-topics=()`,
  },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
