import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Campfire Foundry · 증거 기반 경영 시뮬레이션",
  description:
    "현장의 증거와 사람의 판단을 마케팅, 제품, 생산, 재무 결정으로 연결하는 교육용 경영 시뮬레이션",
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
