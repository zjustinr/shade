import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // §10 Privacy: nothing here may send user data off-origin.
  poweredByHeader: false,
};

export default withNextIntl(nextConfig);
