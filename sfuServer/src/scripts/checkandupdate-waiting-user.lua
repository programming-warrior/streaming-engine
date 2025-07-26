
local waiting_user = redis.call('LPOP', KEYS[1])

if waiting_user then
  return waiting_user
else
  redis.call('RPUSH', KEYS[1], ARGV[1])
  return nil
end