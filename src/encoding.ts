import { Buffer } from "buffer";

import algosdk from "algosdk";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encode(s: string): Uint8Array {
  return encoder.encode(s);
}

export function decode(s: Uint8Array): string {
  return decoder.decode(s);
}

export function encodeArray(arr: Array<any>): Uint8Array[] {
  return arr.map((value) => {
    if (typeof value === "number") {
      // uint64ToBigEndian doesn't quite return the Uint8Array and needs to be converted
      // That array has proto: UInt8Array, while needed is TypedArray
      return algosdk.encodeUint64(value);
    }
    return encoder.encode(value);
  });
}

export function decodeUint64Array(data: string): number[] {
  const buffer = Buffer.from(data, "base64");
  let offset = 0;
  const numbers: number[] = [];
  while (offset < buffer.length) {
    // We don't need bigints. The values will be small enough to fit into Number.
    numbers.push(Number(buffer.readBigUInt64BE(offset)));
    offset += 8;
  }
  return numbers;
}
