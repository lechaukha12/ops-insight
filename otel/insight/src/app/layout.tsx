import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Insight - Traces Error Aggregator",
  description: "Real-time trace error aggregation and anomaly detection dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
