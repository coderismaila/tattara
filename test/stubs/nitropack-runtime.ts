// Stand-in for `nitropack/runtime` in plain-Node test projects, so server modules that import it can load.
// Anything that actually needs the Nitro runtime must be mocked in the test.
const unavailable = (name: string) => () => {
  throw new Error(`${name} needs the Nitro runtime; mock it in this test.`)
}
export const useRuntimeConfig = unavailable('useRuntimeConfig')
export const runTask = unavailable('runTask')
export const defineTask = <T>(task: T) => task
