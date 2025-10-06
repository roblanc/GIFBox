import type { Metadata } from "next";
import { Source_Code_Pro } from "next/font/google";
import "./globals.css";
import "bootstrap/dist/css/bootstrap.min.css";

const sourceCodePro = Source_Code_Pro({
  subsets: ["latin"],
  variable: "--font-source-code-pro",
  weight: "400",
});

export const metadata: Metadata = {
  title: "GIFBox",
  description: "Your personal GIF collection",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={sourceCodePro.variable}>
      <body>
        {children}
      </body>
    </html>
  );
}
