import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Provedores } from "@/components/provedores";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Aprova+ — Estudos para concursos", template: "%s · Aprova+" },
  description: "Plataforma inteligente de estudos para concursos públicos: materiais, questões, simulados, cronograma e desempenho.",
  applicationName: "Aprova+",
  appleWebApp: { capable: true, title: "Aprova+", statusBarStyle: "default" },
  icons: { icon: [{ url: "/icons/192", type: "image/png" }], apple: [{ url: "/icons/apple", sizes: "180x180" }] },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#141a2b" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh font-sans">
        <Provedores>{children}</Provedores>
      </body>
    </html>
  );
}
