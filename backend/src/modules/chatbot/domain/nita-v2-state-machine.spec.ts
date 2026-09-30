import { ColorDeclaration, ConversationState as State } from '../../../generated/prisma/client.js';
import type { ChatbotInput, ConversationContext } from './chatbot.types.js';
import { NitaStateMachine } from './nita-state-machine.js';
import { parseTargetSizeCm } from './nita-v2-state-machine.js';
import { VISION_IMAGE } from '../../../../test/fixtures/vision-v2.js';

const machine = new NitaStateMachine();
function context(
  currentState: State,
  overrides: Partial<ConversationContext> = {},
): ConversationContext {
  return {
    flowVersion: 'V2',
    currentState,
    selectedSize: null,
    selectedDetail: null,
    bodyPart: null,
    firstTattoo: null,
    sameSizeAsReference: null,
    targetSizeCm: null,
    colorDeclaration: null,
    ...overrides,
  };
}
const text = (value: string): ChatbotInput => ({ type: 'text', value });

describe('Nita V2 intake state machine', () => {
  it.each([true, false])(
    'completes the intake with sameSize=%s and stops before analysis',
    (sameSize) => {
      let current = context(State.START);
      const inputs: ChatbotInput[] = [
        text('hola'),
        { type: 'option', stage: 'firstTattoo', value: false },
        { type: 'image', image: VISION_IMAGE },
        { type: 'option', stage: 'sameSize', value: sameSize },
      ];
      if (!sameSize) inputs.push(text('12.5 cm'));
      inputs.push(
        { type: 'option', stage: 'color', value: ColorDeclaration.BLACK_WITH_SOME_COLOR },
        text('Antebrazo izquierdo'),
      );
      const states: State[] = [];
      for (const input of inputs) {
        const decision = machine.process(current, input);
        current = { ...current, ...decision.update };
        states.push(current.currentState);
      }
      expect(states).toEqual([
        State.ASK_FIRST_TATTOO,
        State.WAITING_IMAGE,
        State.ASK_SAME_SIZE,
        sameSize ? State.ASK_COLOR : State.ASK_DESIRED_SIZE_CM,
        ...(!sameSize ? [State.ASK_COLOR] : []),
        State.ASK_BODY_PART,
        State.READY_FOR_ANALYSIS,
      ]);
      expect(current).toMatchObject({
        firstTattoo: false,
        sameSizeAsReference: sameSize,
        targetSizeCm: sameSize ? null : 12.5,
        colorDeclaration: 'BLACK_WITH_SOME_COLOR',
        bodyPart: 'Antebrazo izquierdo',
        selectedSize: null,
        selectedDetail: null,
      });
      expect(machine.process(current, text('continuar'))).toMatchObject({
        ignored: true,
        update: {},
        response: { messages: [], options: [] },
      });
    },
  );
  it.each([
    ['8', 8],
    ['8 cm', 8],
    ['12.5 cm', 12.5],
  ])('accepts one main dimension %s', (value, size) => {
    expect(machine.process(context(State.ASK_DESIRED_SIZE_CM), text(String(value))).update).toEqual(
      { targetSizeCm: size, currentState: State.ASK_COLOR },
    );
  });
  it.each([
    '0',
    '-8',
    '8 pulgadas',
    '8 x 10 cm',
    'como un brazo',
    '8 o 10',
    'Infinity',
    'NaN',
    '8 m',
    '',
  ])('rejects ambiguous or unsupported size %s', (value) => {
    expect(parseTargetSizeCm(value)).toBeNull();
    expect(machine.process(context(State.ASK_DESIRED_SIZE_CM), text(value))).toMatchObject({
      update: {},
      response: { state: State.ASK_DESIRED_SIZE_CM },
    });
  });
  it.each(Object.values(ColorDeclaration))('accepts stable color %s', (value) => {
    expect(
      machine.process(context(State.ASK_COLOR), { type: 'option', stage: 'color', value }).update,
    ).toEqual({ colorDeclaration: value, currentState: State.ASK_BODY_PART });
  });
  it.each(['Black & Grey', 'negro y gris', 'Solo negro'])(
    'classifies textual %s as BLACK_ONLY',
    (value) => {
      expect(machine.process(context(State.ASK_COLOR), text(value)).update.colorDeclaration).toBe(
        'BLACK_ONLY',
      );
    },
  );
  it('supports yes/no textual fallback in the current question only', () => {
    expect(machine.process(context(State.ASK_FIRST_TATTOO), text('Sí')).update.firstTattoo).toBe(
      true,
    );
    expect(machine.process(context(State.ASK_SAME_SIZE), text('No')).update).toEqual({
      sameSizeAsReference: false,
      targetSizeCm: null,
      currentState: State.ASK_DESIRED_SIZE_CM,
    });
    expect(machine.process(context(State.ASK_COLOR), text('Sí')).update).toEqual({});
  });
  it('requires a reference without advancing on text', () => {
    const decision = machine.process(context(State.WAITING_IMAGE), text('hola'));
    expect(decision.update).toEqual({});
    expect(decision.response.messages[0]?.text).toContain('imagen de referencia');
  });
  it('rejects unsupported images and ignores reference images outside WAITING_IMAGE', () => {
    expect(
      machine.process(context(State.WAITING_IMAGE), {
        type: 'image',
        image: { ...VISION_IMAGE, mimeType: 'image/gif' },
      }).update,
    ).toEqual({});
    for (const state of [
      State.START,
      State.ASK_FIRST_TATTOO,
      State.ASK_SAME_SIZE,
      State.ASK_COLOR,
      State.READY_FOR_ANALYSIS,
    ]) {
      expect(
        machine.process(context(state), { type: 'image', image: VISION_IMAGE }).update,
      ).toEqual({});
    }
  });
  it('ignores earlier and V1 buttons', () => {
    expect(
      machine.process(context(State.ASK_SAME_SIZE), {
        type: 'option',
        stage: 'firstTattoo',
        value: true,
      }),
    ).toMatchObject({ ignored: true, update: {} });
    expect(
      machine.process(context(State.ASK_BODY_PART), {
        type: 'option',
        stage: 'color',
        value: 'MOSTLY_COLOR',
      }),
    ).toMatchObject({ ignored: true, update: {} });
    expect(
      machine.process(context(State.START), { type: 'option', stage: 'size', value: 'SMALL' }),
    ).toMatchObject({ ignored: true, update: {} });
  });
  it('does not route V1 states into V2, or V2 states into V1', () => {
    expect(
      machine.process(context(State.ASK_SIZE), { type: 'option', stage: 'size', value: 'SMALL' })
        .update,
    ).toEqual({});
    expect(
      machine.process(context(State.ASK_FIRST_TATTOO, { flowVersion: 'V1' }), text('Sí')).update,
    ).toEqual({});
    expect(
      machine.process(context(State.START, { flowVersion: 'V1' }), {
        type: 'option',
        stage: 'firstTattoo',
        value: true,
      }),
    ).toMatchObject({ ignored: true, update: {} });
    expect(
      machine.process(context(State.START, { flowVersion: 'V1' }), text('hola')).update
        .currentState,
    ).toBe(State.ASK_SIZE);
  });
  it('accepts a placement beyond 10 characters and rejects empty or oversized input', () => {
    expect(
      machine.process(context(State.ASK_BODY_PART), text('Antebrazo izquierdo')).update.bodyPart,
    ).toBe('Antebrazo izquierdo');
    for (const value of ['', 'a'.repeat(121), 'Solo negro'])
      expect(machine.process(context(State.ASK_BODY_PART), text(value)).update).toEqual({});
  });
});
