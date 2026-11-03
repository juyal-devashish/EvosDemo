import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import Link from "next/link";
import { ConvexClientProvider } from "./ConvexClientProvider";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], weight: ["300", "400", "500"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Earned Autonomy",
  description:
    "Release suite, permission system and production monitor for one AI scheduling operator in a simulated PCB factory. An independent work sample.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable}`}>
      <body>
        <div className="strip">Simulation · synthetic factory and data · independent work sample, not an Evos product</div>
        <div className="shell">
          <header className="nav">
            <Link href="/" className="brand" aria-label="Earned Autonomy, results">
              <span className="mark" aria-hidden="true" />
              Earned Autonomy
            </Link>
            <nav className="nav-links" aria-label="Main">
              <Link href="/" aria-current="page">
                Results
              </Link>
            </nav>
            <div className="nav-meta">
              <span className="badge badge-neutral">Independent manufacturing demo</span>
            </div>
          </header>
          <ConvexClientProvider>{children}</ConvexClientProvider>
          <footer className="footer">
            Everything here is simulated: the factory, machines, orders and reviewer are synthetic. The operator is a real
            Claude model. Demotion, recovery and monitoring rules are this project&apos;s own design, not Evos&apos;s.
          </footer>
        </div>
      </body>
    </html>
  );
}
