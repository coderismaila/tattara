// Read the app's on-device database (task 4.5) from a test.
import type { Page } from '@playwright/test'

/** Keys in the `tattara` IndexedDB `meta` table; [] when the database was wiped (or never created). */
export function localMetaKeys(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const names = (await indexedDB.databases()).map(d => d.name)
    if (!names.includes('tattara')) return []
    return new Promise<string[]>((resolve, reject) => {
      const open = indexedDB.open('tattara')
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const db = open.result
        if (!db.objectStoreNames.contains('meta')) {
          db.close()
          resolve([])
          return
        }
        const req = db.transaction('meta').objectStore('meta').getAllKeys()
        req.onsuccess = () => {
          db.close()
          resolve((req.result as string[]).sort())
        }
        req.onerror = () => reject(req.error)
      }
    })
  })
}
