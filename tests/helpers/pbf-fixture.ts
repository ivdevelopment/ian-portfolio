import { deflateSync } from "node:zlib";

/**
 * A tiny OpenStreetMap PBF ENCODER for tests: it writes a few synthetic nodes and ways (never real data) in the real file format, so the
 * reader and the index builder are exercised end to end without the 700 MB Belgium extract.
 */
const varint = (n: number): Buffer => {
  const out: number[] = [];
  let v = n;
  while (v >= 128) {
    out.push((v % 128) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return Buffer.from(out);
};
const zigzag = (n: number) => (n >= 0 ? n * 2 : -n * 2 - 1);
const tag = (field: number, wire: number) => varint(field * 8 + wire);
const lenField = (field: number, body: Buffer) => Buffer.concat([tag(field, 2), varint(body.length), body]);
const varField = (field: number, n: number) => Buffer.concat([tag(field, 0), varint(n)]);
const packed = (field: number, values: number[], zz = false) => lenField(field, Buffer.concat(values.map((v) => varint(zz ? zigzag(v) : v))));

export type FixtureNode = { id: number; lat: number; lon: number; tags?: Record<string, string> };
export type FixtureWay = { id: number; refs: number[]; tags: Record<string, string> };

class Strings {
  list: string[] = [""];
  idx(s: string): number {
    const i = this.list.indexOf(s);
    if (i >= 0) return i;
    this.list.push(s);
    return this.list.length - 1;
  }
  encode(): Buffer {
    return lenField(1, Buffer.concat(this.list.map((s) => lenField(1, Buffer.from(s, "utf8")))));
  }
}

const COORD = 1e7; // granularity 100 nanodegrees
const blob = (type: string, payload: Buffer): Buffer => {
  const body = Buffer.concat([varField(2, payload.length), lenField(3, deflateSync(payload))]);
  const header = Buffer.concat([lenField(1, Buffer.from(type)), varField(3, body.length)]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(header.length);
  return Buffer.concat([len, header, body]);
};

function nodeBlock(nodes: FixtureNode[]): Buffer {
  const st = new Strings();
  const ids: number[] = [];
  const lats: number[] = [];
  const lons: number[] = [];
  const kv: number[] = [];
  let pi = 0;
  let pla = 0;
  let plo = 0;
  for (const n of nodes) {
    ids.push(n.id - pi);
    pi = n.id;
    const la = Math.round(n.lat * COORD);
    const lo = Math.round(n.lon * COORD);
    lats.push(la - pla);
    lons.push(lo - plo);
    pla = la;
    plo = lo;
    for (const [k, v] of Object.entries(n.tags ?? {})) kv.push(st.idx(k), st.idx(v));
    kv.push(0);
  }
  const dense = Buffer.concat([packed(1, ids, true), packed(8, lats, true), packed(9, lons, true), packed(10, kv)]);
  return Buffer.concat([st.encode(), lenField(2, lenField(2, dense))]);
}

function wayBlock(ways: FixtureWay[]): Buffer {
  const st = new Strings();
  const groups = ways.map((w) => {
    const keys = Object.keys(w.tags).map((k) => st.idx(k));
    const vals = Object.values(w.tags).map((v) => st.idx(v));
    let prev = 0;
    const deltas = w.refs.map((r) => {
      const d = r - prev;
      prev = r;
      return d;
    });
    return lenField(3, Buffer.concat([varField(1, w.id), packed(2, keys), packed(3, vals), packed(8, deltas, true)]));
  });
  return Buffer.concat([st.encode(), lenField(2, Buffer.concat(groups))]);
}

/** A complete .osm.pbf file: header (with the data timestamp), one block of nodes and one block of ways. */
export function buildPbfFile(opts: { timestamp?: string; nodes: FixtureNode[]; ways?: FixtureWay[] }): Buffer {
  const header = Buffer.concat([opts.timestamp ? varField(32, Math.floor(Date.parse(opts.timestamp) / 1000)) : Buffer.alloc(0), lenField(4, Buffer.from("OsmSchema-V0.6"))]);
  const parts = [blob("OSMHeader", header), blob("OSMData", nodeBlock(opts.nodes))];
  if (opts.ways?.length) parts.push(blob("OSMData", wayBlock(opts.ways)));
  return Buffer.concat(parts);
}

/* ---- the synthetic "Brugge area" used by several tests ---- */
export const BRUGGE = { lat: 51.2093, lon: 3.2247 };

/** Businesses around a fictional Brugge. Names are invented; ids are small. */
export function sampleNodes(): FixtureNode[] {
  const at = (dLat: number, dLon: number) => ({ lat: BRUGGE.lat + dLat, lon: BRUGGE.lon + dLon });
  return [
    { id: 1, ...BRUGGE, tags: { place: "city", name: "Brugge", population: "118000" } },
    { id: 2, ...at(0.4, 0.4), tags: { place: "village", name: "Brugge", population: "50" } }, // a smaller namesake elsewhere: the city must win
    { id: 10, ...at(0.01, 0.01), tags: { name: "Fietsen Peeters", shop: "bicycle", website: "peeters.example", phone: "+32 50 12 34 56", "addr:city": "Brugge" } },
    { id: 11, ...at(0.02, 0), tags: { name: "Bakkerij Janssens", shop: "bakery", "addr:city": "Brugge" } }, // no website, no contact
    { id: 12, ...at(0.03, 0.02), tags: { name: "Dakwerken Claeys", craft: "roofer", website: "https://claeys.example/", email: "Info@Claeys.be", "addr:city": "Damme" } },
    { id: 13, ...at(0.05, 0), tags: { name: "Frituur Dichtbij", amenity: "fast_food", phone: "+32 50 00 00 00" } },
    { id: 14, ...at(0.001, 0), tags: { name: "Chain Cafe", amenity: "cafe", brand: "BigChain", website: "bigchain.example" } }, // chain: excluded
    { id: 15, ...at(0.02, 0.02), tags: { shop: "bicycle" } }, // no name: not a business we can use
    { id: 16, ...at(0.04, 0.01), tags: { name: "Leegstaand", shop: "vacant" } }, // vacant shop
    { id: 17, ...at(0.3, 0.3), tags: { name: "Fietsen Ver Weg", shop: "bicycle", website: "verweg.example" } }, // ~40 km away
    { id: 18, ...at(0.06, 0.03), tags: { name: "Evil Garage", shop: "car_repair", website: "javascript:alert(1)", email: "not-an-email", phone: "1".repeat(200) } },
    { id: 19, ...at(0.07, 0.01), tags: { name: "Haar & Co", shop: "hairdresser", "contact:website": "http://haarco.example", "contact:instagram": "haarco" } },
    // nodes that only give a building its position
    { id: 100, ...at(0.08, 0.02) },
    { id: 101, ...at(0.0802, 0.02) },
    { id: 102, ...at(0.0802, 0.0202) },
  ];
}

export function sampleWays(): FixtureWay[] {
  return [{ id: 500, refs: [100, 101, 102], tags: { name: "Schilderwerken Maes", craft: "painter", website: "maes.example" } }];
}
