import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { SessionAuthGuard } from './session-auth.guard.js';

describe('SessionAuthGuard', () => {
  it('rejects a private route without a session cookie', async () => {
    const authenticateSession = vi.fn();
    const guard = new SessionAuthGuard({ authenticateSession } as unknown as AuthService);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
      }),
    } as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toEqual(
      new UnauthorizedException('Debes iniciar sesión para continuar.'),
    );
    expect(authenticateSession).not.toHaveBeenCalled();
  });
});
