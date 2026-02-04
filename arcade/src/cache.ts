/**
 * Arcade Tools Cache
 *
 * Manages persistent caching of Arcade tools to ~/.arcade/openclaw.json
 * to avoid repeated API calls and support offline access to tool metadata.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ArcadeToolDefinition } from "./client.js";

// ============================================================================
// Types
// ============================================================================

export type CachedTool = {
  name: string;
  fully_qualified_name?: string;
  qualified_name?: string;
  description: string;
  toolkit: string;
  toolkit_description?: string;
  toolkit_version?: string;
  requires_auth?: boolean;
  auth_provider?: string;
};

export type ArcadeToolsCache = {
  version: number;
  created_at: string;
  updated_at: string;
  total_tools: number;
  toolkits: string[];
  tools: CachedTool[];
};

// ============================================================================
// Constants
// ============================================================================

const CACHE_VERSION = 1;

// Cache is valid for 24 hours by default
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Lazy-initialized paths (for testability)
let _cacheDir: string | null = null;
let _cacheFile: string | null = null;

function getCacheDir(): string {
  if (!_cacheDir) {
    _cacheDir = path.join(os.homedir(), ".arcade");
  }
  return _cacheDir;
}

function getCacheFile(): string {
  if (!_cacheFile) {
    _cacheFile = path.join(getCacheDir(), "openclaw.json");
  }
  return _cacheFile;
}

// ============================================================================
// Cache Operations
// ============================================================================

/**
 * Ensure the cache directory exists
 */
function ensureCacheDir(): void {
  if (!fs.existsSync(getCacheDir())) {
    fs.mkdirSync(getCacheDir(), { recursive: true });
  }
}

/**
 * Get the cache file path
 */
export function getCacheFilePath(): string {
  return getCacheFile();
}

/**
 * Check if the cache file exists
 */
export function cacheExists(): boolean {
  return fs.existsSync(getCacheFile());
}

/**
 * Check if the cache is valid (exists and not expired)
 */
export function isCacheValid(ttlMs: number = DEFAULT_CACHE_TTL_MS): boolean {
  if (!cacheExists()) {
    return false;
  }

  try {
    const cache = readCache();
    if (!cache || cache.version !== CACHE_VERSION) {
      return false;
    }

    const updatedAt = new Date(cache.updated_at).getTime();
    const now = Date.now();
    return now - updatedAt < ttlMs;
  } catch {
    return false;
  }
}

/**
 * Read the cache from disk
 */
export function readCache(): ArcadeToolsCache | null {
  if (!cacheExists()) {
    return null;
  }

  try {
    const content = fs.readFileSync(getCacheFile(), "utf-8");
    const cache = JSON.parse(content) as ArcadeToolsCache;

    // Validate version
    if (cache.version !== CACHE_VERSION) {
      return null;
    }

    return cache;
  } catch {
    return null;
  }
}

/**
 * Write the cache to disk
 */
export function writeCache(tools: ArcadeToolDefinition[]): ArcadeToolsCache {
  ensureCacheDir();

  // Extract unique toolkit names
  const toolkitSet = new Set<string>();
  const cachedTools: CachedTool[] = tools.map((tool) => {
    const toolkitName = typeof tool.toolkit === "string"
      ? tool.toolkit
      : tool.toolkit?.name ?? "unknown";
    const toolkitDesc = typeof tool.toolkit === "object" ? tool.toolkit?.description : undefined;
    const toolkitVersion = typeof tool.toolkit === "object" ? tool.toolkit?.version : undefined;

    toolkitSet.add(toolkitName);

    return {
      name: tool.name,
      fully_qualified_name: tool.fully_qualified_name,
      qualified_name: tool.qualified_name,
      description: tool.description,
      toolkit: toolkitName,
      toolkit_description: toolkitDesc,
      toolkit_version: toolkitVersion,
      requires_auth: tool.requires_auth,
      auth_provider: tool.auth_provider,
    };
  });

  const now = new Date().toISOString();
  const cache: ArcadeToolsCache = {
    version: CACHE_VERSION,
    created_at: now,
    updated_at: now,
    total_tools: cachedTools.length,
    toolkits: Array.from(toolkitSet).sort(),
    tools: cachedTools,
  };

  fs.writeFileSync(getCacheFile(), JSON.stringify(cache, null, 2));
  return cache;
}

/**
 * Delete the cache file
 */
export function clearCache(): boolean {
  if (cacheExists()) {
    fs.unlinkSync(getCacheFile());
    return true;
  }
  return false;
}

/**
 * Get cached tools, optionally filtered
 */
export function getCachedTools(opts?: {
  toolkit?: string;
  search?: string;
  limit?: number;
}): CachedTool[] {
  const cache = readCache();
  if (!cache) {
    return [];
  }

  let tools = cache.tools;

  // Filter by toolkit
  if (opts?.toolkit) {
    const tkLower = opts.toolkit.toLowerCase();
    tools = tools.filter((t) => t.toolkit.toLowerCase().includes(tkLower));
  }

  // Filter by search query
  if (opts?.search) {
    const queryLower = opts.search.toLowerCase();
    tools = tools.filter(
      (t) =>
        t.name.toLowerCase().includes(queryLower) ||
        t.description?.toLowerCase().includes(queryLower) ||
        t.toolkit.toLowerCase().includes(queryLower),
    );
  }

  // Apply limit
  if (opts?.limit && opts.limit > 0) {
    tools = tools.slice(0, opts.limit);
  }

  return tools;
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
  exists: boolean;
  valid: boolean;
  totalTools: number;
  toolkits: string[];
  updatedAt: string | null;
  ageMs: number | null;
} {
  const cache = readCache();

  if (!cache) {
    return {
      exists: cacheExists(),
      valid: false,
      totalTools: 0,
      toolkits: [],
      updatedAt: null,
      ageMs: null,
    };
  }

  const updatedAt = new Date(cache.updated_at).getTime();
  const ageMs = Date.now() - updatedAt;

  return {
    exists: true,
    valid: isCacheValid(),
    totalTools: cache.total_tools,
    toolkits: cache.toolkits,
    updatedAt: cache.updated_at,
    ageMs,
  };
}

/**
 * Convert cached tool back to ArcadeToolDefinition format
 */
export function toToolDefinition(cached: CachedTool): ArcadeToolDefinition {
  return {
    name: cached.name,
    fully_qualified_name: cached.fully_qualified_name,
    qualified_name: cached.qualified_name,
    description: cached.description,
    toolkit: {
      name: cached.toolkit,
      description: cached.toolkit_description,
      version: cached.toolkit_version,
    },
    requires_auth: cached.requires_auth,
    auth_provider: cached.auth_provider,
  };
}
