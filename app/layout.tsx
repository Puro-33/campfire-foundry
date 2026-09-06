import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://campfire-foundry-lab.junghuncha40.chatgpt.site"),
  title: "Campfire Foundry · 실제 데이터 워크벤치",
  description:
    "근거 입력, D1 영구 저장, 서버 시뮬레이션, 온톨로지 감사 기록, 장치 영수증을 연결하는 실행형 워크벤치",
  openGraph: {
    title: "Campfire Foundry",
    description: "Physical AI Evidence Graph",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Campfire Foundry Physical AI Evidence Graph" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Campfire Foundry",
    description: "Physical AI Evidence Graph",
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
