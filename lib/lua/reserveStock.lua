-- reserveStock.lua
-- Atomically decrement stock for a cart. Either ALL items are reserved or NONE.
-- KEYS: stock keys per line, e.g. stock:counterId:menuItemId
-- ARGV: quantities matching KEYS order
-- Returns: {1, remaining1, remaining2, ...} on success, or {0, shortIndex} on failure.
-- The caller MUST release nothing on failure (nothing was decremented).
local n = #KEYS
for i = 1, n do
  local have = tonumber(redis.call("GET", KEYS[i]) or "0")
  local need = tonumber(ARGV[i])
  if have < need then
    return {0, i}
  end
end
local out = {1}
for i = 1, n do
  local remaining = redis.call("DECRBY", KEYS[i], ARGV[i])
  table.insert(out, remaining)
end
return out
