# Awesome Physical AI를 Campfire Foundry에 통합하는 방법

- 대상: Campfire Foundry 제품·연구 설계자
- 조사일: 2026-09-05
- 범위: keon/awesome-physical-ai의 분류 체계, Campfire에 필요한 공개 인터페이스, OpenCat 연동 경계, 안전·운영 설계
- 제외: 사용자가 이미 완료했다고 밝힌 장치 연결성의 재시험, 개별 모델 성능 재현, 제품 인증 판단

## 직접 답

[Awesome Physical AI](https://github.com/keon/awesome-physical-ai)는 통합 가능한 단일 소프트웨어가 아니라 Physical AI 연구를 발견하기 위한 CC0 색인이다. Campfire는 모든 프로젝트를 서로 직접 연결하지 말고 관찰, 세계 예측, 추론·계획, 행동 정책, 시뮬레이션, 오케스트레이션, 장치 실행 역할의 플러그인으로 등록해야 한다. 플러그인들은 공통 Observation, ActionProposal, ApprovedAction, EpisodeOutcome 객체만 교환한다.

권장 기본 경로:

동의된 현장 관찰 → Ontology 객체 → AI 가설 → 사람 검토 → LeRobot PolicyAdapter → SafetyGate → MuJoCo 또는 Isaac Lab → 사람 실행 승인 → ROS 2 Action → OpenCatAdapter → 장치 → Outcome

VLA나 자연어 모델이 원시 시리얼 문자열이나 관절각을 직접 만들거나 보내지 않게 하는 것이 가장 중요한 경계다.

## 저장소 감사

[Awesome Physical AI README](https://raw.githubusercontent.com/keon/awesome-physical-ai/main/README.md)는 기반 VLM, 시각 표현, VLA 구조, 행동 표현, 월드모델, 추론·계획, 학습, 일반화, 배포, 안전, 평생학습, 응용, sim-to-real, 데이터셋, 시뮬레이터를 폭넓게 분류한다. 그러나 전용 로봇 런타임, 장치 계약, ROS 2, OpenCat, 승인 원장 같은 통합 계층은 제공하지 않는다.

2026-09-05에 현재 README를 직접 집계했을 때 arXiv URL 384개와 Code 링크 74개가 있었고, XXXXX가 남은 placeholder arXiv URL도 27개였다. 따라서 이 저장소는 발견 색인이지만 링크, 연도, 성능 문구를 채택 근거로 그대로 사용하면 안 된다. 각 공식 논문·저장소·문서를 다시 확인하는 소스 승격 과정이 필요하다.

사용자가 모든 프로젝트의 장치 연결을 검증했다는 진술은 connectivity=user_verified로 기록한다. 이것은 공개 문서가 입증하는 interface=officially_documented나 Campfire가 별도로 측정해야 할 task_quality, latency, safety와 분리한다.

## 7계층 통합 설계

### 1. 관찰

카메라·IMU·GPS·메모를 Observation 객체로 정규화한다. 원본, 파생 특징, 품질, 동의 범위, 시간, 흐림 수준을 함께 기록한다. DINOv2·SAM 계열은 인식 플러그인이며 사실 원장 자체가 아니다. 휴대폰 움직임으로 건강·피로·감정을 추론하지 않는다.

### 2. 세계 예측

[V-JEPA 2 공식 저장소](https://github.com/facebookresearch/vjepa2)는 비디오 잠재 표현과 action-conditioned 예측을 제공한다. Campfire에서는 후보 행동 뒤의 상태를 추정하거나 이상을 탐지하는 WorldModelAdapter로 사용한다. 공개 로봇 증거는 주로 Franka 조작에 관한 것이므로 OpenCat에서의 예측 품질은 연결 성공과 별도로 측정한다. 2026년 공개된 V-JEPA 2.1은 현재 색인보다 새로우므로 목록의 최신성도 별도 관리한다.

### 3. 추론·계획

자연어 모델은 목표와 맥락을 ActionProposal로 바꾼다. 제안에는 출처, 불확실성, 예상 결과, 필요한 능력, 금지 조건이 들어간다. Palantir형 온톨로지는 증거·가설·결정·장치·결과의 관계와 허용된 행동을 관리한다. 계획 모델은 실행 권한을 갖지 않는다.

### 4. 행동 정책

[LeRobot 공식 문서](https://huggingface.co/docs/lerobot/main/index)는 데이터 수집, 정책 훈련·평가, 장치 추상화를 한 작업면에 둔다. 모든 장치가 connect, get_observation, send_action, disconnect 계약을 구현하므로 Campfire의 기본 RobotAdapter 경계로 적합하다. 외부 장치는 별도 Python 플러그인으로 추가할 수 있다.

[SmolVLA](https://huggingface.co/blog/smolvla)는 450M 규모, 다중 이미지·센서운동 상태·자연어 입력, action chunk, 비동기 추론을 제공하므로 소비자급 장비에서 시작하는 기본 정책 후보이다. [OpenVLA](https://github.com/openvla/openvla)는 7B 비교 정책 또는 원격 정책 서비스로 둔다. 둘의 출력은 공통 ActionProposal로 정규화하고 action_space, 단위, 좌표계, horizon, control_hz, model_version을 반드시 붙인다.

### 5. 시뮬레이션

[MuJoCo](https://mujoco.readthedocs.io/en/stable/overview.html)는 articulated/contact dynamics, MJCF·URDF 로딩, 제어·상태추정·시스템식별을 위한 비교적 얇은 물리 엔진이다. 빠른 MVP와 결정론적 회귀 테스트에 알맞다.

[Isaac Lab](https://isaac-sim.github.io/IsaacLab/main/)은 Isaac Sim 위의 로봇학습 프레임워크로 벡터화 환경, 센서, domain randomization, imitation/RL 작업면을 제공한다. 고충실도·대규모 학습에는 강하지만 현재 2.x, main, 3.0 beta 문서와 플랫폼 조건을 고정해야 한다.

MVP에서 두 스택을 상시 운용하지 않는다. 가벼운 사족 회귀가 우선이면 MuJoCo, RTX 센서 합성과 대규모 병렬 학습이 핵심이면 Isaac Lab을 선택한다. 동일한 reset, step, outcome SimAdapter 계약을 두면 나중에 교체 가능하다.

### 6. 오케스트레이션·제어

[ROS 2 인터페이스 문서](https://docs.ros.org/en/ros2_documentation/rolling/Concepts/Basic/Interfaces-Topics-Services-Actions.html)에 따라 연속 센서 스트림은 Topic, 짧은 질의는 Service, 피드백·취소가 필요한 장시간 동작은 Action으로 분리한다. [Managed Nodes 설계](https://design.ros2.org/articles/node_lifecycle.html)의 Unconfigured → Inactive → Active → Finalized 수명주기를 장치 어댑터에 적용한다.

ros2_control을 쓰는 경우 read-update-write loop, joint limits, fallback을 활용하되 이것을 인증된 물리 비상정지로 오해하지 않는다. 실제 전원 차단, MCU watchdog, 물리 E-stop은 AI와 ROS보다 아래 계층에 둔다.

### 7. 장치 실행

사용자가 준 [OpenCat 저장소](https://github.com/PetoiCamp/OpenCat-Quadruped-Robot)는 NyBoard/ATmega328P 기반 구형 Bittle·Nybble를 다루며, 현재 세대 Bittle X·Nybble Q는 [OpenCatESP32](https://github.com/PetoiCamp/OpenCatEsp32-Quadruped-Robot) 프로필로 분기한다.

[Petoi Serial Protocol](https://docs.petoi.com/apis/serial-protocol)은 명령이 대소문자를 구분하는 ASCII token임을 설명한다. 상위 모델에 이 원시 형식을 노출하지 않는다. MVP 허용 의도는 SIT, STAND, REST, BEEP로 제한하며 Gateway만 ksit, kbalance, d, 검토된 고정 음 패턴으로 변환한다. 임의 관절각, 보행, 회전, 점프, 보정, 펌웨어 업로드, 자동 재전송은 차단한다.

## 안전 결론

[Google DeepMind의 로봇 안전 설명](https://deepmind.google/models/gemini-robotics/responsibly-advancing-ai-and-robotics/)처럼 의미·물리·운영 안전은 겹치는 여러 층이어야 한다. [RoboPAIR](https://robopair.org/)는 LLM 제어 로봇에서 텍스트 jailbreak가 물리 행동으로 이어질 수 있음을 실험했다. 따라서 자연어 안전 필터는 장치 allowlist, 속도·관절 제한, 장애물·접촉 제어, 현장 사람 승인, 취소, watchdog, 전원 차단을 대체할 수 없다.

Campfire의 안전 spine:

동의 → 출처 → 불확실성 → 정책 제안 → 시뮬레이션 → 의미 가드 → 물리 제약 → 사람 승인 → allowlist 변환 → 취소 가능 실행 → 결과 감사

## 경영 시뮬레이션과의 결합

경영 라운드에서 마케팅은 수요, R&D는 개인화·정책 품질, 생산은 장치 용량·폐기, 재무는 현금 완충과 안전투자를 결정한다. 제출된 DecisionSet만 ProductSpec과 ControlPolicy를 만들 수 있고, 사람 승인 뒤 ProductionRun 또는 RobotAction이 생성된다. Outcome은 다음 라운드의 예측 오차와 기업 성과에 함께 반영한다.

이 구조는 Business Simulation의 부서별 결정 → 공식 제출 → 라운드 처리 → 경쟁 결과 → 디브리프와 Physical AI의 관찰 → 예측 → 계획 → 제어 → 행동 → 피드백을 한 학습 루프로 결합한다.

## 권장 단계

1. 현재: Ontology 원장, 합성 Observation, 결정론적 경영 엔진, Human Gate, MockOpenCatAdapter.
2. 다음: LeRobot 외부 Robot plugin, ROS 2 Action/Lifecycle, 단일 MuJoCo 회귀 환경, 사용자 장치 검증 로그의 Episode 변환.
3. 실험: SmolVLA 기본 정책, V-JEPA 2 예측 플러그인, OpenVLA/openpi 원격 비교 정책, 필요 시 Isaac Lab 고충실도 트랙.

## 한계

- 사용자의 장치 검증 원시 로그와 테스트 조건은 이번 대화에 포함되지 않아 연결성은 사용자 제공 근거로만 표기했다.
- 개별 프로젝트의 과제 성공률, 지연시간, 안전성은 장치 연결 성공에서 추론할 수 없다.
- awesome-physical-ai의 일부 항목은 placeholder 링크와 시점 불일치를 포함하므로 목록 자체를 자동 설치 manifest로 쓰면 안 된다.
- 실제 제품 분류와 ISO 적합성·인증은 의도된 사용, 사용자, 장소, 관할이 정해진 뒤 별도 판단해야 한다.

## 주장-출처 원장

| 주장 | 출처 | 게시·갱신 정보 | 확인 메모 |
|---|---|---|---|
| 색인의 범위와 CC0 성격 | [Awesome Physical AI](https://github.com/keon/awesome-physical-ai) | Keon, 2026-06-24 최근 push 확인 | README와 LICENSE 직접 확인 |
| LeRobot 장치 계약·데이터 작업면 | [LeRobot](https://huggingface.co/docs/lerobot/main/index), [Bring Your Own Hardware](https://huggingface.co/docs/lerobot/main/en/integrate_hardware) | Hugging Face, 2026-09-05 열람 | 공식 문서 |
| SmolVLA 규모·입출력·비동기 추론 | [SmolVLA](https://huggingface.co/blog/smolvla) | Hugging Face, 2025-06-03 | 공식 기술 블로그 |
| OpenVLA 7B·원격 추론 역할 | [OpenVLA](https://github.com/openvla/openvla) | Moo Jin Kim 외, 2024 | 공식 저장소 |
| V-JEPA 2/2.1 역할 | [V-JEPA 2](https://github.com/facebookresearch/vjepa2) | Meta FAIR, 2025-06 / 2026-03 | 공식 저장소 |
| MuJoCo 역할 | [MuJoCo Overview](https://mujoco.readthedocs.io/en/stable/overview.html) | Google DeepMind, 2026-09-05 열람 | 공식 문서 |
| Isaac Lab 역할·버전 주의 | [Isaac Lab](https://isaac-sim.github.io/IsaacLab/main/) | Isaac Lab Project, 2026-09-02 갱신 문서 확인 | 공식 문서 |
| ROS 2 통신 역할·수명주기 | [ROS 2 Interfaces](https://docs.ros.org/en/ros2_documentation/rolling/Concepts/Basic/Interfaces-Topics-Services-Actions.html), [Managed Nodes](https://design.ros2.org/articles/node_lifecycle.html) | ROS 2 Project | 공식 문서 |
| OpenCat 세대·시리얼 경계 | [OpenCat](https://github.com/PetoiCamp/OpenCat-Quadruped-Robot), [OpenCatESP32](https://github.com/PetoiCamp/OpenCatEsp32-Quadruped-Robot), [Serial Protocol](https://docs.petoi.com/apis/serial-protocol) | Petoi, 2026-09-05 열람 | 공식 저장소·문서 |
| 다층 로봇 안전 | [Responsibly advancing AI and robotics](https://deepmind.google/models/gemini-robotics/responsibly-advancing-ai-and-robotics/), [RoboPAIR](https://robopair.org/) | Google DeepMind; Robey 외, ICRA 2025 | 공식 설명·연구 프로젝트 |
| cross-embodiment 데이터 규모 | [Open X-Embodiment](https://robotics-transformer-x.github.io/) | Open X-Embodiment Collaboration, 2023 | 공식 프로젝트 |
