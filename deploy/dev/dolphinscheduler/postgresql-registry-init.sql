-- Licensed to the Apache Software Foundation (ASF) under one or more
-- contributor license agreements. See the NOTICE file distributed with
-- this work for additional information regarding copyright ownership.
-- The ASF licenses this file to You under the Apache License, Version 2.0.

-- data-os owns this one-shot migration wrapper. Unlike the upstream demo SQL,
-- it is idempotent and never drops registry state during a restart.
CREATE TABLE IF NOT EXISTS t_ds_jdbc_registry_data (
    id BIGSERIAL NOT NULL,
    data_key VARCHAR NOT NULL,
    data_value TEXT NOT NULL,
    data_type VARCHAR NOT NULL,
    client_id BIGINT NOT NULL,
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_update_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_t_ds_jdbc_registry_data_key
    ON t_ds_jdbc_registry_data (data_key);

CREATE TABLE IF NOT EXISTS t_ds_jdbc_registry_lock (
    id BIGSERIAL NOT NULL,
    lock_key VARCHAR NOT NULL,
    lock_owner VARCHAR NOT NULL,
    client_id BIGINT NOT NULL,
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uk_t_ds_jdbc_registry_lock_key
    ON t_ds_jdbc_registry_lock (lock_key);

CREATE TABLE IF NOT EXISTS t_ds_jdbc_registry_client_heartbeat (
    id BIGINT NOT NULL,
    client_name VARCHAR NOT NULL,
    last_heartbeat_time BIGINT NOT NULL,
    connection_config TEXT NOT NULL,
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS t_ds_jdbc_registry_data_change_event (
    id BIGSERIAL NOT NULL,
    event_type VARCHAR NOT NULL,
    jdbc_registry_data TEXT NOT NULL,
    create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);
