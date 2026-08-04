const VALUE_FLAGS = new Set(['--note', '--pr', '--preview', '--branch', '--name'])

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
    if (arg.startsWith('-')) {
      if (VALUE_FLAGS.has(arg)) {
        i += 1
        flags[arg] = argv[i] ?? ''
      } else {
        flags[arg] = true
      }
    } else {
      positionals.push(arg)
    }
  }

  return { flags, positionals }
}

export function str(args: Args, name: string): string | null {
  const value = args.flags[name]
  return typeof value === 'string' && value !== '' ? value : null
}

export function has(args: Args, name: string): boolean {
  return args.flags[name] !== undefined
}
