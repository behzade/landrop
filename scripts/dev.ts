const commands = [
  {
    name: "server",
    command: ["bun", "run", "server/main.ts"],
  },
  {
    name: "web",
    command: ["bun", "run", "vite", "--host", "0.0.0.0"],
  },
] as const

const children = commands.map(({ command }) =>
  Bun.spawn(command, {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  })
)

let shuttingDown = false

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    shutdown(signal === "SIGINT" ? 130 : 143)
  })
}

await Promise.race(
  children.map(async (child, index) => {
    const exitCode = await child.exited
    const name = commands[index]?.name ?? "process"

    if (!shuttingDown) {
      console.error(`${name} exited with ${exitCode}`)
      shutdown(exitCode || 1)
    }
  })
)

function shutdown(exitCode: number) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true

  for (const child of children) {
    child.kill("SIGTERM")
  }

  setTimeout(() => process.exit(exitCode), 100)
}
