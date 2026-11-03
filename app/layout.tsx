import type { Metadata, Viewport } from "next";
import { Geist_Mono, Poppins } from "next/font/google";
import "./globals.css";

// Same typeface as sevenyears.in (Poppins 400 / 500 / 600 / 700).
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Seven Years Care — Warranty & Service",
    template: "%s | Seven Years Care",
  },
  description:
    "Register your Seven Years product warranty, view certificates, request service, raise complaints and track support.",
  appleWebApp: { capable: true, title: "SY Care", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#8883d7",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${poppins.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
