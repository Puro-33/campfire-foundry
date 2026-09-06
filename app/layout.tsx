import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://campfire-foundry-lab.junghuncha40.chatgpt.site"),
  title: "Campfire Foundry · Physical AI 설계기",
  description:
    "자연어 목표를 온톨로지 근거, 장치 점검, 안전 게이트와 연결해 검토할 수 있는 작업 명세로 바꾸는 워크벤치",
  openGraph: {
    title: "Campfire Foundry",
    description: "Ontology-backed Physical AI Workbench",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Campfire Foundry Physical AI 설계기" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Campfire Foundry",
    description: "Ontology-backed Physical AI Workbench",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
