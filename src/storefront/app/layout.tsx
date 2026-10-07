import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Instrument_Serif } from "next/font/google";

import { ChatLauncher } from "@/components/chat/ChatLauncher";
import { ChatOverlay } from "@/components/chat/ChatOverlay";
import { ChatProvider } from "@/components/chat/ChatProvider";
import { BagDrawer } from "@/components/store/BagDrawer";
import { BagProvider } from "@/components/store/BagProvider";
import { Footer } from "@/components/store/Footer";
import { Nav } from "@/components/store/Nav";
import { BRAND_NAME } from "@/lib/brand";

import "./globals.css";

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-instrument-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: BRAND_NAME, template: `%s · ${BRAND_NAME}` },
  description: `${BRAND_NAME} — thoughtfully made apparel, with an AI shopping assistant.`,
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${instrumentSerif.variable} ${instrumentSans.variable}`}>
      <body className="min-h-dvh font-sans">
        <ChatProvider>
          <BagProvider>
            <Nav />
            <main id="main">{children}</main>
            <Footer />
            <BagDrawer />
            <ChatLauncher />
            <ChatOverlay />
          </BagProvider>
        </ChatProvider>
      </body>
    </html>
  );
}
