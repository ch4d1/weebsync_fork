export class RingBuffer<T> {
  private readonly _buffer: (T | undefined)[];
  private _head: number = 0;
  private _tail: number = 0;
  private _size: number = 0;
  private readonly _capacity: number;

  constructor(capacity: number = 200) {
    this._capacity = capacity;
    this._buffer = new Array<T | undefined>(capacity);
  }

  push(item: T): void {
    this._buffer[this._tail] = item;
    this._tail = (this._tail + 1) % this._capacity;

    if (this._size < this._capacity) {
      this._size++;
    } else {
      this._head = (this._head + 1) % this._capacity;
    }
  }

  get(index: number): T | undefined {
    if (index >= this._size) {
      return undefined;
    }
    return this._buffer[(this._head + index) % this._capacity];
  }

  getAll(): T[] {
    const result: T[] = [];
    let count = this._size;
    let index = this._head;

    while (count > 0) {
      const item = this._buffer[index];
      if (item !== undefined) {
        result.push(item);
      }
      index = (index + 1) % this._capacity;
      count--;
    }

    return result;
  }

  get size(): number {
    return this._size;
  }
}
