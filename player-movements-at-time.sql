USE rustgovernment;

SELECT timestamp, x, y
FROM player_positions
WHERE user_incrementing_id = 93  # Vanuatu Gamer
#WHERE user_incrementing_id = 120  # Aperture
AND timestamp > CURRENT_TIMESTAMP - INTERVAL 16 HOUR
AND timestamp < CURRENT_TIMESTAMP
ORDER BY timestamp
;
