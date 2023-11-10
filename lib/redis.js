const { Redis } = require("ioredis");

const { config } = require("../config");

const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  db: config.redis.db,
});

exports.redis = redis;
