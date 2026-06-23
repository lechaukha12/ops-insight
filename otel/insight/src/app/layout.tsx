import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Insight - Dashboard vận hành và giám sát hệ thống",
  description: "Real-time trace error aggregation and anomaly detection dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
