import type { Metadata } from "next";
import Link from "next/link";
import { Fraunces, Manrope } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Polymarket Impulse Bot",
  description: "Detect sudden price impulses, buy rising side, trail and hedge",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${fraunces.variable} ${manrope.variable}`}>
      <body>
        <div className="layout">
          <header className="layoutHeader">
            <div className="layoutHeaderInner">
              <Link href="/" className="appTitle">
                Polymarket Impulse Bot
              </Link>
              <nav className="nav">
                <Link href="/" className="navLink">
                  Dashboard
                </Link>
                <Link href="/settings" className="navLink">
                  Settings
                </Link>
              </nav>
            </div>
          </header>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
