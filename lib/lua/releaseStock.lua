-- releaseStock.lua
-- Refund stock when an order is rejected or cancelled.
-- KEYS: stock keys per line
-- ARGV: quantities matching KEYS order
local out = {}
for i = 1, #KEYS do
  local remaining = redis.call("INCRBY", KEYS[i], ARGV[i])
  table.insert(out, remaining)
end
return out
