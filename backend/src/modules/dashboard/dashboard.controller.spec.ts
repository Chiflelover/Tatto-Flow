import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { DashboardController } from './dashboard.controller.js';

describe('DashboardController security', () => {
  it('protects every dashboard route, including signed image URLs, at controller level', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, DashboardController) as unknown[];

    expect(guards).toContain(SessionAuthGuard);
  });
});
