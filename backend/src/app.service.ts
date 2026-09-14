import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth() {
    return {
      service: 'tatto-flow-backend',
      status: 'ok',
    } as const;
  }
}
