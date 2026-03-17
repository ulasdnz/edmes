# Redis Architecture Notes

## Current State

- Single Redis instance, 1GB maxmemory, `noeviction` policy
- Two use cases on the same instance:
  - **Cache** (`redisClient`, keyPrefix `user:`): auth token cache (TTL 300s), role permissions cache (TTL 300s)
  - **Streams** (`streamClient`, no prefix): `events.user`, `events.station` with `MAXLEN ~ 10000`
- All cache keys have TTL set via `redis.set(key, value, 'EX', ttlSeconds)`
- Streams auto-trim at ~10,000 messages per stream (~5MB per stream)

## Why It Works Right Now

- `noeviction` means Redis returns OOM errors when full instead of evicting keys
- But practically, cache keys expire via TTL and streams trim via MAXLEN
- With 1 service: cache ~few MB + 1-2 streams ~10MB = nowhere near 1GB
- No real risk of OOM currently

## When to Split into Two Instances

**Trigger: Adding BullMQ**

BullMQ docs state:

> "It is very important to configure maxmemory-policy to noeviction. This is the ONLY setting that guarantees correct behavior of the queues."

BullMQ requires `noeviction` — if a job key gets evicted, the queue breaks silently. Cache needs eviction to function as a cache. These are incompatible on the same instance.

claude.md notu: **Cache & Events**: Redis 7 (ioredis for cache, Redis Streams for cross-service events). Single instance, `noeviction` policy. All cache keys **must** have a TTL. Streams use `MAXLEN ~ 10000` for auto-trimming. If BullMQ is added in
-the future, split into two instances: cache (`allkeys-lru`) + queue/streams (`noeviction`). See `REDIS-NOTES.md` for details.

**Action plan when BullMQ is added:**

1. Add second Redis service in `docker-compose.yml`:

```yaml
redis-cache:
  image: redis:7-alpine
  command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
  # Cache only — eviction OK, no persistence needed
  ports:
    - "6380:6379" # external debug only
  networks:
    - mes_network
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 10s
    timeout: 5s
    retries: 5

redis-queue:
  image: redis:7-alpine
  command: redis-server --maxmemory 512mb --maxmemory-policy noeviction --appendonly yes
  # Streams + BullMQ — no eviction, persistent
  ports:
    - "6381:6379" # external debug only
  volumes:
    - redis_queue_data:/data
  networks:
    - mes_network
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 10s
    timeout: 5s
    retries: 5
```

2. Add env vars per service:
   - `REDIS_CACHE_URL=redis://redis-cache:6379` (cache operations)
   - `REDIS_QUEUE_URL=redis://redis-queue:6379` (streams + BullMQ)

3. Update `@mes/cache` to use `REDIS_CACHE_URL`
4. Update `@mes/events` to use `REDIS_QUEUE_URL`
5. BullMQ connections use `REDIS_QUEUE_URL`

## Alternative: volatile-lru (Single Instance, No BullMQ)

If BullMQ is never added, switching to `volatile-lru` is an option:

- Keys WITH TTL (cache) → evicted when memory full
- Keys WITHOUT TTL (streams) → never evicted
- Works because all cache keys already have TTL set

Trade-off: Redis docs say "it is usually a better idea to run two Redis instances" for mixed workloads. Each TTL'd key costs extra memory for the expire metadata.

**Verdict: Not needed right now.** Current setup works. Revisit when BullMQ is added.

## Consider: Reduce maxmemory from 1GB to 256MB

Current 1GB is oversized for actual usage:

- 1 service cache (TTL 300s, few hundred keys) ≈ 1-5MB
- 2 streams (MAXLEN 10,000 each) ≈ 10MB
- Redis overhead (buffers, metadata) ≈ 20-30MB
- Total real usage ≈ ~50MB max

256MB gives 5x headroom over actual usage. Even at 10 services:

- 10 service caches ≈ 10-50MB
- 10 streams ≈ 50MB
- Total ≈ ~100MB → still fits in 256MB

When to go higher:

- BullMQ added → job data can grow, consider 512MB for the queue instance
- Large cache objects (user profiles with avatars, etc.) → monitor with `redis-cli INFO memory`

Change in docker-compose.yml:

```yaml
command: redis-server --maxmemory 256mb --maxmemory-policy noeviction --appendonly yes
```

Benefit: On-prem factory machines with 512GB-1TB SSD — RAM is more constrained than disk. Freeing 768MB matters when running MongoDB + Redis + Grafana + Loki + Promtail + all services.

## Stream Sizing Reference

- 1 event message ≈ 200-500 bytes
- MAXLEN 10,000 per stream ≈ 5MB
- 10 services × 1 stream = ~50MB total (worst case)
- 1GB Redis handles this easily
- 10,000 messages = hours of buffer if a consumer falls behind
