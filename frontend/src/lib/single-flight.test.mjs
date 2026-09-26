import assert from 'node:assert/strict';
import test from 'node:test';
import { createSingleFlightRunner } from './single-flight.ts';

test('runs only one request when the action is triggered twice while pending', async () => {
  let releaseFirstRequest;
  const firstRequestPending = new Promise((resolve) => {
    releaseFirstRequest = resolve;
  });
  const runSingleFlight = createSingleFlightRunner();
  let requestCount = 0;
  const firstClick = runSingleFlight(async () => {
    requestCount += 1;
    await firstRequestPending;
  });
  const secondClick = await runSingleFlight(async () => {
    requestCount += 1;
  });

  assert.equal(secondClick, false);
  assert.equal(requestCount, 1);

  releaseFirstRequest();
  assert.equal(await firstClick, true);
  assert.equal(requestCount, 1);
});
