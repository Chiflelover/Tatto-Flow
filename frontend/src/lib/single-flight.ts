export function createSingleFlightRunner() {
  let running = false;

  return async (action: () => Promise<void>): Promise<boolean> => {
    if (running) {
      return false;
    }

    running = true;

    try {
      await action();
      return true;
    } finally {
      running = false;
    }
  };
}
