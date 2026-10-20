/**
 * Minimal local server for the "ZaapConnect" protocol the Dofus Retro client
 * already speaks (client/sources-as/dofus/ZaapConnect.as in
 * dofus-retro-elbustemu — inherited from Ankama, never wired up on our side).
 *
 * This is deliberately NOT the real Ankama mechanism: that one is a Thrift
 * RPC service (see lib/service/index.js) which is permanently disabled here
 * (protocol-generated-nodejs, the Thrift bindings, are not part of this
 * source dump). ZaapConnect.as itself, however, only ever speaks a tiny
 * plain-text protocol over a raw TCP socket (Flash's XMLSocket, messages
 * terminated by a null byte, not Thrift framing) — simple enough to
 * implement directly with Node's `net` module, no Thrift needed at all.
 *
 * Flow (see ZaapConnect.as for the exact client-side state machine):
 *   1. Client connects to 127.0.0.1:<port> and sends
 *      "connect retro main -1 <hash>" (gameUid/release/instanceId are
 *      hardcoded in the client, not meaningful here — only <hash> matters).
 *   2. We reply "connect <sessionToken>" if <hash> matches the one we
 *      registered right before spawning the game (registerPendingHash),
 *      or "connect error" otherwise (client disables ZaapConnect for the
 *      rest of that run).
 *   3. Client sends "auth_getGameToken <sessionToken> <gameId>".
 *   4. We mint a real one-time login token via auth.createToken() (HTTP
 *      call to our own site, see lib/auth.js) and reply
 *      "auth_getGameToken <token>". The client then auto-submits the login
 *      form with login="#Z" and this token as password (see Login.as /
 *      Account.as — ACTION_LOGIN_WITH_ZAAP_TOKEN), which the login server
 *      consumes against accounts_login.zaaptoken (dofus-retro-elbustemu).
 *
 * @module zaap/zaapConnect
 */
const inject = require('instill')
const net = require('net')
const path = require('path')
const uuid = require('uuid')

inject(exports, {
  net,
  fs: require('fs'),
  uuid,
  auth: require('./auth'),
  logger: require('./logger'),
})

const DEFAULT_PORT = 26118
const MESSAGE_TERMINATOR = '\0'
const CONFIG_FILE_NAME = 'config.xml'

/**
 * @summary Add or overwrite the zaaphash="..." attribute on every <conf>
 * profile in the client's config.xml. zaapconnectport is expected to
 * already be there (baked in once by tools/build_launcher_repo.py in
 * dofus-retro-elbustemu, same value for everyone) — only the hash changes
 * on every single launch. Plain regex rather than an XML parser: the exact
 * shape of this file is already fixed/known (see docs/tutoriels/03-...md
 * in dofus-retro-elbustemu), no need for a dependency to edit one attribute.
 * @param {string} xml - Current config.xml contents.
 * @param {string} hash - The per-launch value to write.
 * @returns {string} Patched contents.
 */
function patchConfigXml(xml, hash) {
  return xml.replace(/<conf\b[^>]*>/g, (tag) => {
    if (/\bzaaphash\s*=\s*"[^"]*"/.test(tag)) {
      return tag.replace(/\bzaaphash\s*=\s*"[^"]*"/, `zaaphash="${hash}"`)
    }
    return tag.replace(/>$/, ` zaaphash="${hash}">`)
  })
}

exports.server = null
exports.port = DEFAULT_PORT

/**
 * The hash we expect "connect" to present, and the session token we hand
 * back once it does. A single slot is enough: we only ever spawn one game
 * instance at a time (zaap.yml -> maxInstances: 1). Both stay valid for the
 * lifetime of that game process, not just its first connection — the game
 * also re-runs this handshake whenever the player uses in-client "reconnect"
 * after a server-side disconnect (ZaapConnect.as -> Login.zaapAutoLogin()),
 * which must keep working for as long as the process is the one we spawned.
 * The actual one-time-use security boundary is the auth token minted below
 * (auth.createToken(), consumed server-side by the login server on first
 * use) — not this local handshake, which only proves "this process is the
 * one this launcher instance spawned" and stays true across reconnects.
 */
let pendingHash = null
let sessionToken = null

/**
 * @summary Register the hash a freshly-spawned game instance must present
 * to be trusted, right before actually spawning it.
 * @param {string} hash - Random per-launch value, also written into the
 * installed client's config.xml (zaaphash attribute) by release.js.
 * @returns {undefined} void
 */
exports.registerPendingHash = function (hash) {
  pendingHash = hash
  sessionToken = null
}

/**
 * @summary Prepare auto-login for an about-to-be-spawned game instance:
 * generate a fresh per-launch hash, write it into the installed client's
 * config.xml, and remember it so the matching "connect" is trusted. Called
 * by Release.prototype.start() right before scriptSpawner.spawn(). Never
 * throws: auto-login is a nice-to-have, a failure here must not prevent the
 * game from starting (the player just falls back to the normal login
 * screen).
 * @param {string} location - The release's install directory (same as
 * `this.location` in release.js), where config.xml lives.
 * @returns {undefined} void
 */
exports.prepareLaunch = function (location) {
  const {
    fs,
    uuid,
    logger,
  } = this.modules

  const configPath = path.join(location, CONFIG_FILE_NAME)

  try {
    const hash = uuid()
    const contents = fs.readFileSync(configPath, 'utf8')
    fs.writeFileSync(configPath, patchConfigXml(contents, hash))
    this.registerPendingHash(hash)
  } catch (error) {
    logger.warn('zaapConnect: unable to patch config.xml, auto-login into the game will be unavailable', error.message)
  }
}

/**
 * Transient EADDRINUSE handling: when a previous run of this same app exits
 * (window closed, relaunch after update, etc.) the OS can take a little
 * while to fully release the port before a freshly-spawned process tries to
 * bind it again — observed in practice (application.log) as "server error
 * ... EADDRINUSE" immediately followed, moments later, by a successful
 * "listening" from a *different* run. Previously this just gave up silently:
 * the game would then connect to nothing (ERROR_ZAAP_CONNECT_CONNECTION_FAILED)
 * or, worse, to an unrelated stale listener still holding the port from an
 * older process whose pendingHash no longer matches anything
 * (ERROR_ZAAP_CONNECT_LAUNCHER_IGNORING_CLIENT) — exactly the failure the
 * player sees, despite config.xml having just been patched correctly.
 */
const LISTEN_RETRY_DELAY_MS = 500
const LISTEN_MAX_RETRIES = 6 // ~3s total, generous for a just-exited process's socket to clear

/**
 * @summary Start listening for ZaapConnect connections from the game client.
 * Safe to call once at app startup; retries a few times on EADDRINUSE (see
 * above), then gives up and logs — ZaapConnect is a nice-to-have, not core
 * functionality, this must never crash the app.
 * @returns {undefined} void
 */
exports.start = function () {
  const {
    net,
    logger,
  } = this.modules

  if (this.server) {
    return
  }

  const attempt = (retriesLeft) => {
    const server = net.createServer((socket) => {
      let buffer = ''

      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8')

        let terminatorIndex
        while ((terminatorIndex = buffer.indexOf(MESSAGE_TERMINATOR)) !== -1) {
          const message = buffer.slice(0, terminatorIndex)
          buffer = buffer.slice(terminatorIndex + 1)
          this.handleMessage(socket, message)
        }
      })

      socket.on('error', (error) => {
        logger.debug('zaapConnect: socket error', error.message)
      })
    })

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE' && retriesLeft > 0) {
        logger.debug(`zaapConnect: port ${this.port} still in use, retrying in ${LISTEN_RETRY_DELAY_MS}ms (${retriesLeft} left)`)
        server.close()
        setTimeout(() => attempt(retriesLeft - 1), LISTEN_RETRY_DELAY_MS)
        return
      }

      // Giving up: do NOT leave `this.server` pointing at a server that
      // never bound, or the `if (this.server) return` guard above would
      // permanently block any later retry (e.g. a future manual call).
      this.server = null
      logger.warn('zaapConnect: server error, auto-login into the game will be unavailable', error.message)
    })

    server.listen(this.port, '127.0.0.1', () => {
      logger.info('zaapConnect: listening on 127.0.0.1:' + this.port)
    })

    this.server = server
  }

  attempt(LISTEN_MAX_RETRIES)
}

/**
 * @summary Handle one complete (null-byte-delimited) message from the game.
 * @param {net.Socket} socket - The client connection.
 * @param {string} message - Raw message, e.g. "connect retro main -1 <hash>".
 * @returns {undefined} void
 */
exports.handleMessage = function (socket, message) {
  const {
    auth,
    logger,
  } = this.modules

  const parts = message.split(' ')
  const command = parts[0]

  logger.debug('zaapConnect: <-- ' + message)

  if (command === 'connect') {
    const hash = parts[4]

    if (!pendingHash || hash !== pendingHash) {
      logger.debug(`zaapConnect: hash mismatch, rejecting connect. received="${hash}" pending="${pendingHash}"`)
      this.reply(socket, 'connect error')
      return
    }

    sessionToken = hash
    this.reply(socket, 'connect ' + sessionToken)
    return
  }

  if (command === 'auth_getGameToken') {
    const receivedSessionToken = parts[1]

    if (!sessionToken || receivedSessionToken !== sessionToken) {
      socket.destroy()
      return
    }

    auth.createToken()
      .then((token) => {
        this.reply(socket, 'auth_getGameToken ' + token)
        // pendingHash/sessionToken deliberately survive this: the game may
        // ask again later (in-client "reconnect" after a disconnect), and
        // that must keep working for the rest of this process's lifetime.
        // See the doc comment on the variables above for why that's safe --
        // each individual token minted here is still one-time-use where it
        // actually matters (the login server). registerPendingHash() resets
        // both on the next fresh spawn.
      })
      .catch(() => {
        socket.destroy()
      })
    return
  }

  logger.debug('zaapConnect: unknown command, ignoring: ' + command)
}

/**
 * @summary Send a reply, null-byte terminated as XMLSocket expects.
 * @param {net.Socket} socket - The client connection.
 * @param {string} message - Message to send, without the terminator.
 * @returns {undefined} void
 */
exports.reply = function (socket, message) {
  const {
    logger,
  } = this.modules

  logger.debug('zaapConnect: --> ' + message)
  socket.write(message + MESSAGE_TERMINATOR)
}
