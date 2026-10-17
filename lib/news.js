
const inject = require('instill')

inject(exports, {
  http: require('./http'),
})

const CACHE_LIFETIME_IN_MS = 5 * 60 * 1000

exports.cache = {}

/**
 * @summary Get the news for a release from our own server (not Ankama's CMS)
 * @param {String} site - Full URL of our news API endpoint (release.information.default.news)
 * @param {Number} page - unused, kept for call-site compatibility with the release/game modules
 * @param {Number} count - number of news to get
 * @returns {Promise} Promise object, resolves with an array of { id, title, imageUrl, url, type }
 */
exports.get = function (site, page = 1, count = 3) {
  const {
    http,
  } = this.modules

  if (!site) {
    return Promise.resolve([])
  }

  const cacheKey = [site, count].join('/')

  const cachedSite = this.cache[cacheKey]
  if (cachedSite && cachedSite.date + CACHE_LIFETIME_IN_MS > Date.now()) {
    if (!cachedSite.news) {
      return cachedSite.promise
    }
    return Promise.resolve(cachedSite.news)
  }

  const separator = site.includes('?') ? '&' : '?'
  const url = `${site}${separator}count=${count}`

  const fetchPromise = http.get(url).then((response) => response.body)

  this.cache[cacheKey] = {
    date: Date.now(),
    promise: fetchPromise,
  }

  fetchPromise
    .then((news) => {
      const convertedNews = news.map((n) => {
        n.type = n.imageUrl ? 'IMG' : 'TXT'
        return n
      })
      this.cache[cacheKey].news = convertedNews
      return convertedNews
    })
    .catch(() => {
      delete this.cache[cacheKey]
    })

  return fetchPromise
}
