import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Physical AI 설계기 | Campfire Foundry",
  description: "목표를 센서·정책·데이터·안전 게이트와 연결해 검토할 수 있는 외부 어댑터 작업 명세로 변환합니다.",
  openGraph: {
    title: "Campfire Foundry — Physical AI 설계기",
    description: "목표에서 검토 가능한 외부 어댑터 작업 명세까지",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Campfire Foundry Physical AI 설계기" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Campfire Foundry — Physical AI 설계기",
    description: "목표에서 검토 가능한 외부 어댑터 작업 명세까지",
    images: ["/og.png"],
  },
};

export default function CatalogLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
