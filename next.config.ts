import type { NextConfig } from "next";

// Cabeceras de seguridad para todas las rutas (Cloud Run ya fuerza HTTPS).
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["pg", "google-auth-library", "@google-cloud/firestore"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  outputFileTracingExcludes: {
    "*": [
      "./agents/**/*",
      "./.data/**/*",
      "./.data-qa/**/*",
      "./.env*",
      "./tests/**/*",
    ],
  },
};
export default config;
