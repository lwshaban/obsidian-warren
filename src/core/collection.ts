export class Collection {
  private collected: Set<string> = new Set();
  private listeners: (() => void)[] = [];

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }

  toggle(path: string): void {
    if (this.collected.has(path)) {
      this.collected.delete(path);
    } else {
      this.collected.add(path);
    }
    this.notify();
  }

  add(path: string): void {
    this.collected.add(path);
    this.notify();
  }

  remove(path: string): void {
    this.collected.delete(path);
    this.notify();
  }

  isCollected(path: string): boolean {
    return this.collected.has(path);
  }

  getAll(): string[] {
    return [...this.collected];
  }

  size(): number {
    return this.collected.size;
  }

  clear(): void {
    this.collected.clear();
    this.notify();
  }

  serialize(): string[] {
    return [...this.collected];
  }

  deserialize(data: string[]): void {
    this.collected = new Set(data);
    this.notify();
  }
}
