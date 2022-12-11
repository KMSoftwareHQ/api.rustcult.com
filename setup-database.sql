CREATE TABLE users (
  incrementing_id INT NOT NULL AUTO_INCREMENT,
  steam_id VARCHAR(64) NOT NULL,
  steam_name VARCHAR(256),
  profile_url TEXT,
  avatar TEXT,
  avatar_medium TEXT,
  avatar_full TEXT,
  account_time_created INT,
  last_movement_time TIMESTAMP,
  last_base_detection_time TIMESTAMP,
  PRIMARY KEY (incrementing_id),
  INDEX (steam_id),
  UNIQUE (steam_id)
);

CREATE TABLE servers (
  incrementing_id INT NOT NULL AUTO_INCREMENT,
  host_and_port VARCHAR(128) NOT NULL,
  host VARCHAR(128),
  port INT,
  name TEXT,
  img TEXT,
  logo TEXT,
  id TEXT,
  url TEXT,
  description TEXT,
  PRIMARY KEY (incrementing_id),
  INDEX (host_and_port),
  UNIQUE (host_and_port)
);

CREATE TABLE server_pairings (
  server_host_and_port VARCHAR(128),
  user_steam_id VARCHAR(64),
  token TEXT,
  consecutive_failure_count INT DEFAULT 0,
  next_retry_time VARCHAR(32),
  PRIMARY KEY (server_host_and_port, user_steam_id),
  UNIQUE (server_host_and_port, user_steam_id)
);

CREATE TABLE player_positions (
  server_incrementing_id INT,
  user_incrementing_id INT,
  timestamp TIMESTAMP(0),
  x FLOAT,
  y FLOAT,
  PRIMARY KEY (server_incrementing_id, user_incrementing_id, timestamp)
);

CREATE TABLE player_bases (
  server_host_and_port VARCHAR(128),
  user_steam_id VARCHAR(64),
  x FLOAT,
  y FLOAT,
  density FLOAT,
  INDEX (server_host_and_port, user_steam_id)
);
