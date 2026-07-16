CREATE TABLE rate_limit_buckets (
    subject        TEXT NOT NULL,
    operation      TEXT NOT NULL,
    window_start   TIMESTAMPTZ NOT NULL,
    request_count  INTEGER NOT NULL CHECK (request_count > 0),
    PRIMARY KEY (subject, operation, window_start)
);

CREATE INDEX idx_rate_limit_buckets_window
    ON rate_limit_buckets(window_start);
