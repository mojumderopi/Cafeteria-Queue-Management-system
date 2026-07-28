-- promote.lua (anti-starvation)
-- For each order older than `ageMs`, bump its priority score by `boost`.
-- KEYS[1] = priority ZSET
-- ARGV[1] = nowMs
-- ARGV[2] = ageMs (orders older than this get boosted)
-- ARGV[3] = boost (added to score)
-- Returns: array of order IDs that were boosted (empty array if none).
-- Returning the IDs lets the caller emit a single targeted socket event
-- instead of fanning out orderStatus to every order in the queue.
local prioKey = KEYS[1]
local now = tonumber(ARGV[1])
local ageMs = tonumber(ARGV[2])
local boost = tonumber(ARGV[3])
local cutoff = now - ageMs
local stale = redis.call("ZRANGEBYSCORE", prioKey, "-inf", cutoff)
if #stale == 0 then return {} end
for i, id in ipairs(stale) do
  redis.call("ZINCRBY", prioKey, boost, id)
end
return stale
