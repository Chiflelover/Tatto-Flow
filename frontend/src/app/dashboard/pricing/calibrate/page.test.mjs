import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  fileName: 'page.tsx',
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText;

function loadedStates(draft) {
  // Seed the existing page's loaded state; no browser or API calls are needed.
  return [
    [
      {
        id: draft.styleId,
        code: 'FINE_LINE',
        name: draft.styleName,
        enabled: true,
        caseCount: 0,
        catalogCaseCount: draft.totalCount,
        activeVersion: null,
      },
    ],
    [],
    draft,
    draft.styleId,
    0,
    '',
    '0',
    '0',
    false,
    false,
    null,
    null,
  ];
}

function render(draft, styleOverrides = {}) {
  const states = loadedStates(draft);
  Object.assign(states[0][0], styleOverrides);
  let stateIndex = 0;
  const dependencies = {
    react: {
      ...React,
      useState: () => [states[stateIndex++], () => {}],
      useEffect: () => {},
    },
    'next/navigation': { useRouter: () => ({ replace: () => {} }) },
    'next/image': ({ src, alt, width, height }) =>
      React.createElement('img', { src, alt, width, height }),
    '@/lib/dashboard-api': {},
    './calibrate.module.css': {},
  };
  const exports = {};
  runInNewContext(compiled, {
    exports,
    require: (name) => dependencies[name] ?? require(name),
  });
  return renderToStaticMarkup(React.createElement(exports.default));
}

function draftFixture(metadata = {}) {
  return {
    id: 'test-draft',
    styleId: 'test-style',
    styleName: 'Fine Line',
    version: 1,
    catalogFormat: 'PHASED',
    canActivate: false,
    answeredCount: 0,
    totalCount: 2,
    cases: [
      { id: 'test-case-1', imageUrl: '/test-reference.png', pricePen: null, ...metadata },
      { id: 'test-case-2', imageUrl: '/test-reference-2.png', pricePen: null, ...metadata },
    ],
  };
}

test('internal case metadata does not change the artist presentation', () => {
  const a = render(
    draftFixture({
      caseKey: 'INTERNAL_A',
      phase: 'A',
      sizeCm: 10,
      colorCoverage: 0.1,
      colorMetadata: { label: 'internal color A' },
      density: 18,
      densityMetadata: { label: 'internal density A' },
      baseCaseKey: null,
      catalogVersion: 'INTERNAL_REVISION_A',
    }),
  );
  const b = render(
    draftFixture({
      caseKey: 'INTERNAL_B',
      phase: 'B',
      sizeCm: 20,
      colorCoverage: 0.9,
      colorMetadata: { label: 'internal color B' },
      density: 94,
      densityMetadata: { label: 'internal density B' },
      baseCaseKey: 'INTERNAL_A',
      catalogVersion: 'INTERNAL_REVISION_B',
    }),
  );
  assert.equal(a, b);
  assert.doesNotMatch(a, /INTERNAL_|A\/B|Fase [AB]|Tamaño|Cobertura|Densidad/);
});

test('preserves style, image, progress, price input and navigation', () => {
  const html = render(draftFixture());
  assert.match(html, /Calibración · Fine Line/);
  assert.match(html, /src="\/test-reference.png"/);
  assert.match(html, /Referencia 1 de 2 · 0 respondidas/);
  assert.match(html, /¿Cuánto cobrarías normalmente por este tatuaje\?/);
  assert.match(html, /id="calibration-price"/);
  assert.match(html, /Guardar respuesta/);
  assert.match(html, /Anterior/);
  assert.match(html, /Siguiente/);
});

test('shows the available catalog without a false empty-image warning', () => {
  const html = render(draftFixture());
  assert.match(html, /2 referencias disponibles/);
  assert.match(html, /Responder referencias \(2\)/);
  assert.doesNotMatch(html, /0 referencias disponibles|aún no están cargadas/);
  assert.match(html, />Calibrar</);
  assert.doesNotMatch(html, />Activar modelo/);
});

test('Fine Line exposes only its 25 references even if a stale response includes 9 old cases', () => {
  const html = render(
    { ...draftFixture(), totalCount: 25 },
    { caseCount: 9, catalogCaseCount: 25, activeVersion: 2 },
  );
  assert.match(html, /25 referencias disponibles/);
  assert.match(html, />Recalibrar</);
  assert.doesNotMatch(html, /34 referencias disponibles|9 referencias disponibles/);
});

test('the artist can start, price and navigate through all 25 real Fine Line references', async () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        '../../../../../public/calibration-assets/v1/Fine_Line/catalog.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const draft = {
    ...draftFixture(),
    totalCount: 25,
    cases: manifest.cases.map((item) => ({
      id: item.caseId,
      imageUrl: `${manifest.imageBaseUrl}${item.image}`,
      pricePen: null,
    })),
  };
  const states = loadedStates(draft);
  states[2] = null;
  states[3] = null;
  const saved = [];
  let activationCount = 0;
  const starts = [];
  let stateIndex = 0;
  const dependencies = {
    react: {
      ...React,
      useState: () => {
        const index = stateIndex++;
        return [
          states[index],
          (value) => {
            states[index] = typeof value === 'function' ? value(states[index]) : value;
          },
        ];
      },
      useEffect: () => {},
      useCallback: (callback) => callback,
    },
    'next/navigation': { useRouter: () => ({ replace: () => assert.fail('Unexpected redirect') }) },
    'next/image': ({ src, alt, width, height }) =>
      React.createElement('img', { src, alt, width, height }),
    '@/lib/dashboard-api': {
      startCalibrationDraft: async (styleId, catalog, restart) => {
        assert.equal(styleId, draft.styleId);
        assert.equal(catalog, 'PHASED');
        starts.push({ catalog, restart });
        return { ...structuredClone(draft), version: restart ? 3 : 1 };
      },
      saveCalibrationAnswer: async (styleId, caseId, price) => {
        assert.equal(styleId, draft.styleId);
        saved.push({ caseId, price });
        const next = structuredClone(states[2]);
        next.cases.find((item) => item.id === caseId).pricePen = price.toFixed(2);
        next.answeredCount = next.cases.filter((item) => item.pricePen !== null).length;
        next.canActivate = next.answeredCount === next.totalCount;
        return next;
      },
      activateCalibration: async (styleId) => {
        assert.equal(styleId, draft.styleId);
        activationCount++;
        return { version: activationCount + 1 };
      },
      getCalibrationStyles: async () => states[0],
      getPricingModels: async () => [],
      getGeneralAdjustment: async () => ({ percent: '0' }),
    },
    './calibrate.module.css': {},
  };
  const exports = {};
  runInNewContext(compiled, { exports, require: (name) => dependencies[name] ?? require(name) });
  const page = () => {
    stateIndex = 0;
    return exports.default();
  };
  function find(node, matches) {
    if (Array.isArray(node)) return node.map((item) => find(item, matches)).find(Boolean);
    if (!React.isValidElement(node)) return null;
    return matches(node) ? node : find(node.props.children, matches);
  }
  const label = (children) =>
    Array.isArray(children)
      ? children.map(label).join('')
      : React.isValidElement(children)
        ? label(children.props.children)
        : children == null
          ? ''
          : String(children);
  const button = (text) =>
    find(page(), (item) => item.type === 'button' && label(item.props.children) === text);
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  button('Responder referencias (25)').props.onClick();
  await flush();
  for (const [index, item] of draft.cases.entries()) {
    const html = renderToStaticMarkup(page());
    assert.ok(html.includes(`src="${item.imageUrl}"`));
    assert.ok(html.includes(`Referencia ${index + 1} de 25 · ${index} respondidas`));
    find(page(), (entry) => entry.props.id === 'calibration-price').props.onChange({
      target: { value: String(200.25 + index) },
    });
    find(
      page(),
      (entry) =>
        entry.type === 'form' && find(entry, (child) => child.props.id === 'calibration-price'),
    ).props.onSubmit({ preventDefault() {} });
    await flush();
  }
  assert.deepEqual(
    saved,
    draft.cases.map((item, index) => ({ caseId: item.id, price: 200.25 + index })),
  );
  assert.match(renderToStaticMarkup(page()), /Referencia 25 de 25 · 25 respondidas/);
  assert.match(renderToStaticMarkup(page()), /Activar modelo de Fine Line/);
  assert.equal(button('Siguiente').props.disabled, true);
  button('Anterior').props.onClick();
  assert.match(renderToStaticMarkup(page()), /Referencia 24 de 25 · 25 respondidas/);
  assert.equal(
    find(page(), (entry) => entry.props.id === 'calibration-price').props.value,
    '223.25',
  );
  button('Siguiente').props.onClick();
  assert.equal(
    find(page(), (entry) => entry.props.id === 'calibration-price').props.value,
    '224.25',
  );
  button('Activar modelo de Fine Line').props.onClick();
  await flush();
  assert.equal(activationCount, 1);
  assert.match(renderToStaticMarkup(page()), /Modelo de precios versión 2 activado/);
  assert.equal(states[2], null);
  states[0][0].activeVersion = 2;
  states[0][0].caseCount = 9;
  assert.match(renderToStaticMarkup(page()), /25 referencias disponibles/);
  button('Recalibrar').props.onClick();
  await flush();
  assert.deepEqual(starts, [
    { catalog: 'PHASED', restart: false },
    { catalog: 'PHASED', restart: true },
  ]);
  assert.equal(states[2].version, 3);
  assert.equal(states[2].answeredCount, 0);
  assert.equal(states[2].totalCount, 25);
  assert.ok(states[2].cases.every((item) => item.pricePen === null));
  assert.equal(find(page(), (entry) => entry.props.id === 'calibration-price').props.value, '');
  for (const [index] of draft.cases.entries()) {
    find(page(), (entry) => entry.props.id === 'calibration-price').props.onChange({
      target: { value: String(400.25 + index) },
    });
    find(
      page(),
      (entry) =>
        entry.type === 'form' && find(entry, (child) => child.props.id === 'calibration-price'),
    ).props.onSubmit({ preventDefault() {} });
    await flush();
  }
  assert.match(renderToStaticMarkup(page()), /Referencia 25 de 25 · 25 respondidas/);
  assert.deepEqual(
    saved.slice(25),
    draft.cases.map((item, index) => ({ caseId: item.id, price: 400.25 + index })),
  );
  button('Activar modelo de Fine Line').props.onClick();
  await flush();
  assert.equal(activationCount, 2);
  assert.match(renderToStaticMarkup(page()), /Modelo de precios versión 3 activado/);
});
