module.exports = {
  computed: {
    release() {
      return this.$store.getters.displayedRelease
    },
    baseUrl() {
      return this.release.information.url
    },
    language() {
      return this.$store.state.settings[SETTINGS_KEYS.LANGUAGE]
    },
  },
}
