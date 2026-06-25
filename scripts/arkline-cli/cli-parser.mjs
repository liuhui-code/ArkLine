const POSITION_COMMANDS = new Set(["language completion", "actions list"])
const EDIT_PRODUCING_COMMANDS = new Set(["actions resolve"])
const GENERATE_COMMANDS = new Set(["generate page", "generate component"])

export function parseArklineCliArgs(args) {
  try {
    const normalized = normalizeCommandArgs(args)
    const [area, name, ...rest] = normalized
    if (!area || !name) {
      throw new Error("Expected a command")
    }

    const options = parseOptions(rest)
    const command = {
      area,
      name,
      output: options.json ? "json" : options.pretty ? "pretty" : undefined,
      dryRun: !options.apply,
    }

    if (options.workspace !== undefined) {
      command.workspace = options.workspace
    }
    if (options.file !== undefined) {
      command.file = options.file
    }
    if (options.line !== undefined) {
      command.line = parsePositiveInteger(options.line, "--line")
    }
    if (options.column !== undefined) {
      command.column = parsePositiveInteger(options.column, "--column")
    }
    if (options.id !== undefined) {
      command.id = options.id
    }
    if (options.name !== undefined) {
      command.symbolName = options.name
    }
    if (options.to !== undefined) {
      command.to = options.to
    }

    validateCommand(command)

    return { ok: true, command }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function parseOptions(args) {
  const options = {
    apply: false,
    json: false,
    pretty: false,
  }

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    switch (value) {
      case "--workspace":
        options.workspace = requireNext(args, ++index, value)
        break
      case "--file":
        options.file = requireNext(args, ++index, value)
        break
      case "--line":
        options.line = requireNext(args, ++index, value)
        break
      case "--column":
        options.column = requireNext(args, ++index, value)
        break
      case "--id":
        options.id = requireNext(args, ++index, value)
        break
      case "--name":
        options.name = requireNext(args, ++index, value)
        break
      case "--to":
        options.to = requireNext(args, ++index, value)
        break
      case "--json":
        options.json = true
        break
      case "--pretty":
        options.pretty = true
        break
      case "--dry-run":
        options.apply = false
        break
      case "--apply":
        options.apply = true
        break
      default:
        throw new Error(`Unknown argument: ${value}`)
    }
  }

  if (options.json && options.pretty) {
    throw new Error("Use only one of --json or --pretty")
  }
  if (options.pretty) {
    throw new Error("--pretty is not implemented yet; use --json")
  }

  return options
}

function validateCommand(command) {
  const key = `${command.area} ${command.name}`

  if (key === "language inspect") {
    if (command.output !== "json") {
      throw new Error("language inspect requires --json")
    }
    return
  }

  if (POSITION_COMMANDS.has(key)) {
    if (
      !command.workspace ||
      !command.file ||
      command.line === undefined ||
      command.column === undefined ||
      command.output !== "json"
    ) {
      throw new Error(`${key} requires --workspace, --file, --line, --column, and --json`)
    }
    return
  }

  if (EDIT_PRODUCING_COMMANDS.has(key)) {
    if (!command.id || command.output !== "json") {
      throw new Error(`${key} requires --id and --json`)
    }
    return
  }

  if (GENERATE_COMMANDS.has(key)) {
    if (!command.workspace || !command.symbolName || command.output !== "json") {
      throw new Error(`${key} requires --workspace, --name, and --json`)
    }
    return
  }

  if (key === "rename-file workspace") {
    if (!command.workspace || !command.file || !command.to || command.output !== "json") {
      throw new Error("rename-file requires --workspace, --file, --to, and --json")
    }
    return
  }

  throw new Error(`Unsupported command: ${key}`)
}

function normalizeCommandArgs(args) {
  if (args[0] === "rename-file") {
    return ["rename-file", "workspace", ...args.slice(1)]
  }

  return args
}

function requireNext(args, index, flag) {
  const value = args[index]
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

function parsePositiveInteger(value, flag) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== value) {
    throw new Error(`${flag} requires a positive integer`)
  }
  return parsed
}
