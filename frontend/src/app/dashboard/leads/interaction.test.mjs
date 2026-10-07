import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const sourceRoot = new URL('../../', import.meta.url);
function load(path, dependencies, appended = '') {
  const exports = {};
  const source = readFileSync(new URL(path, sourceRoot), 'utf8') + appended;
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText,
    {
      exports,
      URLSearchParams,
      require: (name) =>
        name.endsWith('.css')
          ? new Proxy({}, { get: (_, key) => (key === '__esModule' ? false : key) })
          : (dependencies[name] ?? require(name)),
    },
  );
  return exports;
}

const dependencies = {
  'next/link': ({ href, children, ...props }) =>
    React.createElement('a', { href, ...props }, children),
  '@/components/dashboard/action-label': load('../components/dashboard/action-label.tsx', {}),
  '@/components/dashboard/feedback-state': load('../components/dashboard/feedback-state.tsx', {}),
  '@/components/dashboard/lead-card': {
    StatusBadge: ({ label }) => React.createElement('span', null, label),
  },
  '@/lib/lead-price': load('../lib/lead-price.ts', {}),
  '@/lib/v2-lead': load('../lib/v2-lead.ts', {}),
  '@/lib/single-flight': load('../lib/single-flight.ts', {}),
};

function mount(path, api, props = {}, appended = '') {
  const states = [],
    refs = [],
    effects = [];
  let stateIndex = 0,
    refIndex = 0,
    effectIndex = 0;
  let rootRendering = false;
  let query = new URLSearchParams();
  const pendingEffects = [];
  const router = {
    replace: (url) => {
      query = new URL(url, 'http://test.invalid').searchParams;
    },
    push: () => {},
  };
  const react = {
    ...React,
    useState: (initial) => {
      // Child components use React's server renderer; the page uses the test state store.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      if (!rootRendering) return React.useState(initial);
      const index = stateIndex++;
      if (index >= states.length) states[index] = initial;
      return [
        states[index],
        (value) => {
          states[index] = typeof value === 'function' ? value(states[index]) : value;
        },
      ];
    },
    useRef: (initial) => (refs[refIndex++] ??= { current: initial }),
    useMemo: (callback) => callback(),
    useCallback: (callback) => callback,
    useEffect: (effect, deps) => {
      const index = effectIndex++;
      const previous = effects[index];
      if (!previous || deps.some((dep, position) => !Object.is(dep, previous.deps[position]))) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          effects[index] = { deps, cleanup: effect() };
        });
      }
    },
  };
  const exports = load(
    path,
    {
      ...dependencies,
      react,
      'next/navigation': {
        useRouter: () => router,
        useSearchParams: () => query,
        usePathname: () => '/dashboard/leads',
      },
      '@/lib/dashboard-api': {
        isUnauthorized: () => false,
        dashboardErrorMessage: (error) => error.message,
        ...api,
      },
    },
    appended,
  );
  const component = exports.TestedPage ?? exports.LeadDetailClient;
  function page() {
    stateIndex = refIndex = effectIndex = 0;
    rootRendering = true;
    const node = component(props);
    rootRendering = false;
    pendingEffects.splice(0).forEach((effect) => effect());
    return node;
  }
  function find(node, matches) {
    if (Array.isArray(node)) return node.map((item) => find(item, matches)).find(Boolean);
    if (!React.isValidElement(node)) return null;
    return matches(node) ? node : find(node.props.children, matches);
  }
  function label(node) {
    if (Array.isArray(node)) return node.map(label).join('');
    if (!React.isValidElement(node)) return node == null ? '' : String(node);
    if (node.props['aria-hidden']) return '';
    return label(typeof node.type === 'function' ? node.type(node.props) : node.props.children);
  }
  page();
  return {
    html: () => renderToStaticMarkup(page()),
    button: (text) =>
      find(page(), (node) => node.type === 'button' && label(node.props.children) === text),
    find: (matches) => find(page(), matches),
    flush: () => new Promise((resolve) => setImmediate(resolve)),
    unmount: () => effects.forEach((effect) => effect.cleanup?.()),
  };
}

const lead = {
  id: 'fixture-lead',
  customerPhoneNumber: 'Cliente de prueba',
  targetSizeCm: 11,
  status: 'ANALYZING',
  statusLabel: 'Incompleto',
  createdAt: '2026-10-06T12:00:00Z',
  archivedAt: null,
  deletable: true,
  manualFinalPrice: null,
  quote: null,
  bodyPart: 'brazo',
  visionV2: null,
  whatsappUrl: null,
  v2: {
    style: 'FINE_LINE',
    targetAreaCm2: null,
    targetColorCoverage: 0.25,
    bookingIntent: null,
    reviewReasons: [],
    specialReviewTypes: [],
    decision: null,
  },
};
const result = (leads) => ({
  leads,
  pagination: { page: 1, pageSize: 20, total: leads.length, totalPages: leads.length ? 1 : 0 },
});
const leadsAppend = '\nexport { LeadsWorkspace as TestedPage };';

test('filters retain visible orders while loading, then replace them with the new empty result', async () => {
  let release;
  let calls = 0;
  const page = mount(
    'dashboard/leads/page.tsx',
    {
      listLeads: async () =>
        ++calls === 1
          ? result([lead])
          : new Promise((resolve) => {
              release = resolve;
            }),
    },
    {},
    leadsAppend,
  );
  await page.flush();
  assert.match(page.html(), /Cliente de prueba/);
  page.button('Finalizados').props.onClick();
  assert.match(page.html(), /Actualizando.../);
  assert.match(page.html(), /Cliente de prueba/);
  assert.equal(page.button('Archivar').props.disabled, true);
  release(result([]));
  await page.flush();
  assert.doesNotMatch(page.html(), /Cliente de prueba|Actualizando.../);
  assert.match(page.html(), /No hay leads finalizados/);
  page.unmount();
});

test('a refresh error retains orders and retry recovers without reloading the page', async () => {
  let calls = 0;
  const page = mount(
    'dashboard/leads/page.tsx',
    {
      listLeads: async () => {
        if (++calls === 2) throw new Error('Error de actualización.');
        return result([lead]);
      },
    },
    {},
    leadsAppend,
  );
  await page.flush();
  page.button('Revisar').props.onClick();
  page.html();
  await page.flush();
  assert.match(page.html(), /No pudimos actualizar los pedidos/);
  assert.match(page.html(), /Cliente de prueba/);
  page.button('Reintentar').props.onClick();
  page.html();
  await page.flush();
  assert.equal(calls, 3);
  assert.doesNotMatch(page.html(), /No pudimos actualizar los pedidos/);
  assert.equal(page.button('Archivar').props.disabled, false);
  page.unmount();
});

test('an obsolete filter response cannot replace the latest result', async () => {
  let calls = 0;
  let release;
  const page = mount(
    'dashboard/leads/page.tsx',
    {
      listLeads: async () => {
        if (++calls === 2)
          return new Promise((resolve) => {
            release = resolve;
          });
        return result(calls === 1 ? [lead] : []);
      },
    },
    {},
    leadsAppend,
  );
  await page.flush();
  page.button('Revisar').props.onClick();
  page.html();
  page.button('Finalizados').props.onClick();
  page.html();
  await page.flush();
  release(result([lead]));
  await page.flush();
  assert.doesNotMatch(page.html(), /Cliente de prueba/);
  assert.match(page.html(), /No hay leads finalizados/);
  page.unmount();
});

test('saving a final price has busy feedback and cannot submit twice before a render', async () => {
  const reviewLead = { ...lead, status: 'REQUIRES_REVIEW' };
  let release;
  let calls = 0;
  const page = mount(
    'dashboard/leads/[id]/lead-detail-client.tsx',
    {
      getLead: async () => reviewLead,
      getLeadReference: async () => ({
        available: false,
        imageId: null,
        message: 'Sin imagen de prueba.',
      }),
      saveManualFinalPrice: async (id, price) => {
        assert.equal(id, lead.id);
        assert.equal(price, 321.25);
        calls++;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    },
    { leadId: lead.id },
  );
  await page.flush();
  page
    .find((node) => node.type === 'input' && node.props.inputMode === 'decimal')
    .props.onChange({ target: { value: '321.25' } });
  const submit = page.find((node) => node.type === 'form').props.onSubmit;
  submit({ preventDefault() {} });
  submit({ preventDefault() {} });
  assert.equal(calls, 1);
  assert.equal(page.button('Guardando...').props['aria-busy'], true);
  assert.equal(page.button('Guardando...').props.disabled, true);
  release({ ...reviewLead, manualFinalPrice: '321.25' });
  await page.flush();
  assert.match(page.html(), /Precio final guardado correctamente/);
  assert.equal(page.button('Guardar precio').props.disabled, false);
  page.unmount();
});
