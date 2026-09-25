// Minimal types for the part of mapshaper we use (it ships no declarations).
declare module 'mapshaper' {
  interface Mapshaper {
    /** Runs mapshaper CLI commands on in-memory inputs; resolves to output file name → contents. */
    applyCommands(commands: string, inputs?: Record<string, unknown>): Promise<Record<string, string | Uint8Array>>
  }
  const mapshaper: Mapshaper
  export default mapshaper
}
