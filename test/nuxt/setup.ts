// The app's plugins open the Dexie database on start (offline store, ADR-036). Browsers have IndexedDB; happy-dom
// doesn't, so give the Nuxt test app the same in-memory IndexedDB the unit tests use.
import 'fake-indexeddb/auto'
