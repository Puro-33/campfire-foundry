# Physical AI 출처 기반 온톨로지 구축 및 데이터 충분성 판단

- 대상 독자: Campfire Foundry 제품·연구 설계자
- 조사일: 2026-09-05 (America/Los_Angeles)
- 범위: `keon/awesome-physical-ai` 고정 커밋의 구조화, 출처 추적, 그래프 검증, 온톨로지와 로봇 정책 학습의 데이터 규모 구분
- 가정: 사용자가 말한 “잘 작동”은 (1) 검색·관계 추적·규칙 검증과 (2) 로봇 행동 예측/학습을 모두 포함할 수 있으므로 두 문제를 분리한다.
- 제외: 목록에 있다는 사실만으로 프로젝트 간 호환성·성능 우열·장치 연결 성공을 추론하지 않는다.

## 직접 답

온톨로지/지식그래프에는 보편적인 최소 노드 수가 없다. 수백 개의 고품질 객체로도 좁은 업무 질문에는 충분할 수 있고, 수백만 개의 트리플도 업무 범위가 빠졌거나 출처가 없으면 충분하지 않다. 충분성은 원시 개수가 아니라 우선순위 질문 답변율, 선언 범위 대비 coverage, 출처 완비율, 제약 위반, 최신성으로 판정해야 한다. [W3C SHACL](https://www.w3.org/TR/shacl/)은 그래프를 선언된 조건에 대해 검증하고 보고서를 만드는 표준이며 최소 트리플 수를 요구하지 않는다. [W3C Data on the Web Best Practices](https://www.w3.org/TR/dwbp/)도 완전성을 선언된 데이터셋 범위에서 기대 객체 대비 표현된 객체의 비율로 설명한다.

로봇 정책 학습은 별도 문제다. [SmolVLA](https://huggingface.co/blog/smolvla)는 정제된 487개 데이터셋, 약 1천만 프레임, 3만 미만 에피소드를 사용했고 크기만이 아니라 시각 품질·과업 coverage·다양성을 기준으로 선별했다. 범용 사전학습 사례인 [OpenVLA](https://proceedings.mlr.press/v270/kim25c.html)는 97만 개 실제 로봇 시연, [Open X-Embodiment](https://robotics-transformer-x.github.io/)는 100만 개 이상의 실제 로봇 궤적과 22개 embodiment를 보고한다. 이 숫자는 사례이지 신규 단일 과업의 보편적 최소값이 아니다.

## 구축 결과

2026-06-24의 고정 커밋 `a6f62d11d9e7d1336a04927e86e3fbedc25a8456`과 사용자가 지정한 OpenCat 공식 저장소를 수집했다. 생성 데이터셋은 다음을 포함한다.

- 노드 1,358개
- 관계 1,419개
- 원 목록 및 사용자 지정 출처 언급(`CatalogMention`) 472개
- 분류 34개, 물리 AI 실행 역할 7개
- 논문 식별 노드 355개, GitHub 저장소 100개, 웹 리소스 303개
- GitHub 공식 API로 다시 확인된 외부 저장소 98개
- 모든 노드의 source URL, 수집 시각, SHA-256 완비
- 중복 노드 ID 0, 끊어진 관계 0

README의 행은 사실 객체로 바로 승격하지 않고 `CatalogMention`으로 저장했다. `Paper`, `Code`, `Project` 링크는 목록이 명시한 관계로 저장하고, GitHub API가 확인한 저장소 소유자만 `MAINTAINED_BY`로 승격했다. Campfire Foundry의 7개 실행 역할 연결은 원문 사실이 아니라 `DESIGN_MAPPING`, 신뢰도 0.65로 표시했다. 이는 [W3C PROV-O](https://www.w3.org/TR/prov-o/)의 Entity·Activity·Agent 및 derivation chain 개념을 단순화해 적용한 것이다.

## 데이터 모델

핵심 클래스:

- `Catalog`: 버전 고정 수집 스냅샷
- `CatalogMention`: 원 목록에서 수집한 행/항목
- `Category`: README의 분류 경로
- `OperationalRole`: 감지·세계예측·추론·정책·시뮬레이션·제어·장치실행
- `Paper`, `Repository`, `Organization`, `WebResource`

핵심 관계:

- `Catalog HAS_CATEGORY Category`
- `Category CONTAINS CatalogMention`
- `CatalogMention HAS_PAPER/HAS_CODE/HAS_PROJECT_PAGE Resource`
- `Repository MAINTAINED_BY Organization`
- `Category SUPPORTS_ROLE OperationalRole` — 반드시 `DESIGN_MAPPING` 표시

모든 관계는 `confidence`, `verificationStatus`, `evidenceUrl`, `evidenceKind`, `evidenceHash`를 갖는다. 단순히 같은 목록에 등장했다는 이유로 `WORKS_WITH`, `TRAINED_ON`, `OUTPERFORMS` 같은 관계를 만들지 않는다.

## 충분성 판정 기준

### 온톨로지 파일럿 — 공학적 휴리스틱

아래는 표준이나 논문이 보장하는 최소량이 아니라 첫 배치를 설계하는 기준이다.

- 핵심 competency question 10~20개
- 핵심 클래스마다 대표 인스턴스 5~10개
- 중요 관계·제약마다 정상 사례 3개, 누락/오류 사례 1개 이상
- P0 질문 답변율 100%
- 핵심 사실 provenance 완비율 100%
- 배포 데이터의 blocking 제약 위반 0개

현재 1,358노드 그래프는 연구 자원 발견·출처 추적이라는 좁은 목적의 파일럿 규모는 넘는다. 그러나 모델이 어떤 데이터로 학습됐는지, 어떤 로봇·과업에서 어떤 성능을 냈는지 답하려면 원 논문에서 `Model`, `Dataset`, `Robot`, `Task`, `Evaluation` 주장을 추가 추출해야 한다.

### 좁은 로봇 과업 — 공학적 휴리스틱

고정 장치·고정 과업은 50 에피소드를 첫 수집 tranche로 삼아 학습 곡선을 그린다. 50은 최소치가 아니다. 매 배치 후 별도 물체·조명·위치·사람이 있는 보류 환경에서 성공률, 실패 모드, 안전 중단률을 비교하고 개선이 포화될 때 중단한다.

### 범용 정책

범용 VLA의 공개 사례는 수만 에피소드에서 약 100만 시연/궤적까지 넓다. 사전학습 모델, embodiment 수, 과업 다양성, 관측·행동 공간이 다르므로 하나의 최소량으로 환산할 수 없다. 양보다 coverage와 정규화가 중요한 근거는 SmolVLA가 데이터셋을 프레임 수뿐 아니라 시각 품질·과업 coverage로 필터링하고 과업 문구와 카메라 명칭을 표준화한 과정이다.

## 한계와 불일치

- arXiv 대량 API 요청이 429 제한을 반환했다. 유효 형식의 arXiv ID는 보존했지만 이번 스냅샷에서는 1차 API 재확인으로 표시하지 않았다.
- 원 목록에는 유일값 기준 9개의 `XXXXX` arXiv placeholder ID가 있고, 수집된 관계 24곳에서 재사용된다. `INVALID_OR_PLACEHOLDER_ARXIV_ID`로 표시했다.
- Awesome 목록의 CC0 라이선스는 연결된 논문·코드·데이터의 라이선스로 전파되지 않는다.
- 목록의 한 행은 Dataset, Benchmark, Project 등의 역할을 섞을 수 있다. 따라서 링크 라벨은 `catalogClaimedKind`이고 검증된 실체 유형과 분리했다.
- 장치 연결 성공 주장은 이번 크롤링으로 검증하지 않았다. 실제 영수증에는 장치·펌웨어·환경·코드 버전·시각·결과를 별도 실행 Activity로 남겨야 한다.

## 조사 기록과 중단 이유

고정 README·LICENSE, GitHub API, W3C PROV-O·SHACL·DWBP, Open X-Embodiment, OpenVLA, SmolVLA를 확인했다. 목록 구조, provenance/검증 기준, 공개 로봇 데이터 규모라는 핵심 주장에 1차 근거가 확보됐고 추가 검색이 보편적 최소량을 제시할 가능성이 낮아 수익 체감 기준으로 중단했다.

## 주장-출처 원장

| 주장 | 출처 | 게시자/저자·날짜 | 접근 메모 |
|---|---|---|---|
| 원 목록 구조·링크·고정 커밋 | [Awesome Physical AI README](https://github.com/keon/awesome-physical-ai/blob/a6f62d11d9e7d1336a04927e86e3fbedc25a8456/README.md) | Keon Kim, commit 2026-06-24 | 고정 blob 직접 수집 |
| 목록 라이선스 CC0 1.0 | [LICENSE](https://github.com/keon/awesome-physical-ai/blob/a6f62d11d9e7d1336a04927e86e3fbedc25a8456/LICENSE) | 저장소, 2026-06-24 snapshot | 연결 자원에는 비전파 |
| provenance의 Entity·Activity·Agent | [PROV-O](https://www.w3.org/TR/prov-o/) | W3C, 2013-04-30 | Recommendation |
| 데이터 그래프의 조건 검증·보고서 | [SHACL](https://www.w3.org/TR/shacl/) | W3C, 2017-07-20 | Recommendation |
| 품질은 목적 적합성, 완전성은 범위 대비 비율 | [Data on the Web Best Practices](https://www.w3.org/TR/dwbp/) | W3C, 2017-01-31 | Recommendation |
| 100만+ 궤적, 22 embodiment | [Open X-Embodiment](https://robotics-transformer-x.github.io/) | Open X-Embodiment Collaboration, 2023 | 공식 프로젝트 |
| 97만 실제 로봇 시연 | [OpenVLA](https://proceedings.mlr.press/v270/kim25c.html) | Moo Jin Kim 외, PMLR 2025 | 출판 논문 페이지 |
| 3만 미만 에피소드, 1천만 프레임, 품질·coverage 선별 | [SmolVLA](https://huggingface.co/blog/smolvla) | Hugging Face 연구팀, 2025-06-03 | 공식 기술 글 |
| 사용자 지정 장치 저장소 | [OpenCat Quadruped Robot](https://github.com/PetoiCamp/OpenCat-Quadruped-Robot) | PetoiCamp, 2026-09-05 접근 | GitHub API 메타데이터 확인 |

---

# 스마트폰 센서와 ROS 2 시뮬레이션 런타임 조사

- 조사일: 2026-09-06 (America/Los_Angeles)
- 질문: 별도 장비 없이 스마트폰만으로 Physical AI의 감지–해석–피드백 루프를 만들고 ROS 2에 연결할 수 있는가?
- 결론: 가능하다. 스마트폰은 카메라·IMU·GPS·마이크 센서 노드와 화면·소리·진동 피드백 장치가 될 수 있다. 다만 스마트폰 자체에는 이동·조작 액추에이터가 없으므로 사람 추종의 물리 이동은 ROS 2 시뮬레이터로만 표현해야 한다.

## 구현 선택

브라우저는 사용자 동작으로 센서 권한을 받고 관찰을 로컬에서 처리한다. 원시 카메라 프레임과 원시 음성은 Campfire 서버에 올리지 않는다. 모션·위치·비전 요약·검토한 전사만 사용자가 지정한 rosbridge WebSocket으로 선택적으로 발행한다. HTTPS 사이트에서 평문 `ws://` 연결은 혼합 콘텐츠 제약을 받으므로 실제 휴대폰 연결에는 인증된 `wss://` reverse proxy가 필요하다.

ROS 2 패키지는 Jazzy를 기준으로 했다. 2026년 최신 배포판은 Lyrical이지만 Jazzy는 Ubuntu 24.04 기반 장기 지원 배포판이고 2029년 5월까지 지원되어 현재 WSL2·패키지 생태계와의 호환성을 우선하기에 적절하다. 구현한 메시지는 표준 `sensor_msgs/msg/Imu`, `sensor_msgs/msg/NavSatFix`, `std_msgs/msg/String`, `geometry_msgs/msg/Twist`만 사용하므로 이후 배포판에도 이식 가능하다.

rosbridge는 브라우저와 ROS 사이에 JSON/WebSocket 인터페이스를 제공한다. 브라우저는 `/campfire/phone/imu`, `/campfire/phone/navsat`, `/campfire/phone/vision`, `/campfire/phone/transcript`, `/campfire/phone/runtime`을 발행하고 `/campfire/phone/feedback`만 구독한다. 피드백은 길이가 제한된 진동·음성 화이트리스트만 허용한다.

## 정확성·안전 경계

- 프레임 차이 기반 비전은 움직임 중심을 찾을 뿐 사람을 식별하지 않는다.
- 모션 임계값 기반 걸음 수는 웰니스용 추정이며 의료 진단이 아니다.
- 브라우저 음성 인식은 구현에 따라 제3자 서버 처리가 발생할 수 있으므로 별도 동의가 필요하다.
- production HTTPS 페이지는 사용자가 제공한 WSS bridge에만 연결하며 rosbridge 9090 포트를 인터넷에 직접 노출하지 않는다.
- 스마트폰 런타임의 성공은 사용자 보고이고 물리 실행 증명이 아니다. evidence JSON의 실제 바이트 해시, 작업·설계 해시, 종료 이유와 시뮬레이션 모드를 영수증에 묶는다.
- 카메라 관찰을 ROS로 보내는 실행은 시작 시 `ROS2_SIMULATION`으로 고정하며 데이터 전송 동의와 시뮬레이션 전용 확인을 모두 요구한다. 실행 중 연결이 끊기거나 브라우저가 백그라운드로 가면 센서와 ROS 임대를 중단한다.
- 과거 v2 외부 어댑터 영수증은 서버에서 읽을 수 있지만 브라우저 센서 실행 권한은 새 v3 작업에만 부여한다.
- 원래의 `person_following`은 `ROS2_SIMULATION` 이외의 모드로 성공 처리하지 않는다.

## 주장-출처 원장

| 주장 | 1차 출처 | 적용 |
|---|---|---|
| ROS 2 배포판 출시·지원 일정 | [ROS 2 Releases](https://docs.ros.org/en/rolling/Releases.html) | 최신성 및 Jazzy 지원 기간 확인 |
| Jazzy Ubuntu 패키지 설치 기준 | [ROS 2 Jazzy Ubuntu deb packages](https://docs.ros.org/en/jazzy/Installation/Ubuntu-Install-Debs.html) | Ubuntu 24.04/WSL2 개발 기준 |
| rosbridge가 ROS에 JSON API와 WebSocket server 제공 | [RobotWebTools rosbridge_suite](https://github.com/RobotWebTools/rosbridge_suite) | 브라우저–ROS 전송 계층 |
| rosbridge v2의 advertise/publish/subscribe 연산 | [ROSBRIDGE protocol specification](https://github.com/RobotWebTools/rosbridge_suite/blob/ros2/ROSBRIDGE_PROTOCOL.md) | 웹 런타임 메시지 봉투 |
| ROS 표준 센서 메시지 정의 | [sensor_msgs package](https://docs.ros.org/en/rolling/p/sensor_msgs/) | IMU·NavSatFix 계약 |
| 브라우저 모션 센서 이벤트 | [MDN DeviceMotionEvent](https://developer.mozilla.org/en-US/docs/Web/API/DeviceMotionEvent) | 권한·가용성 경계 |
| 브라우저 위치 API | [MDN Geolocation API](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API) | GPS 관찰 수명주기 |
| 브라우저 WebSocket API | [MDN WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API) | rosbridge 연결 |
| 진동 API는 제한적 지원 | [MDN Vibration API](https://developer.mozilla.org/en-US/docs/Web/API/Vibration_API) | 선택적 피드백·fallback |
| 음성 인식은 서버 기반일 수 있음 | [MDN Web Speech API usage](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API) | 제3자 처리 동의 표시 |

핵심 메시지·전송·센서 API와 지원 일정을 1차 문서에서 확인했고, 특정 비전 모델을 추가하지 않아도 의존성 없는 움직임 관찰 MVP를 만들 수 있어 조사를 중단했다. 실기기 최종 확인은 Android Chrome과 iOS Safari에서 각각 권한 허용·철회·백그라운드 전환을 시험해야 한다.
