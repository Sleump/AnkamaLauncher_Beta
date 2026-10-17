/**
 * Abstract disk info/space check
 *
 * @module zaap/disk
 */
const inject = require('instill')

// check-disk-space@1.x shelled out to `wmic`, which Microsoft has removed from
// recent Windows 11 builds, breaking disk space checks there entirely. 3.x
// prefers PowerShell (Get-CimInstance) instead, and changed its exports from
// properties on the default function to separate named exports. Pinned to
// exactly 3.3.1 (not a caret range): 3.4.0 switched to `require('node:...')`
// core-module specifiers, which this app's old bundled Electron/Node (v4) does
// not support at all and crashes the whole app on startup.
const checkDiskSpaceModule = require('check-disk-space')

inject(exports, {
  checkDiskSpace: checkDiskSpaceModule.default,
  InvalidPathError: checkDiskSpaceModule.InvalidPathError,
  NoMatchError: checkDiskSpaceModule.NoMatchError,
})

// Errors
const {
  errors,
  ZaapError,
} = require('./errors').register('DISK', {
  INVALID_PATH: 9001,
  UNABLE_TO_GET_DRIVE_INFO: 9002,
})

exports.errors = errors

/**
 * @summary Get the drive info of a HDD
 * @param {string} directoryPath - the path to check
 * @return {Promise} Promise object
 */
exports.getDriveInfo = function (directoryPath) {
  const {
    checkDiskSpace,
    InvalidPathError,
    NoMatchError,
  } = this.modules

  const {
    INVALID_PATH,
    UNABLE_TO_GET_DRIVE_INFO,
  } = errors

  return checkDiskSpace(directoryPath)
    .catch(err => {
      if (err instanceof InvalidPathError || err instanceof NoMatchError) {
        throw new ZaapError(
          INVALID_PATH,
          err.message,
          'disk.error.invalidPath'
        )
      }

      throw new ZaapError(
        UNABLE_TO_GET_DRIVE_INFO,
        err.message,
        'disk.error.unableToGetDriveInfo'
      )
    })
}
