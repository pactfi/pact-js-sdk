import { decode } from "./encoding";

export function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function b64ToUtf8(data: string) {
  if (isBrowser()) {
    return decodeURIComponent(window.atob(data));
  } else {
    return decode(Buffer.from(data, "base64"));
  }
}
