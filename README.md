# Campfire Foundry

사람의 증언·센서 요약을 출처가 있는 온톨로지 객체로 저장하고, 인간 검토 뒤 서버 시뮬레이션과 장치 영수증까지 추적하는 비공개 작업대입니다.

## 실제 기능

- D1에 실험 세션, Evidence, Hypothesis, ProductSpec, ProductionPlan, ProductionRun, Action log 저장
- 확인된 가설만 서버 시뮬레이션 실행
- 자연어 목표를 `Goal → DesignPlan → CapabilityRequirement → CatalogSelection` 실행 그래프로 저장
- `/catalog`에서 브라우저 권한·포트 접근 결과와 사용자의 설치·동의·안전 확인을 방법별로 기록
- 단계별 실행기·입출력·STOP 조건이 있는 외부 어댑터용 작업 JSON 생성 및 내려받기(장치로 자동 전송하지 않음)
- 반환 영수증의 작업 키와 요청·설계·증거 해시 형식을 대조해 외부 어댑터의 자기 보고로 저장
- 카탈로그 링크는 출처가 있는 구현 참고 자료로만 취급하며 기능 성능이나 실제 물리 실행을 증명하지 않음
- 모든 카탈로그 노드·관계에 출처 URL, 수집 시각, SHA-256, 검증 상태 저장
- `/runtime`에서 스마트폰 카메라·IMU·GPS·마이크를 사용자 동의 뒤 실행하고 원시 영상·음성을 업로드하지 않은 채 로컬 evidence JSON 생성
- evidence 파일의 실제 UTF-8 바이트를 SHA-256으로 해시하고 종료 이유·측정 요약·실행 모드를 v2 영수증으로 기존 온톨로지에 기록
- 사용자 제공 rosbridge `wss://`에 표준 ROS 2 IMU·NavSatFix와 비전·전사·런타임 요약을 선택적으로 발행
- `ros2/campfire_phone_bridge`에 ROS 2 Jazzy + turtlesim 전용 어댑터 제공. 실제 로봇 `/cmd_vel`과 안전하지 않은 remap은 시작 시 거부

## 스마트폰 + ROS 2 실행

설계기에서 스마트폰 과업을 만들고 확인 기록 및 v3 작업 JSON을 생성한 뒤 `/runtime?session=...`을 엽니다. 브라우저가 서버 저장본·작업 해시·브라우저 실행 권한을 대조한 다음에만 센서 시작 버튼이 열립니다. 카메라 관찰을 ROS로 보낼 때는 실행 시작 전에 데이터 전송 동의와 시뮬레이션 전용 확인을 모두 받아 실행 모드를 `ROS2_SIMULATION`으로 고정합니다.

ROS 2 Jazzy/Ubuntu 24.04 또는 WSL2에서 패키지를 워크스페이스의 `src` 아래에 복사하고 실행합니다.

```bash
source /opt/ros/jazzy/setup.bash
colcon build --symlink-install
source install/setup.bash
ros2 launch campfire_phone_bridge phone_sim.launch.py
```

기본 출력은 `/turtle1/cmd_vel`뿐입니다. production HTTPS 페이지에서 휴대폰으로 연결할 때는 평문 `ws://` 대신 인증된 `wss://` reverse proxy나 VPN을 사용해야 하며, 인증 없는 rosbridge 9090 포트를 인터넷에 노출하면 안 됩니다. 자세한 내용은 `ros2/campfire_phone_bridge/README.md`에 있습니다.

## 온톨로지 다시 수집

GitHub 인증 토큰이 환경에 있으면 저장소 메타데이터까지 공식 API로 확인합니다.

```bash
npm run crawl:ontology
```

arXiv API 제한 중에는 ID와 출처를 보존하되 API 확인을 생략할 수 있습니다.

```bash
npm run crawl:ontology -- --skip-arxiv
```

생성물은 `data/physical-ai-ontology.v1.json`이며, 빌드된 사이트가 버전 해시를 확인해 D1에 멱등 적재합니다.

새 배포에서 데이터를 미리 적재할 때는 새 번호의 migration 경로를 명시해 생성합니다. 이미 적용된 migration 파일을 재사용하면 안 됩니다.

```bash
npm run build:ontology-migration -- data/physical-ai-ontology.v1.json drizzle/0002_physical_ai_seed.sql
```

## 검증

```bash
npm run lint
npm run build
```

원 목록인 `keon/awesome-physical-ai`는 CC0-1.0입니다. 연결된 논문·코드·데이터의 라이선스는 각 원출처를 따르며 CC0가 자동으로 전파되지 않습니다.
