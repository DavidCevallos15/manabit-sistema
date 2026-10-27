import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg", "google-auth-library"],
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
