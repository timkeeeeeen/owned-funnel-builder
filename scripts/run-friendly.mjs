const script = process.argv[2];

if (!script || !/^[a-z0-9][a-z0-9-]*\.mjs$/.test(script)) {
  console.error('\nSetup stopped: the requested setup step is not valid.\n');
  process.exitCode = 1;
} else {
  try {
    await import(new URL(`./${script}`, import.meta.url));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nSetup stopped: ${message}\n`);
    process.exitCode = 1;
  }
}
