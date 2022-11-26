CREATE TABLE users (
  steam_id VARCHAR(64),
  steam_name VARCHAR(256),
  profile_url TEXT,
  avatar TEXT,
  avatar_medium TEXT,
  avatar_full TEXT,
  account_time_created INT,
  PRIMARY KEY(steam_id)
);

CREATE TABLE servers (
  host_and_port VARCHAR(128),
  host VARCHAR(128),
  port INT,
  img TEXT,
  logo TEXT,
  id TEXT,
  url TEXT,
  description TEXT,
  PRIMARY KEY (host_and_port)
);

CREATE TABLE server_pairings (
  server_host_and_port VARCHAR(128),
  user_steam_id VARCHAR(64),
  token TEXT,
  consecutive_failure_count INT DEFAULT 0,
  next_retry_time VARCHAR(32),
  PRIMARY KEY (server_host_and_port, user_steam_id)
);
