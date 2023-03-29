USE rustgovernment;

SELECT
  user_incrementing_id,
  COUNT(*) AS playtime_seconds
FROM player_positions_by_timestamp
GROUP BY user_incrementing_id
ORDER BY COUNT(*)
;
