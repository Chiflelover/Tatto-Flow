// Minimal test data only; these values do not define the client catalog.
export function catalogManifestFixture() {
  const base = {
    caseId: 'TEST_A_001',
    image: 'TEST_A_001.png',
    style: 'TEST_STYLE',
    phase: 'A',
    sizeCm: 10.5,
    color: { coverage: 0.25, metadata: { label: 'test color', palette: ['test'] } },
    density: { value: 34.5, metadata: { label: 'test density' } },
    sortOrder: 20,
    active: true,
    baseCaseId: null as string | null,
  };
  return {
    catalogVersion: 'TEST_REV_1',
    imageBaseUrl: 'https://catalog.test.invalid/revision-1/',
    cases: [
      {
        ...structuredClone(base),
        caseId: 'TEST_B_001',
        image: 'TEST_B_001.png',
        phase: 'B',
        density: { value: 76.2, metadata: { label: 'test variant' } },
        sortOrder: 10,
        baseCaseId: base.caseId,
      },
      base,
      {
        ...structuredClone(base),
        caseId: 'TEST_A_002',
        image: 'TEST_A_002.png',
        active: false,
        sortOrder: 0,
      },
    ],
  };
}
