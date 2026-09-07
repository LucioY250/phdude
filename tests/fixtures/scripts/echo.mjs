process.stdout.write(
  JSON.stringify({
    args: process.argv.slice(2),
    cwd: process.cwd(),
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('PHDUDE_'))),
  }),
);
