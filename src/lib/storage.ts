import { openDB } from "idb";
import type { AppState } from "../types";

const DB_NAME = "family-tree-prd-db";
const STORE_NAME = "kv";
const STATE_KEY = "app-state";
const LS_KEY = "family-tree-prd-fallback";

async function db() {
  return openDB(DB_NAME, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    },
  });
}

export async function loadState(): Promise<AppState | null> {
  try {
    const database = await db();
    const data = await database.get(STORE_NAME, STATE_KEY);
    if (data) return data as AppState;
  } catch {
    // ignore and fallback
  }

  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AppState;
  } catch {
    return null;
  }
}

export async function saveState(state: AppState): Promise<void> {
  try {
    const database = await db();
    await database.put(STORE_NAME, state, STATE_KEY);
  } catch {
    // ignore and fallback
  }

  localStorage.setItem(LS_KEY, JSON.stringify(state));
}
