import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Campfire Foundry · 실제 데이터 워크벤치",
  description:
    "근거 입력, D1 영구 저장, 서버 시뮬레이션, 온톨로지 감사 기록, 장치 영수증을 연결하는 실행형 워크벤치",
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
