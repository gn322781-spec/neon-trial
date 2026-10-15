const KEY = "neon-trial-nickname";
const EVENT = "neon-trial-nickname-change";

export function getNickname() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(KEY) ?? "";
}

export function subscribeNickname(callback: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("storage", callback);
  window.addEventListener(EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(EVENT, callback);
  };
}

export function saveNickname(value: string) {
  window.localStorage.setItem(KEY, value);
  window.dispatchEvent(new Event(EVENT));
}
