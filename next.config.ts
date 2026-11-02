import type { NextConfig } from "next";

// Run the server in Indian Standard Time, so any date the server works out
// (e.g. "today") matches the clock in the stores.
process.env.TZ = "Asia/Kolkata";

const nextConfig: NextConfig = {};

export default nextConfig;
