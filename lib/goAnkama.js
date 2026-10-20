/**
 * Abstract the go ankama logic
 *
 * @module zaap/goAnkama
 */
const inject = require('instill')
const ipcMain = require('electron').ipcMain
const remoteCommunication = require('./remoteCommunication')

inject(exports, {
  settings: require('./settings'),
  buildConfig: require('./buildConfig'),
})

exports.setup = function () {
  ipcMain.on(remoteCommunication.CHANNELS.GO_ANKAMA_GET_URL, (event, keyword) => {
    event.returnValue = this.getUrl(keyword)
  })
}

/**
 * Pages de notre propre site pour chaque mot-cle utilise par l'UI (logbox ->
 * "Mon compte", ecran de login -> "Inscription"/"Besoin d'aide ?"). Tout
 * mot-cle absent de cette table retombe sur l'ancien comportement Ankama
 * (buildConfig.ankama.go) : rien ne casse si un nouveau bouton utilisant un
 * mot-cle inconnu est ajoute plus tard sans mettre a jour cette liste.
 */
const SITE_PAGES_BY_KEYWORD = {
  'profile': 'profile.php',
  'sign-up': 'register.php',
  'cannot-sign-in': 'login.php',
}

exports.getUrl = function (keyword) {
  const {
    settings,
    buildConfig,
  } = this.modules

  if (buildConfig.site && buildConfig.site.url && SITE_PAGES_BY_KEYWORD[keyword]) {
    return buildConfig.site.url + SITE_PAGES_BY_KEYWORD[keyword]
  }

  const baseUrl = buildConfig.ankama.go
  const language = settings.get(settings.KEYS.LANGUAGE)

  return baseUrl + language + '/go/' + keyword
}
