import { Request, Response, NextFunction } from "express";
import { Router } from "express";

export type ApiTier = "pilot" | "basic" | "pro" | "enterprise";

export interface ApiKey {
  key: string;
  owner: string;
  tier: ApiTier;
  createdAt: number;
  contractsThisMonth: number;
  lastResetMonth: string;
  active: boolean;
}

export interface TierLimits {
  maxContractsPerMonth: number;
  ratePerMinute: number;
  mainnetAllowed: boolean;
}

export const TIER_LIMITS: Record<ApiTier, TierLimits> = {
  pilot:      { maxContractsPerMonth: 5,        ratePerMinute: 30,  mainnetAllowed: false },
  basic:      { maxContractsPerMonth: 25,       ratePerMinute: 60,  mainnetAllowed: true },
  pro:        { maxContractsPerMonth: 100,      ratePerMinute: 120, mainnetAllowed: true },
  enterprise: { maxContractsPerMonth: Infinity,  ratePerMinute: 300, mainnetAllowed: true },
};

const apiKeys: Map<string, ApiKey> = new Map();
const rateLimitWindows: Map<string, number[]> = new Map();

function generateKey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const segments = [];
  for (let s = 0; s < 4; s++) {
    let seg = "";
    for (let i = 0; i < 8; i++) {
      seg += chars[Math.floor(Math.random() * chars.length)];
    }
    segments.push(seg);
  }
  return "sv_" + segments.join("_");
}

export function createApiKey(owner: string, tier: ApiTier = "pilot"): ApiKey {
  const key: ApiKey = {
    key: generateKey(),
    owner,
    tier,
    createdAt: Math.floor(Date.now() / 1000),
    contractsThisMonth: 0,
    lastResetMonth: new Date().toISOString().slice(0, 7),
    active: true,
  };
  apiKeys.set(key.key, key);
  console.log("[AUTH] Created API key for " + owner + " (" + tier + "): " + key.key);
  return key;
}

export function revokeApiKey(key: string): boolean {
  const existing = apiKeys.get(key);
  if (!existing) return false;
  existing.active = false;
  return true;
}

export function getApiKey(key: string): ApiKey | undefined {
  return apiKeys.get(key);
}

export function listApiKeys(): ApiKey[] {
  return Array.from(apiKeys.values());
}

export function incrementContractCount(key: string): void {
  const existing = apiKeys.get(key);
  if (!existing) return;
  const currentMonth = new Date().toISOString().slice(0, 7);
  if (existing.lastResetMonth !== currentMonth) {
    existing.contractsThisMonth = 0;
    existing.lastResetMonth = currentMonth;
  }
  existing.contractsThisMonth++;
}

function checkRateLimit(key: string, tier: ApiTier): boolean {
  const now = Date.now();
  const windowMs = 60000;
  const limit = TIER_LIMITS[tier].ratePerMinute;
  const timestamps = rateLimitWindows.get(key) || [];
  const recent = timestamps.filter(t => now - t < windowMs);
  recent.push(now);
  rateLimitWindows.set(key, recent);
  return recent.length <= limit;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.path === "/health") { next(); return; }
  if (req.path.startsWith("/admin/")) { const adminKey = req.headers["x-admin-key"] as string; if (adminKey !== process.env.SURVIVOR_ADMIN_KEY) { res.status(401).json({ error: "Invalid admin key" }); return; } next(); return; }

  const apiKey = req.headers["x-api-key"] as string;
  if (!apiKey) {
    res.status(401).json({ error: "Missing API key", message: "Include x-api-key header." });
    return;
  }

  const keyRecord = apiKeys.get(apiKey);
  if (!keyRecord) { res.status(401).json({ error: "Invalid API key" }); return; }
  if (!keyRecord.active) { res.status(403).json({ error: "API key revoked" }); return; }

  if (!checkRateLimit(apiKey, keyRecord.tier)) {
    res.status(429).json({ error: "Rate limit exceeded", tier: keyRecord.tier });
    return;
  }

  if (req.path === "/work-contract" && req.method === "POST") {
    const currentMonth = new Date().toISOString().slice(0, 7);
    if (keyRecord.lastResetMonth !== currentMonth) {
      keyRecord.contractsThisMonth = 0;
      keyRecord.lastResetMonth = currentMonth;
    }
    const limit = TIER_LIMITS[keyRecord.tier].maxContractsPerMonth;
    if (keyRecord.contractsThisMonth >= limit) {
      res.status(429).json({ error: "Monthly contract limit reached", limit, used: keyRecord.contractsThisMonth, tier: keyRecord.tier });
      return;
    }
  }

  (req as any).apiKey = keyRecord;
  next();
}

export function createAdminRouter(): Router {
  const router = Router();

  router.post("/keys", (req, res) => {
    const { owner, tier } = req.body;
    if (!owner) return res.status(400).json({ error: "Missing required field: owner" });
    const validTiers: ApiTier[] = ["pilot", "basic", "pro", "enterprise"];
    const keyTier = validTiers.includes(tier) ? tier : "pilot";
    const key = createApiKey(owner, keyTier);
    res.status(201).json({ key: key.key, owner: key.owner, tier: key.tier, limits: TIER_LIMITS[key.tier] });
  });

  router.get("/keys", (_req, res) => {
    const keys = listApiKeys().map(k => ({
      key: k.key.slice(0, 10) + "...",
      owner: k.owner,
      tier: k.tier,
      contractsThisMonth: k.contractsThisMonth,
      active: k.active,
    }));
    res.json({ keys });
  });

  router.delete("/keys/:key", (req, res) => {
    const success = revokeApiKey(req.params.key);
    if (!success) return res.status(404).json({ error: "Key not found" });
    res.json({ message: "Key revoked" });
  });

  return router;
}
