import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Physical AI Evidence Graph | Campfire Foundry",
  description: "Awesome Physical AI를 출처·검증 상태와 함께 검색하고 관계를 추적하는 온톨로지 탐색기",
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

export default function CatalogLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
