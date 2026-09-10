import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { AppShell } from "@/components/layout/AppShell";
import { AuthGate } from "@/components/auth/AuthGate";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { ServiceWorkerRegister } from "@/components/pwa/ServiceWorkerRegisterLoader";
import { SyncProvider } from "@/components/sync/SyncProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ENA TID’I",
  description: "Gestión offline-first de un emprendimiento piscícola.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    // Nombre bajo el ícono al instalar en iOS (pantalla de inicio) —
    // iOS lo trunca a ~11-12 caracteres visibles, "ENA TID'I" cabe entero.
    title: "ENA TID’I",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#047857",
  // "cover" (no "auto", el valor por defecto) habilita las variables CSS
  // env(safe-area-inset-*) — sin esto valen siempre 0 y el header/nav/FAB
  // fijos podrían quedar bajo el notch o el home indicator de iPhone en
  // modo standalone (PWA instalada). AppShell/QuickRegisterButton/
  // InstallPrompt las usan explícitamente — ver ese padding ahí, nunca
  // aquí, porque cada elemento fijo necesita un valor distinto.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <ServiceWorkerRegister />
        <AuthGate>
          <SyncProvider>
            <AppShell>{children}</AppShell>
          </SyncProvider>
          <InstallPrompt />
        </AuthGate>
      </body>
    </html>
  );
}
