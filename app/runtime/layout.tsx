import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "스마트폰 ROS 2 런타임 · Campfire Foundry",
  description: "스마트폰 카메라·모션·GPS·마이크를 로컬 관찰과 ROS 2 시뮬레이션에 연결하는 사용자 제어 런타임",
};

export default function RuntimeLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
