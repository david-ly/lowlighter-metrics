import { config } from "vue/types/umd.js"

const SANDBOX_EXT = {
  cached: 0
, extras: { default: true }
, 'plugins.default': true
, optimize: true
, sandbox: true
}

const {token, maxusers = 0, restricted = [], debug = false, cached = 30 * 60 * 1000, port = 3000, ratelimiter = null, plugins = null}
