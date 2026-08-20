import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Display-layer URI brand: the data layer keeps the upstream "core" domain
// (dsh/pi MCP clients and migrated data depend on core://), but the UI shows
// noc:// so the tree reads as the memory itself, not a namespaced store.
export function displayUri(uri) {
  if (typeof uri !== 'string') return uri;
  return uri.replace(/^core:\/\//, 'noc://');
}

