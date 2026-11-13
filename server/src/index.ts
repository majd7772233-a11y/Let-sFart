import type { Env } from './env.ts';
import { routeWorkerRequest } from './router.ts';

export { RaftRoom } from './rooms/RaftRoom.ts';

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    return routeWorkerRequest(request, env);
  },
};
