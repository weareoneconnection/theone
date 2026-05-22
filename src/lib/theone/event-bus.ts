import type { TheOneEvent } from './types';

export class TheOneEventBus {
  private events: TheOneEvent[] = [];

  emit(event: TheOneEvent) {
    this.events.push(event);
  }

  getAll() {
    return this.events;
  }
}
