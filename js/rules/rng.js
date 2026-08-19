// River Stakes — seeded deterministic randomness (mulberry32 core, per-stream mixing).

/**
 * FNV-1a hash of a string to uint32.
 * @param {string} str
 * @returns {number} uint32
 */
export function seedFromString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic JSON serialization: object keys sorted recursively.
 * @param {*} value
 * @returns {string}
 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

/** cyrb53 53-bit hash of a string. */
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Deterministic 16-char hex hash of any JSON-safe value.
 * @param {*} value
 * @returns {string} 16 hex chars
 */
export function stateHash(value) {
  return cyrb53(stableStringify(value)).toString(16).padStart(16, '0');
}

/**
 * Seeded deterministic RNG (mulberry32). The stream name is mixed into the
 * seed so independent streams never share sequences.
 */
export class Rng {
  /**
   * @param {number} seed uint32
   * @param {string} [stream] stream label mixed into the seed
   */
  constructor(seed, stream = 'rules') {
    this._seed = seed >>> 0;
    this._stream = String(stream);
    this._state = (this._seed ^ seedFromString(this._stream)) >>> 0;
    this._calls = 0;
  }

  /** @returns {number} float in [0,1) */
  next() {
    this._calls++;
    let t = (this._state = (this._state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * @param {number} n upper bound (exclusive)
   * @returns {number} integer 0..n-1
   */
  int(n) {
    return Math.floor(this.next() * n);
  }

  /**
   * @param {number} lo inclusive low
   * @param {number} hi inclusive high
   * @returns {number} integer lo..hi
   */
  range(lo, hi) {
    return lo + this.int(hi - lo + 1);
  }

  /**
   * In-place Fisher–Yates shuffle.
   * @param {Array} arr
   * @returns {Array} the same array
   */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /**
   * @param {Array} arr
   * @returns {*} a random element
   */
  pick(arr) {
    return arr[this.int(arr.length)];
  }

  /**
   * Derive a new independent Rng from the current state and a stream name.
   * Does not advance this generator.
   * @param {string} stream
   * @returns {Rng}
   */
  fork(stream) {
    return new Rng((this._state ^ seedFromString(String(stream))) >>> 0, this._stream + '/' + stream);
  }

  /** @returns {{seed:number, stream:string, calls:number}} JSON-safe state */
  getState() {
    return { seed: this._seed, stream: this._stream, calls: this._calls };
  }

  /**
   * Restore a state previously produced by getState().
   * @param {{seed:number, stream:string, calls:number}} s
   */
  setState(s) {
    this._seed = s.seed >>> 0;
    this._stream = String(s.stream);
    this._state = (this._seed ^ seedFromString(this._stream)) >>> 0;
    this._calls = 0;
    for (let i = 0; i < s.calls; i++) this.next();
  }
}
