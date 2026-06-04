export class RememberedSet {
  constructor() {
    this._holders = new Set();
  }

  record(holder) {
    this._holders.add(holder);
  }

  remove(holder) {
    this._holders.delete(holder);
  }

  has(holder) {
    return this._holders.has(holder);
  }

  clear() {
    this._holders.clear();
  }

  iterateHolders(callback) {
    for (const holder of this._holders) {
      callback(holder);
    }
  }

  filterDead(predicate) {
    for (const holder of this._holders) {
      if (!predicate(holder)) this._holders.delete(holder);
    }
  }

  get size() {
    return this._holders.size;
  }
}
