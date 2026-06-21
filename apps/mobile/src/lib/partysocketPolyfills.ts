/**
 * Web-global polyfills that `partysocket` needs but Hermes (React Native) lacks.
 * Imported by `realtime.ts` BEFORE `partysocket` so the globals exist when
 * partysocket's module + runtime code reference them. All conditional, so they
 * are no-ops where the globals already exist (the web build, Node/vitest).
 *
 *  - `EventTarget` / `Event`: provided by `event-target-polyfill` (partysocket's
 *    ReconnectingWebSocket extends EventTarget and defines its own
 *    ErrorEvent/CloseEvent subclasses of Event).
 *  - `MessageEvent`: partysocket constructs `new MessageEvent(type, { data })`
 *    for each incoming WS message using the GLOBAL constructor. Without it, Hermes
 *    throws `Property 'MessageEvent' doesn't exist` on the first message, so the
 *    lobby/game never receive `state_update` and silently stall.
 */
import 'partysocket/event-target-polyfill';

const g = globalThis as { MessageEvent?: unknown };

if (typeof g.MessageEvent === 'undefined') {
  class MessageEventPolyfill<T = unknown> extends Event {
    readonly data: T;
    constructor(type: string, init: { data?: T } & EventInit = {}) {
      super(type, init);
      this.data = (init.data ?? null) as T;
    }
  }
  g.MessageEvent = MessageEventPolyfill;
}
