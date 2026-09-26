import { ConversationState, DetailLevel, TattooSize } from '../../../generated/prisma/client.js';
import type { ConversationContext } from './chatbot.types.js';
import { NitaStateMachine } from './nita-state-machine.js';

const stateMachine = new NitaStateMachine();

function context(
  currentState: ConversationState,
  overrides: Partial<ConversationContext> = {},
): ConversationContext {
  return {
    currentState,
    selectedSize: null,
    selectedDetail: null,
    bodyPart: null,
    ...overrides,
  };
}

describe('NitaStateMachine', () => {
  it('returns Nita welcome and the fixed size options at conversation start', () => {
    const decision = stateMachine.begin();

    expect(decision.response.messages[0]?.text).toContain('Hola, soy Nita');
    expect(decision.response.messages[1]?.text).toBe('¿Qué tamaño aproximado tendrá tu tatuaje?');
    expect(decision.response.options).toEqual([
      { value: TattooSize.SMALL, label: 'Pequeño' },
      { value: TattooSize.MEDIUM, label: 'Mediano' },
      { value: TattooSize.LARGE, label: 'Grande' },
    ]);
  });

  it('transitions START to ASK_SIZE', () => {
    const decision = stateMachine.process(context(ConversationState.START), {
      type: 'text',
      value: 'hola',
    });

    expect(decision.update.currentState).toBe(ConversationState.ASK_SIZE);
    expect(decision.response.state).toBe(ConversationState.ASK_SIZE);
  });

  it.each([TattooSize.SMALL, TattooSize.MEDIUM, TattooSize.LARGE])(
    'accepts the valid size %s',
    (size) => {
      const decision = stateMachine.process(context(ConversationState.ASK_SIZE), {
        type: 'option',
        value: size,
      });

      expect(decision.update).toEqual({
        selectedSize: size,
        currentState: ConversationState.ASK_DETAIL,
      });
      expect(decision.response.state).toBe(ConversationState.ASK_DETAIL);
    },
  );

  it('keeps ASK_SIZE when the size is invalid', () => {
    const decision = stateMachine.process(context(ConversationState.ASK_SIZE), {
      type: 'option',
      value: 'EXTRA_LARGE',
    });

    expect(decision.update).toEqual({});
    expect(decision.response.state).toBe(ConversationState.ASK_SIZE);
  });

  it.each([DetailLevel.LIGHT, DetailLevel.MEDIUM, DetailLevel.DETAILED])(
    'accepts the valid detail level %s',
    (detail) => {
      const decision = stateMachine.process(
        context(ConversationState.ASK_DETAIL, { selectedSize: TattooSize.SMALL }),
        { type: 'option', value: detail },
      );

      expect(decision.update).toEqual({
        selectedDetail: detail,
        currentState: ConversationState.ASK_BODY_PART,
      });
      expect(decision.response.messages).toEqual([
        { type: 'text', text: '¿En qué parte del cuerpo será el tatuaje?' },
      ]);
      expect(decision.response.options).toEqual([]);
    },
  );

  it('keeps ASK_DETAIL when the input is invalid', () => {
    const decision = stateMachine.process(
      context(ConversationState.ASK_DETAIL, { selectedSize: TattooSize.SMALL }),
      { type: 'image', image: { content: new Uint8Array(), mimeType: 'image/jpeg' } },
    );

    expect(decision.update).toEqual({});
    expect(decision.response.state).toBe(ConversationState.ASK_DETAIL);
  });

  it('trims and accepts a valid body part', () => {
    const decision = stateMachine.process(
      context(ConversationState.ASK_BODY_PART, {
        selectedSize: TattooSize.SMALL,
        selectedDetail: DetailLevel.LIGHT,
      }),
      { type: 'text', value: '  brazo  ' },
    );

    expect(decision.update).toEqual({
      bodyPart: 'brazo',
      currentState: ConversationState.WAITING_IMAGE,
    });
    expect(decision.response.messages).toEqual([
      {
        type: 'text',
        text: 'Ahora envíame una imagen de referencia del tatuaje que deseas.',
      },
    ]);
  });

  it('ignores an obsolete interactive reply while waiting for the body part', () => {
    const decision = stateMachine.process(
      context(ConversationState.ASK_BODY_PART, {
        selectedSize: TattooSize.SMALL,
        selectedDetail: DetailLevel.DETAILED,
      }),
      { type: 'option', value: DetailLevel.LIGHT },
    );

    expect(decision).toEqual({
      ignored: true,
      update: {},
      response: {
        state: ConversationState.ASK_BODY_PART,
        messages: [],
        options: [],
      },
    });
  });

  it('rejects an empty body part', () => {
    const decision = stateMachine.process(context(ConversationState.ASK_BODY_PART), {
      type: 'text',
      value: '   ',
    });

    expect(decision.update).toEqual({});
    expect(decision.response.state).toBe(ConversationState.ASK_BODY_PART);
  });

  it('rejects a body part longer than 10 characters', () => {
    const decision = stateMachine.process(context(ConversationState.ASK_BODY_PART), {
      type: 'text',
      value: 'antebrazo largo',
    });

    expect(decision.update).toEqual({});
    expect(decision.response.messages[0]?.text).toBe(
      'La zona debe tener máximo 10 caracteres. Por favor, inténtalo nuevamente.',
    );
  });

  it('rejects text while waiting for an image', () => {
    const decision = stateMachine.process(context(ConversationState.WAITING_IMAGE), {
      type: 'text',
      value: 'ya la envié',
    });

    expect(decision.update).toEqual({});
    expect(decision.response.state).toBe(ConversationState.WAITING_IMAGE);
  });

  it('moves to ANALYZING when a valid image arrives', () => {
    const decision = stateMachine.process(context(ConversationState.WAITING_IMAGE), {
      type: 'image',
      image: {
        content: new Uint8Array(),
        mimeType: 'image/png',
        fileName: 'referencia.png',
      },
    });

    expect(decision.update.currentState).toBe(ConversationState.ANALYZING);
    expect(decision.response.state).toBe(ConversationState.ANALYZING);
  });

  it('keeps two customer contexts independent', () => {
    const firstCustomer = stateMachine.process(context(ConversationState.ASK_SIZE), {
      type: 'option',
      value: TattooSize.SMALL,
    });
    const secondCustomer = stateMachine.process(context(ConversationState.ASK_SIZE), {
      type: 'option',
      value: TattooSize.LARGE,
    });

    expect(firstCustomer.update.selectedSize).toBe(TattooSize.SMALL);
    expect(secondCustomer.update.selectedSize).toBe(TattooSize.LARGE);
  });
});
