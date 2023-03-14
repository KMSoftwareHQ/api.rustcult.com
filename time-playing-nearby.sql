USE rustgovernment;

SELECT
  a.user_incrementing_id AS aid,
  b.user_incrementing_id AS bid,
  #COUNT(*),
  0.018997 * SUM(
    EXP(
      -((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)) / 882
    )
  ) AS gauss
FROM player_positions_by_timestamp a
INNER JOIN player_positions_by_timestamp b ON a.timestamp = b.timestamp
WHERE b.server_incrementing_id = a.server_incrementing_id
AND a.user_incrementing_id < b.user_incrementing_id
AND ABS(b.x - a.x) < 100
AND ABS(b.y - a.y) < 100
GROUP BY a.user_incrementing_id, b.user_incrementing_id
ORDER BY COUNT(*)
;
