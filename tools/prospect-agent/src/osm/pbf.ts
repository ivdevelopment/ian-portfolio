import { closeSync, openSync, readSync } from "node:fs";
import { inflateSync } from "node:zlib";

/**
 * A small, dependency-free reader for OpenStreetMap PBF files (https://wiki.openstreetmap.org/wiki/PBF_Format), written for ONE purpose: streaming
 * a country extract once or twice without loading it into memory. It decodes only what the business index needs: dense nodes and nodes (id,
 * position, tags), ways (id, node refs, tags) and the header's replication timestamp. Relations are skipped.
 *
 * Everything in a PBF is untrusted input: lengths are bounds-checked and a malformed block throws (the caller keeps its previous index).
 * Numbers are JavaScript doubles, which are exact for OSM ids and coordinates (< 2^53).
 */
const MAX_HEADER = 64 * 1024;
const MAX_BLOB = 64 * 1024 * 1024;

/** Minimal protobuf wire-format reader over a Buffer slice. */
export class Reader {
  pos: number;
  constructor(readonly buf: Buffer, pos = 0, readonly end = buf.length) {
    this.pos = pos;
  }
  get done(): boolean {
    return this.pos >= this.end;
  }
  varint(): number {
    let result = 0;
    let mul = 1;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.end) throw new Error("truncated varint");
      const b = this.buf[this.pos++];
      result += (b & 0x7f) * mul;
      if ((b & 0x80) === 0) return result;
      mul *= 128;
    }
    throw new Error("varint too long");
  }
  sint(): number {
    const n = this.varint();
    return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
  }
  /** Reads a field header: [fieldNumber, wireType]. */
  tag(): [number, number] {
    const t = this.varint();
    return [Math.floor(t / 8), t % 8];
  }
  /** A length-delimited field as a sub-reader (no copy). */
  sub(): Reader {
    const len = this.varint();
    if (len < 0 || this.pos + len > this.end) throw new Error("length out of range");
    const r = new Reader(this.buf, this.pos, this.pos + len);
    this.pos += len;
    return r;
  }
  skip(wire: number): void {
    if (wire === 0) this.varint();
    else if (wire === 2) this.sub();
    else if (wire === 1) this.pos += 8;
    else if (wire === 5) this.pos += 4;
    else throw new Error(`unsupported wire type ${wire}`);
    if (this.pos > this.end) throw new Error("field out of range");
  }
  /** All values of a packed varint field. */
  packed(zigzag = false): number[] {
    const r = this.sub();
    const out: number[] = [];
    while (!r.done) out.push(zigzag ? r.sint() : r.varint());
    return out;
  }
}

export type OsmTags = Record<string, string>;
export type OsmNode = { id: number; lat: number; lon: number; tags: OsmTags | null };
export type OsmWay = { id: number; refs: number[]; tags: OsmTags };

/** What a caller wants from each kind of block. All callbacks are optional so a pass can skip what it does not need. */
export type PbfHandlers = {
  /** Header timestamp (ISO) of the extract's data, when present. */
  onHeader?: (info: { timestamp: string | null; features: string[] }) => void;
  /** Called per node. `tags` is null for an untagged node. Only tag keys accepted by `wantKey` are materialised. */
  onNode?: (node: OsmNode) => void;
  /** Called per way. */
  onWay?: (way: OsmWay) => void;
  /** Tag keys worth decoding; everything else is skipped without allocating. */
  wantKey?: (key: string) => boolean;
  /** Pass 1 only needs ways: node-only blocks are then skipped after inflating, without decoding their strings. */
  skipNodes?: boolean;
  onProgress?: (bytesRead: number, totalBytes: number) => void;
};

/** Streams every blob of a .osm.pbf file through the handlers. */
export function readPbf(path: string, handlers: PbfHandlers, fileSize: number): void {
  const fd = openSync(path, "r");
  try {
    let offset = 0;
    const lenBuf = Buffer.alloc(4);
    let lastProgress = 0;
    while (offset < fileSize) {
      if (readSync(fd, lenBuf, 0, 4, offset) !== 4) throw new Error("truncated file");
      const headerLen = lenBuf.readUInt32BE(0);
      if (headerLen === 0 || headerLen > MAX_HEADER) throw new Error("invalid blob header size");
      const header = Buffer.alloc(headerLen);
      if (readSync(fd, header, 0, headerLen, offset + 4) !== headerLen) throw new Error("truncated blob header");
      let dataSize = 0;
      const hr = new Reader(header);
      while (!hr.done) {
        const [f, w] = hr.tag();
        if (f === 3 && w === 0) dataSize = hr.varint();
        else hr.skip(w);
      }
      const type = readType(header);
      if (dataSize <= 0 || dataSize > MAX_BLOB) throw new Error("invalid blob size");
      const blob = Buffer.alloc(dataSize);
      if (readSync(fd, blob, 0, dataSize, offset + 4 + headerLen) !== dataSize) throw new Error("truncated blob");
      offset += 4 + headerLen + dataSize;
      const raw = blobData(blob);
      if (type === "OSMHeader") readHeader(raw, handlers);
      else if (type === "OSMData") readPrimitiveBlock(raw, handlers);
      if (handlers.onProgress && Date.now() - lastProgress > 2000) {
        lastProgress = Date.now();
        handlers.onProgress(offset, fileSize);
      }
    }
    handlers.onProgress?.(fileSize, fileSize);
  } finally {
    closeSync(fd);
  }
}

function readType(header: Buffer): string {
  const r = new Reader(header);
  while (!r.done) {
    const [f, w] = r.tag();
    if (f === 1 && w === 2) {
      const s = r.sub();
      return s.buf.toString("utf8", s.pos, s.end);
    }
    r.skip(w);
  }
  return "";
}

/** The decompressed payload of a Blob (raw or zlib; anything else is refused). */
function blobData(blob: Buffer): Buffer {
  const r = new Reader(blob);
  let raw: Buffer | null = null;
  let zlib: Buffer | null = null;
  let rawSize = 0;
  while (!r.done) {
    const [f, w] = r.tag();
    if (f === 1 && w === 2) {
      const s = r.sub();
      raw = blob.subarray(s.pos, s.end);
    } else if (f === 2 && w === 0) rawSize = r.varint();
    else if (f === 3 && w === 2) {
      const s = r.sub();
      zlib = blob.subarray(s.pos, s.end);
    } else if ((f === 4 || f === 5 || f === 6 || f === 7) && w === 2) throw new Error("unsupported blob compression");
    else r.skip(w);
  }
  if (raw) return raw;
  if (!zlib) throw new Error("blob has no data");
  if (rawSize > MAX_BLOB * 4) throw new Error("blob too large");
  return inflateSync(zlib);
}

function readHeader(raw: Buffer, h: PbfHandlers): void {
  const r = new Reader(raw);
  let timestamp: string | null = null;
  const features: string[] = [];
  while (!r.done) {
    const [f, w] = r.tag();
    if (f === 32 && w === 0) timestamp = new Date(r.varint() * 1000).toISOString();
    else if ((f === 4 || f === 5) && w === 2) {
      const s = r.sub();
      features.push(s.buf.toString("utf8", s.pos, s.end));
    } else r.skip(w);
  }
  h.onHeader?.({ timestamp, features });
}

function readPrimitiveBlock(raw: Buffer, h: PbfHandlers): void {
  const r = new Reader(raw);
  const groups: Reader[] = [];
  let strings: Reader | null = null;
  let granularity = 100;
  let latOffset = 0;
  let lonOffset = 0;
  while (!r.done) {
    const [f, w] = r.tag();
    if (f === 1 && w === 2) strings = r.sub();
    else if (f === 2 && w === 2) groups.push(r.sub());
    else if (f === 17 && w === 0) granularity = r.varint();
    else if (f === 19 && w === 0) latOffset = r.sint();
    else if (f === 20 && w === 0) lonOffset = r.sint();
    else r.skip(w);
  }
  if (!strings || groups.length === 0) return;

  // Which kinds of entity this block holds (cheap peek), so unwanted blocks never decode their string table.
  let hasWays = false;
  let hasNodes = false;
  for (const g of groups) {
    const peek = new Reader(g.buf, g.pos, g.end);
    while (!peek.done) {
      const [f, w] = peek.tag();
      if (f === 3) hasWays = true;
      else if (f === 1 || f === 2) hasNodes = true;
      peek.skip(w);
    }
  }
  const wantWays = Boolean(h.onWay) && hasWays;
  const wantNodes = Boolean(h.onNode) && hasNodes && !h.skipNodes;
  if (!wantWays && !wantNodes) return;

  const table: string[] = [];
  const st = new Reader(strings.buf, strings.pos, strings.end);
  while (!st.done) {
    const [f, w] = st.tag();
    if (f === 1 && w === 2) {
      const s = st.sub();
      table.push(s.buf.toString("utf8", s.pos, s.end));
    } else st.skip(w);
  }
  const want = h.wantKey;
  const tagsOf = (keys: number[], vals: number[]): OsmTags => {
    const tags: OsmTags = {};
    for (let i = 0; i < keys.length; i++) {
      const k = table[keys[i]];
      if (k !== undefined && (!want || want(k))) tags[k] = table[vals[i]] ?? "";
    }
    return tags;
  };
  const lat = (v: number) => 1e-9 * (latOffset + granularity * v);
  const lon = (v: number) => 1e-9 * (lonOffset + granularity * v);

  for (const g of groups) {
    const gr = new Reader(g.buf, g.pos, g.end);
    while (!gr.done) {
      const [f, w] = gr.tag();
      if (f === 2 && w === 2 && wantNodes) readDense(gr.sub(), table, want, lat, lon, h);
      else if (f === 1 && w === 2 && wantNodes) {
        const n = gr.sub();
        let id = 0;
        let la = 0;
        let lo = 0;
        let keys: number[] = [];
        let vals: number[] = [];
        while (!n.done) {
          const [nf, nw] = n.tag();
          if (nf === 1 && nw === 0) id = n.sint();
          else if (nf === 2 && nw === 2) keys = n.packed();
          else if (nf === 3 && nw === 2) vals = n.packed();
          else if (nf === 8 && nw === 0) la = n.sint();
          else if (nf === 9 && nw === 0) lo = n.sint();
          else n.skip(nw);
        }
        h.onNode!({ id, lat: lat(la), lon: lon(lo), tags: keys.length ? tagsOf(keys, vals) : null });
      } else if (f === 3 && w === 2 && wantWays) {
        const way = gr.sub();
        let id = 0;
        let keys: number[] = [];
        let vals: number[] = [];
        let refs: number[] = [];
        while (!way.done) {
          const [wf, ww] = way.tag();
          if (wf === 1 && ww === 0) id = way.varint();
          else if (wf === 2 && ww === 2) keys = way.packed();
          else if (wf === 3 && ww === 2) vals = way.packed();
          else if (wf === 8 && ww === 2) {
            const rr = way.sub();
            let acc = 0;
            refs = [];
            while (!rr.done) refs.push((acc += rr.sint()));
          } else way.skip(ww);
        }
        if (keys.length) h.onWay!({ id, refs, tags: tagsOf(keys, vals) });
      } else gr.skip(w);
    }
  }
}

function readDense(d: Reader, table: string[], want: ((k: string) => boolean) | undefined, lat: (v: number) => number, lon: (v: number) => number, h: PbfHandlers): void {
  let ids: number[] = [];
  let lats: number[] = [];
  let lons: number[] = [];
  let kv: number[] = [];
  while (!d.done) {
    const [f, w] = d.tag();
    if (f === 1 && w === 2) ids = d.packed(true);
    else if (f === 8 && w === 2) lats = d.packed(true);
    else if (f === 9 && w === 2) lons = d.packed(true);
    else if (f === 10 && w === 2) kv = d.packed();
    else d.skip(w);
  }
  let id = 0;
  let la = 0;
  let lo = 0;
  let k = 0;
  for (let i = 0; i < ids.length; i++) {
    id += ids[i];
    la += lats[i];
    lo += lons[i];
    let tags: OsmTags | null = null;
    // keys_vals: key,val pairs per node, ended by a 0.
    while (k < kv.length && kv[k] !== 0) {
      const key = table[kv[k]];
      const val = table[kv[k + 1]];
      if (key !== undefined && (!want || want(key))) (tags ??= {})[key] = val ?? "";
      k += 2;
    }
    k++; // the 0 terminator (also present for untagged nodes)
    h.onNode!({ id, lat: lat(la), lon: lon(lo), tags });
  }
}
