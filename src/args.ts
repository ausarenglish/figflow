// Argument parsing.
//
// The set below is not decoration. A value flag missing from it does not fail —
// it silently becomes a boolean and its value falls through into the
// positionals, where `report` and `issue` read positionals as thread ids. So
// `--title "Fix cards"` used to file an issue against a thread called
// "Fix cards", and `--interval 30` used to poll every 300 seconds. Any new
// flag that takes a value MUST be listed here.

const VALUE_FLAGS = new Set([
  '--base-branch',
  '--branch',
  '--interval',
  '--label',
  '--name',
  '--note',
  '--pr',
  '--preview',
  '--since',
  '--title',
  '--token-expires',
])

const BOOLEAN_FLAGS = new Set([
  '--all',
  '--allow-empty',
  '--dry-run',
  '--each',
  '--force',
  '--help',
  '-h',
  '--init',
  '--json',
  '--no-trailers',
  '--offline',
  '--once',
  '--open',
  '--post',
  '--preview', // dual use: a value for `report`, a switch for `open`
  '--skip-check',
  '--version',
  '-v',
])

export type Args = {
  flags: Record<string, string | true>
  positionals: string[]
}

export function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | true> = {}
  const positionals: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === undefined) continue

    if (!arg.startsWith('-')) {
      positionals.push(arg)
      continue
    }

    // --flag=value is unambiguous and always allowed.
    const eq = arg.indexOf('=')
    if (eq > 2) {
      const name = arg.slice(0, eq)
      assertKnown(name)
      flags[name] = arg.slice(eq + 1)
      continue
    }

    assertKnown(arg)

    // A value flag consumes the next token only when there is one and it is not
    // itself a flag. That keeps `open <id> --preview` a switch, and stops
    // `--note --post` from swallowing --post.
    const next = argv[i + 1]
    if (VALUE_FLAGS.has(arg) && next !== undefined && !next.startsWith('-')) {
      flags[arg] = next
      i += 1
    } else {
      flags[arg] = true
    }
  }

  return { flags, positionals }
}

/**
 * An unrecognised flag is an error, not a no-op. A typo'd `--allow-emty` in a
 * deploy hook would otherwise do nothing and let the job pass.
 */
function assertKnown(name: string): void {
  if (VALUE_FLAGS.has(name) || BOOLEAN_FLAGS.has(name)) return
  throw new Error(`Unknown flag: ${name}\n  Run \`figflow help\` to see the flags each command takes.`)
}

export function str(args: Args, name: string): string | null {
  const value = args.flags[name]
  return typeof value === 'string' && value !== '' ? value : null
}

export function has(args: Args, name: string): boolean {
  return args.flags[name] !== undefined
}
