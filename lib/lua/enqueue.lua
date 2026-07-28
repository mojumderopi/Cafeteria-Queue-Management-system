-- enqueue.lua
-- Push an order into the per-counter FIFO queue and the priority ZSET.
-- KEYS[1] = queue list (FIFO)
-- KEYS[2] = priority ZSET
-- ARGV[1] = orderId
-- ARGV[2] = base priority (now ms + urgency boost)
-- Returns 1 if the order was newly queued, 0 if it was already present (idempotent).
-- Idempotency is critical: a retry must not create a duplicate list entry, because
-- the matching LREM count=1 in dequeueOrder would only remove one of them.
local queueKey = KEYS[1]
local prioKey = KEYS[2]
local orderId = ARGV[1]
local score = tonumber(ARGV[2])
if redis.call("ZSCORE", prioKey, orderId) then
  return 0
end
redis.call("RPUSH", queueKey, orderId)
redis.call("ZADD", prioKey, score, orderId)
return 1
