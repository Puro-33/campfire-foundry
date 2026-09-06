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
