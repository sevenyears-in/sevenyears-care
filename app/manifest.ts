import type { MetadataRoute } from "next";

// Lets staff install Seven Years Care on their phone (Android and iPhone) from the browser.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Seven Years Care",
    short_name: "SY Care",
    description: "Warranty, service requests and complaints for Seven Years staff.",
    id: "/staff",
    start_url: "/staff",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f9fb",
    theme_color: "#8883d7",
    icons: [
      { src: "/app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
