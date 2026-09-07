process.kill(process.pid, 'SIGKILL');
setTimeout(() => {}, 60_000);
